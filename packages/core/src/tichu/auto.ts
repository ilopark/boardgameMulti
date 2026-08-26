import { canBeat, parseCombo } from './combo.js'
import type { TichuAction, TichuGameState } from './game.js'
import { mustFulfillWish, legalPlaysContainingWish } from './game.js'
import { teamOf, type TichuCard } from './types.js'

/**
 * 제한시간이 다 됐을 때 대신 할 행동.
 *
 * 원칙: **가장 손해가 적은 쪽.** 자리를 비운 사람 때문에 판이 이상해지지 않게,
 * 티츄는 선언하지 않고, 낼 수 있으면 제일 약한 걸 내고, 패스할 수 있으면 패스한다.
 */
export function autoAction(state: TichuGameState, seat: number): TichuAction | null {
  // 마작을 낸 봇은 소원을 부르지 않는다 (대기를 풀어 판을 계속 굴린다)
  if (state.awaitingWish === seat) return { type: 'wish', seat, rank: null }
  // 폭탄 창구·예약 중에는 봇은 아무것도 하지 않는다 (서버 타이머가 처리)
  if (state.pendingClose !== null || state.bombClaim !== null) return null

  switch (state.phase) {
    case 'grandTichu':
      return { type: 'grandTichu', seat, call: false }

    case 'passing': {
      const hand = state.hands[seat] ?? []
      if (hand.length < 3) return null
      // 점수 없는 약한 카드부터 넘긴다
      const sorted = [...hand].sort((a, b) => weight(a) - weight(b))
      const ids = sorted.slice(0, 3).map((c) => c.id) as [string, string, string]
      return { type: 'pass3', seat, cardIds: ids }
    }

    case 'playing': {
      if (state.turn !== seat) return null
      // 소원을 이행해야 하면 패스할 수 없다
      if (mustFulfillWish(state, seat)) {
        const options = legalPlaysContainingWish(state, seat)
        const pick = options[0]
        return pick ? { type: 'play', seat, cardIds: pick } : null
      }
      // 받아치는 상황이면 패스가 가장 안전하다
      if (state.current !== null) return { type: 'pass', seat }
      // 리드는 반드시 내야 한다 → 제일 약한 한 장
      const weakest = weakestLead(state, seat)
      return weakest ? { type: 'play', seat, cardIds: [weakest.id] } : null
    }

    case 'dragonGift': {
      const target = [0, 1, 2, 3].find((s) => teamOf(s) !== teamOf(seat))
      return target === undefined ? null : { type: 'giveDragon', seat, to: target }
    }

    default:
      return null
  }
}

/** 리드할 때 낼 제일 약한 단일 카드 */
function weakestLead(state: TichuGameState, seat: number): TichuCard | null {
  const hand = state.hands[seat] ?? []
  let best: TichuCard | null = null
  let bestWeight = Infinity
  for (const card of hand) {
    // 개는 리드를 넘겨버리므로 자동 선택에서는 피한다
    if (card.kind === 'dog') continue
    const combo = parseCombo([card])
    if (!combo || !canBeat(combo, null)) continue
    const w = weight(card)
    if (w < bestWeight) {
      bestWeight = w
      best = card
    }
  }
  // 개밖에 없으면 어쩔 수 없이 개
  return best ?? hand[0] ?? null
}

/** 넘기거나 버리기 좋은 순서 — 낮을수록 먼저 */
function weight(card: TichuCard): number {
  switch (card.kind) {
    case 'mahjong':
      return 1
    case 'dog':
      return 2
    case 'number':
      // 점수 카드(5·10·K)는 아깝다
      return card.rank + (card.rank === 5 || card.rank === 10 || card.rank === 13 ? 30 : 0)
    case 'phoenix':
      return 200
    case 'dragon':
      return 300
  }
}
