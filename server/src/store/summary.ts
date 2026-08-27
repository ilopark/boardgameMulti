import { SEAT_COUNT, type PublicRoomSummary } from '@bg/core'
import type { ListFilter, RoomSnapshot } from './types.js'

/**
 * 방 스냅샷 → 로비 목록 한 줄.
 *
 * **여기서 나가는 건 전부 남이 봐도 되는 것만이다.** 손패·입찰·플레이어 토큰은 절대 넣지 않는다.
 * 목록은 방에 들어가지 않은 사람도 받으므로 여기가 정보 유출의 최전선이다.
 */
export function toSummary(room: RoomSnapshot): PublicRoomSummary {
  const host = room.players.find((p) => p.id === room.hostId)
  return {
    code: room.code,
    game: room.game,
    title: room.title,
    hostNickname: host?.nickname ?? '(빈 방)',
    playerCount: room.players.length,
    seatCount: SEAT_COUNT[room.game],
    phase: room.phase,
    options: room.options,
    createdAt: room.createdAt,
  }
}

/** 목록에 띄울 방인지 — 공개방이고, 필터에 맞고, 사람이 남아 있는 방 */
export function isListable(room: RoomSnapshot, filter: ListFilter = {}): boolean {
  if (room.visibility !== 'public') return false
  if (filter.game && room.game !== filter.game) return false
  if (filter.waitingOnly && room.phase !== 'lobby') return false
  // 봇만 남은 방은 사람이 들어가도 의미가 없어서 숨긴다
  return room.players.some((p) => !p.isBot)
}

/** 대기 중 → 진행 중 순, 그 안에서는 최근에 만든 방부터 */
export function sortForLobby(rooms: PublicRoomSummary[]): PublicRoomSummary[] {
  const rank = (p: PublicRoomSummary['phase']): number => (p === 'lobby' ? 0 : p === 'playing' ? 1 : 2)
  return rooms.slice().sort((a, b) => rank(a.phase) - rank(b.phase) || b.createdAt - a.createdAt)
}
