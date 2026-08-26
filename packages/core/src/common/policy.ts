/**
 * 게임 공통 진행 정책.
 *
 * 티츄와 스컬킹이 **같은 값을 쓴다.** 한 게임만 바꾸고 싶어질 때가 오면
 * 그때 게임별로 갈라내되, 기본은 여기 한 곳에서만 고친다.
 */
export const TURN_POLICY = {
  /** 카드 한 장 낼 때까지 주는 시간 */
  playMs: 30_000,
  /** 입찰(스컬킹) · 선언과 카드 교환(티츄)에 주는 시간 */
  bidMs: 30_000,
  /** 트릭 결과를 보여주는 시간. 끝나면 자동으로 다음 트릭 */
  trickEndMs: 3_000,
  /** 라운드 점수를 보여주는 시간. 트릭보다는 길어야 표를 읽을 수 있다 */
  roundEndMs: 8_000,
  /**
   * 시간이 다 되면 어떻게 하나.
   * 트릭 테이킹 게임은 "패스"가 없어서 반드시 뭔가 내야 한다 → 가장 약한 카드를 자동으로 낸다.
   */
  onTimeout: 'autoPlayWeakest' as const,
} satisfies Record<string, number | string>

export type TurnPolicy = typeof TURN_POLICY

/** 남은 시간을 초 단위로 (올림). 카운트다운 표시용 */
export function secondsLeft(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000))
}
