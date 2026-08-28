// **가장 먼저 .env 를 읽는다.** 아래 모듈들이 최상위에서 process.env 를 보기 때문에
// 순서가 밀리면 이미 undefined 로 굳은 채 시작한다.
import { loadEnv } from './env.js'

loadEnv()

import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import sirv from 'sirv'
import { Server, type Socket } from 'socket.io'
import { randomInt, randomUUID } from 'node:crypto'
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
import { setupAuth, type Accounts, type Account } from './auth/index.js'
import { createPost, deletePost, isAdmin, listPosts, PostError, replyPost, updatePost } from './posts.js'
import { getUserRecord, recordGame } from './stats.js'
import { AuthError } from './auth/types.js'
import { RateLimiter, clientIp } from './ratelimit.js'
import { createRoomStore, toSummary, type RoomStore } from './store/index.js'
import {
  addBot,
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
  toSnapshot,
  restoreAll,
  allRooms,
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
  /** 로그인했다면 그 계정. 게스트면 undefined */
  account?: Account | undefined
  /** 로그아웃할 때 지울 세션 토큰 */
  authToken?: string | undefined
}

/**
 * 배포 시엔 서버가 빌드된 React 앱까지 같이 서빙한다.
 * 서비스를 하나로 합치면 CORS가 사라지고, 무료 호스팅 1개 슬롯에 다 들어간다.
 * WEB_DIST가 없으면(로컬 개발) 정적 서빙 없이 API만 뜬다.
 */
const webDist = process.env.WEB_DIST ?? resolve(import.meta.dirname, '../../web/dist')
const serveWeb = existsSync(webDist)
  ? sirv(webDist, {
      single: true,
      gzip: true,
      brotli: true,
      maxAge: 3600,
      /**
       * 파일 종류별 캐시 정책.
       *  - HTML: 항상 재검증(no-cache) → 새로 배포하면 사용자가 바로 최신을 받는다.
       *  - Vite 해시 자산(/assets/…): 내용이 바뀌면 파일명이 바뀌므로 1년 불변 캐시로 두어
       *    재방문 성능을 살린다.
       * 그 외(공용 이미지·규칙 페이지 CSS 등)는 위 maxAge(1시간)를 그대로 쓴다.
       */
      setHeaders(res, pathname) {
        if (pathname === '/' || pathname.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache')
        } else if (pathname.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
      /**
       * 요청마다 파일 시스템을 다시 확인한다.
       *
       * 이게 없으면 sirv가 **서버 시작 시점의 파일 목록을 캐시**한다.
       * 게임이 도는 중에 npm run build를 돌리면 파일이 통째로 바뀌는데,
       * 캐시된 목록은 사라진 파일을 가리키고 있어서 읽다가 죽는다.
       * 요청당 stat 한 번이 늘 뿐이라 이 규모에선 비용이 없다시피 하다.
       */
      dev: true,
    })
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
  // 화면이 바뀌었다는 건 방 상태가 바뀌었다는 뜻이다 — 저장소도 따라가게 한다
  persist(room)
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
    socket?.emit('game:view', {
      view,
      remainingMs,
      waitingFor,
      autoPass: room.tichuAutoPass[player.seat] ?? false,
    })
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
 * 지금 기다리는 좌석 중 **자리를 비운(소켓이 끊긴) 사람**이 있는가.
 * 봇은 서버가 대신 두므로 세지 않는다.
 */
function someoneAwaitingIsGone(room: Room): boolean {
  const waiting = new Set(waitingSeatsOf(room))
  for (const p of room.players.values()) {
    if (p.seat === null || p.isBot) continue
    if (waiting.has(p.seat) && p.socketId === null) return true
  }
  return false
}

/**
 * 제한시간을 건다. 시간이 다 되면 서버가 대신 행동한다.
 * 트릭 테이킹은 "패스"가 없어서 누군가 자리를 비우면 판 전체가 멈추기 때문.
 */
function scheduleTurnTimeout(room: Room): void {
  clearTurnTimer(room)

  // 티츄 특수 대기: 소원(10초) · 폭탄 창구(3초)는 별도 타이머로 마감한다
  const tg = room.tichuGame
  if (tg) {
    if (tg.awaitingWish !== null) {
      room.turnDeadline = Date.now() + TURN_POLICY.wishMs
      room.turnTimer = setTimeout(() => handleWishTimeout(room), TURN_POLICY.wishMs)
      return
    }
    if (tg.bombClaim !== null) {
      room.turnDeadline = Date.now() + TURN_POLICY.bombClaimMs
      room.turnTimer = setTimeout(() => handleBombClaimTimeout(room), TURN_POLICY.bombClaimMs)
      return
    }
    if (tg.pendingClose !== null) {
      room.turnDeadline = Date.now() + TURN_POLICY.bombWindowMs
      room.turnTimer = setTimeout(() => handleBombWindowTimeout(room), TURN_POLICY.bombWindowMs)
      return
    }
  }

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
  const base = THINKING[phase]
  if (base === undefined) return

  // 자리 비운(백그라운드/끊김) 사람 차례면 자동 제출을 미룬다 — 돌아올 시간을 준다.
  // 재접속하면 아래 재연결 경로에서 이 함수를 다시 불러 정상 시간으로 리셋한다.
  const limit = someoneAwaitingIsGone(room) ? Math.max(base, TURN_POLICY.disconnectGraceMs) : base

  room.turnDeadline = Date.now() + limit
  room.turnTimer = setTimeout(() => handleTurnTimeout(room), limit)
}

/** 소원 대기 시간 초과 — 소원 없음으로 처리하고 판을 계속 굴린다 */
function handleWishTimeout(room: Room): void {
  const game = room.tichuGame
  if (!game || !room.rng || game.awaitingWish === null) return
  try {
    room.tichuGame = tichu.reduce(game, { type: 'wish', seat: game.awaitingWish, rank: null }, room.rng)
    console.log(`[시간초과] ${room.code} 티츄 소원 미선택 → 소원 없음`)
  } catch (e) {
    console.error('[소원 시간초과 처리 실패]', e)
    return
  }
  afterGameChange(room)
}

/** 폭탄 창구 종료 — 트릭을 실제로 걷어간다. 트릭이 바뀌므로 트릭 패스도 초기화. */
function handleBombWindowTimeout(room: Room): void {
  const game = room.tichuGame
  if (!game || !room.rng || game.pendingClose === null) return
  try {
    room.tichuGame = tichu.reduce(game, { type: 'collectTrick' }, room.rng)
    room.tichuAutoPass = [false, false, false, false] // 트릭 패스는 트릭마다 초기화
  } catch (e) {
    console.error('[폭탄 창구 종료 처리 실패]', e)
    return
  }
  afterGameChange(room)
}

/** 폭탄 예약 시간 초과 — 예약을 취소하고 트릭을 걷어간다 */
function handleBombClaimTimeout(room: Room): void {
  const game = room.tichuGame
  if (!game || !room.rng || game.bombClaim === null) return
  try {
    room.tichuGame = tichu.reduce(game, { type: 'cancelBomb', seat: game.bombClaim }, room.rng)
    room.tichuAutoPass = [false, false, false, false] // 트릭이 걷혔으므로 트릭 패스 초기화
    console.log(`[시간초과] ${room.code} 티츄 폭탄 예약 미제출 → 취소`)
  } catch (e) {
    console.error('[폭탄 예약 시간초과 처리 실패]', e)
    return
  }
  afterGameChange(room)
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
      // 낼 수 있는 카드 중 손패 **가장 왼쪽**(화면 정렬 순서 기준) 카드를 낸다
      const legalIds = new Set(skullking.legalFor(game, seat).map((c) => c.id))
      if (legalIds.size === 0) return
      const sorted = skullking.sortHand(game.hands[seat] ?? [])
      const pick = sorted.find((c) => legalIds.has(c.id))
      if (!pick) return
      // 티그리스가 가장 왼쪽이면 도주로 낸다(자리 비운 사람이 얻어걸려 트릭 먹는 걸 피함)
      const action =
        pick.kind === 'tigress'
          ? ({ type: 'play', seat, cardId: pick.id, tigressAs: 'escape' } as const)
          : ({ type: 'play', seat, cardId: pick.id } as const)
      room.skGame = skullking.reduce(game, action, room.rng)
      console.log(`[시간초과] ${room.code} ${seat}번 자동 제출(가장 왼쪽) ${pick.id}`)
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
 * 전체 패스를 켠 사람의 차례면 대신 패스해 준다.
 *
 * 리드해야 하거나 마작 소원을 이행해야 하면 패스가 불가능하므로 그때는 **자동으로 꺼진다.**
 * 재귀 대신 루프로 도는 이유는, 여러 명이 켜 뒀을 때 한 번에 처리하기 위해서다.
 */
function runTichuAutoPass(room: Room): void {
  const rng = room.rng
  if (!rng) return
  for (let guard = 0; guard < 16; guard++) {
    const game = room.tichuGame
    if (!game || game.phase !== 'playing') return
    // 소원 대기·폭탄 창구·폭탄 예약 중에는 패스 자체가 막혀 있다 → 자동 패스도 멈춘다
    if (game.awaitingWish !== null || game.pendingClose !== null || game.bombClaim !== null) return
    const seat = game.turn
    if (!room.tichuAutoPass[seat]) return
    // 리드는 반드시 내야 하고, 소원도 이행해야 한다 → 자동 패스를 끈다
    if (game.current === null || tichu.mustFulfillWish(game, seat)) {
      room.tichuAutoPass[seat] = false
      return
    }
    try {
      room.tichuGame = tichu.reduce(game, { type: 'pass', seat }, rng)
    } catch {
      room.tichuAutoPass[seat] = false
      return
    }
  }
}

function clearBotTimer(room: Room): void {
  if (room.botTimer) {
    clearTimeout(room.botTimer)
    room.botTimer = null
  }
}

/** 그 게임 좌석에 앉은 봇 (없으면 undefined) */
function botAtSeat(room: Room, seat: number) {
  for (const p of room.players.values()) if (p.seat === seat && p.isBot) return p
  return undefined
}

/** 지금 행동을 기다리는 좌석들 */
function waitingSeatsOf(room: Room): number[] {
  if (room.skGame) return skullking.waitingSeats(room.skGame)
  if (room.tichuGame) return tichu.waitingSeats(room.tichuGame)
  return []
}

/** 봇 차례가 하나라도 있으면 잠깐 뒤에 대신 행동하도록 예약한다 */
function scheduleBots(room: Room): void {
  if (room.botTimer) return // 이미 예약돼 있다
  const phase = currentPhase(room)
  if (phase === null || phase === 'trickEnd' || phase === 'roundEnd' || phase === 'gameEnd') return
  const hasBotTurn = waitingSeatsOf(room).some((seat) => botAtSeat(room, seat))
  if (!hasBotTurn) return
  // 사람처럼 잠깐 생각하는 척. 카드 내는 건 조금 더 뜸을 들인다.
  const delay = phase === 'playing' ? 900 : 700
  room.botTimer = setTimeout(() => {
    room.botTimer = null
    stepBots(room)
  }, delay)
}

/**
 * 기다리는 봇 좌석 중 하나를 대신 처리한다.
 * 한 번에 하나만 처리하고 afterGameChange로 다시 예약해서,
 * 여러 봇이 있어도 한 명씩 차례로 두는 것처럼 보이게 한다.
 */
function stepBots(room: Room): void {
  if (!room.rng) return
  const waiting = waitingSeatsOf(room)
  const seat = waiting.find((s) => botAtSeat(room, s))
  if (seat === undefined) return
  try {
    if (room.skGame) {
      const game = room.skGame
      if (game.phase === 'bidding') {
        // 0~카드수 사이 무작위 입찰 (자동 처리의 무조건 0보다 판이 재밌다)
        const value = randomInt(0, skullking.maxBid(game) + 1)
        room.skGame = skullking.reduce(game, { type: 'bid', seat, value }, room.rng)
      } else if (game.phase === 'playing') {
        const pick = skullking.pickWeakestLegal(game, seat)
        if (!pick) return
        room.skGame = skullking.reduce(
          game,
          pick.tigressAs
            ? { type: 'play', seat, cardId: pick.card.id, tigressAs: pick.tigressAs }
            : { type: 'play', seat, cardId: pick.card.id },
          room.rng,
        )
      } else {
        return
      }
    } else if (room.tichuGame) {
      const action = tichu.autoAction(room.tichuGame, seat)
      if (!action) return
      room.tichuGame = tichu.reduce(room.tichuGame, action, room.rng)
    } else {
      return
    }
  } catch (e) {
    console.error('[봇 처리 실패]', e)
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
  runTichuAutoPass(room)
  // 라운드가 끝나면 전체 패스는 초기화한다 (다음 라운드까지 끌고 가지 않는다)
  if (room.tichuGame && room.tichuGame.phase !== 'playing') {
    room.tichuAutoPass = [false, false, false, false]
  }
  scheduleTurnTimeout(room)
  scheduleAdvance(room)
  scheduleBots(room)
  broadcastGame(room)
  persist(room)
}

/**
 * 재시작 뒤 **첫 사람이 돌아왔을 때** 멈춰 있던 판의 시계를 다시 돌린다.
 *
 * 시계는 남은 시간이 아니라 **처음부터** 다시 준다. 서버가 꺼져 있던 건
 * 플레이어 잘못이 아닌데 남은 3초를 물려주면 돌아오자마자 시간초과가 난다.
 */
function armTimersOnReturn(room: Room): void {
  if (room.phase !== 'playing') return
  // 이미 돌고 있으면 건드리지 않는다
  if (room.turnTimer || room.advanceTimer) return
  if (!room.skGame && !room.tichuGame) return

  scheduleTurnTimeout(room)
  scheduleAdvance(room)
  scheduleBots(room)
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
      void recordGame(room).catch((e) => console.error('[전적 기록 실패]', e))
    }
  } else if (room.tichuGame) {
    room.tichuGame = tichu.reduce(room.tichuGame, { type: 'advance' }, room.rng)
    if (room.tichuGame.phase === 'gameEnd') {
      room.phase = 'finished'
      broadcast(room)
      void recordGame(room).catch((e) => console.error('[전적 기록 실패]', e))
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
  clearBotTimer(room)
  room.skGame = null
  room.tichuGame = null
  room.seatArrangement = null
  room.tichuAutoPass = [false, false, false, false]
  room.rng = null
  room.dealerSeat = null
  room.phase = 'lobby'
  // 봇은 늘 준비 상태를 유지한다 (사람만 초기화)
  for (const p of room.players.values()) p.ready = p.isBot
}

/** 방 이름 정리. 안 보이는 글자로 목록을 어지럽히는 걸 막고 길이를 자른다. */
function cleanRoomTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const cleaned = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
  return cleaned.length > 0 ? cleaned : null
}

/**
 * 인증 오류를 클라이언트에 보여줄 문구로 바꾼다.
 * AuthError 가 아닌 것(DB 장애 등)은 속내를 드러내지 않고 뭉뚱그린다.
 */
function authMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message
  console.error('[인증] 예상치 못한 오류', err)
  return '지금은 처리할 수 없습니다. 잠시 뒤에 다시 시도해주세요.'
}

function isValidNickname(nickname: unknown): nickname is string {
  return typeof nickname === 'string' && nickname.trim().length >= 1 && nickname.trim().length <= 12
}

// ── 인증 · 저장소 ──────────────────────────────────────────────

/** DB 가 없으면 null — 계정 기능만 꺼지고 게스트로 게임은 그대로 된다 */
let accounts: Accounts | null = null
/** 진행 중인 방을 담아두는 곳 (Redis 또는 메모리) */
let roomStore: RoomStore | null = null

/** 로그인 시도. 계정당 5분에 10번. */
const loginLimiter = new RateLimiter(10, 5 * 60_000)
/** 가입. IP 당 한 시간에 5개. */
const signupLimiter = new RateLimiter(5, 60 * 60_000)
/** 방 훔쳐보기. 코드를 무작위로 넣어 남의 비밀방을 찾는 걸 막는다. */
const peekLimiter = new RateLimiter(20, 60_000)

setInterval(() => {
  loginLimiter.sweep()
  signupLimiter.sweep()
  peekLimiter.sweep()
}, 5 * 60_000).unref()

/**
 * 방이 바뀔 때마다 저장소에 써 둔다.
 *
 * 기다리지 않는다 — 저장이 느리다고 게임이 멈추면 안 된다.
 * 실패하면 로그만 남기고 넘어간다. 최악의 경우 재시작 때 그 방을 못 살릴 뿐,
 * 지금 하고 있는 게임에는 영향이 없다.
 */
/** 저장 대기 중인 방들. 한 번의 처리 안에서 여러 번 불려도 쓰기는 한 번만 나간다. */
const dirtyRooms = new Set<string>()
let flushScheduled = false

function persist(room: Room): void {
  if (!roomStore) return
  dirtyRooms.add(room.code)
  if (flushScheduled) return
  flushScheduled = true
  // 지금 처리 중인 일이 다 끝난 뒤에 한꺼번에 내보낸다
  setImmediate(flushDirtyRooms)
}

function flushDirtyRooms(): void {
  flushScheduled = false
  if (!roomStore) return
  for (const code of dirtyRooms) {
    const room = getRoom(code)
    if (!room) continue
    void roomStore.save(toSnapshot(room)).catch((err) => {
      console.error(`[저장소] 방 ${code} 저장 실패`, err)
    })
  }
  dirtyRooms.clear()
}

function forget(code: string): void {
  if (!roomStore) return
  void roomStore.remove(code).catch((err) => {
    console.error(`[저장소] 방 ${code} 삭제 실패`, err)
  })
}

function toAuthUser(account: Account) {
  // 비밀번호와 관련된 건 아무것도 실어 보내지 않는다
  return {
    id: account.id,
    username: account.username,
    nickname: account.nickname,
    tag: account.tag,
  }
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
  const ip = clientIp(socket.handshake)

  // ── 계정 ────────────────────────────────────────────────────

  socket.on('auth:status', (_p, cb) => {
    cb({
      ok: true,
      data: {
        enabled: accounts !== null,
        user: socket.data.account ? toAuthUser(socket.data.account) : null,
      },
    })
  })

  socket.on('auth:signup', ({ username, password, nickname }, cb) => {
    if (!accounts) return cb({ ok: false, error: '지금은 계정 없이 게스트로만 이용할 수 있습니다.' })
    if (!signupLimiter.take(ip)) {
      return cb({ ok: false, error: '가입 시도가 너무 잦습니다. 잠시 뒤에 다시 해주세요.' })
    }
    void accounts
      .signUp({ username, password, nickname, ip })
      .then((session) => {
        socket.data.account = session.account
        socket.data.authToken = session.token
        cb({
          ok: true,
          data: { user: toAuthUser(session.account), token: session.token, expiresAt: session.expiresAt },
        })
        console.log(`[가입] ${session.account.username}`)
      })
      .catch((err: unknown) => cb({ ok: false, error: authMessage(err) }))
  })

  socket.on('auth:login', ({ username, password }, cb) => {
    if (!accounts) return cb({ ok: false, error: '지금은 계정 없이 게스트로만 이용할 수 있습니다.' })

    // 아이디 기준으로 센다. IP 기준이면 같은 공유기를 쓰는 사람들이 서로 막힌다.
    const key = typeof username === 'string' ? username.trim().toLowerCase() : ip
    if (!loginLimiter.take(key)) {
      const wait = loginLimiter.retryAfterSeconds(key)
      return cb({ ok: false, error: `로그인 시도가 너무 잦습니다. ${wait}초 뒤에 다시 해주세요.` })
    }

    void accounts
      .logIn({ username, password, ip })
      .then((session) => {
        loginLimiter.clear(key) // 성공했으면 실패 기록은 지운다
        socket.data.account = session.account
        socket.data.authToken = session.token
        cb({
          ok: true,
          data: { user: toAuthUser(session.account), token: session.token, expiresAt: session.expiresAt },
        })
      })
      .catch((err: unknown) => cb({ ok: false, error: authMessage(err) }))
  })

  socket.on('auth:resume', ({ token }, cb) => {
    if (!accounts) return cb({ ok: true, data: { user: null } })
    void accounts
      .resume(token)
      .then((account) => {
        if (account) {
          socket.data.account = account
          socket.data.authToken = token
        }
        cb({ ok: true, data: { user: account ? toAuthUser(account) : null } })
      })
      // 토큰이 낡았거나 DB 가 잠깐 안 되는 것뿐이다. 로그인만 안 된 채로 게스트로 논다.
      .catch(() => cb({ ok: true, data: { user: null } }))
  })

  socket.on('auth:logout', (_p, cb) => {
    const token = socket.data.authToken
    socket.data.account = undefined
    socket.data.authToken = undefined
    if (accounts && token) void accounts.logOut(token).catch(() => {})
    cb({ ok: true })
  })

  // ── 커뮤니티 / 문의 게시판 ────────────────────────────────────
  // 관리자(ilo2918) 전체 열람, 로그인 사용자는 본인 글만, 게스트는 열람 UI만(글 없음).
  const postFail = (cb: (r: { ok: false; error: string }) => void) => (e: unknown) => {
    if (!(e instanceof PostError)) console.error('[게시판]', e)
    cb({ ok: false, error: e instanceof PostError ? e.message : '게시판 처리 중 오류가 발생했습니다.' })
  }

  socket.on('posts:list', (_p, cb) => {
    if (!accounts) return cb({ ok: false, error: '지금은 게시판을 쓸 수 없습니다.' })
    const account = socket.data.account ?? null
    void listPosts(account)
      .then((posts) => cb({ ok: true, data: { posts, isAdmin: isAdmin(account), canWrite: account !== null } }))
      .catch(postFail(cb))
  })

  socket.on('posts:create', ({ title, body }, cb) => {
    const account = socket.data.account
    if (!account) return cb({ ok: false, error: '로그인이 필요합니다.' })
    void createPost(account, title, body)
      .then((post) => cb({ ok: true, data: { post } }))
      .catch(postFail(cb))
  })

  socket.on('posts:update', ({ id, title, body }, cb) => {
    const account = socket.data.account
    if (!account) return cb({ ok: false, error: '로그인이 필요합니다.' })
    void updatePost(account, id, title, body)
      .then(() => cb({ ok: true }))
      .catch(postFail(cb))
  })

  socket.on('posts:delete', ({ id }, cb) => {
    const account = socket.data.account
    if (!account) return cb({ ok: false, error: '로그인이 필요합니다.' })
    void deletePost(account, id)
      .then(() => cb({ ok: true }))
      .catch(postFail(cb))
  })

  socket.on('posts:reply', ({ id, reply }, cb) => {
    const account = socket.data.account
    if (!account) return cb({ ok: false, error: '로그인이 필요합니다.' })
    void replyPost(account, id, reply)
      .then(() => cb({ ok: true }))
      .catch(postFail(cb))
  })

  socket.on('stats:me', (_p, cb) => {
    const account = socket.data.account
    if (!account) return cb({ ok: true, data: null }) // 게스트는 전적 없음
    void getUserRecord(account.id)
      .then((rec) => cb({ ok: true, data: rec }))
      .catch(() => cb({ ok: true, data: null }))
  })

  // ── 로비 ────────────────────────────────────────────────────

  socket.on('lobby:list', ({ game, waitingOnly }, cb) => {
    const filter = {
      ...(game === 'tichu' || game === 'skullking' ? { game } : {}),
      ...(waitingOnly ? { waitingOnly: true } : {}),
    }
    if (!roomStore) return cb({ ok: true, data: { rooms: [] } })
    void roomStore
      .listPublic(filter)
      .then((rooms) => cb({ ok: true, data: { rooms } }))
      .catch((err: unknown) => {
        console.error('[로비] 목록 조회 실패', err)
        cb({ ok: false, error: '방 목록을 불러오지 못했습니다.' })
      })
  })

  /**
   * 초대 링크를 눌렀을 때, 들어가기 전에 어떤 방인지 보여주기 위한 것.
   * 비밀방이라도 **코드를 아는 사람에게는** 요약을 준다 — 코드가 곧 열쇠다.
   */
  socket.on('room:peek', ({ code }, cb) => {
    if (!peekLimiter.take(ip)) {
      return cb({ ok: false, error: '요청이 너무 잦습니다. 잠시 뒤에 다시 해주세요.' })
    }
    const room = getRoom(code ?? '')
    if (!room) return cb({ ok: false, error: '그런 방이 없습니다. 코드를 확인해주세요.' })
    cb({ ok: true, data: toSummary(toSnapshot(room)) })
  })

  socket.on('room:visibility', ({ visibility, title }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 바꿀 수 있습니다.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 바꿀 수 없습니다.' })
    if (visibility !== 'public' && visibility !== 'private') {
      return cb({ ok: false, error: '알 수 없는 공개 설정입니다.' })
    }

    room.visibility = visibility
    room.title = visibility === 'public' ? cleanRoomTitle(title) : null
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:create', ({ nickname, game, visibility, title }, cb) => {
    if (!isValidNickname(nickname)) return cb({ ok: false, error: '닉네임은 1~12자로 입력해주세요.' })
    if (game !== 'tichu' && game !== 'skullking') return cb({ ok: false, error: '알 수 없는 게임입니다.' })

    const isPublic = visibility === 'public'
    const room = createRoom(
      game,
      defaultOptions(game),
      isPublic ? 'public' : 'private',
      isPublic ? cleanRoomTitle(title) : null,
    )
    // 로그인한 사람이면 계정을 달아둔다 — 전적은 계정이 있는 사람만 쌓인다
    const player = addPlayer(room, nickname.trim(), socket.data.account?.id ?? null)
    player.socketId = socket.id
    player.seat = firstFreeSeat(room)

    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    void socket.join(room.code)

    cb({ ok: true, data: { room: toPublic(room), identity: { playerId: player.id, token: player.token } } })
    broadcast(room)
    console.log(
      `[방 생성] ${room.code} (${GAME_LABEL[game]}, ${isPublic ? '공개' : '비밀'}) by ${player.nickname}`,
    )
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
        // 재시작 뒤 첫 복귀라면 멈춰 있던 시계를 여기서 다시 돌린다
        armTimersOnReturn(room)
        broadcast(room)
        // 자리 비운 사이 유예(90초)로 늘어나 있던 타이머를, 돌아왔으니 정상 시간으로 리셋한다.
        // 이 사람이 지금 낼 차례가 아니면 건드리지 않는다(남의 타이머를 리셋하면 안 된다).
        if (
          existing.seat !== null &&
          (room.skGame || room.tichuGame) &&
          waitingSeatsOf(room).includes(existing.seat)
        ) {
          scheduleTurnTimeout(room)
        }
        broadcastGame(room) // 새로고침해도 판이 그대로 보이도록
        return
      }
    }

    if (!isValidNickname(nickname)) return cb({ ok: false, error: '닉네임은 1~12자로 입력해주세요.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '이미 시작된 게임입니다.' })
    if (room.players.size >= SEAT_COUNT[room.game]) return cb({ ok: false, error: '방이 가득 찼습니다.' })

    const player = addPlayer(room, nickname.trim(), socket.data.account?.id ?? null)
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
    // 설정이 바뀌면 준비 상태를 초기화한다 (모르고 시작하는 걸 막기 위해). 봇은 늘 준비.
    for (const p of room.players.values()) p.ready = p.isBot
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
    const ctx = currentRoomAndPlayer(socket)
    let declared = false
    withTichu(
      (r) => {
        declared = r.ok
        cb(r)
      },
      (seat) => ({ type: 'grandTichu', seat, call: Boolean(call) }),
    )
    // 실제로 선언에 성공했을 때만 알린다
    if (call && declared && ctx) {
      io.to(ctx.room.code).emit('game:announce', {
        kind: 'grand',
        seat: ctx.player.seat ?? 0,
        nickname: ctx.player.nickname,
      })
    }
  })

  socket.on('tichu:pass3', ({ cardIds }, cb) => {
    withTichu(cb, (seat) => {
      if (!Array.isArray(cardIds) || cardIds.length !== 3) return null
      return { type: 'pass3', seat, cardIds: cardIds as [string, string, string] }
    })
  })

  socket.on('tichu:call', (_p, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    let declared = false
    withTichu(
      (r) => {
        declared = r.ok
        cb(r)
      },
      (seat) => ({ type: 'tichu', seat }),
    )
    if (declared && ctx) {
      io.to(ctx.room.code).emit('game:announce', {
        kind: 'tichu',
        seat: ctx.player.seat ?? 0,
        nickname: ctx.player.nickname,
      })
    }
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

  socket.on('tichu:claimBomb', (_p, cb) => {
    withTichu(cb, (seat) => ({ type: 'claimBomb', seat }))
  })

  socket.on('tichu:cancelBomb', (_p, cb) => {
    withTichu(cb, (seat) => ({ type: 'cancelBomb', seat }))
  })

  socket.on('tichu:autopass', ({ on }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (!room.tichuGame) return cb({ ok: false, error: '진행 중인 티츄 게임이 없습니다.' })
    if (player.seat === null) return cb({ ok: false, error: '자리에 앉아 있지 않습니다.' })
    room.tichuAutoPass[player.seat] = Boolean(on)
    cb({ ok: true })
    afterGameChange(room)
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

  socket.on('room:addBot', (_p, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 봇을 추가할 수 있습니다.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 봇을 추가할 수 없습니다.' })
    const bot = addBot(room)
    if (!bot) return cb({ ok: false, error: '빈자리가 없습니다.' })
    cb({ ok: true })
    broadcast(room)
    console.log(`[봇 추가] ${room.code} ${bot.nickname} (${bot.seat! + 1}번)`)
  })

  socket.on('room:removeBot', ({ playerId }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 봇을 내보낼 수 있습니다.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 봇을 내보낼 수 없습니다.' })
    const bot = room.players.get(playerId)
    if (!bot || !bot.isBot) return cb({ ok: false, error: '봇이 아닙니다.' })
    room.players.delete(playerId)
    cb({ ok: true })
    broadcast(room)
  })

  socket.on('room:kick', ({ playerId }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (room.hostId !== player.id) return cb({ ok: false, error: '방장만 내보낼 수 있습니다.' })
    if (room.phase !== 'lobby') return cb({ ok: false, error: '게임 중에는 내보낼 수 없습니다.' })
    if (playerId === player.id) return cb({ ok: false, error: '자신은 내보낼 수 없습니다.' })
    const target = room.players.get(playerId)
    if (!target) return cb({ ok: false, error: '그런 사람이 없습니다.' })

    // 쫓겨난 사람의 소켓을 방에서 떼어내고 로비로 돌려보낸다
    if (target.socketId) {
      const sock = io.sockets.sockets.get(target.socketId)
      if (sock) {
        sock.emit('room:closed', { reason: '방장이 내보냈습니다.' })
        delete sock.data.roomCode
        delete sock.data.playerId
        void sock.leave(room.code)
      }
    }
    room.players.delete(playerId)
    reassignHostIfNeeded(room) // (방장은 자신을 못 쫓아내지만 방어적으로)
    cb({ ok: true })
    broadcast(room)
    persist(room)
  })

  socket.on('chat:send', ({ text }, cb) => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return cb({ ok: false, error: '방에 들어와 있지 않습니다.' })
    const { room, player } = ctx
    if (typeof text !== 'string') return cb({ ok: false, error: '메시지가 올바르지 않습니다.' })
    const trimmed = text.replace(/\s+$/g, '').slice(0, 300).trim()
    if (trimmed.length === 0) return cb({ ok: false, error: '빈 메시지는 보낼 수 없습니다.' })
    cb({ ok: true })
    // **같은 방 소켓에게만** 보낸다 (io.to(방코드)). 다른 방으로는 절대 나가지 않는다.
    io.to(room.code).emit('chat:message', {
      id: randomUUID(),
      playerId: player.id,
      nickname: player.nickname,
      seat: player.seat,
      text: trimmed,
      ts: Date.now(),
    })
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
    // 사람이 아무도 안 남으면(봇만 남아도) 방을 정리한다
    const anyHuman = [...room.players.values()].some((p) => !p.isBot)
    if (!anyHuman) {
      deleteRoom(room.code)
      forget(room.code)
    }
    else broadcast(room)
  })

  socket.on('disconnect', () => {
    const ctx = currentRoomAndPlayer(socket)
    if (!ctx) return
    const { room, player } = ctx
    // 즉시 제거하지 않는다 — 새로고침/터널 끊김으로 자리를 잃으면 안 되니까
    player.socketId = null
    player.disconnectedAt = Date.now()
    // **끊긴 사람이 지금 낼 차례였다면 타이머를 다시 건다.**
    // 타이머는 턴이 시작될 때 걸리는데, 그 순간엔 아직 연결돼 있어 정상 30초로 걸린다.
    // 여기서 다시 걸어야 someoneAwaitingIsGone 이 반영돼 90초 유예로 늘어난다.
    // (안 그러면 모바일이 백그라운드 간 직후 30초에 카드가 자동 제출된다)
    if (player.seat !== null && (room.skGame || room.tichuGame) && waitingSeatsOf(room).includes(player.seat)) {
      scheduleTurnTimeout(room)
    }
    broadcast(room)
  })
})

setInterval(() => {
  const { changed, removed } = sweep()
  for (const code of changed) {
    const room = getRoom(code)
    if (room) broadcast(room)
  }
  // 사라진 방은 저장소에서도 뺀다 — 안 그러면 로비 목록에 유령 방이 남는다
  for (const code of removed) forget(code)
}, 30_000).unref()

/**
 * 마지막 방어선.
 *
 * 요청 하나가 잘못됐다고 **모두의 게임이 끝나면 안 된다.**
 * 정적 파일 스트림 오류처럼 프로세스 상태와 무관한 예외가 대부분이라
 * 크게 남기고 계속 돈다. 진짜로 못 살릴 상태면 다음 요청에서 다시 터진다.
 */
process.on('uncaughtException', (err) => {
  console.error('[치명적이지 않은 예외 — 서버는 계속 돕니다]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[처리되지 않은 프로미스 거부 — 서버는 계속 돕니다]', reason)
})

/**
 * 서버 부팅.
 *
 * 붙을 곳에 다 붙은 **뒤에** 포트를 연다. 순서가 뒤집히면 첫 몇 초 동안
 * 들어온 사람들이 계정도 못 쓰고 저장도 안 되는 상태로 게임을 시작하게 된다.
 */
async function bootstrap(): Promise<void> {
  const auth = await setupAuth()
  accounts = auth.accounts

  roomStore = await createRoomStore()

  // 재시작 전에 돌던 방들을 되살린다
  try {
    const saved = await roomStore.loadAll()
    const restored = restoreAll(saved)
    if (restored > 0) {
      console.log(`[복원] 진행 중이던 방 ${restored}개를 되살렸습니다`)
      // **타이머는 여기서 걸지 않는다.**
      // 되살아난 방은 전원 끊긴 상태다. 지금 제한시간을 걸면 아무도 못 돌아온 사이에
      // 서버가 자동 플레이로 판을 끝까지 진행시켜 버린다.
      // 사람이 하나라도 돌아오면 그때 건다 (armTimersOnReturn).
      for (const room of allRooms()) room.turnDeadline = null
    }
  } catch (err) {
    // 되살리기에 실패해도 서버는 뜬다 — 새 방은 만들 수 있어야 하니까
    console.error('[복원] 실패 — 빈 상태로 시작합니다', err)
  }

  // 컨테이너에서는 0.0.0.0에 바인딩해야 외부 트래픽이 들어온다
  http.listen(PORT, '0.0.0.0', () => {
    const corsLabel =
      ORIGIN === true ? '전체 허용 — 개발용' : ORIGIN === false ? '같은 오리진만' : String(ORIGIN)
    console.log(`보드게임 서버 http://localhost:${PORT}  (CORS: ${corsLabel})`)
  })
}

void bootstrap().catch((err: unknown) => {
  // 여기서 죽는 건 설정이 잘못됐다는 뜻이다. 반쯤 동작하는 서버를 띄우는 것보다
  // 지금 멈추고 무엇이 문제인지 보여주는 편이 낫다.
  console.error('[부팅 실패]', err)
  process.exit(1)
})
