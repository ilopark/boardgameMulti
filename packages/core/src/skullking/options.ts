import type { BonusKind } from './types.js'

export type SkEdition = 'classic' | 'legendary2018' | 'edition2021'

export interface SkBonusTable extends Record<BonusKind, number> {}

export interface SkRuleOptions {
  edition: SkEdition
  /** 숫자카드 최대 랭크. 클래식 13, 2018/2021 14 */
  maxRank: 13 | 14
  useTigress: boolean
  useMermaids: boolean
  useKraken: boolean
  useWhiteWhale: boolean
  /**
   * 해적 고유 능력(로지/바히즈/라스칼/후아니타/해리).
   * **아직 미구현.** 켜도 능력이 발동하지 않으므로 기본값은 false로 둔다.
   */
  usePirateAbilities: boolean
  /**
   * 2인 플레이에서 Graybeard's Ghost(유령 손패)를 쓸지.
   * 3인 이상이면 무시된다. 끄면 그냥 둘이서만 트릭을 겨룬다(비공식).
   */
  useGhostForTwoPlayers: boolean
  /** true면 스컬킹보다 "먼저 낸" 해적만 +30 (2018 룰). false면 순서 무관 (2021 룰) */
  skPirateBonusOrderMatters: boolean
  bonuses: SkBonusTable
  /** 라운드별 배분 장수. 기본 [1..10] */
  roundCardCounts: number[]
}

const DEFAULT_ROUNDS = Array.from({ length: 10 }, (_, i) => i + 1)

export const SK_PRESETS: Record<SkEdition, SkRuleOptions> = {
  classic: {
    edition: 'classic',
    maxRank: 13,
    useTigress: true,
    useMermaids: true,
    useKraken: false,
    useWhiteWhale: false,
    usePirateAbilities: false,
    useGhostForTwoPlayers: true,
    skPirateBonusOrderMatters: true,
    bonuses: {
      colored14: 0,
      black14: 0,
      skCapturesPirate: 30,
      mermaidCapturesSk: 50,
      pirateCapturesMermaid: 0,
    },
    roundCardCounts: DEFAULT_ROUNDS,
  },
  legendary2018: {
    edition: 'legendary2018',
    maxRank: 14,
    useTigress: true,
    useMermaids: true,
    useKraken: true,
    useWhiteWhale: false,
    usePirateAbilities: false, // 미구현
    useGhostForTwoPlayers: true,
    skPirateBonusOrderMatters: true,
    bonuses: {
      colored14: 10,
      black14: 20,
      skCapturesPirate: 30,
      mermaidCapturesSk: 50,
      pirateCapturesMermaid: 0,
    },
    roundCardCounts: DEFAULT_ROUNDS,
  },
  /** 기본값 */
  edition2021: {
    edition: 'edition2021',
    maxRank: 14,
    useTigress: true,
    useMermaids: true,
    useKraken: true,
    useWhiteWhale: true,
    usePirateAbilities: false, // 미구현
    useGhostForTwoPlayers: true,
    skPirateBonusOrderMatters: false,
    bonuses: {
      colored14: 10,
      black14: 20,
      skCapturesPirate: 30,
      mermaidCapturesSk: 40,
      pirateCapturesMermaid: 20,
    },
    roundCardCounts: DEFAULT_ROUNDS,
  },
}

export const DEFAULT_SK_OPTIONS: SkRuleOptions = SK_PRESETS.edition2021

export function makeSkOptions(patch: Partial<SkRuleOptions> = {}): SkRuleOptions {
  const base = patch.edition ? SK_PRESETS[patch.edition] : DEFAULT_SK_OPTIONS
  return { ...base, ...patch, bonuses: { ...base.bonuses, ...(patch.bonuses ?? {}) } }
}

/**
 * 사람 수에 맞춰 옵션을 보정한다.
 * 지금은 사람 수에 따라 바꿀 규칙이 없어 그대로 돌려준다.
 * (2인 변형에서 카드 구성을 조정할 여지를 남겨두는 훅)
 */
export function optionsForPlayerCount(opts: SkRuleOptions, _humanCount: number): SkRuleOptions {
  return opts
}
