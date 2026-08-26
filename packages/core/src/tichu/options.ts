import type { TeamPairing } from './teams.js'

export interface TichuRuleOptions {
  /** 목표 점수. 먼저 도달한 팀 승리 */
  targetScore: number
  /** 폭탄을 자기 턴이 아닐 때도 던질 수 있는가 */
  allowBombInterrupt: boolean
  /** 팀 조합. 게임 시작 시 이 조합대로 자리를 재배치한다 */
  teamPairing: TeamPairing
}

export const DEFAULT_TICHU_OPTIONS: TichuRuleOptions = {
  targetScore: 1000,
  allowBombInterrupt: true,
  teamPairing: 'seats13',
}

export function makeTichuOptions(patch: Partial<TichuRuleOptions> = {}): TichuRuleOptions {
  return { ...DEFAULT_TICHU_OPTIONS, ...patch }
}
