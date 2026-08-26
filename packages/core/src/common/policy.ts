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
  trickEndMs: 4_000,
  /** 라운드 점수를 보여주는 시간. 표를 읽을 정도만 짧게. */
  roundEndMs: 4_000,
  /** (티츄) 마작을 낸 뒤 소원을 고를 시간. 안 고르면 소원 없음 */
  wishMs: 10_000,
  /** (티츄) 트릭이 닫히기 전 폭탄을 던질 수 있는 창구 */
  bombWindowMs: 3_000,
  /** (티츄) "폭탄 내기" 예약 후 실제 폭탄을 제출할 시간. 넘기면 취소되고 진행 */
  bombClaimMs: 10_000,
  /**
   * 시간이 다 되면 어떻게 하나.
   * 트릭 테이킹 게임은 "패스"가 없어서 반드시 뭔가 내야 한다 →
   * 낼 수 있는 카드 중 손패 **가장 왼쪽** 카드를 자동으로 낸다.
   */
  onTimeout: 'autoPlayLeftmost' as const,
} satisfies Record<string, number | string>

export type TurnPolicy = typeof TURN_POLICY

/** 남은 시간을 초 단위로 (올림). 카운트다운 표시용 */
export function secondsLeft(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000))
}
