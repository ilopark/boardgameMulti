import { describe, expect, it } from 'vitest'
import { createRng } from '../src/common/rng.js'
import {
  dealerForRound,
  GHOST_SEAT,
  leadSchedule,
  nextDealer,
  pickInitialDealer,
  roundFirstLeader,
  SK_PRESETS,
  seatToLeft,
  trickOrder,
  trickOrderFor,
  twoPlayerTrickOrder,
} from '../src/skullking/index.js'

const OPTS = SK_PRESETS.edition2021

describe('첫 딜러 뽑기', () => {
  it('항상 좌석 범위 안에서 나온다', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const n of [2, 3, 4, 5, 6]) {
        const d = pickInitialDealer(n, createRng(seed))
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThan(n)
      }
    }
  })

  it('로비 입장 순서와 무관하게 모든 좌석이 첫 딜러가 될 수 있다', () => {
    const seen = new Set<number>()
    for (let seed = 0; seed < 500; seed++) seen.add(pickInitialDealer(4, createRng(seed)))
    expect(seen).toEqual(new Set([0, 1, 2, 3]))
  })

  it('치우치지 않는다 (4인 4000회, 각 좌석 25% ± 3%p)', () => {
    const counts = [0, 0, 0, 0]
    for (let seed = 0; seed < 4000; seed++) {
      counts[pickInitialDealer(4, createRng(seed))]! += 1
    }
    for (const c of counts) {
      expect(c / 4000).toBeGreaterThan(0.22)
      expect(c / 4000).toBeLessThan(0.28)
    }
  })

  it('같은 시드면 같은 결과 (리플레이 재현용)', () => {
    expect(pickInitialDealer(5, createRng(12345))).toBe(pickInitialDealer(5, createRng(12345)))
  })
})

describe('딜러 회전과 선턴', () => {
  it('왼쪽 = 좌석 번호 +1, 끝에서 처음으로 돈다', () => {
    expect(seatToLeft(0, 4)).toBe(1)
    expect(seatToLeft(3, 4)).toBe(0)
  })

  it('라운드가 끝나면 딜러는 왼쪽으로 한 칸', () => {
    expect(nextDealer(0, 4)).toBe(1)
    expect(nextDealer(3, 4)).toBe(0)
  })

  it('라운드 첫 트릭은 딜러 왼쪽 사람이 리드한다', () => {
    expect(roundFirstLeader(0, 4)).toBe(1)
    expect(roundFirstLeader(3, 4)).toBe(0)
  })

  it('첫 딜러만 알면 몇 라운드든 바로 계산된다', () => {
    expect(dealerForRound(2, 0, 4)).toBe(2)
    expect(dealerForRound(2, 1, 4)).toBe(3)
    expect(dealerForRound(2, 2, 4)).toBe(0)
    expect(dealerForRound(2, 5, 4)).toBe(3)
  })

  it('10라운드 동안 선턴이 골고루 돈다 (4인 → 각자 2~3번)', () => {
    const schedule = leadSchedule(0, 4, 10)
    const counts = new Map<number, number>()
    for (const { leader } of schedule) counts.set(leader, (counts.get(leader) ?? 0) + 1)
    expect(counts.size).toBe(4)
    for (const c of counts.values()) {
      expect(c).toBeGreaterThanOrEqual(2)
      expect(c).toBeLessThanOrEqual(3)
    }
  })

  it('6인 10라운드도 한 명도 빠지지 않는다', () => {
    const leaders = new Set(leadSchedule(3, 6, 10).map((r) => r.leader))
    expect(leaders.size).toBe(6)
  })

  it('선턴표는 딜러 왼쪽 규칙과 항상 일치한다', () => {
    for (const { dealer, leader } of leadSchedule(1, 5, 10)) {
      expect(leader).toBe(seatToLeft(dealer, 5))
    }
  })
})

describe('트릭 플레이 순서', () => {
  it('리드부터 왼쪽으로 한 바퀴', () => {
    expect(trickOrder(0, 4)).toEqual([0, 1, 2, 3])
    expect(trickOrder(2, 4)).toEqual([2, 3, 0, 1])
  })

  it('3인 이상이면 일반 순서를 쓴다', () => {
    expect(trickOrderFor(OPTS, 4, 2, 0)).toEqual([2, 3, 0, 1])
  })

  it('2인이면 유령을 두 번째에 끼워 넣는다', () => {
    expect(trickOrderFor(OPTS, 2, 0, 0)).toEqual([0, GHOST_SEAT, 1])
    expect(trickOrderFor(OPTS, 2, 1, 1)).toEqual([1, GHOST_SEAT, 0])
  })

  it('2인에서 선턴은 라운드마다 번갈아간다', () => {
    const leaders = leadSchedule(0, 2, 10).map((r) => r.leader)
    expect(leaders).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0])
  })

  it('유령이 리드하면 직전에 리드했던 사람이 먼저', () => {
    expect(twoPlayerTrickOrder(GHOST_SEAT, 0)).toEqual([GHOST_SEAT, 0, 1])
  })

  it('유령 옵션을 끄면 2인도 일반 순서', () => {
    const noGhost = { ...OPTS, useGhostForTwoPlayers: false }
    expect(trickOrderFor(noGhost, 2, 0, 0)).toEqual([0, 1])
  })
})
