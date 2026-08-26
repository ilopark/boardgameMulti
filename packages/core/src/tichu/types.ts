export type TichuSuit = 'jade' | 'sword' | 'pagoda' | 'star'
export const SUITS: readonly TichuSuit[] = ['jade', 'sword', 'pagoda', 'star']

/** 마작 = 1, 2~10 그대로, J=11 Q=12 K=13 A=14, 용 = 15 */
export const MAHJONG_RANK = 1
export const DRAGON_RANK = 15

export type TichuCard =
  | { id: string; kind: 'number'; suit: TichuSuit; rank: number }
  | { id: string; kind: 'mahjong' }
  | { id: string; kind: 'dog' }
  | { id: string; kind: 'phoenix' }
  | { id: string; kind: 'dragon' }

export type ComboType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'stairs'
  | 'fullhouse'
  | 'straight'
  | 'bomb4'
  | 'bombstraight'
  | 'dog'

export interface Combo {
  type: ComboType
  cards: TichuCard[]
  /** 카드 장수 — 같은 장수끼리만 비교 가능 */
  length: number
  /** 비교 기준값. 풀하우스는 트리플 값, 나머지는 최고값 */
  rank: number
  isBomb: boolean
  /** 봉황을 몇 값으로 썼는지 (봉황을 안 썼으면 undefined) */
  phoenixAs?: number
}

export type Declaration = 'none' | 'tichu' | 'grand'

/** 좌석 0-1-2-3, 팀은 (0,2) / (1,3) */
export function teamOf(seat: number): 0 | 1 {
  return (seat % 2) as 0 | 1
}

export function partnerOf(seat: number): number {
  return (seat + 2) % 4
}
