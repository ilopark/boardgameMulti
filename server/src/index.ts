import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import sirv from 'sirv'
import { Server, type Socket } from 'socket.io'
import { randomInt } from 'node:crypto'
import {
  createRng,
  hashSeed,
  TURN_POLICY,
  GAME_LABEL,
  josa,
  MIN_PLAYERS,
  SEAT_COUNT,
  skullking,
  tichu,
  type ClientToServer,
  type GameId,
  type ServerToClient,
} from '@bg/core'
import {
  addPlayer,
  applySeatArrangement,
  compactSeats,
  createRoom,
  deleteRoom,
  firstFreeSeat,
  getRoom,
  reassignHostIfNeeded,
  roomCount,
  seatTakenBy,
  shuffleSeats,
  sweep,
  toPublic,
  type Room,
} from './rooms.js'

const PORT = Number(process.env.PORT ?? 3001)
const IS_PROD = process.env.NODE_ENV === 'production'
/**
 * CORS 정책
 * - CORS_ORIGIN을 주면 그 값만 허용
 * - 배포(NODE_ENV=production)에선 서버가 프론트까지 같이 주므로 **같은 오리진만** 허용(false)
 * - 개발에선 같은 와이파이 친구가 http://192.168.x.x:5173 으로 들어와야 하므로 열어둔다
 */
const ORIGIN: string | boolean = process.env.CORS_ORIGIN ?? !IS_PROD

interface SocketData {
  roomCode?: string
  playerId?: string
}

/**
 * 배포 시엔 서버가 빌드된 React 앱까지 같이 서빙한다.
 * 서비스를 하나로 합치면 CORS가 사라지고, 무료 호스팅 1개 슬롯에 다 들어간다.
 * WEB_DIST가 없으면(로컬 개발) 정적 서빙 없이 API만 뜬다.
 */
const webDist = process.env.WEB_DIST ?? resolve(import.meta.dirname, '../../web/dist')
const serveWeb = existsSync(webDist)
  ? sirv(webDist, { single: true, gzip: true, brotli: true, maxAge: 3600 })
  : null

if (serveWeb) console.log(`정적 파일 서빙: ${webDist}`)
else console.log('정적 파일 없음 — API만 서빙 (개발 모드에선 vite가 따로 뜬다)')

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: roomCount() }))
    return
  }
  if (serveWeb) {
    serveWeb(req, res, () => {
      res.writeHead(404)
      res.end()
    })
    return
  }
  res.writeHead(404)
  res.end()
})

const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(http, {
  cors: { origin: ORIGIN, credentials: true },
})

function defaultOptions(game: GameId): Record<string, unknown> {
  if (game === 'skullking') {
    return { ...skullking.DEFAULT_SK_OPTIONS } as unknown as Record<string, unknown>
  }
  return { ...tichu.DEFAULT_TICHU_OPTIONS } as unknown as Record<string, unknown>
}

function broadcast(room: Room): void {
  io.to(room.code).emit('room:state', toPublic(room))
}

/** 각자에게 **자기 것만 보이는** 게임 뷰를 보낸다. 사람마다 내용이 다르다. */
function broadcastGame(room: Room): void {
  const waitingFor = room.skGame
    ? skullking.waitingSeats(room.skGame)
    : room.tichuGame
      ? tichu.waitingSeats(room.tichuGame)
      : null
  if (waitingFor === null) return

  // 절대 시각이 아니라 남은 시간을 보낸다 — 클라이언트 시계가 어긋나 있어도 카운트다운이 맞는다
  const remainingMs =
    room.turnDeadline === null ? null : Math.max(0, room.turnDeadline - Date.now())

  for (const player of room.players.values()) {
    if (player.socketId === null || player.seat === null) continue
    const socket = io.sockets.sockets.get(player.socketId)
    const view = room.skGame
      ? skullking.viewFor(room.skGame, player.seat)
      : tichu.viewFor(room.tichuGame!, player.seat)
    socket?.emit('game:view', { view, remainingMs, waitingFor })
  }
}

/** 지금 진행 중인 게임의 단계 이름 (제한시간 계산용) */
function currentPhase(room: Room): string | null {
  return room.skGame?.phase ?? room.tichuGame?.phase ?? null
}

function clearTurnTimer(room: Room): void {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer)
    room.turnTimer = null
  }
  room.turnDeadline = null
}

/**
 * 제한시간을 건다. 시간이 다 되면 서버가 대신 행동한다.
 * 트릭 테이킹은 "패스"가 없어서 누군가 자리를 비우면 판 전체가 멈추기 때문.
 */
function scheduleTurnTimeout(room: Room): void {
  clearTurnTimer(room)
  const phase = currentPhase(room)
  if (phase === null) return

  // 생각할 게 많은 단계는 bidMs, 카드 한 장 내는 건 playMs (공용 정책)
  const THINKING: Record<string, number> = {
    bidding: TURN_POLICY.bidMs,
    grandTichu: TURN_POLICY.bidMs,
    passing: TURN_POLICY.bidMs,
    playing: TURN_POLICY.playMs,
    dragonGift: TURN_POLICY.playMs,
  }
  const limit = THINKING[phase]
  if (limit === undefined) return

  room.turnDeadline = Date.now() + limit
  room.turnTimer = setTimeout(() => handleTurnTimeout(room), limit)
}

/** 시간 초과 — 대신 행동하고 계속 진행한다 */
function handleTurnTimeout(room: Room): void {
  if (room.tichuGame && room.rng) return handleTichuTimeout(room)
  const game = room.skGame
  if (!game || !room.rng) return
  try {
    if (game.phase === 'bidding') {
      // 아직 입찰 안 한 사람 전원을 0으로 처리
      let next = game
      for (let seat = 0; seat < next.humanCount; seat++) {
        if (next.bids[seat] !== null) continue
        next = skullking.reduce(next, { type: 'bid', seat, value: skullking.autoBid(next, seat) }, room.rng)
      }
      room.skGame = next
      console.log(`[시간초과] ${room.code} 미입찰자 자동 0 입찰`)
    } else if (game.phase === 'playing') {
      const seat = skullking.currentSeat(game)
      if (seat === null) return
      const pick = skullking.pickWeakestLegal(game, seat)
      if (!pick) return
      room.skGame = skullking.reduce(
        game,
        pick.tigressAs
          ? { type: 'play', seat, cardId: pick.card.id, tigressAs: pick.tigressAs }
          : { type: 'play', seat, cardId: pick.card.id },
        room.rng,
      )
      console.log(`[시간초과] ${room.code} ${seat}번 자동 제출 ${pick.card.id}`)
    }
  } catch (e) {
    console.error('[시간초과 처리 실패]', e)
    return
  }
  afterGameChange(room)
}

/** 티츄 시간 초과 — 기다리는 사람 전원을 대신 처리한다 */
function handleTichuTimeout(room: Room): void {
  const rng = room.rng
  if (!rng) return
  try {
    let game = room.tichuGame!
    for (const seat of tichu.waitingSeats(game)) {
      const action = tichu.autoAction(game, seat)
      if (!action) continue
      game = tichu.reduce(game, action, rng)
      console.log(`[시간초과] ${room.code} 티츄 ${seat}번 자동 ${action.type}`)
    }
    room.tichuGame = game
  } catch (e) {
    console.error('[티츄 시간초과 처리 실패]', e)
    return
  }
  afterGameChange(room)
}

/**
 * 게임 상태가 바뀐 뒤 공통 처리.
 * **타이머를 먼저 세팅하고 그 다음에 뷰를 보낸다** — 순서가 반대면
 * 클라이언트가 직전 단계의 남은 시간을 받아서 카운트다운이 엉뚱하게 나온다.
 */
function afterGameChange(room: Room): void {
  scheduleTurnTimeout(room)
  scheduleAdvance(room)
  broadcastGame(room)
}

function clearAdvanceTimer(room: Room): void {
  if (room.advanceTimer) {
    clearTimeout(room.advanceTimer)
    room.advanceTimer = null
  }
}

/** 결과 화면(trickEnd/roundEnd)에서 다음으로 넘어간다 */
function advance(room: Room): void {
  if (!room.rng) return
  const phase = currentPhase(room)
  if (phase !== 'trickEnd' && phase !== 'roundEnd') return

  clearAdvanceTimer(room)
  clearTurnTimer(room)

  if (room.skGame) {
    room.skGame = skullking.reduce(room.skGame, { type: 'advance' }, room.rng)
    const next = room.skGame
    room.dealerSeat = skullking.dealerForRound(next.initialDealer, next.roundIndex, next.humanCount)
    if (next.phase === 'gameEnd') {
      room.phase = 'finished'
      broadcast(room)
    }
  } else if (room.tichuGame) {
    room.tichuGame = tichu.reduce(room.tichuGame, { type: 'advance' }, room.rng)
    if (room.tichuGame.phase === 'gameEnd') {
      room.phase = 'finished'
      broadcast(room)
    }
  }
  afterGameChange(room)
}

/** 결과 화면은 버튼 없이 자동으로 넘어간다 (공용 정책) */
function scheduleAdvance(room: Room): void {
  clearAdvanceTimer(room)
  const phase = currentPhase(room)
  if (phase !== 'trickEnd' && phase !== 'roundEnd') return
  const wait = phase === 'trickEnd' ? TURN_POLICY.trickEndMs : TURN_POLICY.roundEndMs
  room.turnDeadline = Date.now() + wait
  room.advanceTimer = setTimeout(() => advance(room), wait)
}

/** 게임을 끝내고 대기실로 되돌린다 */
function resetToLobby(room: Room): void {
  clearAdvanceTimer(room)
  clearTurnTimer(room)
  room.skGame = null
  room.tichuGame = null
  room.seatArrangement = null
  room.rng = null
  room.dealerSeat = null
  room.phase = 'lobby'
  for (const p of room.players.values()) p.ready = false
}

function isValidNickname(nickname: unknown): nickname is string {
  return typeof nickname === 'string' && nickname.trim().length >= 1 && nickname.trim().length <= 12
}

function currentRoomAndPlayer(socket: Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>) {
  const code = socket.data.roomCode
  const playerId = socket.data.playerId
  if (!code || !playerId) return null
  const room = getRoom(code)
  if (!room) return null
  const player = room.players.get(playerId)
  if (!player) return null
  return { room, player }
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ nickname, game }, cb) => {
    if (!isValidNickname(nickname)) return cb({ ok: false, error: '닉네임은 1~12자로 입력해주세요.' })
    if (game !== 'tichu' && game !== 'skullking') return cb({ ok: false, error: '알 수 없는 게임입니다.' })

    const room = createRoom(game, defaultOptions(game))
    const player = addPlayer(room, nickname.trim())
    player.socketId = socket.id
    player.seat = firstFreeSeat(room)

    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    void socket.join(room.code)

    cb({ ok: true, data: { room: toPublic(room), identity: { playerId: player.id, token: player.token } } })
    broadcast(room)
    console.log(`[방 생성] ${room.code} (${GAME_LABEL[game]}) by ${player.nickname}`)
  })

  socket.on('room:join', ({ code, nickname, identity }, cb) => {
    const room = getRoom(code ?? '')
    if (!room) return cb({ ok: false, error: '그런 방이 없습니다. 코드를 확인해주세요.' })

    // 재접속: 기존 플레이어 복구
    if (identity) {
      const existing = room.players.get(identity.playerId)
      if (existing && existing.token === identity.token) {
        // 같은 신원으로 새 연결이 오면 이전 연결은 끊는다.
        // 안 그러면 한 플레이어를 두 소켓이 동시에 조종할 수 있다.
        if (existing.socketId && existing.socketId !== socket.id) {
          const prev = io.sockets.sockets.get(existing.socketId)
          if (prev) {
            prev.emit('room:closed', { reason: '다른 기기에서 접속해 이 연결은 종료되었습니다.' })
            prev.data.roomCode = undefined as unknown as string
            prev.data.playerId = undefined as unknown as string
            prev.disconnect(true)
          }
        }
        existing.socketId = socket.id
        existing.disconnectedAt = null
        socket.data.roomCode = room.code
        socket.data.playerId = existing.id
        void socket.join(room.code)
        cb({ ok: true, data: { room: toPublic(room), identity } })
        broadcast(room)
        broadcastGame(room) // 새로고침해도 판이 그대로 보이도록
        return
      }
    }

    if (!isValidNickname(nickname)) return cb({ ok: false, error: '닉네임은 1~12자로 입력해주세요.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '이미 시작된 게임입니다.' })
    if (room.players.size >= SEAT_COUNT[room.game]) return cb({ ok: false, error: '방이 가득 찼습니다.' })

    const player = addPlayer(room, nickname.trim())
    player.socketId = socket.id
    player.seat = firstFreeSeat(room)

    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    void socket.join(room.code)

    cb({ ok: true, data: { room: toPublic(room), identity: { playerId: player.id, token: player.token } } })
    broadcast(room)
  })

  socket.on('room:sit', ({ seat }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 자리를 옮길 수 없습니다.' })
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT[room.game]) {
      return cb({ ok: false, error: '없는 자리입니다.' })
    }
    const occupant = seatTakenBy(room, seat)
    if (occupant && occupant.id !== player.id) return cb({ ok: false, error: '이미 누가 앉아 있습니다.' })

    player.seat = seat
    player.ready = false
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:ready', ({ ready }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (player.seat === null) return cb({ ok: false, error: '먼저 자리에 앉아주세요.' })
    player.ready = Boolean(ready)
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:options', ({ options }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 설정을 바꿀 수 있습니다.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 설정을 바꿀 수 없습니다.' })
    room.options = { ...room.options, ...options }
    // 설정이 바뀌면 준비 상태를 초기화한다 (모르고 시작하는 걸 막기 위해)
    for (const p of room.players.values()) p.ready = false
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:start', (_p, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 시작할 수 있습니다.' })

    const seated = [...room.players.values()].filter((p) => p.seat !== null)
    const minPlayers = MIN_PLAYERS[room.game]
    if (seated.length < minPlayers) {
      return cb({
        ok: false,
        error: `${josa(GAME_LABEL[room.game], '은는')} 최소 ${minPlayers}명이 필요합니다.`,
      })
    }
    if (room.game === 'tichu' && seated.length !== 4) {
      return cb({ ok: false, error: '티츄는 정확히 4명이어야 합니다.' })
    }
    if (!seated.every((p) => p.ready)) return cb({ ok: false, error: '아직 준비하지 않은 사람이 있습니다.' })

    // 좌석 번호에 구멍이 있으면 딜러 회전 계산이 어긋난다. 시작 직전에 0..N-1로 당겨 붙인다.
    compactSeats(room)

    // 첫 딜러는 무작위로 정한다.
    // 룰북이 첫 딜러 선정 방법을 정하지 않았고, 로비 입장 순서로 굳히면 먼저 들어온 사람이 유리하다.
    // 시드를 통해 뽑아서 나중에 "이 판 다시보기"를 만들 때 재현할 수 있게 남겨둔다.
    const seed = randomInt(0, 2 ** 31)
    room.dealerSeat = skullking.pickInitialDealer(seated.length, createRng(seed))

    // 카드 셔플용 난수. 방 코드 + 무작위 시드를 섞어서 방마다 다르게.
    room.rng = createRng(hashSeed(`${room.code}:${seed}`))

    if (room.game === 'skullking') {
      const opts = skullking.makeSkOptions(room.options as Partial<skullking.SkRuleOptions>)
      room.skGame = skullking.createGame(seated.length, opts, room.dealerSeat, room.rng)
    } else {
      const opts = tichu.makeTichuOptions(room.options as Partial<tichu.TichuRuleOptions>)
      // 팀 조합에 맞춰 실제 자리를 바꾼다 — 티츄는 파트너가 마주 앉아야 룰이 성립한다
      applySeatArrangement(room, tichu.seatArrangement(opts.teamPairing, room.rng))
      room.tichuGame = tichu.createGame(opts, room.rng)
    }

    room.phase = 'playing'
    cb({ ok: true })
    broadcast(room)
    afterGameChange(room)
    const leader = skullking.roundFirstLeader(room.dealerSeat, seated.length)
    console.log(
      `[게임 시작] ${room.code} ${GAME_LABEL[room.game]} ${seated.length}명 ` +
        `· 첫 딜러 ${room.dealerSeat + 1}번 · 선턴 ${leader + 1}번`,
    )
  })

  /** 게임 액션 공통 처리 — 좌석 확인, 규칙 위반은 한국어 메시지로 돌려준다 */
  function withGame(
    cb: (r: { ok: boolean; error?: string }) => void,
    fn: (room: Room, seat: number, game: skullking.SkGameState) => void,
  ): void {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (!room.skGame) return cb({ ok: false, error: '진행 중인 게임이 없습니다.' })
    if (player.seat === null) return cb({ ok: false, error: '자리에 앉아 있지 않습니다.' })
    try {
      fn(room, player.seat, room.skGame)
      cb({ ok: true })
    } catch (e) {
      // 규칙 위반은 정상적인 흐름이다. 서버를 죽이지 않고 메시지만 돌려준다.
      if (e instanceof skullking.SkRuleError) return cb({ ok: false, error: e.message })
      console.error('[게임 액션 오류]', e)
      cb({ ok: false, error: '알 수 없는 오류가 발생했습니다.' })
    }
  }

  socket.on('game:bid', ({ value }, cb) => {
    withGame(cb, (room, seat, game) => {
      room.skGame = skullking.reduce(game, { type: 'bid', seat, value }, room.rng!)
      afterGameChange(room)
    })
  })

  socket.on('game:play', ({ cardId, tigressAs }, cb) => {
    withGame(cb, (room, seat, game) => {
      room.skGame = skullking.reduce(
        game,
        tigressAs ? { type: 'play', seat, cardId, tigressAs } : { type: 'play', seat, cardId },
        room.rng!,
      )
      afterGameChange(room)
    })
  })

  /** 티츄 액션 공통 처리 */
  function withTichu(
    cb: (r: { ok: boolean; error?: string }) => void,
    make: (seat: number, game: tichu.TichuGameState) => tichu.TichuAction | null,
  ): void {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (!room.tichuGame || !room.rng) return cb({ ok: false, error: '진행 중인 티츄 게임이 없습니다.' })
    if (player.seat === null) return cb({ ok: false, error: '자리에 앉아 있지 않습니다.' })
    try {
      const action = make(player.seat, room.tichuGame)
      if (!action) return cb({ ok: false, error: '지금 할 수 없는 행동입니다.' })
      room.tichuGame = tichu.reduce(room.tichuGame, action, room.rng)
      cb({ ok: true })
      afterGameChange(room)
    } catch (e) {
      // 규칙 위반은 정상적인 흐름이다. 서버를 죽이지 않고 메시지만 돌려준다.
      if (e instanceof tichu.TichuRuleError) return cb({ ok: false, error: e.message })
      console.error('[티츄 액션 오류]', e)
      cb({ ok: false, error: '알 수 없는 오류가 발생했습니다.' })
    }
  }

  socket.on('tichu:grand', ({ call }, cb) => {
    withTichu(cb, (seat) => ({ type: 'grandTichu', seat, call: Boolean(call) }))
  })

  socket.on('tichu:pass3', ({ cardIds }, cb) => {
    withTichu(cb, (seat) => {
      if (!Array.isArray(cardIds) || cardIds.length !== 3) return null
      return { type: 'pass3', seat, cardIds: cardIds as [string, string, string] }
    })
  })

  socket.on('tichu:call', (_p, cb) => {
    withTichu(cb, (seat) => ({ type: 'tichu', seat }))
  })

  socket.on('tichu:play', ({ cardIds, phoenixAs, asBomb }, cb) => {
    withTichu(cb, (seat) => {
      if (!Array.isArray(cardIds) || cardIds.length === 0) return null
      const action: tichu.TichuAction = { type: 'play', seat, cardIds }
      if (typeof phoenixAs === 'number') action.phoenixAs = phoenixAs
      if (typeof asBomb === 'boolean') action.asBomb = asBomb
      return action
    })
  })

  socket.on('tichu:pass', (_p, cb) => {
    withTichu(cb, (seat) => ({ type: 'pass', seat }))
  })

  socket.on('tichu:wish', ({ rank }, cb) => {
    withTichu(cb, (seat) => ({ type: 'wish', seat, rank: rank ?? null }))
  })

  socket.on('tichu:dragon', ({ to }, cb) => {
    withTichu(cb, (seat) => {
      if (!Number.isInteger(to) || to < 0 || to > 3) return null
      return { type: 'giveDragon', seat, to }
    })
  })

  socket.on('game:abort', (_p, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 게임을 끝낼 수 있습니다.' })
    resetToLobby(room)
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:shuffle', (_p, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 자리를 섞을 수 있습니다.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 자리를 섞을 수 없습니다.' })
    shuffleSeats(room)
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:leave', (_p, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: true })
    const { room, player } = ctx
    if (room.phase === 'playing') {
      return cb({
        ok: false,
        error: '게임 중에는 나갈 수 없습니다. 탭을 닫아도 자리는 유지됩니다. (방장은 "게임 끝내기" 가능)',
      })
    }
    room.players.delete(player.id)
    reassignHostIfNeeded(room)
    void socket.leave(room.code)
    socket.data.roomCode = undefined as unknown as string
    socket.data.playerId = undefined as unknown as string
    cb({ ok: true })
    if (room.players.size === 0) deleteRoom(room.code)
    else broadcast(room)
  })

  socket.on('disconnect', () => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return
    const { room, player } = ctx
    // 즉시 제거하지 않는다 — 새로고침/터널 끊김으로 자리를 잃으면 안 되니까
    player.socketId = null
    player.disconnectedAt = Date.now()
    broadcast(room)
  })
})

setInterval(() => {
  for (const code of sweep()) {
    const room = getRoom(code)
    if (room) broadcast(room)
  }
}, 30_000).unref()

// 컨테이너에서는 0.0.0.0에 바인딩해야 외부 트래픽이 들어온다
http.listen(PORT, '0.0.0.0', () => {
  const corsLabel =
    ORIGIN === true ? '전체 허용 — 개발용' : ORIGIN === false ? '같은 오리진만' : String(ORIGIN)
  console.log(`보드게임 서버 http://localhost:${PORT}  (CORS: ${corsLabel})`)
})
