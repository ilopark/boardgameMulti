import { deal, shuffle, type Rng } from '../common/rng.js'
import { canBeat, parseAgainst, parseCombo, type ParseOptions } from './combo.js'
import { buildDeck, cardPoints, handPoints } from './deck.js'
import { DEFAULT_TICHU_OPTIONS, type TichuRuleOptions } from './options.js'
import { partnerOf, teamOf, type Combo, type Declaration, type TichuCard } from './types.js'

/**
 * 티츄 게임 진행 상태머신. 순수 함수 — 같은 상태 + 같은 액션이면 항상 같은 결과.
 *
 * 라운드 흐름
 *   grandTichu(8장) → passing(14장, 3장 교환) → playing → roundEnd → 다음 라운드
 */

export type TichuPhase =
  | 'grandTichu'
  | 'passing'
  | 'playing'
  /** 용으로 트릭을 이겨서 상대팀 중 누구에게 줄지 고르는 중 */
  | 'dragonGift'
  | 'roundEnd'
  | 'gameEnd'

export interface TichuPlay {
  seat: number
  combo: Combo
}

export interface RoundScore {
  /** 팀별 카드 점수 */
  cardPoints: [number, number]
  /** 선언(티츄/그랜드) 가감 */
  declarationPoints: [number, number]
  /** 원투 피니시 여부 */
  doubleWin: 0 | 1 | null
  total: [number, number]
  /** 좌석별 선언과 성공 여부 */
  declarations: Array<{ seat: number; declaration: Declaration; success: boolean }>
}

export interface TichuGameState {
  opts: TichuRuleOptions
  phase: TichuPhase
  /** 1부터 */
  round: number
  /** 좌석별 손패 (4자리) */
  hands: TichuCard[][]
  /** 라운드 시작 시 돌린 14장 전체 — 교환 전 8장만 보여주려고 나눠 둔다 */
  dealt: TichuCard[][]
  /** grandTichu 단계에서 아직 안 본 6장 */
  pending: TichuCard[][]
  declarations: Declaration[]
  /** 그랜드 티츄 결정을 마쳤는지 */
  grandDecided: boolean[]
  /** 교환할 카드 3장 [왼쪽, 파트너, 오른쪽] */
  passSelections: Array<string[] | null>
  /** 첫 카드를 냈는지 — 티츄는 첫 카드 내기 전까지만 선언 가능 */
  played: boolean[]
  /**
   * 교환에서 **누구에게서 무엇을 받았는지**. 라운드 내내 유지한다.
   * 받은 카드를 손에 섞어 넣고 나면 뭘 받았는지 잊어버리기 쉬워서 남겨둔다.
   */
  received: Array<Array<{ from: number; card: TichuCard }>>

  leader: number
  turn: number
  /** 이번 트릭에 깔린 것들 */
  trick: TichuPlay[]
  /** 지금 테이블 위 조합 (이걸 이겨야 낼 수 있다) */
  current: Combo | null
  /** 이번 트릭에서 패스한 좌석. 누가 카드를 내면 초기화된다(재진입 가능하므로) */
  passed: boolean[]
  /**
   * 이번 트릭에서 마지막으로 한 행동. **passed와 달리 초기화되지 않는다.**
   * 화면에서 "패스한 사람은 카드를 낼 때까지 계속 덮어두기" 위해 필요하다.
   * 트릭이 끝날 때만 비운다.
   */
  trickAction: Array<'play' | 'pass' | null>
  /** 마작 소원. 아직 이행되지 않은 값 */
  wish: number | null
  /**
   * 마작을 낸 뒤 **소원을 고르는 중인 좌석**. 이 값이 있으면 그 좌석의 소원 선택만 받고
   * 나머지 전원은 행동할 수 없다. 소원을 고르거나(또는 시간초과로 소원 없음) 해제된다.
   */
  awaitingWish: number | null
  /**
   * 트릭이 곧 닫힘 — **폭탄 창구**가 열린 상태. 트릭은 테이블에 그대로 두고,
   * 이 동안 누구든 (턴이 아니어도) 폭탄을 던질 수 있다. 폭탄이 없으면 winner가 가져간다.
   * 서버가 잠깐 뒤 collectTrick 으로 실제 마감한다.
   */
  pendingClose: { winner: number } | null
  /**
   * 폭탄 창구에서 **"폭탄 내기"를 예약한 좌석**. 이 값이 있으면 진행이 멈추고,
   * 그 좌석만 (더 넉넉한 시간 동안) 폭탄을 제출할 수 있다. 제출하거나 취소/시간초과되면 풀린다.
   */
  bombClaim: number | null
  /** 손패를 턴 순서 (먼저 턴 사람부터) */
  finishOrder: number[]
  /** 좌석별로 따놓은 카드 */
  won: TichuCard[][]
  /** 용으로 이겨서 넘겨야 하는 트릭 (dragonGift 단계) */
  pendingDragon: { winner: number; cards: TichuCard[] } | null
  /**
   * 개를 낸 기록. 개는 트릭을 만들지 않고 사라지기 때문에
   * 그냥 두면 **누가 개를 냈는지 화면에서 알 수가 없다.**
   * 다음 트릭이 끝날 때까지 남겨서 보여준다.
   */
  dogNote: { seat: number; card: TichuCard } | null

  totals: [number, number]
  history: RoundScore[]
  lastRound: RoundScore | null
}

export type TichuAction =
  | { type: 'grandTichu'; seat: number; call: boolean }
  | { type: 'pass3'; seat: number; cardIds: [string, string, string] }
  | { type: 'tichu'; seat: number }
  | { type: 'play'; seat: number; cardIds: string[]; phoenixAs?: number; asBomb?: boolean }
  | { type: 'pass'; seat: number }
  | { type: 'wish'; seat: number; rank: number | null }
  | { type: 'giveDragon'; seat: number; to: number }
  /** 폭탄 창구가 끝나 트릭을 실제로 걷어간다 (서버 타이머가 보낸다) */
  | { type: 'collectTrick' }
  /** 폭탄 창구에서 "폭탄 내기"를 예약 — 진행을 멈추고 그 좌석에게 제출 시간을 준다 */
  | { type: 'claimBomb'; seat: number }
  /** 폭탄 예약 취소(또는 시간초과) — 트릭을 걷고 진행 */
  | { type: 'cancelBomb'; seat: number }
  | { type: 'advance' }

export class TichuRuleError extends Error {}
function err(m: string): never {
  throw new TichuRuleError(m)
}

const SEATS = [0, 1, 2, 3]

export function createGame(opts: TichuRuleOptions = DEFAULT_TICHU_OPTIONS, rng?: Rng): TichuGameState {
  const state: TichuGameState = {
    opts,
    phase: 'grandTichu',
    round: 1,
    hands: [[], [], [], []],
    dealt: [[], [], [], []],
    pending: [[], [], [], []],
    declarations: ['none', 'none', 'none', 'none'],
    grandDecided: [false, false, false, false],
    passSelections: [null, null, null, null],
    played: [false, false, false, false],
    received: [[], [], [], []],
    leader: 0,
    turn: 0,
    trick: [],
    current: null,
    passed: [false, false, false, false],
    trickAction: [null, null, null, null],
    wish: null,
    awaitingWish: null,
    pendingClose: null,
    bombClaim: null,
    finishOrder: [],
    won: [[], [], [], []],
    pendingDragon: null,
    dogNote: null,
    totals: [0, 0],
    history: [],
    lastRound: null,
  }
  if (rng) startRound(state, rng)
  return state
}

/** 라운드 시작 — 14장씩 돌리되 처음엔 8장만 보여준다 */
export function startRound(state: TichuGameState, rng: Rng): void {
  const deck = shuffle(buildDeck(), rng)
  const { hands } = deal(deck, 4, 14)
  state.dealt = hands
  state.hands = hands.map((h) => h.slice(0, 8))
  state.pending = hands.map((h) => h.slice(8))
  state.declarations = ['none', 'none', 'none', 'none']
  state.grandDecided = [false, false, false, false]
  state.passSelections = [null, null, null, null]
  state.played = [false, false, false, false]
  state.received = [[], [], [], []]
  state.trick = []
  state.current = null
  state.passed = [false, false, false, false]
  state.trickAction = [null, null, null, null]
  state.wish = null
  state.awaitingWish = null
  state.pendingClose = null
  state.finishOrder = []
  state.won = [[], [], [], []]
  state.pendingDragon = null
  state.dogNote = null
  state.lastRound = null
  state.phase = 'grandTichu'
}

/** 아직 손패가 남아 있는 좌석 */
function stillIn(state: TichuGameState, seat: number): boolean {
  return (state.hands[seat]?.length ?? 0) > 0
}

/** 마작(1)을 가진 사람이 선 */
function mahjongHolder(state: TichuGameState): number {
  for (const seat of SEATS) {
    if (state.hands[seat]?.some((c) => c.kind === 'mahjong')) return seat
  }
  return 0
}

function applyGrandTichu(state: TichuGameState, seat: number, call: boolean): void {
  if (state.phase !== 'grandTichu') err('지금은 그랜드 티츄를 선언할 때가 아닙니다.')
  if (state.grandDecided[seat]) err('이미 결정했습니다.')
  state.grandDecided[seat] = true
  if (call) state.declarations[seat] = 'grand'

  if (state.grandDecided.every(Boolean)) {
    // 나머지 6장을 마저 준다
    for (const s of SEATS) state.hands[s] = [...(state.hands[s] ?? []), ...(state.pending[s] ?? [])]
    state.pending = [[], [], [], []]
    state.phase = 'passing'
  }
}

function applyPass3(state: TichuGameState, seat: number, cardIds: [string, string, string]): void {
  if (state.phase !== 'passing') err('지금은 카드를 교환할 때가 아닙니다.')
  if (state.passSelections[seat]) err('이미 교환할 카드를 골랐습니다.')
  const hand = state.hands[seat] ?? []
  const unique = new Set(cardIds)
  if (unique.size !== 3) err('서로 다른 카드 3장을 골라야 합니다.')
  for (const id of cardIds) {
    if (!hand.some((c) => c.id === id)) err('손에 없는 카드입니다.')
  }
  state.passSelections[seat] = [...cardIds]

  if (state.passSelections.every((p) => p !== null)) exchange(state)
}

/** 3장씩 실제로 주고받는다. [0]=왼쪽, [1]=파트너, [2]=오른쪽 */
function exchange(state: TichuGameState): void {
  const outgoing = state.passSelections.map((sel, seat) => {
    const hand = state.hands[seat] ?? []
    return (sel ?? []).map((id) => {
      const card = hand.find((c) => c.id === id)
      if (!card) err('교환할 카드를 찾을 수 없습니다.')
      return card
    })
  })

  // 보낸 카드를 손에서 뺀다
  for (const seat of SEATS) {
    const ids = new Set(outgoing[seat]!.map((c) => c.id))
    state.hands[seat] = (state.hands[seat] ?? []).filter((c) => !ids.has(c.id))
  }
  // 받는다. 동시에 누가 뭘 줬는지 기록한다.
  state.received = [[], [], [], []]
  for (const seat of SEATS) {
    for (let i = 0; i < 3; i++) {
      const to = (seat + 1 + i) % 4
      const card = outgoing[seat]![i]!
      state.hands[to] = [...(state.hands[to] ?? []), card]
      state.received[to]!.push({ from: seat, card })
    }
  }

  state.passSelections = [null, null, null, null]
  state.phase = 'playing'
  state.leader = mahjongHolder(state)
  state.turn = state.leader
  state.current = null
  state.passed = [false, false, false, false]
}

function applyTichu(state: TichuGameState, seat: number): void {
  if (state.phase !== 'passing' && state.phase !== 'playing') err('지금은 티츄를 선언할 수 없습니다.')
  if (state.played[seat]) err('이미 카드를 낸 뒤에는 티츄를 선언할 수 없습니다.')
  if (state.declarations[seat] === 'grand') err('그랜드 티츄를 이미 선언했습니다.')
  if (state.declarations[seat] === 'tichu') err('이미 티츄를 선언했습니다.')
  state.declarations[seat] = 'tichu'
}

function applyWish(state: TichuGameState, seat: number, rank: number | null): void {
  // 마작을 낸 사람이 "소원 대기" 중일 때만. 그 좌석만.
  if (state.awaitingWish !== seat) err('지금은 소원을 부를 수 없습니다.')
  if (rank !== null && (rank < 2 || rank > 14)) err('소원은 2~A(14) 사이의 숫자여야 합니다.')
  state.wish = rank
  state.awaitingWish = null
  // 소원이 정해졌으니 이제 정상 진행 — 마작 리드 다음 사람으로 턴을 넘긴다
  advanceAfterPlay(state, seat)
}

/**
 * 개를 냈을 때 리드를 받을 좌석.
 *
 * 룰북: "리드는 파트너에게 넘어간다. **파트너가 이미 나갔으면 파트너의 오른쪽으로.**"
 * 그 사람도 나갔으면 계속 오른쪽으로 돈다.
 *
 * 그래서 파트너와 그 오른쪽이 모두 나간 상황(1대1 잔여 등)에서는
 * **리드가 자기 자신에게 돌아올 수 있다.** 룰대로면 개는 그냥 버리는 카드가 되고
 * 리드를 유지한다. docs/RULES.md 2.8절 참고.
 */
function dogTarget(state: TichuGameState, seat: number): number {
  const start = partnerOf(seat)
  for (let i = 0; i < 4; i++) {
    const candidate = (start + i) % 4
    if (stillIn(state, candidate)) return candidate
  }
  return seat
}

/** 다음 차례 좌석 (손패가 남아 있고 패스하지 않은 사람) */
function nextTurn(state: TichuGameState, from: number): number | null {
  for (let i = 1; i <= 4; i++) {
    const seat = (from + i) % 4
    if (!stillIn(state, seat)) continue
    if (state.passed[seat]) continue
    return seat
  }
  return null
}

/** 이 좌석이 소원을 이행할 수 있는가 (소원 숫자를 포함한 합법 조합이 있는가) */
export function mustFulfillWish(state: TichuGameState, seat: number): boolean {
  if (state.wish === null) return false
  const hand = state.hands[seat] ?? []
  if (!hand.some((c) => c.kind === 'number' && c.rank === state.wish)) return false
  return legalPlaysContainingWish(state, seat).length > 0
}

/** 소원 숫자를 포함하면서 지금 낼 수 있는 조합들 (카드 id 묶음) */
export function legalPlaysContainingWish(state: TichuGameState, seat: number): string[][] {
  const wish = state.wish
  if (wish === null) return []
  const hand = state.hands[seat] ?? []
  const wishCards = hand.filter((c) => c.kind === 'number' && c.rank === wish)
  if (wishCards.length === 0) return []

  const out: string[][] = []
  // 소원 카드를 포함하는 부분집합을 전부 훑기엔 손패가 최대 14장이라 2^14 = 16384, 충분히 빠르다
  const n = hand.length
  for (let mask = 1; mask < 1 << n; mask++) {
    const picked: TichuCard[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) picked.push(hand[i]!)
    if (!picked.some((c) => c.kind === 'number' && c.rank === wish)) continue
    const combo = parseCombo(picked)
    if (!combo) continue
    if (!canBeat(combo, state.current)) continue
    out.push(picked.map((c) => c.id))
  }
  return out
}

/** 카드를 낸(또는 소원을 정한) 뒤: 다음 사람에게 넘기거나, 아무도 안 남았으면 트릭을 닫는다 */
function advanceAfterPlay(state: TichuGameState, seat: number): void {
  const next = nextTurn(state, seat)
  if (next === null || next === seat) beginClose(state, seat)
  else state.turn = next
}

/**
 * 트릭을 바로 닫지 않고 **폭탄 창구**를 연다.
 * 트릭은 테이블에 그대로 두고, 서버가 잠깐 뒤 collectTrick 으로 마감한다.
 * 이미 라운드가 끝났으면(3명 아웃 등) 창구 없이 바로 마감한다.
 */
function beginClose(state: TichuGameState, winner: number): void {
  if (isRoundOver(state)) {
    finishTrick(state, winner)
    return
  }
  state.pendingClose = { winner }
}

/** 폭탄 창구가 끝났다 — 트릭을 실제로 걷어간다 */
function applyCollect(state: TichuGameState): void {
  const pc = state.pendingClose
  if (!pc) err('걷어갈 트릭이 없습니다.')
  state.pendingClose = null
  state.bombClaim = null
  finishTrick(state, pc.winner)
}

/** 폭탄 창구에서 "폭탄 내기"를 예약한다 — 진행이 멈추고 그 좌석에게 제출 시간을 준다 */
function applyClaimBomb(state: TichuGameState, seat: number): void {
  if (state.pendingClose === null) err('지금은 폭탄을 예약할 수 없습니다.')
  if (state.bombClaim !== null) err('이미 다른 사람이 폭탄을 예약했습니다.')
  // 이미 손패를 다 낸(골인한) 사람은 폭탄이 없으므로 예약할 수 없다
  if (!stillIn(state, seat)) err('이미 손패를 다 냈습니다.')
  state.bombClaim = seat
}

/** 폭탄 예약 취소(또는 시간초과) — 트릭을 걷어가고 진행한다 */
function applyCancelBomb(state: TichuGameState, seat: number): void {
  if (state.bombClaim === null) err('예약된 폭탄이 없습니다.')
  if (state.bombClaim !== seat) err('폭탄을 예약한 사람만 취소할 수 있습니다.')
  state.bombClaim = null
  const pc = state.pendingClose
  if (pc) {
    state.pendingClose = null
    finishTrick(state, pc.winner)
  }
}

function applyPlay(
  state: TichuGameState,
  seat: number,
  cardIds: string[],
  parseOpts: ParseOptions,
): void {
  if (state.phase !== 'playing') err('지금은 카드를 낼 때가 아닙니다.')
  if (state.awaitingWish !== null) err('마작 소원을 정하는 중입니다. 잠시만 기다려주세요.')
  // 누군가 폭탄을 예약했으면 그 사람만 낼 수 있다 (다른 사람은 대기)
  if (state.bombClaim !== null && state.bombClaim !== seat) err('폭탄 낼 사람을 기다리는 중입니다.')
  if (!stillIn(state, seat)) err('이미 손패를 다 냈습니다.')

  const hand = state.hands[seat] ?? []
  const cards: TichuCard[] = []
  for (const id of cardIds) {
    const card = hand.find((c) => c.id === id)
    if (!card) err('손에 없는 카드입니다.')
    if (cards.some((c) => c.id === id)) err('같은 카드를 두 번 낼 수 없습니다.')
    cards.push(card)
  }

  // 봉황을 단독으로 낼 때는 값이 테이블에서 정해진다 (직전 카드 + 0.5)
  const combo = parseAgainst(cards, state.current, parseOpts)
  if (!combo) err('유효한 조합이 아닙니다.')

  const isBomb = combo.isBomb
  const myTurn = state.turn === seat
  // 폭탄 창구가 열린 동안에는 **폭탄만** 받는다 (일반 카드·패스는 창구가 끝난 뒤)
  if (state.pendingClose !== null && !isBomb) err('지금은 폭탄만 낼 수 있습니다.')
  if (!myTurn) {
    if (!isBomb) err('당신 차례가 아닙니다.')
    if (!state.opts.allowBombInterrupt) err('이 방에서는 턴이 아닐 때 폭탄을 낼 수 없습니다.')
    if (state.current?.type === 'dog') err('개는 폭탄으로 잡을 수 없습니다.')
  }

  if (!canBeat(combo, state.current)) err('테이블 위 조합을 이길 수 없습니다.')

  // 폭탄이 들어왔으면 닫히려던 창구·예약을 모두 풀고 판이 다시 굴러간다
  if (state.pendingClose !== null) state.pendingClose = null
  state.bombClaim = null

  // 소원 이행 강제 — 폭탄을 자기 턴이 아닐 때 던지는 경우는 예외
  if (state.wish !== null && myTurn) {
    const usesWish = cards.some((c) => c.kind === 'number' && c.rank === state.wish)
    if (!usesWish && mustFulfillWish(state, seat)) {
      err(`마작 소원(${state.wish})을 낼 수 있으면 반드시 내야 합니다.`)
    }
    if (usesWish) state.wish = null
  }

  // 손에서 제거
  const ids = new Set(cardIds)
  state.hands[seat] = hand.filter((c) => !ids.has(c.id))
  state.played[seat] = true

  // 개는 트릭을 만들지 않고 파트너에게 리드를 넘긴다
  if (combo.type === 'dog') {
    const to = dogTarget(state, seat)
    state.dogNote = { seat, card: cards[0]! }
    state.trick = []
    state.current = null
    state.passed = [false, false, false, false]
    state.trickAction = [null, null, null, null]
    state.leader = to
    state.turn = to
    state.won[seat] = state.won[seat] ?? []
    checkFinished(state, seat)
    return
  }

  state.trick.push({ seat, combo })
  state.current = combo
  state.trickAction[seat] = 'play'
  // 폭탄이 터지면 패스했던 사람도 다시 낼 기회가 생긴다.
  // (trickAction은 그대로 둔다 — 패스한 사람은 실제로 낼 때까지 계속 덮인 상태로 보인다)
  state.passed = [false, false, false, false]

  checkFinished(state, seat)

  // 3명이 나갔거나 원투 피니시가 나오면 **그 자리에서 라운드가 끝난다.**
  // 남은 한 명이 패스할 때까지 기다릴 이유가 없다.
  if (isRoundOver(state)) {
    finishTrick(state, seat)
    return
  }

  // 마작을 냈으면 소원을 정할 때까지 대기 — 다른 사람은 아무도 행동 못 한다
  if (cards.some((c) => c.kind === 'mahjong')) {
    state.awaitingWish = seat
    return
  }

  advanceAfterPlay(state, seat)
}

function applyPass(state: TichuGameState, seat: number): void {
  if (state.phase !== 'playing') err('지금은 패스할 수 없습니다.')
  if (state.awaitingWish !== null) err('마작 소원을 정하는 중입니다. 잠시만 기다려주세요.')
  if (state.pendingClose !== null) err('지금은 폭탄만 낼 수 있습니다.')
  if (state.turn !== seat) err('당신 차례가 아닙니다.')
  if (state.current === null) err('리드할 때는 패스할 수 없습니다. 카드를 내야 합니다.')
  if (mustFulfillWish(state, seat)) err(`마작 소원(${state.wish})을 낼 수 있으면 반드시 내야 합니다.`)

  state.passed[seat] = true
  state.trickAction[seat] = 'pass'
  const next = nextTurn(state, seat)
  const winner = state.trick[state.trick.length - 1]?.seat
  if (next === null || next === winner) {
    if (winner === undefined) err('트릭에 아무도 내지 않았습니다.')
    // 바로 닫지 않고 폭탄 창구를 연다 (마지막 패스 후, 카드를 걷기 전)
    beginClose(state, winner)
  } else {
    state.turn = next
  }
}

/** 트릭 종료 — 딴 카드를 옮기고 다음 리드를 정한다 */
function finishTrick(state: TichuGameState, winner: number): void {
  const cards = state.trick.flatMap((p) => p.combo.cards)
  const hasDragon = cards.some((c) => c.kind === 'dragon')
  const wonByDragon = state.current?.cards.some((c) => c.kind === 'dragon') ?? false

  state.trick = []
  state.current = null
  state.passed = [false, false, false, false]
  state.trickAction = [null, null, null, null]
  state.dogNote = null

  if (hasDragon && wonByDragon) {
    // 용으로 이기면 트릭 전체를 상대팀 한 명에게 넘겨야 한다
    state.pendingDragon = { winner, cards }
    state.phase = 'dragonGift'
    return
  }

  state.won[winner] = [...(state.won[winner] ?? []), ...cards]
  setLeadAfterTrick(state, winner)
}

function setLeadAfterTrick(state: TichuGameState, winner: number): void {
  if (isRoundOver(state)) {
    finishRound(state)
    return
  }
  const lead = stillIn(state, winner) ? winner : (nextTurn(state, winner) ?? winner)
  state.leader = lead
  state.turn = lead
}

function applyGiveDragon(state: TichuGameState, seat: number, to: number): void {
  if (state.phase !== 'dragonGift') err('지금은 용을 넘길 때가 아닙니다.')
  const pending = state.pendingDragon
  if (!pending) err('넘길 트릭이 없습니다.')
  if (pending.winner !== seat) err('용을 낸 사람만 고를 수 있습니다.')
  if (teamOf(to) === teamOf(seat)) err('용은 상대팀에게 줘야 합니다.')

  state.won[to] = [...(state.won[to] ?? []), ...pending.cards]
  state.pendingDragon = null
  state.phase = 'playing'
  // 트릭은 넘겼지만 다음 리드는 용을 낸 사람이 가진다
  setLeadAfterTrick(state, seat)
}

function checkFinished(state: TichuGameState, seat: number): void {
  if (stillIn(state, seat)) return
  if (state.finishOrder.includes(seat)) return
  state.finishOrder.push(seat)
}

/** 라운드가 끝났는가 — 원투 피니시거나 3명이 털었으면 */
function isRoundOver(state: TichuGameState): boolean {
  const done = state.finishOrder
  if (done.length >= 3) return true
  if (done.length === 2) {
    const [a, b] = done as [number, number]
    if (teamOf(a) === teamOf(b)) return true // 원투 피니시
  }
  return false
}

function finishRound(state: TichuGameState): void {
  const done = state.finishOrder
  const first = done[0]!
  const doubleWin =
    done.length >= 2 && teamOf(done[0]!) === teamOf(done[1]!) ? teamOf(done[0]!) : null

  const cardPointsByTeam: [number, number] = [0, 0]

  if (doubleWin === null) {
    // 마지막 사람: 남은 손패는 상대팀에게, 따놓은 트릭은 1등에게
    const last = SEATS.find((s) => !done.includes(s))
    if (last !== undefined) {
      const opponentTeam = teamOf(last) === 0 ? 1 : 0
      cardPointsByTeam[opponentTeam] += handPoints(state.hands[last] ?? [])
      state.won[first] = [...(state.won[first] ?? []), ...(state.won[last] ?? [])]
      state.won[last] = []
      state.hands[last] = []
    }
    for (const seat of SEATS) {
      cardPointsByTeam[teamOf(seat)] += handPoints(state.won[seat] ?? [])
    }
  }

  // 선언 정산
  const declarationPoints: [number, number] = [0, 0]
  const declarations = SEATS.map((seat) => {
    const d = state.declarations[seat] ?? 'none'
    const success = d !== 'none' && first === seat
    if (d === 'tichu') declarationPoints[teamOf(seat)] += success ? 100 : -100
    if (d === 'grand') declarationPoints[teamOf(seat)] += success ? 200 : -200
    return { seat, declaration: d, success }
  })

  const total: [number, number] = doubleWin === null
    ? [cardPointsByTeam[0] + declarationPoints[0], cardPointsByTeam[1] + declarationPoints[1]]
    : [
        (doubleWin === 0 ? 200 : 0) + declarationPoints[0],
        (doubleWin === 1 ? 200 : 0) + declarationPoints[1],
      ]

  const score: RoundScore = {
    cardPoints: doubleWin === null ? cardPointsByTeam : [0, 0],
    declarationPoints,
    doubleWin,
    total,
    declarations,
  }

  state.totals = [state.totals[0] + total[0], state.totals[1] + total[1]]
  state.history.push(score)
  state.lastRound = score
  state.phase = 'roundEnd'
}

function applyAdvance(state: TichuGameState, rng: Rng): void {
  if (state.phase !== 'roundEnd') err('지금은 넘어갈 단계가 아닙니다.')
  const [a, b] = state.totals
  if ((a >= state.opts.targetScore || b >= state.opts.targetScore) && a !== b) {
    state.phase = 'gameEnd'
    return
  }
  state.round += 1
  startRound(state, rng)
}

export function reduce(state: TichuGameState, action: TichuAction, rng: Rng): TichuGameState {
  const next = clone(state)
  switch (action.type) {
    case 'grandTichu':
      applyGrandTichu(next, action.seat, action.call)
      break
    case 'pass3':
      applyPass3(next, action.seat, action.cardIds)
      break
    case 'tichu':
      applyTichu(next, action.seat)
      break
    case 'play': {
      const opts: ParseOptions = {}
      if (action.phoenixAs !== undefined) opts.phoenixAs = action.phoenixAs
      if (action.asBomb !== undefined) opts.asBomb = action.asBomb
      applyPlay(next, action.seat, action.cardIds, opts)
      break
    }
    case 'pass':
      applyPass(next, action.seat)
      break
    case 'wish':
      applyWish(next, action.seat, action.rank)
      break
    case 'giveDragon':
      applyGiveDragon(next, action.seat, action.to)
      break
    case 'collectTrick':
      applyCollect(next)
      break
    case 'claimBomb':
      applyClaimBomb(next, action.seat)
      break
    case 'cancelBomb':
      applyCancelBomb(next, action.seat)
      break
    case 'advance':
      applyAdvance(next, rng)
      break
  }
  return next
}

function clone(s: TichuGameState): TichuGameState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    dealt: s.dealt.map((h) => [...h]),
    pending: s.pending.map((h) => [...h]),
    declarations: [...s.declarations],
    grandDecided: [...s.grandDecided],
    passSelections: s.passSelections.map((p) => (p ? [...p] : null)),
    played: [...s.played],
    received: s.received.map((r) => r.map((x) => ({ ...x }))),
    trick: [...s.trick],
    passed: [...s.passed],
    trickAction: [...s.trickAction],
    finishOrder: [...s.finishOrder],
    won: s.won.map((w) => [...w]),
    pendingDragon: s.pendingDragon ? { ...s.pendingDragon, cards: [...s.pendingDragon.cards] } : null,
    pendingClose: s.pendingClose ? { ...s.pendingClose } : null,
    dogNote: s.dogNote ? { ...s.dogNote } : null,
    totals: [...s.totals] as [number, number],
    history: [...s.history],
  }
}

/** 지금 행동해야 하는 좌석들 */
export function waitingSeats(state: TichuGameState): number[] {
  switch (state.phase) {
    case 'grandTichu':
      return SEATS.filter((s) => !state.grandDecided[s])
    case 'passing':
      return SEATS.filter((s) => state.passSelections[s] === null)
    case 'playing':
      // 소원 대기 → 그 사람 / 폭탄 예약 → 예약자 / 폭탄 창구 → 특정 턴 없음(타이머가 마감)
      if (state.awaitingWish !== null) return [state.awaitingWish]
      if (state.bombClaim !== null) return [state.bombClaim]
      if (state.pendingClose !== null) return []
      return [state.turn]
    case 'dragonGift':
      return state.pendingDragon ? [state.pendingDragon.winner] : []
    default:
      return []
  }
}

export { cardPoints, handPoints }
