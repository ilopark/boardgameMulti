import { describe, expect, it } from 'vitest'
import { createRng } from '../src/common/rng.js'
import {
  createGame,
  makeTichuOptions,
  reduce,
  TichuRuleError,
  waitingSeats,
  type TichuCard,
  type TichuGameState,
} from '../src/tichu/index.js'

const OPTS = makeTichuOptions()
const rng = () => createRng(7)

function newGame(seed = 7) {
  return createGame(OPTS, createRng(seed))
}

/** 그랜드티츄 전원 패스 → 카드 교환까지 마치고 playing 단계로 */
function toPlaying(seed = 7): TichuGameState {
  const r = createRng(seed)
  let g = newGame(seed)
  for (let s = 0; s < 4; s++) g = reduce(g, { type: 'grandTichu', seat: s, call: false }, r)
  expect(g.phase).toBe('passing')
  for (let s = 0; s < 4; s++) {
    const ids = g.hands[s]!.slice(0, 3).map((c) => c.id) as [string, string, string]
    g = reduce(g, { type: 'pass3', seat: s, cardIds: ids }, r)
  }
  expect(g.phase).toBe('playing')
  return g
}

/** 특정 좌석 손패를 강제로 세팅 (시나리오 테스트용) */
function setHand(g: TichuGameState, seat: number, cards: TichuCard[]): void {
  g.hands[seat] = cards
}

const c = (suit: 'jade' | 'sword' | 'pagoda' | 'star', rank: number): TichuCard => ({
  id: `${suit}-${rank}`, kind: 'number', suit, rank,
})
const mahjong: TichuCard = { id: 'mahjong', kind: 'mahjong' }
const dog: TichuCard = { id: 'dog', kind: 'dog' }
const phoenix: TichuCard = { id: 'phoenix', kind: 'phoenix' }
const dragon: TichuCard = { id: 'dragon', kind: 'dragon' }

describe('라운드 시작과 카드 교환', () => {
  it('처음엔 8장만 보여준다 (그랜드 티츄 판단용)', () => {
    const g = newGame()
    expect(g.phase).toBe('grandTichu')
    for (const h of g.hands) expect(h).toHaveLength(8)
  })

  it('전원 결정하면 나머지 6장을 준다', () => {
    const r = rng()
    let g = newGame()
    for (let s = 0; s < 3; s++) {
      g = reduce(g, { type: 'grandTichu', seat: s, call: false }, r)
      expect(g.phase).toBe('grandTichu')
    }
    g = reduce(g, { type: 'grandTichu', seat: 3, call: true }, r)
    expect(g.phase).toBe('passing')
    for (const h of g.hands) expect(h).toHaveLength(14)
    expect(g.declarations[3]).toBe('grand')
  })

  it('교환은 왼쪽·파트너·오른쪽에게 1장씩', () => {
    const g = toPlaying()
    for (const h of g.hands) expect(h).toHaveLength(14)
    // 전원 14장 유지 = 3장 주고 3장 받음
  })

  it('마작을 가진 사람이 선', () => {
    const g = toPlaying()
    const holder = g.hands.findIndex((h) => h.some((x) => x.kind === 'mahjong'))
    expect(g.turn).toBe(holder)
    expect(g.leader).toBe(holder)
  })

  it('같은 카드를 두 번 고르면 거부', () => {
    const r = rng()
    let g = newGame()
    for (let s = 0; s < 4; s++) g = reduce(g, { type: 'grandTichu', seat: s, call: false }, r)
    const id = g.hands[0]![0]!.id
    expect(() => reduce(g, { type: 'pass3', seat: 0, cardIds: [id, id, id] }, r)).toThrow(TichuRuleError)
  })
})

describe('패스와 트릭 종료 — 룰북 핵심', () => {
  it('패스해도 누가 카드를 내면 다시 낼 수 있다', () => {
    const r = rng()
    let g = toPlaying()
    // 0번 리드, 1번 패스, 2번이 더 높은 카드 → 1번이 다시 낼 수 있어야 한다
    setHand(g, 0, [c('jade', 5), c('jade', 6)])
    setHand(g, 1, [c('sword', 9), c('sword', 10)])
    setHand(g, 2, [c('pagoda', 11), c('pagoda', 12)])
    setHand(g, 3, [c('star', 13), c('star', 14)])
    g.turn = 0
    g.leader = 0

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    expect(g.turn).toBe(1)
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    expect(g.passed[1]).toBe(true)
    expect(g.turn).toBe(2)

    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    // 누가 냈으니 패스 상태가 풀려야 한다
    expect(g.passed[1]).toBe(false)
    expect(g.turn).toBe(3)

    g = reduce(g, { type: 'pass', seat: 3 }, r)
    expect(g.turn).toBe(0)
    g = reduce(g, { type: 'pass', seat: 0 }, r)
    // 1번 차례가 다시 돌아왔다 — 패스했었지만 재진입 가능
    expect(g.turn).toBe(1)
    expect(g.hands[1]).toHaveLength(2)
  })

  it('3명이 연속으로 패스하면 마지막에 낸 사람이 트릭을 가져간다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5), c('jade', 6)])
    setHand(g, 1, [c('sword', 9), c('sword', 10)])
    setHand(g, 2, [c('pagoda', 11), c('pagoda', 12)])
    setHand(g, 3, [c('star', 13), c('star', 14)])
    g.turn = 0
    g.leader = 0

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    g = reduce(g, { type: 'pass', seat: 2 }, r)
    g = reduce(g, { type: 'pass', seat: 3 }, r)
    // 0번이 트릭 획득 + 다음 리드
    expect(g.won[0]!.map((x) => x.id)).toContain('jade-5')
    expect(g.leader).toBe(0)
    expect(g.turn).toBe(0)
    expect(g.current).toBeNull()
  })

  it('리드할 때는 패스할 수 없다', () => {
    const r = rng()
    const g = toPlaying()
    expect(() => reduce(g, { type: 'pass', seat: g.turn }, r)).toThrow(/리드할 때는/)
  })
})

describe('특수 카드', () => {
  it('개는 파트너에게 리드를 넘긴다 (트릭이 생기지 않는다)', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    expect(g.turn).toBe(2) // 파트너
    expect(g.leader).toBe(2)
    expect(g.current).toBeNull()
    expect(g.trick).toHaveLength(0)
  })

  it('파트너가 나갔으면 개의 리드는 파트너 오른쪽으로 간다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, []) // 파트너 골인
    setHand(g, 3, [c('star', 13)])
    g.finishOrder = [2]
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    expect(g.leader).toBe(3) // 파트너(2)의 오른쪽
  })

  it('파트너와 그 오른쪽이 모두 나갔으면 리드가 자기에게 돌아온다 (1대1)', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, []) // 파트너 골인
    setHand(g, 3, []) // 그 오른쪽도 골인
    g.finishOrder = [2, 3]
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    // 2(파트너) 나감 → 3 나감 → 0(자기) → 리드 유지, 개는 버린 셈
    expect(g.leader).toBe(0)
    expect(g.hands[0]!.map((x) => x.id)).toEqual(['jade-5'])
  })

  it('1대2 — 파트너만 나갔으면 상대에게 리드가 간다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, []) // 파트너 골인
    setHand(g, 3, [c('star', 13)])
    g.finishOrder = [2]
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    expect([1, 3]).toContain(g.leader) // 상대팀 중 하나
    expect(g.leader).toBe(3)
  })

  it('용으로 이기면 상대팀에게 트릭을 넘겨야 한다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dragon, c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dragon'] }, r)
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    g = reduce(g, { type: 'pass', seat: 2 }, r)
    g = reduce(g, { type: 'pass', seat: 3 }, r)
    expect(g.phase).toBe('dragonGift')
    expect(g.pendingDragon?.winner).toBe(0)

    // 같은 팀에게는 못 준다
    expect(() => reduce(g, { type: 'giveDragon', seat: 0, to: 2 }, r)).toThrow(/상대팀/)
    g = reduce(g, { type: 'giveDragon', seat: 0, to: 1 }, r)
    expect(g.phase).toBe('playing')
    expect(g.won[1]!.some((x) => x.kind === 'dragon')).toBe(true)
    expect(g.leader).toBe(0) // 트릭은 넘겼어도 리드는 유지
  })

  it('마작 소원을 낼 수 있으면 반드시 내야 한다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [mahjong, c('jade', 5)])
    setHand(g, 1, [c('sword', 8), c('sword', 9)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['mahjong'] }, r)
    g = reduce(g, { type: 'wish', seat: 0, rank: 8 }, r)
    expect(g.wish).toBe(8)
    // 1번은 8을 가지고 있고 낼 수 있으므로 9를 내면 안 된다
    expect(() => reduce(g, { type: 'play', seat: 1, cardIds: ['sword-9'] }, r)).toThrow(/소원/)
    expect(() => reduce(g, { type: 'pass', seat: 1 }, r)).toThrow(/소원/)
    const after = reduce(g, { type: 'play', seat: 1, cardIds: ['sword-8'] }, r)
    expect(after.wish).toBeNull()
  })

  it('소원 숫자가 없으면 아무거나 낼 수 있다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [mahjong])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['mahjong'] }, r)
    g = reduce(g, { type: 'wish', seat: 0, rank: 8 }, r)
    expect(() => reduce(g, { type: 'play', seat: 1, cardIds: ['sword-9'] }, r)).not.toThrow()
  })
})

describe('폭탄', () => {
  it('자기 턴이 아니어도 폭탄을 던질 수 있다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5), c('jade', 6)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('jade', 8), c('sword', 8), c('pagoda', 8), c('star', 8)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    expect(g.turn).toBe(1)
    // 2번이 자기 턴이 아닌데 폭탄
    g = reduce(g, { type: 'play', seat: 2, cardIds: ['jade-8', 'sword-8', 'pagoda-8', 'star-8'] }, r)
    expect(g.current?.isBomb).toBe(true)
    expect(g.turn).toBe(3)
  })

  it('폭탄이 아니면 남의 턴에 못 낸다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5)])
    setHand(g, 2, [c('pagoda', 11)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    expect(() => reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)).toThrow(/차례/)
  })

  it('개는 폭탄으로 못 잡는다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog])
    setHand(g, 1, [c('jade', 8), c('sword', 8), c('pagoda', 8), c('star', 8)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    // 개는 트릭을 만들지 않으므로 테이블이 비어 있다 → 폭탄으로 잡을 대상 자체가 없다
    expect(g.current).toBeNull()
  })
})

describe('티츄 선언', () => {
  it('첫 카드를 내기 전까지만 선언할 수 있다', () => {
    const r = rng()
    let g = toPlaying()
    g = reduce(g, { type: 'tichu', seat: 1 }, r)
    expect(g.declarations[1]).toBe('tichu')

    const seat = g.turn
    const id = g.hands[seat]![0]!.id
    g = reduce(g, { type: 'play', seat, cardIds: [id] }, r)
    expect(() => reduce(g, { type: 'tichu', seat }, r)).toThrow(/이미 카드를 낸/)
  })

  it('그랜드 티츄를 선언했으면 티츄를 또 못 부른다', () => {
    const r = rng()
    let g = newGame()
    for (let s = 0; s < 4; s++) g = reduce(g, { type: 'grandTichu', seat: s, call: s === 0 }, r)
    expect(() => reduce(g, { type: 'tichu', seat: 0 }, r)).toThrow(/그랜드/)
  })
})

describe('대기 좌석', () => {
  it('단계별로 누구를 기다리는지 알려준다', () => {
    const r = rng()
    let g = newGame()
    expect(waitingSeats(g)).toEqual([0, 1, 2, 3])
    g = reduce(g, { type: 'grandTichu', seat: 0, call: false }, r)
    expect(waitingSeats(g)).toEqual([1, 2, 3])
  })
})

describe('팀 조합', () => {
  it('1·3 vs 2·4는 자리를 그대로 둔다 (기본)', async () => {
    const { seatArrangement, teamsOf } = await import('../src/tichu/teams.js')
    const arr = seatArrangement('seats13')
    expect(arr).toEqual([0, 1, 2, 3])
    expect(teamsOf(arr)).toEqual([[0, 2], [1, 3]])
  })

  it('1·2 vs 3·4는 로비 1·2가 마주보게 재배치한다', async () => {
    const { seatArrangement, teamsOf } = await import('../src/tichu/teams.js')
    const arr = seatArrangement('seats12')
    const [teamA, teamB] = teamsOf(arr)
    expect(teamA.sort()).toEqual([0, 1]) // 로비 1번·2번
    expect(teamB.sort()).toEqual([2, 3]) // 로비 3번·4번
  })

  it('1·4 vs 2·3도 마찬가지', async () => {
    const { seatArrangement, teamsOf } = await import('../src/tichu/teams.js')
    const [teamA, teamB] = teamsOf(seatArrangement('seats14'))
    expect(teamA.sort()).toEqual([0, 3])
    expect(teamB.sort()).toEqual([1, 2])
  })

  it('랜덤은 4명 모두 정확히 한 번씩 배치된다', async () => {
    const { seatArrangement } = await import('../src/tichu/teams.js')
    const { createRng } = await import('../src/common/rng.js')
    for (let seed = 0; seed < 50; seed++) {
      const arr = seatArrangement('random', createRng(seed))
      expect([...arr].sort()).toEqual([0, 1, 2, 3])
    }
  })

  it('랜덤은 3가지 팀 편성이 모두 나온다', async () => {
    const { seatArrangement, teamsOf } = await import('../src/tichu/teams.js')
    const { createRng } = await import('../src/common/rng.js')
    // 4명을 2:2로 나누는 경우의 수는 3가지. 두 팀을 묶어 하나의 편성으로 센다.
    const partitions = new Set<string>()
    for (let seed = 0; seed < 200; seed++) {
      const [a, b] = teamsOf(seatArrangement('random', createRng(seed)))
      const key = [[...a].sort().join(''), [...b].sort().join('')].sort().join('|')
      partitions.add(key)
    }
    expect(partitions.size).toBe(3)
  })
})
