/**
 * 시드 기반 난수 — 같은 시드면 항상 같은 셔플이 나온다.
 * 테스트 재현성과 "판 다시보기(리플레이)"를 위해 Math.random()을 직접 쓰지 않는다.
 */
export type Rng = () => number

/** mulberry32 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 문자열 시드 → 숫자 시드 (방 코드로 덱을 만들 때 사용) */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Fisher–Yates. 원본 배열을 변형하지 않는다. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

/** n명에게 각 count장씩. 남은 카드는 rest로 반환(스컬킹 후아니타 능력이 이걸 본다). */
export function deal<T>(deck: readonly T[], players: number, count: number): { hands: T[][]; rest: T[] } {
  const hands: T[][] = Array.from({ length: players }, () => [])
  let i = 0
  for (let c = 0; c < count; c++) {
    for (let p = 0; p < players; p++) {
      const card = deck[i++]
      if (card === undefined) throw new Error(`덱 부족: ${players}명 × ${count}장 = ${players * count}장 필요, 덱은 ${deck.length}장`)
      hands[p]!.push(card)
    }
  }
  return { hands, rest: deck.slice(i) }
}
