import { describe, expect, it } from 'vitest'
import { createRng, deal, hashSeed, shuffle } from '../src/common/rng.js'

describe('시드 난수', () => {
  it('같은 시드면 같은 수열', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const left = Array.from({ length: 20 }, () => a())
    const right = Array.from({ length: 20 }, () => b())
    expect(left).toEqual(right)
  })

  it('다른 시드면 다른 수열', () => {
    const a = Array.from({ length: 20 }, createRng(1))
    const b = Array.from({ length: 20 }, createRng(2))
    expect(a).not.toEqual(b)
  })

  it('0 이상 1 미만', () => {
    const rng = createRng(999)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  // ── 여기부터가 Redis 에 방을 저장했다 되살리기 위해 필요한 성질 ──

  it('state 를 다시 시드로 넣으면 수열이 그대로 이어진다', () => {
    const original = createRng(777)
    for (let i = 0; i < 13; i++) original() // 게임이 얼마쯤 진행된 상태

    const saved = original.state // ← 저장소에 넣는 값

    const expected = Array.from({ length: 30 }, () => original())
    const resumed = createRng(saved) // ← 서버 재시작 후 되살림
    const actual = Array.from({ length: 30 }, () => resumed())

    expect(actual).toEqual(expected)
  })

  it('한 번도 안 쓴 난수도 이어받을 수 있다', () => {
    const fresh = createRng(31337)
    const resumed = createRng(fresh.state)
    expect(Array.from({ length: 10 }, () => resumed())).toEqual(
      Array.from({ length: 10 }, () => fresh()),
    )
  })

  it('state 는 JSON 으로 오갈 수 있는 정수', () => {
    const rng = createRng(5)
    rng()
    const roundTripped = JSON.parse(JSON.stringify({ state: rng.state })) as { state: number }
    expect(Number.isInteger(roundTripped.state)).toBe(true)
    expect(roundTripped.state).toBe(rng.state)
  })

  it('중간에 저장했다 되살려도 셔플 결과가 같다', () => {
    const deck = Array.from({ length: 52 }, (_, i) => i)

    const straight = createRng(2024)
    shuffle(deck, straight)
    const expected = shuffle(deck, straight) // 두 번째 셔플

    const interrupted = createRng(2024)
    shuffle(deck, interrupted)
    const revived = createRng(interrupted.state) // 첫 셔플 뒤 재시작
    expect(shuffle(deck, revived)).toEqual(expected)
  })
})

describe('hashSeed', () => {
  it('같은 문자열이면 같은 시드', () => {
    expect(hashSeed('ABC123')).toBe(hashSeed('ABC123'))
  })

  it('다른 문자열이면 다른 시드', () => {
    expect(hashSeed('ABC123')).not.toBe(hashSeed('ABC124'))
  })

  it('부호 없는 32비트 정수', () => {
    for (const s of ['', 'A', '방코드', 'X'.repeat(200)]) {
      const h = hashSeed(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('shuffle', () => {
  it('원본을 건드리지 않는다', () => {
    const original = [1, 2, 3, 4, 5]
    const copy = original.slice()
    shuffle(original, createRng(1))
    expect(original).toEqual(copy)
  })

  it('원소가 하나도 사라지지 않는다', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    const out = shuffle(items, createRng(7))
    expect(out.slice().sort((a, b) => a - b)).toEqual(items)
  })
})

describe('deal', () => {
  it('한 장씩 돌아가며 나눠준다', () => {
    const { hands, rest } = deal([1, 2, 3, 4, 5, 6, 7], 3, 2)
    expect(hands).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
    expect(rest).toEqual([7])
  })

  it('덱이 모자라면 던진다', () => {
    expect(() => deal([1, 2, 3], 2, 2)).toThrow(/덱 부족/)
  })
})
