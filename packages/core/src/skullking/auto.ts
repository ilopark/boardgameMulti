import type { SkGameState } from './game.js'
import { cardCountFor, currentSeat, legalFor } from './game.js'
import { effectiveKind } from './trick.js'
import { TRUMP, type SkCard, type TigressAs } from './types.js'

/**
 * 시간이 다 됐을 때 대신 낼 카드를 고른다.
 *
 * 원칙: **가장 약한 카드.** 자리를 비운 사람이 얻어걸려서 트릭을 먹으면
 * (특히 0을 부른 사람에게) 손해가 크므로, 트릭을 안 먹을 확률이 높은 쪽을 낸다.
 */
export function pickWeakestLegal(
  state: SkGameState,
  seat: number,
): { card: SkCard; tigressAs?: TigressAs } | null {
  const legal = legalFor(state, seat)
  if (legal.length === 0) return null

  const score = (card: SkCard): number => {
    switch (card.kind) {
      case 'escape':
        return 0
      case 'tigress':
        return 2 // 도주로 선언해서 낼 것이므로 도주급
      case 'kraken':
        return 3 // 트릭을 없애버리므로 안 먹는다
      case 'whitewhale':
        return 50 // 숫자 싸움이 되어 결과를 예측하기 어렵다
      case 'number': {
        // 리드색이 아니면 어차피 진다 → 아주 약하게 친다
        const lead = state.trick.length > 0 ? leadColorOf(state) : null
        const offSuit = lead !== null && card.color !== lead && card.color !== TRUMP
        const base = offSuit ? 5 : 20
        return base + card.rank + (card.color === TRUMP ? 20 : 0)
      }
      case 'mermaid':
        return 100
      case 'pirate':
        return 120
      case 'skullking':
        return 140
    }
  }

  let best = legal[0]!
  let bestScore = score(best)
  for (const card of legal.slice(1)) {
    const s = score(card)
    if (s < bestScore) {
      best = card
      bestScore = s
    }
  }
  return best.kind === 'tigress' ? { card: best, tigressAs: 'escape' } : { card: best }
}

function leadColorOf(state: SkGameState) {
  for (const play of state.trick) {
    const k = effectiveKind(play)
    if (k === 'escape' || k === 'kraken') continue
    return play.card.kind === 'number' ? play.card.color : null
  }
  return null
}

/**
 * 시간이 다 됐을 때의 입찰. **0을 부른다.**
 * 자리를 비운 사람이 큰 수를 부르면 판이 이상해지고, 0은 실패해도 손해가 가장 작다.
 */
export function autoBid(_state: SkGameState, _seat: number): number {
  return 0
}

/** 지금 누구를 기다리고 있나. 입찰 단계면 아직 안 낸 사람 전원. */
export function waitingSeats(state: SkGameState): number[] {
  if (state.phase === 'bidding') {
    return state.bids.flatMap((b, seat) => (b === null ? [seat] : []))
  }
  if (state.phase === 'playing') {
    const seat = currentSeat(state)
    return seat === null ? [] : [seat]
  }
  return []
}

/** 이 라운드 최대 입찰값 */
export function maxBid(state: SkGameState): number {
  return cardCountFor(state)
}
