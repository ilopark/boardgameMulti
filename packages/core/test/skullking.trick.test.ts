import { describe, expect, it } from 'vitest'
import {
  buildDeck,
  computeLeadColor,
  GHOST_SEAT,
  hasGhost,
  legalPlays,
  makeSkOptions,
  optionsForPlayerCount,
  resolveTrick,
  scoreRound,
  SK_PRESETS,
  twoPlayerTrickOrder,
  type SkCard,
  type SkPlay,
} from '../src/skullking/index.js'

const OPTS = SK_PRESETS.edition2021

// ── 카드 헬퍼 ──
const num = (color: 'green' | 'yellow' | 'purple' | 'black', rank: number): SkCard => ({
  id: `${color}-${rank}`, kind: 'number', color, rank,
})
const escape = (i = 0): SkCard => ({ id: `escape-${i}`, kind: 'escape' })
const pirate = (p: 'rosie' | 'bahij' | 'rascal' | 'juanita' | 'harry' = 'rosie'): SkCard => ({ id: `pirate-${p}`, kind: 'pirate', pirate: p })
const mermaid = (i = 0): SkCard => ({ id: `mermaid-${i}`, kind: 'mermaid' })
const sk = (): SkCard => ({ id: 'skullking', kind: 'skullking' })
const tigress = (): SkCard => ({ id: 'tigress', kind: 'tigress' })
const loot = (i = 0): SkCard => ({ id: `loot-${i}`, kind: 'loot' })
const kraken = (): SkCard => ({ id: 'kraken', kind: 'kraken' })
const whale = (): SkCard => ({ id: 'whitewhale', kind: 'whitewhale' })

const play = (seat: number, card: SkCard, tigressAs?: 'pirate' | 'escape'): SkPlay =>
  tigressAs ? { seat, card, tigressAs } : { seat, card }

describe('덱 구성', () => {
  it('2021판은 74장', () => {
    expect(buildDeck(SK_PRESETS.edition2021)).toHaveLength(74)
  })
  it('클래식은 66장 (1-13, 루트·크라켄·흰고래 없음)', () => {
    expect(buildDeck(SK_PRESETS.classic)).toHaveLength(66)
  })
})

describe('팔로우 규칙', () => {
  it('숫자카드 리드가 색을 정한다', () => {
    expect(computeLeadColor([play(0, num('green', 7))])).toBe('green')
  })
  it('도주로 리드하면 색 결정권이 다음 사람에게 넘어간다', () => {
    expect(computeLeadColor([play(0, escape()), play(1, num('purple', 3))])).toBe('purple')
  })
  it('해적으로 리드하면 팔로우할 색이 없다', () => {
    expect(computeLeadColor([play(0, pirate()), play(1, num('purple', 3))])).toBeNull()
  })
  it('크라켄으로 리드하면 다음 카드가 색을 정한다', () => {
    expect(computeLeadColor([play(0, kraken()), play(1, num('yellow', 9))])).toBe('yellow')
  })
  it('리드색을 들고 있으면 다른 색 숫자카드는 못 낸다 (특수카드는 언제나 가능)', () => {
    const hand = [num('green', 5), num('purple', 14), escape(), sk()]
    const legal = legalPlays(hand, [play(0, num('green', 7))]).map((c) => c.id)
    expect(legal).toEqual(['green-5', 'escape-0', 'skullking'])
  })
  it('리드색이 없으면 아무거나 낼 수 있다', () => {
    const hand = [num('purple', 14), num('black', 2)]
    expect(legalPlays(hand, [play(0, num('green', 7))])).toHaveLength(2)
  })
})

describe('트릭 판정 서열', () => {
  it('같은 색이면 숫자 높은 쪽', () => {
    const r = resolveTrick([play(0, num('green', 7)), play(1, num('green', 12)), play(2, num('green', 8))], OPTS)
    expect(r.winner).toBe(1)
  })
  it('리드색이 아닌 숫자카드는 아무리 커도 진다', () => {
    const r = resolveTrick([play(0, num('yellow', 12)), play(1, num('purple', 14))], OPTS)
    expect(r.winner).toBe(0)
  })
  it('검정(졸리로저)은 숫자가 낮아도 다른 색을 이긴다', () => {
    const r = resolveTrick([play(0, num('yellow', 12)), play(1, num('black', 2))], OPTS)
    expect(r.winner).toBe(1)
  })
  it('해적은 검정 14도 이긴다', () => {
    const r = resolveTrick([play(0, num('black', 14)), play(1, pirate())], OPTS)
    expect(r.winner).toBe(1)
  })
  it('해적이 여럿이면 먼저 낸 쪽', () => {
    const r = resolveTrick([play(0, pirate('rosie')), play(1, pirate('harry'))], OPTS)
    expect(r.winner).toBe(0)
  })
  it('스컬킹은 해적을 이긴다', () => {
    const r = resolveTrick([play(0, pirate()), play(1, sk())], OPTS)
    expect(r.winner).toBe(1)
  })
  it('인어는 숫자카드는 이기지만 해적에겐 진다', () => {
    expect(resolveTrick([play(0, num('black', 14)), play(1, mermaid())], OPTS).winner).toBe(1)
    expect(resolveTrick([play(0, mermaid()), play(1, pirate())], OPTS).winner).toBe(1)
  })
  it('스컬킹 + 인어가 같이 나오면 해적이 있어도 인어 승', () => {
    const r = resolveTrick([play(0, pirate()), play(1, sk()), play(2, mermaid())], OPTS)
    expect(r.winner).toBe(2)
  })
  it('전원 도주면 먼저 낸 사람 승', () => {
    const r = resolveTrick([play(0, escape(0)), play(1, escape(1)), play(2, escape(2))], OPTS)
    expect(r.winner).toBe(0)
  })
  it('티그리스는 선언한 대로 취급된다', () => {
    expect(resolveTrick([play(0, num('black', 14)), play(1, tigress(), 'pirate')], OPTS).winner).toBe(1)
    expect(resolveTrick([play(0, num('black', 2)), play(1, tigress(), 'escape')], OPTS).winner).toBe(0)
  })
})

describe('크라켄 / 흰고래', () => {
  it('크라켄은 트릭을 소멸시키고, 크라켄이 없었다면 이겼을 사람이 다음 리드', () => {
    const r = resolveTrick([play(0, num('green', 7)), play(1, num('green', 12)), play(2, kraken())], OPTS)
    expect(r.destroyed).toBe(true)
    expect(r.winner).toBeNull()
    expect(r.nextLeader).toBe(1)
    expect(r.bonuses).toHaveLength(0)
  })
  it('크라켄으로 리드하고 나머지 전원 도주면 크라켄 낸 사람이 다음 리드', () => {
    const r = resolveTrick([play(0, kraken()), play(1, escape(1)), play(2, escape(2))], OPTS)
    expect(r.destroyed).toBe(true)
    expect(r.nextLeader).toBe(1) // 남은 카드 중 첫 도주가 1번
  })
  it('흰고래는 특수카드를 전부 도주로 만들고 색 무시 최고 숫자가 이긴다', () => {
    const r = resolveTrick([play(0, num('green', 7)), play(1, sk()), play(2, num('purple', 11)), play(3, whale())], OPTS)
    expect(r.winner).toBe(2)
  })
  it('크라켄 vs 흰고래는 나중에 낸 쪽이 발동', () => {
    const later = resolveTrick([play(0, whale()), play(1, num('green', 9)), play(2, kraken())], OPTS)
    expect(later.destroyed).toBe(true)

    const earlier = resolveTrick([play(0, kraken()), play(1, num('green', 9)), play(2, whale())], OPTS)
    expect(earlier.destroyed).toBe(false)
    expect(earlier.winner).toBe(1)
  })
})

describe('보너스 (2021판)', () => {
  it('룰북 예시: 노랑14 → 검정14 → 해적 → 스컬킹 = 10 + 20 + 30', () => {
    const r = resolveTrick(
      [play(0, num('yellow', 14)), play(1, num('black', 14)), play(2, pirate()), play(3, sk())],
      OPTS,
    )
    expect(r.winner).toBe(3)
    expect(r.bonuses.reduce((s, b) => s + b.points, 0)).toBe(60)
  })
  it('2021판은 인어가 스컬킹 잡으면 40점', () => {
    const r = resolveTrick([play(0, sk()), play(1, mermaid())], SK_PRESETS.edition2021)
    expect(r.bonuses.find((b) => b.kind === 'mermaidCapturesSk')?.points).toBe(40)
  })
  it('2018판은 같은 상황에서 50점', () => {
    const r = resolveTrick([play(0, sk()), play(1, mermaid())], SK_PRESETS.legendary2018)
    expect(r.bonuses.find((b) => b.kind === 'mermaidCapturesSk')?.points).toBe(50)
  })
  it('2021판은 해적이 인어 잡으면 20점, 2018판은 없음', () => {
    expect(resolveTrick([play(0, mermaid()), play(1, pirate())], SK_PRESETS.edition2021)
      .bonuses.some((b) => b.kind === 'pirateCapturesMermaid')).toBe(true)
    expect(resolveTrick([play(0, mermaid()), play(1, pirate())], SK_PRESETS.legendary2018)
      .bonuses.some((b) => b.kind === 'pirateCapturesMermaid')).toBe(false)
  })
  it('2018판은 스컬킹보다 먼저 낸 해적만 +30, 2021판은 순서 무관', () => {
    const plays = [play(0, sk()), play(1, pirate('rosie')), play(2, pirate('harry'))]
    const p2018 = resolveTrick(plays, SK_PRESETS.legendary2018).bonuses.filter((b) => b.kind === 'skCapturesPirate')
    const p2021 = resolveTrick(plays, SK_PRESETS.edition2021).bonuses.filter((b) => b.kind === 'skCapturesPirate')
    expect(p2018).toHaveLength(0)
    expect(p2021).toHaveLength(2)
  })
  it('루트는 낸 사람과 가져간 사람의 동맹을 만든다', () => {
    const r = resolveTrick([play(0, num('green', 7)), play(1, loot()), play(2, num('green', 12))], OPTS)
    expect(r.winner).toBe(2)
    expect(r.alliances).toEqual([[1, 2]])
  })
})

describe('점수 계산', () => {
  const empty = { winner: null, nextLeader: 0, destroyed: true, leadColor: null, bonuses: [], alliances: [], reason: '' } as const
  const won = (seat: number) => ({ winner: seat, nextLeader: seat, destroyed: false, leadColor: null, bonuses: [], alliances: [], reason: '' })

  it('입찰 3 → 3트릭 = +60', () => {
    const s = scoreRound({ cardCount: 3, bids: [3, 0], tricks: [won(0), won(0), won(0)] }, OPTS)
    expect(s[0]!.total).toBe(60)
  })
  it('입찰 3 → 2트릭 = -10', () => {
    const s = scoreRound({ cardCount: 3, bids: [3, 0], tricks: [won(0), won(0), won(1)] }, OPTS)
    expect(s[0]!.total).toBe(-10)
  })
  it('입찰 2 → 5트릭 = -30', () => {
    const s = scoreRound({ cardCount: 5, bids: [2, 0], tricks: [won(0), won(0), won(0), won(0), won(0)] }, OPTS)
    expect(s[0]!.total).toBe(-30)
  })
  it('7라운드 0입찰 성공 = +70', () => {
    const s = scoreRound({ cardCount: 7, bids: [0, 7], tricks: Array.from({ length: 7 }, () => won(1)) }, OPTS)
    expect(s[0]!.total).toBe(70)
  })
  it('9라운드 0입찰인데 2트릭 먹음 = -90', () => {
    const tricks = [won(0), won(0), ...Array.from({ length: 7 }, () => won(1))]
    const s = scoreRound({ cardCount: 9, bids: [0, 7], tricks }, OPTS)
    expect(s[0]!.total).toBe(-90)
  })
  it('입찰 실패하면 보너스를 못 받는다', () => {
    const bonusTrick = { ...won(0), bonuses: [{ seat: 0, kind: 'black14' as const, points: 20, detail: '' }] }
    const s = scoreRound({ cardCount: 2, bids: [2, 0], tricks: [bonusTrick, won(1)] }, OPTS)
    expect(s[0]!.bidMet).toBe(false)
    expect(s[0]!.bonusPoints).toBe(0)
  })
  it('크라켄으로 소멸한 트릭은 아무도 먹지 않은 것으로 센다', () => {
    const s = scoreRound({ cardCount: 2, bids: [0, 0], tricks: [empty, empty] }, OPTS)
    expect(s[0]!.total).toBe(20)
    expect(s[1]!.total).toBe(20)
  })
  it('루트 동맹은 양쪽 다 입찰 성공해야 지급', () => {
    const t = { ...won(1), alliances: [[0, 1]] as Array<[number, number]> }
    const ok = scoreRound({ cardCount: 1, bids: [0, 1], tricks: [t] }, OPTS)
    expect(ok[0]!.bonusPoints).toBe(20)
    expect(ok[1]!.bonusPoints).toBe(20)

    const fail = scoreRound({ cardCount: 1, bids: [1, 1], tricks: [t] }, OPTS)
    expect(fail[0]!.bonusPoints).toBe(0)
    expect(fail[1]!.bonusPoints).toBe(0)
  })
})

describe('옵션 토글', () => {
  it('흰고래를 끄면 흰고래 효과가 발동하지 않는다', () => {
    const off = makeSkOptions({ useWhiteWhale: false })
    const r = resolveTrick([play(0, num('green', 7)), play(1, sk()), play(2, whale())], off)
    expect(r.winner).toBe(1)
  })
})

describe('보너스 누적', () => {
  it('스컬킹이 해적 2장을 잡으면 30 × 2 = 60', () => {
    const r = resolveTrick(
      [play(0, pirate('rosie')), play(1, pirate('harry')), play(2, sk())],
      OPTS,
    )
    expect(r.winner).toBe(2)
    const skBonus = r.bonuses.filter((b) => b.kind === 'skCapturesPirate')
    expect(skBonus).toHaveLength(2)
    expect(skBonus.reduce((n, b) => n + b.points, 0)).toBe(60)
  })

  it('티그리스를 해적으로 냈으면 그것도 잡힌 해적으로 센다 (30 × 3 = 90)', () => {
    const r = resolveTrick(
      [play(0, pirate('rosie')), play(1, pirate('harry')), play(2, tigress(), 'pirate'), play(3, sk())],
      OPTS,
    )
    expect(r.bonuses.filter((b) => b.kind === 'skCapturesPirate')).toHaveLength(3)
  })

  it('해적이 인어 2장을 잡으면 20 × 2 = 40', () => {
    const r = resolveTrick(
      [play(0, mermaid(0)), play(1, mermaid(1)), play(2, pirate())],
      OPTS,
    )
    expect(r.winner).toBe(2)
    const mBonus = r.bonuses.filter((b) => b.kind === 'pirateCapturesMermaid')
    expect(mBonus).toHaveLength(2)
    expect(mBonus.reduce((n, b) => n + b.points, 0)).toBe(40)
  })

  it('14도 장수만큼 누적된다 (색14 두 장 + 검정14 = 10 + 10 + 20)', () => {
    const r = resolveTrick(
      [play(0, num('green', 14)), play(1, num('yellow', 14)), play(2, num('black', 14)), play(3, sk())],
      OPTS,
    )
    expect(r.winner).toBe(3)
    expect(r.bonuses.reduce((n, b) => n + b.points, 0)).toBe(40)
  })

  it('한 트릭에서 여러 종류의 보너스가 동시에 누적된다', () => {
    // 색14 + 검정14 + 해적2 를 스컬킹이 전부 쓸어담음 = 10 + 20 + 30 + 30
    const r = resolveTrick(
      [play(0, num('purple', 14)), play(1, num('black', 14)), play(2, pirate('rosie')), play(3, pirate('bahij')), play(4, sk())],
      OPTS,
    )
    expect(r.bonuses.reduce((n, b) => n + b.points, 0)).toBe(90)
  })

  it('점수 계산까지 통과: 입찰 맞으면 누적 보너스가 전부 붙는다', () => {
    const trick = resolveTrick([play(0, mermaid(0)), play(1, mermaid(1)), play(0, pirate())], OPTS)
    const s = scoreRound({ cardCount: 1, bids: [1, 0], tricks: [trick] }, OPTS)
    expect(s[0]!.bidPoints).toBe(20)
    expect(s[0]!.bonusPoints).toBe(40)
    expect(s[0]!.total).toBe(60)
  })
})

describe('2인 플레이 (Graybeard\'s Ghost)', () => {
  it('2인이면 유령이 참여한다', () => {
    expect(hasGhost(OPTS, 2)).toBe(true)
    expect(hasGhost(OPTS, 3)).toBe(false)
    expect(hasGhost(makeSkOptions({ useGhostForTwoPlayers: false }), 2)).toBe(false)
  })

  it('2인에서는 루트를 빼서 덱이 2장 줄어든다', () => {
    const two = optionsForPlayerCount(OPTS, 2)
    expect(two.useLoot).toBe(false)
    expect(buildDeck(two)).toHaveLength(buildDeck(OPTS).length - 2)
  })

  it('유령은 항상 두 번째로 낸다', () => {
    expect(twoPlayerTrickOrder(0, 0)).toEqual([0, GHOST_SEAT, 1])
    expect(twoPlayerTrickOrder(1, 1)).toEqual([1, GHOST_SEAT, 0])
  })

  it('유령이 직전 트릭을 이겼으면 유령이 리드한다', () => {
    expect(twoPlayerTrickOrder(GHOST_SEAT, 0)).toEqual([GHOST_SEAT, 0, 1])
    expect(twoPlayerTrickOrder(GHOST_SEAT, 1)).toEqual([GHOST_SEAT, 1, 0])
  })

  it('유령이 낸 티그리스는 항상 도주다 (해적 선언 불가)', () => {
    // 유령의 play에는 tigressAs를 붙이지 않는다 → 도주로 취급
    const r = resolveTrick([play(0, num('black', 2)), play(GHOST_SEAT, tigress())], OPTS)
    expect(r.winner).toBe(0)
  })

  it('유령이 트릭을 먹으면 아무도 못 먹은 것으로 센다', () => {
    const ghostWins = resolveTrick(
      [play(0, num('green', 3)), play(GHOST_SEAT, pirate()), play(1, num('green', 9))],
      OPTS,
    )
    expect(ghostWins.winner).toBe(GHOST_SEAT)

    // 사람 둘 다 0을 불렀고 유령이 다 먹었으면 둘 다 0입찰 성공
    const s = scoreRound({ cardCount: 2, bids: [0, 0], tricks: [ghostWins, ghostWins] }, OPTS)
    expect(s[0]!.taken).toBe(0)
    expect(s[1]!.taken).toBe(0)
    expect(s[0]!.total).toBe(20)
    expect(s[1]!.total).toBe(20)
  })

  it('유령이 딴 보너스는 버려진다', () => {
    const trick = resolveTrick(
      [play(0, num('black', 14)), play(1, pirate()), play(GHOST_SEAT, sk())],
      OPTS,
    )
    expect(trick.winner).toBe(GHOST_SEAT)
    expect(trick.bonuses.length).toBeGreaterThan(0) // 트릭 자체에는 보너스가 붙지만
    const s = scoreRound({ cardCount: 1, bids: [0, 0], tricks: [trick] }, OPTS)
    expect(s[0]!.bonusPoints).toBe(0) // 사람에게는 한 점도 안 간다
    expect(s[1]!.bonusPoints).toBe(0)
  })
})

describe('해적 · 스컬킹 · 인어 삼각관계', () => {
  it('셋이 다 나오면 순서와 무관하게 인어가 이긴다', () => {
    // 룰북: "A Mermaid played in the same trick as the Skull King always wins
    //        the trick, even if another Pirate is played."
    const orders: Array<[SkCard, SkCard, SkCard]> = [
      [pirate(), sk(), mermaid()],
      [sk(), pirate(), mermaid()],
      [mermaid(), pirate(), sk()],
      [mermaid(), sk(), pirate()],
      [pirate(), mermaid(), sk()],
      [sk(), mermaid(), pirate()],
    ]
    for (const [c0, c1, c2] of orders) {
      const plays = [play(0, c0), play(1, c1), play(2, c2)]
      const r = resolveTrick(plays, OPTS)
      const mermaidSeat = plays.find((p) => p.card.kind === 'mermaid')!.seat
      expect(r.winner).toBe(mermaidSeat)
    }
  })

  it('인어가 이기면 보너스는 인어→스컬킹 40점 하나뿐 — 해적은 아무 점수도 안 준다', () => {
    const r = resolveTrick([play(0, pirate('rosie')), play(1, sk()), play(2, mermaid())], OPTS)
    expect(r.winner).toBe(2)
    expect(r.bonuses).toHaveLength(1)
    expect(r.bonuses[0]!.kind).toBe('mermaidCapturesSk')
    expect(r.bonuses[0]!.points).toBe(40)
    // 스컬킹이 진 트릭이므로 해적 포획 보너스는 없다
    expect(r.bonuses.some((b) => b.kind === 'skCapturesPirate')).toBe(false)
    // 해적도 진 트릭이므로 인어 포획 보너스도 없다
    expect(r.bonuses.some((b) => b.kind === 'pirateCapturesMermaid')).toBe(false)
  })

  it('해적이 여럿이어도 인어가 이기면 30점은 한 푼도 안 나온다', () => {
    const r = resolveTrick(
      [play(0, pirate('rosie')), play(1, pirate('harry')), play(2, sk()), play(3, mermaid())],
      OPTS,
    )
    expect(r.winner).toBe(3)
    expect(r.bonuses.reduce((n, b) => n + b.points, 0)).toBe(40)
  })

  it('인어가 둘이어도 스컬킹은 1장이라 40점은 한 번만', () => {
    const r = resolveTrick([play(0, sk()), play(1, mermaid(0)), play(2, mermaid(1))], OPTS)
    expect(r.winner).toBe(1) // 먼저 낸 인어
    expect(r.bonuses.filter((b) => b.kind === 'mermaidCapturesSk')).toHaveLength(1)
  })

  it('14 획득 보너스는 인어가 이겨도 그대로 붙는다', () => {
    const r = resolveTrick(
      [play(0, num('black', 14)), play(1, pirate()), play(2, sk()), play(3, mermaid())],
      OPTS,
    )
    expect(r.winner).toBe(3)
    expect(r.bonuses.reduce((n, b) => n + b.points, 0)).toBe(60) // 검정14 20 + 인어 40
  })

  it('삼각관계는 세 방향 모두 성립한다', () => {
    // 스컬킹 > 해적
    expect(resolveTrick([play(0, pirate()), play(1, sk())], OPTS).winner).toBe(1)
    // 해적 > 인어
    expect(resolveTrick([play(0, mermaid()), play(1, pirate())], OPTS).winner).toBe(1)
    // 인어 > 스컬킹
    expect(resolveTrick([play(0, sk()), play(1, mermaid())], OPTS).winner).toBe(1)
  })

  it('라운드 점수: 인어가 입찰을 맞추면 20 + 40 = 60, 틀리면 전부 날아간다', () => {
    const trick = resolveTrick([play(0, pirate()), play(1, sk()), play(2, mermaid())], OPTS)

    const met = scoreRound({ cardCount: 1, bids: [0, 0, 1], tricks: [trick] }, OPTS)
    expect(met[2]!.bidPoints).toBe(20)
    expect(met[2]!.bonusPoints).toBe(40)
    expect(met[2]!.total).toBe(60)

    const missed = scoreRound({ cardCount: 1, bids: [0, 0, 0], tricks: [trick] }, OPTS)
    expect(missed[2]!.bidMet).toBe(false)
    expect(missed[2]!.bonusPoints).toBe(0)
    expect(missed[2]!.total).toBe(-10)
  })
})
