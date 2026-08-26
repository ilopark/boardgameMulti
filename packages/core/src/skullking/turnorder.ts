import type { Rng } from '../common/rng.js'
import type { SkRuleOptions } from './options.js'

/**
 * 좌석 순서와 딜러 회전.
 *
 * 공식 룰:
 * - 라운드 첫 트릭은 **딜러 왼쪽 사람**이 리드한다
 * - 그 다음부터는 **트릭을 이긴 사람**이 리드한다
 * - 라운드가 끝나면 **딜러가 왼쪽으로 한 칸** 이동한다
 *
 * 룰북이 정하지 않은 것: **맨 처음 딜러를 누구로 하는가.**
 * 로비 입장 순서로 정하면 먼저 들어온 사람이 계속 유리하므로 **무작위로 뽑는다.**
 */

/** 이 구현에서 "왼쪽" = 좌석 번호 +1 방향. 플레이도 이 방향으로 돈다. */
export function seatToLeft(seat: number, playerCount: number): number {
  return (seat + 1) % playerCount
}

/** 게임 시작 시 첫 딜러를 무작위로 뽑는다. */
export function pickInitialDealer(playerCount: number, rng: Rng): number {
  if (playerCount <= 0) throw new Error('플레이어가 없다')
  return Math.floor(rng() * playerCount) % playerCount
}

/** 라운드가 끝나면 딜러는 왼쪽으로 넘어간다. */
export function nextDealer(dealer: number, playerCount: number): number {
  return seatToLeft(dealer, playerCount)
}

/** roundIndex는 0부터. 첫 딜러만 알면 몇 라운드든 바로 계산된다. */
export function dealerForRound(initialDealer: number, roundIndex: number, playerCount: number): number {
  return (initialDealer + roundIndex) % playerCount
}

/** 라운드 첫 트릭을 리드하는 사람 = 딜러 왼쪽. */
export function roundFirstLeader(dealer: number, playerCount: number): number {
  return seatToLeft(dealer, playerCount)
}

/** 일반 트릭(3~6인)의 플레이 순서. 리드부터 왼쪽으로 한 바퀴. */
export function trickOrder(leader: number, playerCount: number): number[] {
  return Array.from({ length: playerCount }, (_, i) => (leader + i) % playerCount)
}

// ── 2인 변형 (Graybeard's Ghost) ──

/** 2인 변형에서 유령이 앉는 좌석. 사람은 0, 1을 쓴다. */
export const GHOST_SEAT = 2

/** 유령이 참여하는 2인 게임인가 */
export function hasGhost(opts: SkRuleOptions, humanCount: number): boolean {
  return humanCount === 2 && opts.useGhostForTwoPlayers
}

/**
 * 2인 변형의 한 트릭 플레이 순서.
 *
 * 룰: 유령은 **항상 두 번째**로 낸다. 단 유령이 직전 트릭을 이겼으면 유령이 리드한다.
 * 유령이 리드했을 때 사람 둘 중 누가 먼저인지는 룰북에 없어서
 * "직전에 리드했던 사람이 먼저"로 정했다 (docs/RULES.md 미확정 항목).
 */
export function twoPlayerTrickOrder(leader: number, lastHumanLeader: number): number[] {
  if (leader !== GHOST_SEAT) {
    const other = leader === 0 ? 1 : 0
    return [leader, GHOST_SEAT, other]
  }
  const other = lastHumanLeader === 0 ? 1 : 0
  return [GHOST_SEAT, lastHumanLeader, other]
}

/**
 * 사람 수에 맞는 트릭 순서를 한 번에 구한다.
 * 2인이면 유령을 끼워 넣고, 아니면 일반 순서.
 */
export function trickOrderFor(
  opts: SkRuleOptions,
  humanCount: number,
  leader: number,
  lastHumanLeader: number,
): number[] {
  if (hasGhost(opts, humanCount)) return twoPlayerTrickOrder(leader, lastHumanLeader)
  return trickOrder(leader, humanCount)
}

/**
 * 게임 전체의 라운드별 딜러·선턴 표.
 * 시작할 때 "누가 언제 선턴인지"를 UI에 미리 보여주려고 쓴다.
 */
export function leadSchedule(
  initialDealer: number,
  playerCount: number,
  roundCount: number,
): Array<{ round: number; dealer: number; leader: number }> {
  return Array.from({ length: roundCount }, (_, i) => {
    const dealer = dealerForRound(initialDealer, i, playerCount)
    return { round: i + 1, dealer, leader: roundFirstLeader(dealer, playerCount) }
  })
}
