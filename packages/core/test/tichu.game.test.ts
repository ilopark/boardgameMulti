import { describe, expect, it } from 'vitest'
import { createRng } from '../src/common/rng.js'
import {
  createGame,
  startRound as startRoundForTest,
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

describe('교환 기록', () => {
  it('누가 나에게 뭘 줬는지 기록된다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = newGame()
    for (let s = 0; s < 4; s++) g = reduce(g, { type: 'grandTichu', seat: s, call: false }, r)

    // 각자 자기 손패 앞 3장을 넘긴다. 넘긴 카드를 미리 기억해 둔다.
    const sent: Record<number, string[]> = {}
    for (let s = 0; s < 4; s++) {
      const ids = g.hands[s]!.slice(0, 3).map((c) => c.id) as [string, string, string]
      sent[s] = ids
      g = reduce(g, { type: 'pass3', seat: s, cardIds: ids }, r)
    }

    for (let seat = 0; seat < 4; seat++) {
      const v = viewFor(g, seat)
      expect(v.received).toHaveLength(3)
      // 준 사람 3명이 모두 다르고, 나 자신은 없다
      const froms = v.received.map((x) => x.from).sort()
      expect(froms).toEqual([0, 1, 2, 3].filter((x) => x !== seat))
      // 실제로 그 사람이 보낸 카드가 맞는지
      for (const { from, card } of v.received) {
        expect(sent[from]).toContain(card.id)
      }
      // 받은 카드는 내 손에 들어와 있다
      for (const { card } of v.received) {
        expect(v.hand.some((c) => c.id === card.id)).toBe(true)
      }
    }
  })

  it('남이 받은 카드는 안 보인다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const g = toPlaying()
    const mine = viewFor(g, 0)
    const others = viewFor(g, 1)
    // 각자 자기 것만 본다
    expect(mine.received.every((x) => x.from !== 0)).toBe(true)
    expect(others.received.every((x) => x.from !== 1)).toBe(true)
    const json = JSON.stringify(mine)
    // 1번이 받은 카드 중 내가 준 게 아닌 것은 내 뷰에 없어야 한다
    for (const { from, card } of others.received) {
      if (from === 0) continue
      expect(json.includes(`"${card.id}"`)).toBe(false)
    }
  })

  it('라운드가 바뀌면 기록도 새로 쌓인다', async () => {
    const r = rng()
    let g = toPlaying()
    expect(g.received[0]).toHaveLength(3)
    startRoundForTest(g, r)
    expect(g.received[0]).toHaveLength(0)
  })
})

describe('개 카드 표시', () => {
  it('개를 내면 그 자리에 개 카드가 남는다 (트릭은 안 생기지만)', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    setHand(g, 2, [c('pagoda', 11)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)

    // 트릭 자체는 비어 있다
    expect(g.trick).toHaveLength(0)
    expect(g.current).toBeNull()
    // 하지만 화면에는 개가 보여야 한다
    const v = viewFor(g, 1)
    expect(v.seats[0]!.playedDog).toBe(true)
    expect(v.seats[0]!.played?.type).toBe('dog')
    expect(v.seats[0]!.played?.cards[0]!.kind).toBe('dog')
  })

  it('다음 트릭이 끝나면 개 표시가 사라진다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    expect(viewFor(g, 1).seats[0]!.playedDog).toBe(true)

    // 파트너(2번)가 리드하고 트릭이 끝나면 초기화
    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    for (const s of [3, 0, 1]) g = reduce(g, { type: 'pass', seat: s }, r)
    expect(viewFor(g, 1).seats[0]!.playedDog).toBe(false)
  })

  it('개를 낸 사람이 그 뒤에 카드를 내면 그게 우선 표시된다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dog, c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dog'] }, r)
    // 파트너가 리드 → 3, 0 순서로 진행
    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    g = reduce(g, { type: 'pass', seat: 3 }, r)
    // 0번이 낼 수 있는 게 없으니 패스. 개 표시는 유지
    expect(viewFor(g, 1).seats[0]!.playedDog).toBe(true)
  })
})

describe('라운드 종료 시점', () => {
  it('3명이 나가면 마지막 사람이 아무것도 안 해도 라운드가 끝난다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13), c('star', 3)]) // 4등은 카드가 남는다
    g.turn = 0
    g.leader = 0

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['sword-9'] }, r)
    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    // 여기서 0·1·2가 다 나갔다 → 3번이 패스를 누르지 않아도 끝나야 한다
    expect(g.finishOrder).toEqual([0, 1, 2])
    expect(g.phase).toBe('roundEnd')
  })

  it('원투 피니시도 즉시 끝난다 (3등을 기다리지 않는다)', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5)])
    setHand(g, 1, [c('sword', 9), c('sword', 3)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13), c('star', 2)])
    g.turn = 0
    g.leader = 0

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    // 0번과 2번이 같은 팀 → 원투 피니시
    expect(g.finishOrder).toEqual([0, 2])
    expect(g.phase).toBe('roundEnd')
    expect(g.lastRound?.doubleWin).toBe(0)
    expect(g.lastRound?.total[0]).toBe(200)
  })

  it('2명만 나갔고 같은 팀이 아니면 계속 진행한다', () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11), c('pagoda', 4)])
    setHand(g, 3, [c('star', 13), c('star', 2)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['sword-9'] }, r)
    // 0(팀0)과 1(팀1)이 나갔다 — 다른 팀이므로 계속
    expect(g.finishOrder).toEqual([0, 1])
    expect(g.phase).toBe('playing')
  })
})

describe('봉황 단독 (직전 카드 + 0.5)', () => {
  it('테이블의 2 위에 봉황을 내면 2.5가 되어 이긴다', async () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 2)])
    setHand(g, 1, [phoenix, c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-2'] }, r)
    // 값을 지정하지 않아도 서버가 테이블에서 계산한다
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['phoenix'] }, r)
    expect(g.current?.rank).toBe(2.5)
  })

  it('A 위에서는 14.5가 되어 이긴다', async () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 14)])
    setHand(g, 1, [phoenix])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-14'] }, r)
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['phoenix'] }, r)
    expect(g.current?.rank).toBe(14.5)
  })

  it('용은 못 이긴다', async () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dragon])
    setHand(g, 1, [phoenix])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dragon'] }, r)
    expect(() => reduce(g, { type: 'play', seat: 1, cardIds: ['phoenix'] }, r)).toThrow(/이길 수 없/)
  })

  it('리드로 내면 1.5', async () => {
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [phoenix, c('jade', 5)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['phoenix'] }, r)
    expect(g.current?.rank).toBe(1.5)
  })

  it('조합 안의 봉황은 영향받지 않는다', async () => {
    const { parseAgainst, parseCombo } = await import('../src/tichu/combo.js')
    const pair = [c('jade', 9), phoenix]
    const onTable = parseCombo([c('jade', 3), c('star', 3)])
    expect(parseAgainst(pair, onTable)?.rank).toBe(9)
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

describe('뷰 마스킹', () => {
  it('남의 손패는 장수만 보인다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const g = toPlaying()
    const v = viewFor(g, 0)
    expect(v.hand).toHaveLength(14)
    expect(v.seats.map((s) => s.cards)).toEqual([14, 14, 14, 14])

    const json = JSON.stringify(v)
    for (const seat of [1, 2, 3]) {
      for (const card of g.hands[seat]!) {
        expect(json.includes(`"${card.id}"`)).toBe(false)
      }
    }
  })

  it('선언과 팀이 좌석별로 나온다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    g = reduce(g, { type: 'tichu', seat: 1 }, r)
    const v = viewFor(g, 0)
    expect(v.seats[1]!.declaration).toBe('tichu')
    expect(v.seats.map((s) => s.team)).toEqual([0, 1, 0, 1])
  })

  it('패스한 사람이 표시된다 (화면에 카드 뒷면으로 쓸 값)', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5)])
    setHand(g, 1, [c('sword', 9)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    const v = viewFor(g, 2)
    expect(v.seats[1]!.passed).toBe(true)
    expect(v.seats[0]!.played?.cards[0]!.id).toBe('jade-5')
    expect(v.seats[0]!.leading).toBe(true)
  })

  it('패스 표시는 누가 카드를 내도 유지된다 (실제로 낼 때까지)', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5), c('jade', 6)])
    setHand(g, 1, [c('sword', 9), c('sword', 14)])
    setHand(g, 2, [c('pagoda', 11), c('pagoda', 12)])
    setHand(g, 3, [c('star', 13), c('star', 2)])
    g.turn = 0
    g.leader = 0

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    expect(viewFor(g, 0).seats[1]!.passed).toBe(true)

    // 2번이 카드를 내면 1번은 다시 낼 수 있게 되지만(passed 플래그는 풀림)
    // 화면 표시는 계속 덮여 있어야 한다
    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    expect(g.passed[1]).toBe(false) // 재진입 가능
    expect(viewFor(g, 0).seats[1]!.passed).toBe(true) // 표시는 유지

    // 실제로 내면 풀린다
    g = reduce(g, { type: 'pass', seat: 3 }, r)
    g = reduce(g, { type: 'pass', seat: 0 }, r)
    // 1번 차례. pagoda-11을 이겨야 하므로 12 이상이 필요하다
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['sword-14'] }, r)
    expect(viewFor(g, 0).seats[1]!.passed).toBe(false)
    expect(viewFor(g, 0).seats[1]!.played?.cards[0]!.id).toBe('sword-14')
  })

  it('카드를 냈다가 나중에 패스해도 뒷면으로 덮인다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5), c('jade', 14)])
    setHand(g, 1, [c('sword', 9), c('sword', 3)])
    setHand(g, 2, [c('pagoda', 11), c('pagoda', 12)])
    setHand(g, 3, [c('star', 13), c('star', 2)])
    g.turn = 0
    g.leader = 0

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['sword-9'] }, r) // 1번이 카드를 냈다
    expect(viewFor(g, 2).seats[1]!.played?.cards[0]!.id).toBe('sword-9')
    expect(viewFor(g, 2).seats[1]!.passed).toBe(false)

    g = reduce(g, { type: 'play', seat: 2, cardIds: ['pagoda-11'] }, r)
    g = reduce(g, { type: 'pass', seat: 3 }, r)
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-14'] }, r) // 트릭이 계속 살아 있게
    // 1번이 이번엔 패스 → 아까 낸 sword-9가 아니라 뒷면이 보여야 한다
    g = reduce(g, { type: 'pass', seat: 1 }, r)
    expect(g.phase).toBe('playing') // 트릭이 아직 안 끝났다
    const v = viewFor(g, 2)
    expect(v.seats[1]!.passed).toBe(true)
    expect(v.seats[1]!.played).toBeNull()
  })

  it('트릭이 끝나면 패스 표시가 초기화된다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [c('jade', 5), c('jade', 6)])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    for (const s of [1, 2, 3]) g = reduce(g, { type: 'pass', seat: s }, r)
    for (const s of [0, 1, 2, 3]) expect(viewFor(g, 0).seats[s]!.passed).toBe(false)
  })

  it('카드 점수가 실시간으로 집계된다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    // 5점짜리 카드(5)와 10점짜리(K)를 0번이 가져가게 만든다
    setHand(g, 0, [c('jade', 5), c('jade', 6)])
    setHand(g, 1, [c('sword', 13)])
    setHand(g, 2, [c('pagoda', 2)])
    setHand(g, 3, [c('star', 3)])
    g.turn = 0
    g.leader = 0
    expect(viewFor(g, 0).liveCardPoints).toEqual([0, 0])

    g = reduce(g, { type: 'play', seat: 0, cardIds: ['jade-5'] }, r)
    g = reduce(g, { type: 'play', seat: 1, cardIds: ['sword-13'] }, r)
    for (const s of [2, 3, 0]) g = reduce(g, { type: 'pass', seat: s }, r)
    // 1번(팀1)이 5(5점) + K(10점) = 15점을 가져갔다
    const v = viewFor(g, 0)
    expect(v.liveCardPoints).toEqual([0, 15])
    expect(v.seats[1]!.wonPoints).toBe(15)
  })

  it('용을 낸 사람에게만 넘길 후보가 보인다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const r = rng()
    let g = toPlaying()
    setHand(g, 0, [dragon])
    setHand(g, 1, [c('sword', 9)])
    setHand(g, 2, [c('pagoda', 11)])
    setHand(g, 3, [c('star', 13)])
    g.turn = 0
    g.leader = 0
    g = reduce(g, { type: 'play', seat: 0, cardIds: ['dragon'] }, r)
    for (const s of [1, 2, 3]) g = reduce(g, { type: 'pass', seat: s }, r)
    expect(viewFor(g, 0).dragonTargets).toEqual([1, 3])
    expect(viewFor(g, 1).dragonTargets).toEqual([])
  })
})

describe('손패 정렬', () => {
  it('왼쪽이 약하고 오른쪽이 강하다: 개 → 마작 → 숫자 → 봉황 → 용', async () => {
    const { sortHand } = await import('../src/tichu/view.js')
    const cards = [dragon, c('star', 7), dog, mahjong, phoenix, c('jade', 3), c('sword', 14)]
    expect(sortHand(cards).map((x) => x.kind === 'number' ? `${x.rank}` : x.kind))
      .toEqual(['dog', 'mahjong', '3', '7', '14', 'phoenix', 'dragon'])
  })

  it('같은 숫자는 문양 순으로 묶인다', async () => {
    const { sortHand } = await import('../src/tichu/view.js')
    const cards = [c('star', 5), c('jade', 5), c('pagoda', 5), c('sword', 5)]
    expect(sortHand(cards).map((x) => (x.kind === 'number' ? x.suit : ''))).toEqual([
      'jade', 'sword', 'pagoda', 'star',
    ])
  })

  it('뷰로 나가는 손패가 정렬돼 있다', async () => {
    const { viewFor } = await import('../src/tichu/view.js')
    const g = toPlaying()
    const hand = viewFor(g, 0).hand
    const key = (x: typeof hand[number]) =>
      x.kind === 'dog' ? 0 : x.kind === 'mahjong' ? 1 : x.kind === 'number' ? x.rank : x.kind === 'phoenix' ? 15 : 16
    for (let i = 1; i < hand.length; i++) {
      expect(key(hand[i]!)).toBeGreaterThanOrEqual(key(hand[i - 1]!))
    }
  })
})
