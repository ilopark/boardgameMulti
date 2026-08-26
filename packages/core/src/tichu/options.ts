import type { TeamPairing } from './teams.js'

/** 방에서 고를 수 있는 목표 점수 */
export const TARGET_SCORES = [500, 1000] as const
export type TargetScore = (typeof TARGET_SCORES)[number]

export interface TichuRuleOptions {
  /** 목표 점수. 라운드가 끝난 시점에 먼저 도달한 팀 승리 */
  targetScore: number
  /** 폭탄을 자기 턴이 아닐 때도 던질 수 있는가 */
  allowBombInterrupt: boolean
  /** 팀 조합. 게임 시작 시 이 조합대로 자리를 재배치한다 */
  teamPairing: TeamPairing
}

export const DEFAULT_TICHU_OPTIONS: TichuRuleOptions = {
  // 1000점은 한 판이 너무 길다. 친구끼리 가볍게 하기엔 500점이 적당하다.
  targetScore: 500,
  allowBombInterrupt: true,
  // 기본은 무작위 팀 — 매번 다른 조합으로 시작
  teamPairing: 'random',
}

export function makeTichuOptions(patch: Partial<TichuRuleOptions> = {}): TichuRuleOptions {
  return { ...DEFAULT_TICHU_OPTIONS, ...patch }
}
