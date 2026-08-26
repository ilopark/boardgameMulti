import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { randomInt } from 'node:crypto'
import {
  createRng,
  GAME_LABEL,
  josa,
  MIN_PLAYERS,
  SEAT_COUNT,
  skullking,
  type ClientToServer,
  type GameId,
  type ServerToClient,
} from '@bg/core'
import {
  addPlayer,
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
/**
 * 개발 중에는 같은 와이파이의 친구가 http://192.168.x.x:5173 으로 들어올 수 있어야 하므로
 * origin을 열어둔다. 인터넷에 배포할 때는 CORS_ORIGIN을 반드시 지정할 것.
 */
const ORIGIN: string | true = process.env.CORS_ORIGIN ?? true

interface SocketData {
  roomCode?: string
  playerId?: string
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: roomCount() }))
    return
  }
  res.writeHead(404)
  res.end()
})

const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(http, {
  cors: { origin: ORIGIN, credentials: true },
})

function defaultOptions(game: GameId): Record<string, unknown> {
  if (game === 'skullking') return { ...skullking.DEFAULT_SK_OPTIONS } as unknown as Record<string, unknown>
  return { targetScore: 1000, counterClockwise: true, allowBombInterrupt: true }
}

function broadcast(room: Room): void {
  io.to(room.code).emit('room:state', toPublic(room))
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

    // TODO: 여기서 게임 상태머신 시작 (docs/ROADMAP.md 2단계)
    room.phase = 'playing'
    cb({ ok: true })
    broadcast(room)
    const leader = skullking.roundFirstLeader(room.dealerSeat, seated.length)
    console.log(
      `[게임 시작] ${room.code} ${GAME_LABEL[room.game]} ${seated.length}명 ` +
        `· 첫 딜러 ${room.dealerSeat + 1}번 · 선턴 ${leader + 1}번`,
    )
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

http.listen(PORT, () => {
  console.log(`보드게임 서버 http://localhost:${PORT}  (CORS: ${ORIGIN === true ? '전체 허용 — 개발용' : ORIGIN})`)
})
