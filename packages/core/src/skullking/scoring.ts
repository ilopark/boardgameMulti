import type { BonusEvent, TrickOutcome } from './types.js'
import { DEFAULT_SK_OPTIONS, type SkRuleOptions } from './options.js'

export interface RoundInput {
  /** 이 라운드에 배분된 카드 수 = 트릭 수 */
  cardCount: number
  /** 좌석별 입찰. **사람 좌석만** 넣는다 — 유령은 입찰도 점수도 없다. */
  bids: number[]
  /** 그 라운드에 실제로 벌어진 트릭 결과들 (순서대로) */
  tricks: TrickOutcome[]
  /** 라스칼 능력 베팅: 좌석 -> 10 | 20 */
  rascalWagers?: Record<number, number>
}

export interface SeatRoundScore {
  seat: number
  bid: number
  taken: number
  bidMet: boolean
  bidPoints: number
  bonusPoints: number
  /** 지급된 보너스 내역 (입찰 실패 시 빈 배열) */
  bonuses: BonusEvent[]
  total: number
}

/**
 * 좌석별로 실제 먹은 트릭 수.
 * seats 범위 밖 좌석(2인 변형의 유령)이 이긴 트릭은 아무에게도 가지 않는다.
 */
export function countTricks(tricks: readonly TrickOutcome[], seats: number): number[] {
  const taken = new Array<number>(seats).fill(0)
  for (const t of tricks) {
    if (t.winner === null) continue // 크라켄으로 소멸한 트릭은 아무도 안 먹은 것
    if (t.winner < 0 || t.winner >= seats) continue // 유령 — 점수가 없다
    taken[t.winner] = (taken[t.winner] ?? 0) + 1
  }
  return taken
}

function bidScore(bid: number, taken: number, cardCount: number): number {
  if (bid === 0) return taken === 0 ? 10 * cardCount : -10 * cardCount
  if (bid === taken) return 20 * bid
  return -10 * Math.abs(taken - bid)
}

export function scoreRound(
  input: RoundInput,
  opts: SkRuleOptions = DEFAULT_SK_OPTIONS,
): SeatRoundScore[] {
  const seats = input.bids.length
  const taken = countTricks(input.tricks, seats)

  const bidMet = input.bids.map((bid, seat) => bid === (taken[seat] ?? 0))

  // 좌석별 보너스 수집 — 입찰 성공한 좌석만
  const bonusBySeat: BonusEvent[][] = Array.from({ length: seats }, () => [])
  for (const trick of input.tricks) {
    for (const b of trick.bonuses) {
      if (b.seat < 0 || b.seat >= seats) continue // 유령이 딴 보너스는 버려진다
      if (!bidMet[b.seat]) continue
      bonusBySeat[b.seat]!.push(b)
    }
    // 루트 동맹은 양쪽 다 입찰 성공해야 지급
    for (const [a, c] of trick.alliances) {
      if (a < 0 || a >= seats || c < 0 || c >= seats) continue // 유령과는 동맹이 성립하지 않는다
      if (!bidMet[a] || !bidMet[c]) continue
      const pts = opts.bonuses.lootAlliance
      bonusBySeat[a]!.push({ seat: a, kind: 'lootAlliance', points: pts, detail: `${c}번과 루트 동맹 성립` })
      bonusBySeat[c]!.push({ seat: c, kind: 'lootAlliance', points: pts, detail: `${a}번과 루트 동맹 성립` })
    }
  }

  return input.bids.map((bid, seat) => {
    const t = taken[seat] ?? 0
    const met = bidMet[seat]!
    const bonuses = bonusBySeat[seat]!
    let bonusPoints = bonuses.reduce((sum, b) => sum + b.points, 0)

    // 라스칼 베팅: 성공하면 +, 실패하면 − (입찰 성공 여부와 무관하게 정산)
    const wager = input.rascalWagers?.[seat]
    if (wager) bonusPoints += met ? wager : -wager

    const bidPoints = bidScore(bid, t, input.cardCount)
    return { seat, bid, taken: t, bidMet: met, bidPoints, bonusPoints, bonuses, total: bidPoints + bonusPoints }
  })
}
