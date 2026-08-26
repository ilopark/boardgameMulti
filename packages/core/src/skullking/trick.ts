import {
  TRUMP,
  type BonusEvent,
  type SkCard,
  type SkColor,
  type SkPlay,
  type TrickOutcome,
} from './types.js'
import { DEFAULT_SK_OPTIONS, type SkRuleOptions } from './options.js'

const COLOR_KO: Record<SkColor, string> = {
  green: '앵무새(초록)',
  yellow: '보물상자(노랑)',
  purple: '지도(보라)',
  black: '졸리로저(검정)',
}

/** 티그리스 선언을 반영한 "실제로 취급되는" 종류 */
export type EffectiveKind =
  | 'number'
  | 'escape'
  | 'pirate'
  | 'mermaid'
  | 'skullking'
  | 'kraken'
  | 'whitewhale'

export function effectiveKind(play: SkPlay): EffectiveKind {
  const { card } = play
  switch (card.kind) {
    case 'tigress':
      // 선언 안 했으면 도주로 간주 (서버가 선언을 강제하므로 방어적 기본값)
      return play.tigressAs === 'pirate' ? 'pirate' : 'escape'
    default:
      return card.kind
  }
}

/** 색을 정하지 못하고 다음 사람에게 넘기는 카드 */
function isSuitPasser(play: SkPlay): boolean {
  const k = effectiveKind(play)
  return k === 'escape' || k === 'kraken'
}

/**
 * 리드색 결정.
 * 도주/크라켄은 색 결정권을 다음 사람에게 넘긴다.
 * 해적·인어·스컬킹·흰고래가 먼저 나오면 그 트릭엔 팔로우할 색이 없다.
 */
export function computeLeadColor(plays: readonly SkPlay[]): SkColor | null {
  for (const play of plays) {
    if (isSuitPasser(play)) continue
    if (play.card.kind === 'number') return play.card.color
    return null // 해적/인어/스컬킹/흰고래 — 팔로우 대상 없음
  }
  return null // 전원 도주
}

/** 지금 낼 수 있는 카드들. 서버가 이걸로 검증하고, 클라이언트가 이걸로 흐리게 표시한다. */
export function legalPlays(hand: readonly SkCard[], plays: readonly SkPlay[]): SkCard[] {
  const leadColor = computeLeadColor(plays)
  if (leadColor === null) return hand.slice()

  const hasLeadColor = hand.some((c) => c.kind === 'number' && c.color === leadColor)
  if (!hasLeadColor) return hand.slice()

  // 리드색을 가지고 있으면: 그 색 숫자카드 + 모든 특수카드
  return hand.filter((c) => c.kind !== 'number' || c.color === leadColor)
}

function lastIndexOfKind(plays: readonly SkPlay[], kind: EffectiveKind): number {
  for (let i = plays.length - 1; i >= 0; i--) {
    if (effectiveKind(plays[i]!) === kind) return i
  }
  return -1
}

function firstIndexOfKind(plays: readonly SkPlay[], kind: EffectiveKind): number {
  for (let i = 0; i < plays.length; i++) {
    if (effectiveKind(plays[i]!) === kind) return i
  }
  return -1
}

function indicesOfKind(plays: readonly SkPlay[], kind: EffectiveKind): number[] {
  const out: number[] = []
  for (let i = 0; i < plays.length; i++) if (effectiveKind(plays[i]!) === kind) out.push(i)
  return out
}

/** 크라켄·흰고래를 제외한 순수 서열 판정. 반환값은 plays 배열의 인덱스. */
function resolveRanking(plays: readonly SkPlay[], leadColor: SkColor | null): { idx: number; reason: string } {
  const skIdx = firstIndexOfKind(plays, 'skullking')
  const mermaidIdxs = indicesOfKind(plays, 'mermaid')
  const pirateIdxs = indicesOfKind(plays, 'pirate')

  // 인어는 스컬킹만 잡는다. 스컬킹이 있으면 해적이 같이 있어도 인어 승.
  if (skIdx >= 0 && mermaidIdxs.length > 0) {
    return { idx: mermaidIdxs[0]!, reason: '인어가 스컬킹을 사로잡음' }
  }
  if (skIdx >= 0) return { idx: skIdx, reason: '스컬킹이 모두를 제압' }
  if (pirateIdxs.length > 0) {
    return {
      idx: pirateIdxs[0]!,
      reason: pirateIdxs.length > 1 ? '해적 다수 — 먼저 낸 해적 승' : '해적 승',
    }
  }
  if (mermaidIdxs.length > 0) {
    return {
      idx: mermaidIdxs[0]!,
      reason: mermaidIdxs.length > 1 ? '인어 둘 — 먼저 낸 인어 승' : '인어 승',
    }
  }

  // 숫자카드 판정: 검정(트럼프) 우선, 그다음 리드색
  let best = -1
  let bestRank = -1
  for (let i = 0; i < plays.length; i++) {
    const card = plays[i]!.card
    if (card.kind !== 'number' || card.color !== TRUMP) continue
    if (card.rank > bestRank) {
      bestRank = card.rank
      best = i
    }
  }
  if (best >= 0) return { idx: best, reason: `검정 ${bestRank} — 졸리로저가 다른 색을 제압` }

  if (leadColor !== null) {
    for (let i = 0; i < plays.length; i++) {
      const card = plays[i]!.card
      if (card.kind !== 'number' || card.color !== leadColor) continue
      if (card.rank > bestRank) {
        bestRank = card.rank
        best = i
      }
    }
    if (best >= 0) return { idx: best, reason: `리드색 최고 숫자 ${bestRank}` }
  }

  // 전원 도주
  return { idx: 0, reason: '전원 도주 — 먼저 낸 사람 승' }
}

/** 흰고래: 모든 특수카드가 도주로 변하고, 색 구분 없이 숫자 최고가 이긴다. */
function resolveWhiteWhale(plays: readonly SkPlay[]): { idx: number; reason: string } {
  let best = -1
  let bestRank = -1
  for (let i = 0; i < plays.length; i++) {
    const card = plays[i]!.card
    if (card.kind !== 'number') continue
    if (card.rank > bestRank) {
      bestRank = card.rank
      best = i
    }
  }
  if (best >= 0) return { idx: best, reason: `흰고래 — 색 무시, 숫자 최고 ${bestRank} 승` }
  // 하우스룰: 숫자카드가 하나도 없으면 전원 도주로 취급
  return { idx: 0, reason: '흰고래 — 숫자카드 없음, 먼저 낸 사람 승 (하우스룰)' }
}

function collectBonuses(
  plays: readonly SkPlay[],
  winnerIdx: number,
  opts: SkRuleOptions,
): BonusEvent[] {
  const out: BonusEvent[] = []
  const winner = plays[winnerIdx]!
  const seat = winner.seat
  const b = opts.bonuses

  // 14 획득
  for (const play of plays) {
    const card = play.card
    if (card.kind !== 'number' || card.rank !== opts.maxRank) continue
    const isTrump = card.color === TRUMP
    const points = isTrump ? b.black14 : b.colored14
    if (points === 0) continue
    out.push({
      seat,
      kind: isTrump ? 'black14' : 'colored14',
      points,
      detail: `${COLOR_KO[card.color]} ${card.rank} 획득`,
    })
  }

  const winnerKind = effectiveKind(winner)

  // 스컬킹이 해적을 잡음
  if (winnerKind === 'skullking' && b.skCapturesPirate > 0) {
    const pirateIdxs = indicesOfKind(plays, 'pirate')
    const counted = opts.skPirateBonusOrderMatters
      ? pirateIdxs.filter((i) => i < winnerIdx)
      : pirateIdxs
    for (const i of counted) {
      const c = plays[i]!.card
      out.push({
        seat,
        kind: 'skCapturesPirate',
        points: b.skCapturesPirate,
        detail: `스컬킹이 해적(${c.kind === 'pirate' ? c.pirate : '티그리스'}) 사로잡음`,
      })
    }
  }

  // 인어가 스컬킹을 잡음
  if (winnerKind === 'mermaid' && b.mermaidCapturesSk > 0) {
    if (firstIndexOfKind(plays, 'skullking') >= 0) {
      out.push({ seat, kind: 'mermaidCapturesSk', points: b.mermaidCapturesSk, detail: '인어가 스컬킹 사로잡음' })
    }
  }

  // 해적이 인어를 잡음
  if (winnerKind === 'pirate' && b.pirateCapturesMermaid > 0) {
    for (const _ of indicesOfKind(plays, 'mermaid')) {
      out.push({ seat, kind: 'pirateCapturesMermaid', points: b.pirateCapturesMermaid, detail: '해적이 인어 사로잡음' })
    }
  }

  return out
}

/**
 * 트릭 판정. 순수 함수 — 같은 입력이면 항상 같은 결과.
 * plays는 실제 플레이 순서대로 들어와야 한다.
 */
export function resolveTrick(
  plays: readonly SkPlay[],
  opts: SkRuleOptions = DEFAULT_SK_OPTIONS,
): TrickOutcome {
  if (plays.length === 0) throw new Error('빈 트릭은 판정할 수 없다')

  const leadColor = computeLeadColor(plays)
  const krakenIdx = opts.useKraken ? lastIndexOfKind(plays, 'kraken') : -1
  const whaleIdx = opts.useWhiteWhale ? lastIndexOfKind(plays, 'whitewhale') : -1

  // 크라켄 vs 흰고래 — 나중에 낸 쪽이 발동
  const krakenWins = krakenIdx >= 0 && krakenIdx > whaleIdx
  const whaleWins = whaleIdx >= 0 && whaleIdx > krakenIdx

  if (krakenWins) {
    // 크라켄이 없었다면 이겼을 사람을 찾아 다음 리드로 지정
    const without = plays.filter((_, i) => i !== krakenIdx)
    const fallback =
      without.length === 0
        ? { idx: 0, reason: '' }
        : whaleIdx >= 0
          ? resolveWhiteWhale(without)
          : resolveRanking(without, leadColor)
    const nextLeader = without.length === 0 ? plays[0]!.seat : without[fallback.idx]!.seat
    return {
      winner: null,
      nextLeader,
      destroyed: true,
      leadColor,
      bonuses: [],
      reason: '크라켄이 트릭을 파괴 — 아무도 가져가지 않음',
    }
  }

  const { idx, reason } = whaleWins ? resolveWhiteWhale(plays) : resolveRanking(plays, leadColor)
  const winnerPlay = plays[idx]!

  const bonuses = collectBonuses(plays, idx, opts)

  return {
    winner: winnerPlay.seat,
    nextLeader: winnerPlay.seat,
    destroyed: false,
    leadColor,
    bonuses,
    reason,
  }
}
