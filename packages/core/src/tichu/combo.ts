import { DRAGON_RANK, MAHJONG_RANK, type Combo, type ComboType, type TichuCard, type TichuSuit } from './types.js'

/** 파싱용 내부 표현. virtual = 봉황이 대신하고 있는 자리 */
interface Slot {
  rank: number
  suit: TichuSuit | null
  virtual: boolean
}

export interface ParseOptions {
  /** 봉황을 몇 값으로 쓸지 명시. 단독으로 낼 때는 반드시 지정해야 한다(직전 카드 + 0.5). */
  phoenixAs?: number
  /** 스트레이트 플러시를 폭탄으로 낼지 일반 스트레이트로 낼지. 기본 true(폭탄) */
  asBomb?: boolean
}

function toSlot(card: TichuCard): Slot | null {
  if (card.kind === 'number') return { rank: card.rank, suit: card.suit, virtual: false }
  if (card.kind === 'mahjong') return { rank: MAHJONG_RANK, suit: null, virtual: false }
  return null // 개·봉황·용은 별도 처리
}

function groupByRank(slots: readonly Slot[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const s of slots) m.set(s.rank, (m.get(s.rank) ?? 0) + 1)
  return m
}

function isConsecutive(ranks: readonly number[]): boolean {
  if (ranks.length === 0) return false
  const sorted = [...ranks].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) return false
  }
  return true
}

function make(type: ComboType, cards: TichuCard[], rank: number, isBomb: boolean, phoenixAs?: number): Combo {
  const combo: Combo = { type, cards, length: cards.length, rank, isBomb }
  if (phoenixAs !== undefined) return { ...combo, phoenixAs }
  return combo
}

/** 봉황을 이미 구체적인 값으로 치환한 뒤의 판정 */
function parseConcrete(
  slots: readonly Slot[],
  cards: TichuCard[],
  asBomb: boolean,
  phoenixAs?: number,
): Combo | null {
  const n = slots.length
  if (n === 0) return null

  const hasVirtual = slots.some((s) => s.virtual)
  const allSuited = slots.every((s) => s.suit !== null)
  const groups = groupByRank(slots)
  const ranks = [...groups.keys()].sort((a, b) => a - b)
  const maxRank = ranks[ranks.length - 1]!

  if (n === 1) return make('single', cards, slots[0]!.rank, false, phoenixAs)

  // 폭탄: 포카드
  if (n === 4 && groups.size === 1 && !hasVirtual && allSuited) {
    return make('bomb4', cards, maxRank, true)
  }

  // 폭탄: 스트레이트 플러시 (같은 문양 연속 5장 이상)
  const sameSuit = allSuited && new Set(slots.map((s) => s.suit)).size === 1
  const distinctConsecutive = groups.size === n && isConsecutive(ranks)
  if (n >= 5 && sameSuit && !hasVirtual && distinctConsecutive) {
    if (asBomb) return make('bombstraight', cards, maxRank, true)
    return make('straight', cards, maxRank, false)
  }

  if (n === 2 && groups.size === 1) return make('pair', cards, maxRank, false, phoenixAs)
  if (n === 3 && groups.size === 1) return make('triple', cards, maxRank, false, phoenixAs)

  // 풀하우스: 트리플 + 페어. 비교는 트리플 값으로.
  if (n === 5 && groups.size === 2) {
    const entries = [...groups.entries()]
    const triple = entries.find(([, c]) => c === 3)
    const pair = entries.find(([, c]) => c === 2)
    if (triple && pair) return make('fullhouse', cards, triple[0], false, phoenixAs)
  }

  // 연속 페어 (계단)
  if (n >= 4 && n % 2 === 0) {
    const allPairs = [...groups.values()].every((c) => c === 2)
    if (allPairs && isConsecutive(ranks)) return make('stairs', cards, maxRank, false, phoenixAs)
  }

  // 일반 스트레이트: 연속 5장 이상
  if (n >= 5 && distinctConsecutive) return make('straight', cards, maxRank, false, phoenixAs)

  return null
}

/**
 * 카드 묶음을 조합으로 파싱한다. 유효하지 않으면 null.
 * 봉황이 있고 phoenixAs를 안 주면 가능한 값 중 가장 강한 조합을 고른다.
 */
export function parseCombo(cards: readonly TichuCard[], opts: ParseOptions = {}): Combo | null {
  const n = cards.length
  if (n === 0) return null
  const asBomb = opts.asBomb ?? true

  const hasDog = cards.some((c) => c.kind === 'dog')
  const hasDragon = cards.some((c) => c.kind === 'dragon')
  const hasPhoenix = cards.some((c) => c.kind === 'phoenix')

  // 개: 단독으로만. 트릭을 만들지 않고 파트너에게 리드를 넘긴다.
  if (hasDog) return n === 1 ? make('dog', [...cards], 0, false) : null
  // 용: 단독으로만. 조합에 못 들어간다.
  if (hasDragon) return n === 1 ? make('single', [...cards], DRAGON_RANK, false) : null

  if (!hasPhoenix) {
    const slots: Slot[] = []
    for (const c of cards) {
      const s = toSlot(c)
      if (!s) return null
      slots.push(s)
    }
    return parseConcrete(slots, [...cards], asBomb)
  }

  // ── 봉황 처리 ──
  if (cards.length === 1) {
    // 단독 봉황: 리드면 1.5, 아니면 직전 카드 + 0.5
    const rank = opts.phoenixAs ?? 1.5
    return make('single', [...cards], rank, false, rank)
  }

  const others: Slot[] = []
  for (const c of cards) {
    if (c.kind === 'phoenix') continue
    const s = toSlot(c)
    if (!s) return null
    others.push(s)
  }

  const candidates = opts.phoenixAs !== undefined ? [opts.phoenixAs] : rangeInclusive(MAHJONG_RANK, 14)
  let best: Combo | null = null
  for (const r of candidates) {
    const combo = parseConcrete([...others, { rank: r, suit: null, virtual: true }], [...cards], asBomb, r)
    if (!combo) continue
    if (!best || combo.rank > best.rank) best = combo
  }
  return best
}

function rangeInclusive(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}

/**
 * candidate가 현재 테이블의 current를 이길 수 있는가.
 * current가 null이면 리드 상황.
 */
export function canBeat(candidate: Combo, current: Combo | null): boolean {
  if (candidate.type === 'dog') return current === null // 개는 리드일 때만
  if (current === null) return true

  if (candidate.isBomb) {
    if (!current.isBomb) return true
    if (candidate.length !== current.length) return candidate.length > current.length
    return candidate.rank > current.rank
  }
  if (current.isBomb) return false

  return (
    candidate.type === current.type &&
    candidate.length === current.length &&
    candidate.rank > current.rank
  )
}

const TYPE_LABEL: Record<ComboType, string> = {
  single: '싱글',
  pair: '페어',
  triple: '트리플',
  stairs: '연속 페어',
  fullhouse: '풀하우스',
  straight: '스트레이트',
  bomb4: '폭탄(포카드)',
  bombstraight: '폭탄(스트레이트 플러시)',
  dog: '개',
}

/** 값 표기 — 11~14는 J·Q·K·A 로 (숫자 그대로 쓰지 않는다) */
function rankName(rank: number): string {
  switch (rank) {
    case 11: return 'J'
    case 12: return 'Q'
    case 13: return 'K'
    case 14: return 'A'
    default: return String(rank)
  }
}

export function describeCombo(combo: Combo): string {
  const base = `${TYPE_LABEL[combo.type]} ${combo.length}장 (값 ${rankName(combo.rank)})`
  return combo.phoenixAs !== undefined ? `${base} · 봉황=${rankName(combo.phoenixAs)}` : base
}

/**
 * 봉황을 몇 값으로 쓰느냐에 따라 만들어지는 **서로 다른** 조합들.
 *
 * 클라이언트가 이걸 보고 결과가 2개 이상이면 선택창을 띄운다.
 * 1개면 그냥 낸다 — 매번 묻지 않기 위해서다.
 * 봉황이 없거나 해석이 하나뿐이면 길이 1 이하의 배열이 나온다.
 */
export function phoenixOptions(cards: readonly TichuCard[]): Combo[] {
  if (!cards.some((c) => c.kind === 'phoenix')) {
    const only = parseCombo(cards)
    return only ? [only] : []
  }
  // 단독 봉황은 직전 카드에 따라 값이 정해지므로 고를 게 없다
  if (cards.length === 1) {
    const only = parseCombo(cards)
    return only ? [only] : []
  }

  const seen = new Map<string, Combo>()
  for (let r = MAHJONG_RANK; r <= 14; r++) {
    const combo = parseCombo(cards, { phoenixAs: r })
    if (!combo) continue
    // 결과가 같은 조합(같은 종류·장수·값)이면 하나로 친다
    const key = `${combo.type}:${combo.length}:${combo.rank}`
    if (!seen.has(key)) seen.set(key, combo)
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank)
}

/** 이 카드 묶음을 낼 때 봉황 값을 물어봐야 하는가 */
export function needsPhoenixChoice(cards: readonly TichuCard[]): boolean {
  return phoenixOptions(cards).length > 1
}

/**
 * 봉황을 **단독으로** 낼 때의 값.
 *
 * 룰: 직전에 나온 카드보다 0.5 높다. 리드로 내면 1.5.
 * 그래서 A(14) 위에는 14.5로 이기지만, 용(15)은 못 이긴다.
 *
 * 이 값은 **플레이어가 고르는 게 아니라 테이블 상황이 정한다.**
 * 서버와 클라이언트가 같은 계산을 쓰도록 여기 한 곳에 둔다.
 */
export function phoenixSingleRank(current: Combo | null): number {
  if (current === null) return 1.5
  if (current.type !== 'single') return 1.5
  // 룰: 봉황은 A는 이겨도 **용은 못 이긴다.**
  // 그냥 +0.5를 하면 15.5가 되어 용을 이겨버리므로 여기서 막는다.
  if (current.cards.some((c) => c.kind === 'dragon')) return 1.5
  return current.rank + 0.5
}

/**
 * 지금 테이블 상황에 맞춰 조합을 파싱한다.
 * 봉황 단독이면 값을 테이블에서 계산해 넣어준다.
 */
export function parseAgainst(
  cards: readonly TichuCard[],
  current: Combo | null,
  opts: ParseOptions = {},
): Combo | null {
  const isLonePhoenix = cards.length === 1 && cards[0]?.kind === 'phoenix'
  if (isLonePhoenix && opts.phoenixAs === undefined) {
    return parseCombo(cards, { ...opts, phoenixAs: phoenixSingleRank(current) })
  }
  return parseCombo(cards, opts)
}
