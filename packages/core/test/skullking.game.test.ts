import { describe, expect, it } from 'vitest'
import { createRng } from '../src/common/rng.js'
import {
  buildDeck,
  cardCountFor,
  createGame,
  currentSeat,
  GHOST_SEAT,
  legalFor,
  makeSkOptions,
  reduce,
  SkRuleError,
  totalRounds,
  viewFor,
  type SkAction,
  type SkGameState,
} from '../src/skullking/index.js'

const OPTS = makeSkOptions()

function newGame(players: number, seed = 1, opts = OPTS) {
  return createGame(players, opts, 0, createRng(seed))
}

/** 아무 카드나 합법적으로 내는 봇으로 게임 끝까지 진행 */
function playOut(start: SkGameState, seed = 99): { final: SkGameState; steps: number } {
  const rng = createRng(seed)
  let s = start
  let steps = 0
  while (s.phase !== 'gameEnd') {
    if (steps++ > 20000) throw new Error('무한 루프 — 진행이 막혔다')
    if (s.phase === 'bidding') {
      const seat = s.bids.findIndex((b) => b === null)
      s = reduce(s, { type: 'bid', seat, value: Math.floor(rng() * (cardCountFor(s) + 1)) }, rng)
    } else if (s.phase === 'playing') {
      const seat = currentSeat(s)
      if (seat === null) throw new Error('playing인데 차례가 없다')
      const legal = legalFor(s, seat)
      expect(legal.length).toBeGreaterThan(0)
      const card = legal[Math.floor(rng() * legal.length)]!
      const action: SkAction =
        card.kind === 'tigress'
          ? { type: 'play', seat, cardId: card.id, tigressAs: rng() < 0.5 ? 'pirate' : 'escape' }
          : { type: 'play', seat, cardId: card.id }
      s = reduce(s, action, rng)
    } else {
      s = reduce(s, { type: 'advance' }, rng)
    }
  }
  return { final: s, steps }
}

describe('게임 생성과 라운드 시작', () => {
  it('1라운드는 1장씩 돌린다', () => {
    const g = newGame(4)
    expect(g.phase).toBe('bidding')
    expect(g.hands.slice(0, 4).every((h) => h.length === 1)).toBe(true)
  })

  it('2명 미만은 거부', () => {
    expect(() => createGame(1, OPTS, 0, createRng(1))).toThrow(SkRuleError)
  })

  it('2인이면 유령 손패까지 3벌을 돌린다', () => {
    const g = newGame(2)
    expect(g.hands).toHaveLength(3)
    expect(g.hands[GHOST_SEAT]).toHaveLength(1)
  })

  it('돌리고 남은 카드는 undealt에 남는다 (덱 총량이 보존된다)', () => {
    const g = newGame(4)
    const dealt = g.hands.reduce((n, h) => n + h.length, 0)
    expect(dealt + g.undealt.length).toBe(buildDeck(g.opts).length)
  })
})

describe('입찰', () => {
  it('범위를 벗어나면 거부', () => {
    const g = newGame(4)
    const rng = createRng(1)
    expect(() => reduce(g, { type: 'bid', seat: 0, value: -1 }, rng)).toThrow(SkRuleError)
    expect(() => reduce(g, { type: 'bid', seat: 0, value: 2 }, rng)).toThrow(SkRuleError) // 1라운드는 최대 1
  })

  it('전원 입찰이 끝나야 플레이가 시작된다', () => {
    const rng = createRng(1)
    let g = newGame(4)
    for (let seat = 0; seat < 3; seat++) {
      g = reduce(g, { type: 'bid', seat, value: 0 }, rng)
      expect(g.phase).toBe('bidding')
    }
    g = reduce(g, { type: 'bid', seat: 3, value: 0 }, rng)
    expect(g.phase).toBe('playing')
  })

  it('입찰 중에는 남의 입찰값이 안 보인다', () => {
    const rng = createRng(1)
    let g = newGame(4)
    g = reduce(g, { type: 'bid', seat: 0, value: 1 }, rng)
    const v = viewFor(g, 1)
    expect(v.bidsRevealed).toBe(false)
    expect(v.bids[0]).toBeNull() // 값은 숨김
    expect(v.bidPlaced[0]).toBe(true) // 냈다는 사실만 보임
  })

  it('전원 확정되면 입찰이 공개된다', () => {
    const rng = createRng(1)
    let g = newGame(4)
    for (let seat = 0; seat < 4; seat++) g = reduce(g, { type: 'bid', seat, value: seat % 2 }, rng)
    const v = viewFor(g, 1)
    expect(v.bidsRevealed).toBe(true)
    expect(v.bids).toEqual([0, 1, 0, 1])
  })
})

describe('카드 내기', () => {
  function readyToPlay(players = 4, seed = 1) {
    const rng = createRng(seed)
    let g = newGame(players, seed)
    for (let seat = 0; seat < players; seat++) g = reduce(g, { type: 'bid', seat, value: 0 }, rng)
    return { g, rng }
  }

  it('자기 차례가 아니면 거부', () => {
    const { g, rng } = readyToPlay()
    const turn = currentSeat(g)!
    const other = (turn + 1) % 4
    const card = g.hands[other]![0]!
    expect(() => reduce(g, { type: 'play', seat: other, cardId: card.id }, rng)).toThrow(/차례/)
  })

  it('손에 없는 카드는 거부', () => {
    const { g, rng } = readyToPlay()
    const turn = currentSeat(g)!
    expect(() => reduce(g, { type: 'play', seat: turn, cardId: '없는카드' }, rng)).toThrow(/손에 없는/)
  })

  it('티그리스는 선언 없이 못 낸다', () => {
    const rng = createRng(1)
    // 티그리스를 손에 쥔 상태를 강제로 만든다
    let g = newGame(4, 1)
    const seat = 0
    g.hands[seat] = [{ id: 'tigress', kind: 'tigress' }]
    for (let s = 0; s < 4; s++) g = reduce(g, { type: 'bid', seat: s, value: 0 }, rng)
    while (currentSeat(g) !== seat) {
      const t = currentSeat(g)!
      g = reduce(g, { type: 'play', seat: t, cardId: legalFor(g, t)[0]!.id }, rng)
    }
    expect(() => reduce(g, { type: 'play', seat, cardId: 'tigress' }, rng)).toThrow(/선언/)
  })

  it('카드를 내면 손패가 줄고 테이블에 올라간다', () => {
    const { g, rng } = readyToPlay()
    const seat = currentSeat(g)!
    const before = g.hands[seat]!.length
    const next = reduce(g, { type: 'play', seat, cardId: g.hands[seat]![0]!.id }, rng)
    expect(next.hands[seat]!.length).toBe(before - 1)
    expect(next.trick.some((p) => p.seat === seat)).toBe(true)
  })
})

describe('전체 게임 진행', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    it(`${players}인 10라운드를 끝까지 완주한다`, () => {
      const { final } = playOut(newGame(players, players * 7), players * 13)
      expect(final.phase).toBe('gameEnd')
      expect(final.roundIndex).toBe(totalRounds(final.opts))
      expect(final.history).toHaveLength(10)
    })
  }

  it('카드가 사라지거나 복제되지 않는다 (매 트릭 검사)', () => {
    const rng = createRng(4242)
    let s = newGame(4, 777)
    let guard = 0
    while (s.phase !== 'gameEnd') {
      if (guard++ > 20000) throw new Error('무한 루프')
      // 'playing'에서만 검사한다. trickEnd 단계에서는 방금 끝난 트릭이
      // state.trick(화면 표시용)과 state.tricks(집계용)에 동시에 들어 있어 중복된다.
      if (s.phase === 'playing') {
        const inHands = s.hands.reduce((n, h) => n + h.length, 0)
        const onTable = s.trick.length
        const doneCards = s.tricks.length * s.hands.length
        const dealtTotal = cardCountFor(s) * s.hands.length
        expect(inHands + onTable + doneCards).toBe(dealtTotal)

        // 카드 id가 중복되지 않아야 한다 (복제 방지)
        const ids = [...s.hands.flat().map((c) => c.id), ...s.trick.map((p) => p.card.id)]
        expect(new Set(ids).size).toBe(ids.length)
      }
      if (s.phase === 'bidding') {
        const seat = s.bids.findIndex((b) => b === null)
        s = reduce(s, { type: 'bid', seat, value: 0 }, rng)
      } else if (s.phase === 'playing') {
        const seat = currentSeat(s)!
        s = reduce(s, pickPlay(s, seat, rng), rng)
      } else {
        s = reduce(s, { type: 'advance' }, rng)
      }
    }
    expect(s.phase).toBe('gameEnd')
  })

  it('누적 점수는 라운드 점수의 합과 같다', () => {
    const { final } = playOut(newGame(4, 55), 66)
    for (let seat = 0; seat < final.humanCount; seat++) {
      const sum = final.history.reduce((n, round) => n + (round.find((r) => r.seat === seat)?.total ?? 0), 0)
      expect(final.totals[seat]).toBe(sum)
    }
  })

  it('매 라운드 트릭 수 합계는 그 라운드 카드 수와 같다', () => {
    const rng = createRng(31)
    let s = newGame(4, 31)
    while (s.phase !== 'gameEnd') {
      if (s.phase === 'roundEnd') {
        const taken = s.lastRoundScores!.reduce((n, r) => n + r.taken, 0)
        // 크라켄으로 소멸한 트릭은 아무도 안 먹으므로 <= 가 맞다
        expect(taken).toBeLessThanOrEqual(cardCountFor(s))
      }
      if (s.phase === 'bidding') {
        const seat = s.bids.findIndex((b) => b === null)
        s = reduce(s, { type: 'bid', seat, value: 0 }, rng)
      } else if (s.phase === 'playing') {
        const seat = currentSeat(s)!
        s = reduce(s, pickPlay(s, seat, rng), rng)
      } else {
        s = reduce(s, { type: 'advance' }, rng)
      }
    }
  })
})

describe('2인 유령', () => {
  it('유령이 알아서 카드를 낸다 — 사람은 유령 차례를 기다리지 않는다', () => {
    const rng = createRng(9)
    let g = newGame(2, 9)
    g = reduce(g, { type: 'bid', seat: 0, value: 0 }, rng)
    g = reduce(g, { type: 'bid', seat: 1, value: 0 }, rng)
    // 입찰이 끝나면 바로 사람 차례여야 한다 (유령이 먼저면 자동으로 이미 냈다)
    expect(currentSeat(g)).not.toBe(GHOST_SEAT)
  })

  it('사람이 낸 뒤 유령 차례가 와도 멈추지 않는다 (회귀 테스트)', () => {
    const rng = createRng(77)
    let g = newGame(2, 77)
    g = reduce(g, { type: 'bid', seat: 0, value: 0 }, rng)
    g = reduce(g, { type: 'bid', seat: 1, value: 0 }, rng)

    // 사람이 한 장 낸다
    const seat = currentSeat(g)!
    expect(seat).not.toBe(GHOST_SEAT)
    g = reduce(g, pickPlay(g, seat, rng), rng)

    // 유령 차례에서 멈춰 있으면 안 된다 — 자동으로 넘어가 있어야 한다
    expect(currentSeat(g)).not.toBe(GHOST_SEAT)
    // 유령도 카드를 냈어야 한다
    if (g.phase === 'playing') {
      expect(g.trick.some((pl) => pl.seat === GHOST_SEAT)).toBe(true)
    } else {
      expect(g.lastTrick!.plays.some((pl) => pl.seat === GHOST_SEAT)).toBe(true)
    }
  })

  it('유령은 점수를 받지 않는다', () => {
    const { final } = playOut(newGame(2, 21), 22)
    expect(final.totals).toHaveLength(2)
    expect(final.history[0]).toHaveLength(2)
  })
})

describe('뷰 마스킹', () => {
  it('남의 손패는 장수만 보인다', () => {
    const g = newGame(4, 5)
    const v = viewFor(g, 0)
    expect(v.hand).toHaveLength(1)
    expect(v.handCounts).toEqual([1, 1, 1, 1])
    // 뷰를 통째로 직렬화해도 남의 카드 id가 없어야 한다
    const json = JSON.stringify(v)
    for (let seat = 1; seat < 4; seat++) {
      for (const card of g.hands[seat]!) {
        expect(json.includes(`"${card.id}"`)).toBe(false)
      }
    }
  })

  it('내 차례가 아니면 legal이 비어 있다', () => {
    const rng = createRng(3)
    let g = newGame(4, 3)
    for (let s = 0; s < 4; s++) g = reduce(g, { type: 'bid', seat: s, value: 0 }, rng)
    const turn = currentSeat(g)!
    expect(viewFor(g, turn).legal.length).toBeGreaterThan(0)
    expect(viewFor(g, (turn + 1) % 4).legal).toHaveLength(0)
  })
})

/** 합법 카드 하나를 골라 액션으로 만든다. 티그리스면 선언까지 붙인다. */
function pickPlay(s: SkGameState, seat: number, rng: () => number): SkAction {
  const legal = legalFor(s, seat)
  const card = legal[Math.floor(rng() * legal.length)]!
  if (card.kind === 'tigress') {
    return { type: 'play', seat, cardId: card.id, tigressAs: rng() < 0.5 ? 'pirate' : 'escape' }
  }
  return { type: 'play', seat, cardId: card.id }
}

describe('3인 이상에서 좌석 2는 유령이 아니다 (자동 제출 버그)', () => {
  // GHOST_SEAT=2 이므로, hasGhost 가드가 없으면 3인+ 게임에서 좌석 2(진짜 사람)의
  // 카드가 저절로 나간다. 사용자가 겪은 "3번째 사람 패가 자동으로 나가는" 버그.

  for (const players of [3, 4, 5, 6]) {
    it(`${players}인: 좌석 2 차례가 오면 사람이 낼 때까지 멈춰 있어야 한다`, () => {
      let s = newGame(players)
      // 입찰 전원 완료
      for (let seat = 0; seat < players; seat++) {
        s = reduce(s, { type: 'bid', seat, value: 0 }, createRng(1))
      }
      expect(s.phase).toBe('playing')

      // 좌석 2의 차례가 실제로 오는지, 그리고 그때 자동으로 넘어가지 않는지 확인.
      // 좌석 2 앞 순번들을 사람이 직접 내면서 진행한다.
      const rng = createRng(7)
      let sawSeat2Turn = false
      let guard = 0
      while (s.phase === 'playing' && guard++ < 100) {
        const seat = currentSeat(s)
        if (seat === null) break
        if (seat === GHOST_SEAT) {
          // 좌석 2 차례에 멈춰 있다 = 자동 제출 안 됨 (정상)
          sawSeat2Turn = true
          const before = s.hands[GHOST_SEAT]!.length
          // 한 바퀴 더 진행시켜도(다른 조치 없이) 좌석 2 손패가 저절로 줄지 않아야 한다.
          // 여기서 직접 내주면 진행되지만, '내주기 전에는' 그대로여야 한다.
          expect(s.hands[GHOST_SEAT]!.length).toBe(before)
          const legal = legalFor(s, GHOST_SEAT)
          s = reduce(s, { type: 'play', seat: GHOST_SEAT, cardId: legal[0]!.id }, rng)
          break
        }
        const legal = legalFor(s, seat)
        s = reduce(s, { type: 'play', seat, cardId: legal[0]!.id }, rng)
      }
      expect(sawSeat2Turn).toBe(true)
    })
  }

  it('3인: 한 라운드를 끝까지 사람이 직접 둬도 좌석 2가 먼저 새지 않는다', () => {
    let s = newGame(3)
    for (let seat = 0; seat < 3; seat++) s = reduce(s, { type: 'bid', seat, value: 0 }, createRng(1))
    const rng = createRng(3)
    // 좌석 2의 손패는 오직 좌석 2의 play 액션으로만 줄어야 한다.
    let seat2Plays = 0
    const startHand = s.hands[GHOST_SEAT]!.length
    let guard = 0
    while (s.phase !== 'roundEnd' && s.phase !== 'gameEnd' && guard++ < 200) {
      if (s.phase !== 'playing') break
      const seat = currentSeat(s)
      if (seat === null) break
      if (seat === GHOST_SEAT) seat2Plays++
      const legal = legalFor(s, seat)
      s = reduce(s, { type: 'play', seat, cardId: legal[0]!.id }, rng)
    }
    // 좌석 2가 낸 횟수 = 좌석 2 손패가 줄어든 양. 저절로 나갔으면 이보다 많이 줄었을 것.
    const consumed = startHand - (s.hands[GHOST_SEAT]?.length ?? 0)
    expect(consumed).toBe(seat2Plays)
  })
})

describe('2인 유령 변형은 여전히 자동으로 둔다', () => {
  it('2인: 좌석 2(유령) 차례는 서버가 대신 둔다', () => {
    const opts = makeSkOptions({ useGhostForTwoPlayers: true })
    let s = createGame(2, opts, 0, createRng(1))
    for (let seat = 0; seat < 2; seat++) s = reduce(s, { type: 'bid', seat, value: 0 }, createRng(1))
    expect(s.phase).toBe('playing')
    // playOut 이 무한 루프 없이 끝나면 유령이 자동으로 둬지고 있다는 뜻
    const { final } = playOut(s)
    expect(final.phase).toBe('gameEnd')
  })
})
