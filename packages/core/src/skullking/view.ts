import type { SkGameState, SkPhase } from './game.js'
import { cardCountFor, currentSeat, legalFor, totalRounds } from './game.js'
import { countTricks, type SeatRoundScore } from './scoring.js'
import type { SkCard, SkColor, SkPlay, TrickOutcome } from './types.js'
import { computeLeadColor } from './trick.js'
import { GHOST_SEAT, dealerForRound, hasGhost } from './turnorder.js'

/**
 * 한 플레이어에게 보내는 뷰.
 *
 * **남의 손패는 절대 넣지 않는다.** 클라이언트로 보내고 CSS로 가리는 방식은
 * 개발자도구만 열면 다 보이므로 금지.
 */
export interface SkPlayerView {
  /** 이 뷰를 받는 사람의 좌석 */
  seat: number
  phase: SkPhase
  /** 1부터 */
  round: number
  totalRounds: number
  cardCount: number
  humanCount: number
  hasGhost: boolean
  dealer: number
  leader: number
  /** 지금 카드를 낼 차례인 좌석 */
  currentSeat: number | null
  /** 내 손패 (나만 받는다) */
  hand: SkCard[]
  /** 지금 낼 수 있는 카드 id. 내 차례가 아니면 빈 배열 */
  legal: string[]
  /** 좌석별 남은 손패 장수 (유령 포함) */
  handCounts: number[]
  /** 내 입찰 */
  myBid: number | null
  /**
   * 좌석별 입찰.
   * 입찰 진행 중에는 남의 값을 감춘다 (냈는지 여부만 bidPlaced로).
   * 전원 확정되면 값이 공개된다.
   */
  bids: Array<number | null>
  bidPlaced: boolean[]
  bidsRevealed: boolean
  /** 좌석별 이번 라운드에 먹은 트릭 수 */
  tricksWon: number[]
  /** 지금 테이블에 깔린 카드들 */
  trick: SkPlay[]
  /** 지금 따라야 하는 색. 특수카드만 나왔거나 아직 비었으면 null */
  leadColor: SkColor | null
  /** 방금 끝난 트릭 (trickEnd에서 결과를 보여주려고) */
  lastTrick: { plays: SkPlay[]; outcome: TrickOutcome } | null
  /** 방금 끝난 라운드 점수 */
  lastRoundScores: SeatRoundScore[] | null
  /** 누적 점수 */
  totals: number[]
  history: SeatRoundScore[][]
}

export function viewFor(state: SkGameState, seat: number): SkPlayerView {
  const slots = state.hands.length
  const ghost = hasGhost(state.opts, state.humanCount)
  const bidsRevealed = state.phase !== 'bidding'

  return {
    seat,
    phase: state.phase,
    round: state.roundIndex + 1,
    totalRounds: totalRounds(state.opts),
    cardCount: cardCountFor(state),
    humanCount: state.humanCount,
    hasGhost: ghost,
    dealer: dealerForRound(state.initialDealer, state.roundIndex, state.humanCount),
    leader: state.leader,
    currentSeat: currentSeat(state),
    hand: [...(state.hands[seat] ?? [])],
    legal: legalFor(state, seat).map((c) => c.id),
    handCounts: Array.from({ length: slots }, (_, i) => state.hands[i]?.length ?? 0),
    myBid: state.bids[seat] ?? null,
    bids: bidsRevealed ? [...state.bids] : state.bids.map((b, i) => (i === seat ? b : null)),
    bidPlaced: state.bids.map((b) => b !== null),
    bidsRevealed,
    tricksWon: countTricks(state.tricks, state.humanCount),
    trick: [...state.trick],
    leadColor: computeLeadColor(state.trick),
    lastTrick: state.lastTrick,
    lastRoundScores: state.lastRoundScores,
    totals: [...state.totals],
    history: state.history,
  }
}

/** 관전자/유령용 — 아무 손패도 보여주지 않는다 */
export function spectatorView(state: SkGameState): SkPlayerView {
  const v = viewFor(state, GHOST_SEAT)
  return { ...v, seat: -1, hand: [], legal: [] }
}

/** 최종 순위 (점수 높은 순) */
export function ranking(state: SkGameState): Array<{ seat: number; total: number; rank: number }> {
  const rows = state.totals.map((total, seat) => ({ seat, total }))
  rows.sort((a, b) => b.total - a.total)
  let rank = 0
  let prev: number | null = null
  return rows.map((r, i) => {
    if (prev === null || r.total !== prev) rank = i + 1
    prev = r.total
    return { ...r, rank }
  })
}

export type { SkCard }
