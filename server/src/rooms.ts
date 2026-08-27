import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import {
  SEAT_COUNT,
  createRng,
  type GameId,
  type PlayerPublic,
  type RoomPublic,
  type RoomVisibility,
  type SeededRng,
  type skullking,
  type tichu,
} from '@bg/core'
import type { PlayerSnapshot, RoomSnapshot } from './store/index.js'

type SkGameState = skullking.SkGameState
type TichuGameState = tichu.TichuGameState

export interface Player {
  id: string
  token: string
  nickname: string
  seat: number | null
  socketId: string | null
  ready: boolean
  /** 연결이 끊긴 시각. 일정 시간 지나면 방에서 제거 */
  disconnectedAt: number | null
  /** 방장이 추가한 봇이면 true. 서버가 자동으로 대신 행동한다. */
  isBot: boolean
  /** 로그인한 계정이면 그 id. 게스트면 null — 전적을 남기지 않는다. */
  userId: string | null
}

export interface Room {
  code: string
  game: GameId
  hostId: string
  phase: 'lobby' | 'playing' | 'finished'
  /** 공개방은 로비 목록에 뜨고, 비밀방은 코드를 아는 사람만 들어온다 */
  visibility: RoomVisibility
  /** 공개방 이름. 비밀방이면 null */
  title: string | null
  players: Map<string, Player>
  options: Record<string, unknown>
  /** 이번 라운드 딜러 좌석. 게임 시작 시 무작위로 정해진다. 대기 중엔 null. */
  dealerSeat: number | null
  /** 진행 중인 스컬킹 게임 상태. 서버만 들고 있고, 클라이언트엔 가려진 뷰만 나간다. */
  skGame: SkGameState | null
  /** 진행 중인 티츄 게임 상태 */
  tichuGame: TichuGameState | null
  /** 티츄 시작 시 정해진 자리 배치. arrangement[게임좌석] = 로비 자리 */
  seatArrangement: number[] | null
  /** 티츄 전체 패스를 켠 좌석들. 라운드가 끝나면 초기화된다 */
  tichuAutoPass: boolean[]
  /** trickEnd/roundEnd 자동 진행 타이머 */
  advanceTimer: NodeJS.Timeout | null
  /** 봇 차례가 오면 잠깐 뒤에 대신 행동하는 타이머 */
  botTimer: NodeJS.Timeout | null
  /** 제한시간 초과 시 대신 행동해 주는 타이머 */
  turnTimer: NodeJS.Timeout | null
  /** 지금 턴의 마감 시각(epoch ms). 없으면 null */
  turnDeadline: number | null
  /**
   * 카드를 돌릴 때 쓰는 난수. 방마다 하나를 계속 쓴다.
   * SeededRng 라서 `rng.state` 를 저장해 두면 재시작 후 같은 수열을 이어받는다.
   */
  rng: SeededRng | null
  createdAt: number
}

/** 헷갈리는 글자(0/O, 1/I/L) 제외 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

const rooms = new Map<string, Room>()

function generateCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = randomBytes(CODE_LENGTH)
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
    }
    if (!rooms.has(code)) return code
  }
  throw new Error('방 코드 생성 실패')
}

export function createRoom(
  game: GameId,
  defaultOptions: Record<string, unknown>,
  visibility: RoomVisibility = 'private',
  title: string | null = null,
): Room {
  const room: Room = {
    code: generateCode(),
    game,
    hostId: '',
    phase: 'lobby',
    visibility,
    title,
    players: new Map(),
    options: defaultOptions,
    dealerSeat: null,
    skGame: null,
    tichuGame: null,
    seatArrangement: null,
    tichuAutoPass: [false, false, false, false],
    advanceTimer: null,
    botTimer: null,
    turnTimer: null,
    turnDeadline: null,
    rng: null,
    createdAt: Date.now(),
  }
  rooms.set(room.code, room)
  return room
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase())
}

export function deleteRoom(code: string): void {
  rooms.delete(code)
}

export function addPlayer(room: Room, nickname: string, userId: string | null = null): Player {
  const player: Player = {
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    nickname,
    seat: null,
    socketId: null,
    ready: false,
    disconnectedAt: null,
    isBot: false,
    userId,
  }
  room.players.set(player.id, player)
  if (!room.hostId) room.hostId = player.id
  return player
}

const BOT_NAMES = ['봇하나', '봇둘', '봇셋', '봇넷', '봇다섯']

/**
 * 빈자리에 봇을 앉힌다. 방장이 대기실에서 버튼으로 추가한다.
 * 봇은 소켓이 없고 항상 준비 상태이며, 게임 중엔 서버가 대신 행동한다.
 * 빈자리가 없으면 null.
 */
export function addBot(room: Room): Player | null {
  const seat = firstFreeSeat(room)
  if (seat === null) return null
  // 이미 있는 봇 이름과 겹치지 않게 고른다
  const taken = new Set([...room.players.values()].map((p) => p.nickname))
  let nickname = BOT_NAMES.find((n) => !taken.has(n))
  if (!nickname) {
    let n = 1
    while (taken.has(`봇${n}`)) n++
    nickname = `봇${n}`
  }
  const bot: Player = {
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    nickname,
    seat,
    socketId: null,
    ready: true,
    disconnectedAt: null,
    isBot: true,
    userId: null,
  }
  room.players.set(bot.id, bot)
  return bot
}

/** 비어 있는 가장 앞자리 */
export function firstFreeSeat(room: Room): number | null {
  const taken = new Set<number>()
  for (const p of room.players.values()) if (p.seat !== null) taken.add(p.seat)
  for (let i = 0; i < SEAT_COUNT[room.game]; i++) if (!taken.has(i)) return i
  return null
}

export function seatTakenBy(room: Room, seat: number): Player | undefined {
  for (const p of room.players.values()) if (p.seat === seat) return p
  return undefined
}

export function toPublic(room: Room): RoomPublic {
  const players: PlayerPublic[] = [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    seat: p.seat,
    connected: p.socketId !== null,
    ready: p.ready,
    isBot: p.isBot,
  }))
  return {
    code: room.code,
    game: room.game,
    hostId: room.hostId,
    phase: room.phase,
    visibility: room.visibility,
    title: room.title,
    players,
    seatCount: SEAT_COUNT[room.game],
    dealerSeat: room.dealerSeat,
    options: room.options,
  }
}

/** 호스트가 나가면 남은 **사람**(봇 제외) 중 먼저 들어온 사람에게 넘긴다 */
export function reassignHostIfNeeded(room: Room): void {
  if (room.players.has(room.hostId)) return
  // 봇은 방장이 될 수 없다 — 봇만 남으면 주인 없는 방이 되어 이후 정리된다
  const human = [...room.players.values()].find((p) => !p.isBot)
  room.hostId = human ? human.id : ''
}

export interface SweepResult {
  /** 사람이 빠져서 화면을 다시 그려야 하는 방 */
  changed: string[]
  /** 통째로 사라진 방. 저장소에서도 빼야 로비에 유령 방이 남지 않는다. */
  removed: string[]
}

/** 끊긴 지 오래된 플레이어와 빈 방 정리 */
export function sweep(disconnectGraceMs = 3 * 60_000, emptyRoomTtlMs = 10 * 60_000): SweepResult {
  const now = Date.now()
  const changed: string[] = []
  const removed: string[] = []
  for (const [code, room] of rooms) {
    let dirty = false
    // **게임 중에는 아무도 내보내지 않는다.**
    // 인터넷이 몇 분 끊겼다고 자리를 빼면 남은 사람들의 판까지 깨진다.
    // 자리를 비운 사람은 제한시간이 지나면 서버가 대신 행동해 주므로 판은 계속 굴러간다.
    if (room.phase === 'lobby') {
      for (const [id, p] of room.players) {
        if (p.socketId === null && p.disconnectedAt !== null && now - p.disconnectedAt > disconnectGraceMs) {
          room.players.delete(id)
          dirty = true
        }
      }
    }
    if (dirty) reassignHostIfNeeded(room)
    // 아무도 연결돼 있지 않은 방은 오래되면 정리한다 (게임 중이어도 전원이 나갔으면 의미가 없다)
    const anyoneConnected = [...room.players.values()].some((p) => p.socketId !== null)
    const stale = now - room.createdAt > emptyRoomTtlMs
    if ((room.players.size === 0 || !anyoneConnected) && stale) {
      rooms.delete(code)
      removed.push(code)
      continue
    }
    if (dirty) changed.push(code)
  }
  return { changed, removed }
}

export function roomCount(): number {
  return rooms.size
}

/**
 * 앉아 있는 사람들의 자리를 무작위로 섞는다.
 * 로비 입장 순서가 그대로 좌석 순서로 굳으면 먼저 들어온 사람이 유리해진다.
 */
export function shuffleSeats(room: Room): void {
  const seated = [...room.players.values()].filter((p) => p.seat !== null)
  const seats = seated.map((p) => p.seat!) 
  for (let i = seats.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const a = seats[i]!
    const b = seats[j]!
    seats[i] = b
    seats[j] = a
  }
  seated.forEach((p, i) => {
    p.seat = seats[i]!
    // 자리가 바뀌었으니 준비는 초기화한다. 단, 봇은 늘 준비 상태를 유지한다.
    p.ready = p.isBot
  })
}

/**
 * 앉은 사람들의 자리를 0..N-1로 당겨 붙인다 (상대 순서는 유지).
 *
 * 왜 필요한가: 1번과 5번 자리에만 앉아 있으면 좌석 번호에 구멍이 생긴다.
 * 딜러 회전은 "왼쪽으로 한 칸"이라 좌석 번호가 연속이어야 계산이 맞는다.
 * 게임 시작 직전에 한 번 정리한다.
 */
export function compactSeats(room: Room): void {
  const seated = [...room.players.values()]
    .filter((p) => p.seat !== null)
    .sort((a, b) => a.seat! - b.seat!)
  seated.forEach((p, i) => {
    p.seat = i
  })
}

/**
 * 팀 조합에 맞춰 자리를 재배치한다.
 *
 * arrangement[게임좌석] = 그 자리에 앉을 **현재 자리 번호**.
 * 티츄는 파트너가 마주 앉아야(0·2 / 1·3) 룰이 성립하므로,
 * "누구랑 팀"을 고르면 실제 좌석을 바꿔서 맞춘다.
 */
export function applySeatArrangement(room: Room, arrangement: readonly number[]): void {
  const byCurrentSeat = new Map<number, Player>()
  for (const p of room.players.values()) {
    if (p.seat !== null) byCurrentSeat.set(p.seat, p)
  }
  arrangement.forEach((fromSeat, gameSeat) => {
    const player = byCurrentSeat.get(fromSeat)
    if (player) player.seat = gameSeat
  })
  room.seatArrangement = [...arrangement]
}

// ── 저장소 오가기 ──────────────────────────────────────────────
// 방을 Redis 에 넣었다 되살리기 위한 변환.
// 타이머 핸들과 소켓 ID 는 프로세스가 바뀌면 의미가 없어서 넘기지 않는다.

export function toSnapshot(room: Room): RoomSnapshot {
  return {
    code: room.code,
    game: room.game,
    hostId: room.hostId,
    phase: room.phase,
    visibility: room.visibility,
    title: room.title,
    players: [...room.players.values()].map(
      (p): PlayerSnapshot => ({
        id: p.id,
        token: p.token,
        nickname: p.nickname,
        seat: p.seat,
        ready: p.ready,
        isBot: p.isBot,
        disconnectedAt: p.disconnectedAt,
        userId: p.userId,
      }),
    ),
    options: room.options,
    dealerSeat: room.dealerSeat,
    skGame: room.skGame,
    tichuGame: room.tichuGame,
    seatArrangement: room.seatArrangement,
    tichuAutoPass: room.tichuAutoPass,
    rngState: room.rng?.state ?? null,
    turnDeadline: room.turnDeadline,
    createdAt: room.createdAt,
    updatedAt: Date.now(),
  }
}

/**
 * 스냅샷을 살아 있는 방으로 되돌린다.
 *
 * 되살아난 사람들은 전원 **끊긴 상태**로 시작한다. 소켓은 새로 붙어야 하는 것이고,
 * 각자 브라우저에 있는 토큰으로 재접속하면서 원래 자리를 되찾는다.
 * 게임 중이었다면 sweep 이 자리를 빼지 않으므로 기다려 주면 된다.
 */
export function fromSnapshot(s: RoomSnapshot): Room {
  const players = new Map<string, Player>()
  for (const p of s.players) {
    players.set(p.id, {
      id: p.id,
      token: p.token,
      nickname: p.nickname,
      seat: p.seat,
      socketId: null,
      ready: p.ready,
      // 서버가 죽어 있던 동안은 아무도 "끊긴 지 오래된" 것으로 치지 않는다.
      // 그러지 않으면 재시작 직후 유예시간이 이미 지난 것으로 계산돼 전원이 쫓겨난다.
      disconnectedAt: p.isBot ? null : Date.now(),
      isBot: p.isBot,
      userId: p.userId,
    })
  }
  const room: Room = {
    code: s.code,
    game: s.game,
    hostId: s.hostId,
    phase: s.phase,
    visibility: s.visibility,
    title: s.title,
    players,
    options: s.options,
    dealerSeat: s.dealerSeat,
    skGame: s.skGame,
    tichuGame: s.tichuGame,
    seatArrangement: s.seatArrangement,
    tichuAutoPass: s.tichuAutoPass,
    advanceTimer: null,
    botTimer: null,
    turnTimer: null,
    // 마감 시각은 그대로 살린다. 이미 지났으면 서버가 곧바로 시간초과 처리한다.
    turnDeadline: s.turnDeadline,
    rng: s.rngState === null ? null : createRng(s.rngState),
    createdAt: s.createdAt,
  }
  rooms.set(room.code, room)
  return room
}

/** 서버가 뜰 때 저장소에 있던 방들을 메모리로 올린다 */
export function restoreAll(snapshots: RoomSnapshot[]): number {
  for (const s of snapshots) fromSnapshot(s)
  return snapshots.length
}

/** 모든 방 (스윕·통계용) */
export function allRooms(): Room[] {
  return [...rooms.values()]
}
