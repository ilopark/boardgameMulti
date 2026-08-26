import { shuffle, type Rng } from '../common/rng.js'

/**
 * 팀 조합.
 *
 * 티츄는 **파트너가 마주 앉아야** 룰이 성립한다 (교환은 왼쪽·파트너·오른쪽,
 * 개는 파트너에게 리드, 턴은 한 방향으로 돈다). 그래서 "누구랑 팀"을 고르면
 * 그 둘이 마주 보도록 **자리를 재배치**한다.
 *
 * 이름의 숫자는 로비 자리 번호(1~4) 기준이다.
 */
export type TeamPairing = 'random' | 'seats12' | 'seats13' | 'seats14'

export const TEAM_PAIRING_LABEL: Record<TeamPairing, string> = {
  random: '랜덤',
  seats12: '1·2  vs  3·4',
  seats13: '1·3  vs  2·4',
  seats14: '1·4  vs  2·3',
}

/**
 * 게임 좌석 배치를 구한다.
 *
 * 반환값[gameSeat] = 그 자리에 앉을 **로비 자리 인덱스**.
 * 게임 좌석은 0·2가 한 팀, 1·3이 한 팀으로 고정이다.
 */
export function seatArrangement(pairing: TeamPairing, rng?: Rng): number[] {
  switch (pairing) {
    case 'seats13':
      // 로비 1·3(인덱스 0·2)이 이미 마주본다
      return [0, 1, 2, 3]
    case 'seats12':
      // 로비 1·2(0·1)를 마주보게 → 0번자리=로비1, 2번자리=로비2
      return [0, 2, 1, 3]
    case 'seats14':
      // 로비 1·4(0·3)를 마주보게 → 0번자리=로비1, 2번자리=로비4
      return [0, 1, 3, 2]
    case 'random': {
      if (!rng) return [0, 1, 2, 3]
      return shuffle([0, 1, 2, 3], rng)
    }
  }
}

/** 이 배치에서 실제로 누구와 누가 한 팀인지 (로비 자리 인덱스 쌍) */
export function teamsOf(arrangement: readonly number[]): [[number, number], [number, number]] {
  return [
    [arrangement[0]!, arrangement[2]!],
    [arrangement[1]!, arrangement[3]!],
  ]
}
