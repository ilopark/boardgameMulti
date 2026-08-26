import { describe, expect, it } from 'vitest'
import {
  buildDeck,
  canBeat,
  cardPoints,
  handPoints,
  parseCombo,
  partnerOf,
  teamOf,
  type TichuCard,
} from '../src/tichu/index.js'

const c = (suit: 'jade' | 'sword' | 'pagoda' | 'star', rank: number): TichuCard => ({
  id: `${suit}-${rank}`, kind: 'number', suit, rank,
})
const mahjong: TichuCard = { id: 'mahjong', kind: 'mahjong' }
const dog: TichuCard = { id: 'dog', kind: 'dog' }
const phoenix: TichuCard = { id: 'phoenix', kind: 'phoenix' }
const dragon: TichuCard = { id: 'dragon', kind: 'dragon' }

describe('덱과 점수', () => {
  it('56장', () => expect(buildDeck()).toHaveLength(56))
  it('한 라운드 총 점수는 100점', () => expect(handPoints(buildDeck())).toBe(100))
  it('5는 5점, 10과 K는 10점, 용 +25, 봉황 -25', () => {
    expect(cardPoints(c('jade', 5))).toBe(5)
    expect(cardPoints(c('jade', 10))).toBe(10)
    expect(cardPoints(c('jade', 13))).toBe(10)
    expect(cardPoints(c('jade', 14))).toBe(0)
    expect(cardPoints(dragon)).toBe(25)
    expect(cardPoints(phoenix)).toBe(-25)
  })
  it('팀은 마주보는 좌석', () => {
    expect(teamOf(0)).toBe(teamOf(2))
    expect(teamOf(1)).toBe(teamOf(3))
    expect(partnerOf(0)).toBe(2)
  })
})

describe('조합 파싱', () => {
  it('싱글 / 페어 / 트리플', () => {
    expect(parseCombo([c('jade', 9)])?.type).toBe('single')
    expect(parseCombo([c('jade', 9), c('star', 9)])?.type).toBe('pair')
    expect(parseCombo([c('jade', 9), c('star', 9), c('sword', 9)])?.type).toBe('triple')
  })
  it('연속 페어 (9,9,10,10)', () => {
    const combo = parseCombo([c('jade', 9), c('star', 9), c('jade', 10), c('star', 10)])
    expect(combo?.type).toBe('stairs')
    expect(combo?.rank).toBe(10)
  })
  it('연속이 아닌 페어 2쌍은 무효', () => {
    expect(parseCombo([c('jade', 9), c('star', 9), c('jade', 11), c('star', 11)])).toBeNull()
  })
  it('풀하우스는 트리플 값으로 비교한다', () => {
    const combo = parseCombo([c('jade', 7), c('star', 7), c('sword', 7), c('jade', 13), c('star', 13)])
    expect(combo?.type).toBe('fullhouse')
    expect(combo?.rank).toBe(7)
  })
  it('스트레이트는 5장 이상 연속', () => {
    const ok = parseCombo([c('jade', 3), c('star', 4), c('sword', 5), c('pagoda', 6), c('jade', 7)])
    expect(ok?.type).toBe('straight')
    expect(ok?.rank).toBe(7)
    expect(parseCombo([c('jade', 3), c('star', 4), c('sword', 5), c('pagoda', 6)])).toBeNull()
  })
  it('마작(1)은 스트레이트에 들어간다', () => {
    const combo = parseCombo([mahjong, c('star', 2), c('sword', 3), c('pagoda', 4), c('jade', 5)])
    expect(combo?.type).toBe('straight')
    expect(combo?.rank).toBe(5)
  })
  it('10-J-Q-K-A 스트레이트', () => {
    const combo = parseCombo([c('jade', 10), c('star', 11), c('sword', 12), c('pagoda', 13), c('jade', 14)])
    expect(combo?.rank).toBe(14)
  })
})

describe('폭탄', () => {
  it('포카드는 폭탄', () => {
    const combo = parseCombo([c('jade', 8), c('star', 8), c('sword', 8), c('pagoda', 8)])
    expect(combo?.type).toBe('bomb4')
    expect(combo?.isBomb).toBe(true)
  })
  it('같은 문양 연속 5장은 스트레이트 플러시 폭탄', () => {
    const cards = [c('jade', 3), c('jade', 4), c('jade', 5), c('jade', 6), c('jade', 7)]
    expect(parseCombo(cards)?.type).toBe('bombstraight')
    // 하우스룰: 일반 스트레이트로도 낼 수 있다
    expect(parseCombo(cards, { asBomb: false })?.type).toBe('straight')
  })
  it('스트레이트 플러시가 포카드를 이긴다', () => {
    const sf = parseCombo([c('jade', 3), c('jade', 4), c('jade', 5), c('jade', 6), c('jade', 7)])!
    const four = parseCombo([c('jade', 14), c('star', 14), c('sword', 14), c('pagoda', 14)])!
    expect(canBeat(sf, four)).toBe(true)
    expect(canBeat(four, sf)).toBe(false)
  })
  it('봉황으로는 폭탄을 만들 수 없다', () => {
    const combo = parseCombo([c('jade', 8), c('star', 8), c('sword', 8), phoenix])
    expect(combo?.isBomb).not.toBe(true)
  })
  it('폭탄은 아무 조합이나 이긴다', () => {
    const bomb = parseCombo([c('jade', 2), c('star', 2), c('sword', 2), c('pagoda', 2)])!
    const fh = parseCombo([c('jade', 14), c('star', 14), c('sword', 14), c('jade', 13), c('star', 13)])!
    expect(canBeat(bomb, fh)).toBe(true)
  })
})

describe('특수카드', () => {
  it('개는 단독으로만 낼 수 있고 리드일 때만', () => {
    expect(parseCombo([dog])?.type).toBe('dog')
    expect(parseCombo([dog, c('jade', 5)])).toBeNull()
    expect(canBeat(parseCombo([dog])!, null)).toBe(true)
    expect(canBeat(parseCombo([dog])!, parseCombo([c('jade', 5)])!)).toBe(false)
  })
  it('용은 조합에 못 들어가고 모든 싱글을 이긴다', () => {
    expect(parseCombo([dragon, c('jade', 14)])).toBeNull()
    const d = parseCombo([dragon])!
    expect(canBeat(d, parseCombo([c('jade', 14)])!)).toBe(true)
  })
  it('봉황 단독: 리드면 1.5, 8 위에 내면 8.5', () => {
    expect(parseCombo([phoenix])?.rank).toBe(1.5)
    const ph = parseCombo([phoenix], { phoenixAs: 8.5 })!
    expect(canBeat(ph, parseCombo([c('jade', 8)])!)).toBe(true)
    expect(canBeat(parseCombo([c('jade', 9)])!, ph)).toBe(true)
  })
  it('봉황은 A는 이기지만 용은 못 이긴다', () => {
    const ph = parseCombo([phoenix], { phoenixAs: 14.5 })!
    expect(canBeat(ph, parseCombo([c('jade', 14)])!)).toBe(true)
    expect(canBeat(ph, parseCombo([dragon])!)).toBe(false)
  })
  it('봉황은 스트레이트의 빈칸을 메운다 (2,3,봉황,5,6)', () => {
    const combo = parseCombo([c('jade', 2), c('star', 3), phoenix, c('sword', 5), c('pagoda', 6)])
    expect(combo?.type).toBe('straight')
    expect(combo?.phoenixAs).toBe(4)
  })
  it('봉황은 페어도 만든다', () => {
    const combo = parseCombo([c('jade', 9), phoenix])
    expect(combo?.type).toBe('pair')
    expect(combo?.rank).toBe(9)
  })
  it('봉황 값을 명시하면 그 값으로만 파싱한다', () => {
    const cards = [c('jade', 2), c('star', 3), c('sword', 4), c('pagoda', 5), phoenix]
    expect(parseCombo(cards)?.rank).toBe(6) // 자동이면 가장 강한 6
    expect(parseCombo(cards, { phoenixAs: 1 })?.rank).toBe(5)
  })
})

describe('되받아치기 규칙', () => {
  it('같은 종류·같은 장수·더 높은 값이어야 한다', () => {
    const p9 = parseCombo([c('jade', 9), c('star', 9)])!
    const p10 = parseCombo([c('jade', 10), c('star', 10)])!
    const t10 = parseCombo([c('jade', 10), c('star', 10), c('sword', 10)])!
    expect(canBeat(p10, p9)).toBe(true)
    expect(canBeat(p9, p10)).toBe(false)
    expect(canBeat(t10, p9)).toBe(false) // 종류가 다름
  })
  it('스트레이트는 장수가 같아야 한다', () => {
    const s5 = parseCombo([c('jade', 3), c('star', 4), c('sword', 5), c('pagoda', 6), c('jade', 7)])!
    const s6 = parseCombo([c('jade', 3), c('star', 4), c('sword', 5), c('pagoda', 6), c('jade', 7), c('star', 8)])!
    expect(canBeat(s6, s5)).toBe(false)
  })
})

describe('한글 조사 헬퍼', () => {
  it('받침 유무에 따라 조사를 고른다', async () => {
    const { josa } = await import('../src/protocol.js')
    expect(josa('스컬킹', '은는')).toBe('스컬킹은')
    expect(josa('티츄', '은는')).toBe('티츄는')
    expect(josa('방장', '이가')).toBe('방장이')
    expect(josa('유령', '을를')).toBe('유령을')
    expect(josa('카드', '으로로')).toBe('카드로')
    expect(josa('폭탄', '으로로')).toBe('폭탄으로')
    expect(josa('마을', '으로로')).toBe('마을로')
  })
})

describe('봉황 해석 선택', () => {
  it('봉황이 없으면 해석은 하나뿐', async () => {
    const { phoenixOptions, needsPhoenixChoice } = await import('../src/tichu/combo.js')
    const cards = [c('jade', 3), c('star', 4), c('sword', 5), c('pagoda', 6), c('jade', 7)]
    expect(phoenixOptions(cards)).toHaveLength(1)
    expect(needsPhoenixChoice(cards)).toBe(false)
  })

  it('단독 봉황은 값이 자동으로 정해지므로 묻지 않는다', async () => {
    const { needsPhoenixChoice } = await import('../src/tichu/combo.js')
    expect(needsPhoenixChoice([phoenix])).toBe(false)
  })

  it('2,3,4,5 + 봉황 → 1~5 / 2~6 두 가지 (물어봐야 함)', async () => {
    const { phoenixOptions, needsPhoenixChoice } = await import('../src/tichu/combo.js')
    const cards = [c('jade', 2), c('star', 3), c('sword', 4), c('pagoda', 5), phoenix]
    const opts = phoenixOptions(cards)
    expect(needsPhoenixChoice(cards)).toBe(true)
    expect(opts.map((o) => o.rank)).toEqual([5, 6])
    expect(opts.every((o) => o.type === 'straight')).toBe(true)
  })

  it('빈칸이 하나뿐이면 해석도 하나 (묻지 않음)', async () => {
    const { phoenixOptions, needsPhoenixChoice } = await import('../src/tichu/combo.js')
    // 2,3,_,5,6 → 봉황은 4밖에 될 수 없다
    const cards = [c('jade', 2), c('star', 3), phoenix, c('sword', 5), c('pagoda', 6)]
    expect(phoenixOptions(cards)).toHaveLength(1)
    expect(needsPhoenixChoice(cards)).toBe(false)
  })

  it('페어는 값이 하나로 정해진다', async () => {
    const { needsPhoenixChoice } = await import('../src/tichu/combo.js')
    expect(needsPhoenixChoice([c('jade', 9), phoenix])).toBe(false)
  })
})
