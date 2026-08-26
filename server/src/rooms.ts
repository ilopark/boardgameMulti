import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { SEAT_COUNT, type GameId, type PlayerPublic, type RoomPublic } from '@bg/core'

export interface Player {
  id: string
  token: string
  nickname: string
  seat: number | null
  socketId: string | null
  ready: boolean
  /** 연결이 끊긴 시각. 일정 시간 지나면 방에서 제거 */
  disconnectedAt: number | null
}

export interface Room {
  code: string
  game: GameId
  hostId: string
  phase: 'lobby' | 'playing' | 'finished'
  players: Map<string, Player>
  options: Record<string, unknown>
  /** 이번 라운드 딜러 좌석. 게임 시작 시 무작위로 정해진다. 대기 중엔 null. */
  dealerSeat: number | null
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

export function createRoom(game: GameId, defaultOptions: Record<string, unknown>): Room {
  const room: Room = {
    code: generateCode(),
    game,
    hostId: '',
    phase: 'lobby',
    players: new Map(),
    options: defaultOptions,
    dealerSeat: null,
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

export function addPlayer(room: Room, nickname: string): Player {
  const player: Player = {
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    nickname,
    seat: null,
    socketId: null,
    ready: false,
    disconnectedAt: null,
  }
  room.players.set(player.id, player)
  if (!room.hostId) room.hostId = player.id
  return player
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
  }))
  return {
    code: room.code,
    game: room.game,
    hostId: room.hostId,
    phase: room.phase,
    players,
    seatCount: SEAT_COUNT[room.game],
    dealerSeat: room.dealerSeat,
    options: room.options,
  }
}

/** 호스트가 나가면 남은 사람 중 먼저 들어온 사람에게 넘긴다 */
export function reassignHostIfNeeded(room: Room): void {
  if (room.players.has(room.hostId)) return
  const next = room.players.values().next()
  room.hostId = next.done ? '' : next.value.id
}

/** 끊긴 지 오래된 플레이어와 빈 방 정리 */
export function sweep(disconnectGraceMs = 3 * 60_000, emptyRoomTtlMs = 10 * 60_000): string[] {
  const now = Date.now()
  const changed: string[] = []
  for (const [code, room] of rooms) {
    let dirty = false
    for (const [id, p] of room.players) {
      if (p.socketId === null && p.disconnectedAt !== null && now - p.disconnectedAt > disconnectGraceMs) {
        room.players.delete(id)
        dirty = true
      }
    }
    if (dirty) reassignHostIfNeeded(room)
    if (room.players.size === 0 && now - room.createdAt > emptyRoomTtlMs) {
      rooms.delete(code)
      continue
    }
    if (dirty) changed.push(code)
  }
  return changed
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
    p.ready = false // 자리가 바뀌었으니 준비는 초기화
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
