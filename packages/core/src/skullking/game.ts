import { deal, shuffle, type Rng } from '../common/rng.js'
import { buildDeck } from './deck.js'
import { DEFAULT_SK_OPTIONS, optionsForPlayerCount, type SkRuleOptions } from './options.js'
import { scoreRound, type SeatRoundScore } from './scoring.js'
import { legalPlays, resolveTrick } from './trick.js'
import type { SkCard, SkPlay, TigressAs, TrickOutcome } from './types.js'
import {
  GHOST_SEAT,
  dealerForRound,
  hasGhost,
  roundFirstLeader,
  trickOrderFor,
} from './turnorder.js'

/**
 * 스컬킹 게임 진행 상태머신.
 *
 * 순수 함수로 유지한다 — 같은 상태 + 같은 액션이면 항상 같은 결과.
 * 서버가 이 상태의 유일한 주인이고, 클라이언트에는 `viewFor`로 가린 뷰만 보낸다.
 */

export type SkPhase = 'bidding' | 'playing' | 'trickEnd' | 'roundEnd' | 'gameEnd'

export interface SkGameState {
  humanCount: number
  opts: SkRuleOptions
  initialDealer: number
  /** 0부터 */
  roundIndex: number
  phase: SkPhase
  /** 좌석별 손패. 2인 변형에서는 GHOST_SEAT(2)에 유령 손패가 들어간다. */
  hands: SkCard[][]
  /** 이번 라운드에 돌리지 않은 카드 (후아니타 능력이 볼 것) */
  undealt: SkCard[]
  bids: Array<number | null>
  leader: number
  lastHumanLeader: number
  /** 이번 트릭의 플레이 순서 (좌석 번호 배열) */
  order: number[]
  /** order 안에서 지금 누구 차례인지 */
  turn: number
  trick: SkPlay[]
  /** 이번 라운드에 끝난 트릭들 */
  tricks: TrickOutcome[]
  /** 방금 끝난 트릭 (trickEnd 단계에서 보여주려고) */
  lastTrick: { plays: SkPlay[]; outcome: TrickOutcome } | null
  /** 방금 끝난 라운드 점수 (roundEnd 단계에서 보여주려고) */
  lastRoundScores: SeatRoundScore[] | null
  /** 누적 점수 */
  totals: number[]
  history: SeatRoundScore[][]
}

export type SkAction =
  | { type: 'bid'; seat: number; value: number }
  | { type: 'play'; seat: number; cardId: string; tigressAs?: TigressAs }
  /** trickEnd / roundEnd에서 다음으로 넘어간다 (서버가 타이머로 호출) */
  | { type: 'advance' }

export class SkRuleError extends Error {}

function err(message: string): never {
  throw new SkRuleError(message)
}

/** 이번 라운드에 몇 장 돌리나 */
export function cardCountFor(state: SkGameState): number {
  return state.opts.roundCardCounts[state.roundIndex] ?? 1
}

export function totalRounds(opts: SkRuleOptions): number {
  return opts.roundCardCounts.length
}

/** 좌석 수 (유령 포함). 손패 배열 길이. */
function seatSlots(humanCount: number, opts: SkRuleOptions): number {
  return hasGhost(opts, humanCount) ? GHOST_SEAT + 1 : humanCount
}

export function createGame(
  humanCount: number,
  rawOpts: SkRuleOptions = DEFAULT_SK_OPTIONS,
  initialDealer = 0,
  rng?: Rng,
): SkGameState {
  if (humanCount < 2) err('스컬킹은 최소 2명이 필요합니다.')
  const opts = optionsForPlayerCount(rawOpts, humanCount)
  const slots = seatSlots(humanCount, opts)

  const state: SkGameState = {
    humanCount,
    opts,
    initialDealer: initialDealer % humanCount,
    roundIndex: 0,
    phase: 'bidding',
    hands: Array.from({ length: slots }, () => []),
    undealt: [],
    bids: new Array<number | null>(humanCount).fill(null),
    leader: 0,
    lastHumanLeader: 0,
    order: [],
    turn: 0,
    trick: [],
    tricks: [],
    lastTrick: null,
    lastRoundScores: null,
    totals: new Array<number>(humanCount).fill(0),
    history: [],
  }
  if (rng) startRound(state, rng)
  return state
}

/** 라운드 시작 — 카드를 돌리고 입찰 단계로 */
export function startRound(state: SkGameState, rng: Rng): void {
  const opts = state.opts
  const count = cardCountFor(state)
  const slots = seatSlots(state.humanCount, opts)

  const deck = shuffle(buildDeck(opts), rng)
  const { hands, rest } = deal(deck, slots, count)

  state.hands = hands
  state.undealt = rest
  state.bids = new Array<number | null>(state.humanCount).fill(null)
  state.phase = 'bidding'
  state.trick = []
  state.tricks = []
  state.lastTrick = null
  state.lastRoundScores = null

  const dealer = dealerForRound(state.initialDealer, state.roundIndex, state.humanCount)
  state.leader = roundFirstLeader(dealer, state.humanCount)
  state.lastHumanLeader = state.leader
  state.order = trickOrderFor(opts, state.humanCount, state.leader, state.lastHumanLeader)
  state.turn = 0
}

/** 지금 카드를 내야 하는 좌석. 입찰 단계나 트릭이 끝났으면 null. */
export function currentSeat(state: SkGameState): number | null {
  if (state.phase !== 'playing') return null
  return state.order[state.turn] ?? null
}

/** 이 좌석이 지금 낼 수 있는 카드들 */
export function legalFor(state: SkGameState, seat: number): SkCard[] {
  if (currentSeat(state) !== seat) return []
  return legalPlays(state.hands[seat] ?? [], state.trick)
}

function applyBid(state: SkGameState, seat: number, value: number): void {
  if (state.phase !== 'bidding') err('지금은 입찰할 때가 아닙니다.')
  if (seat < 0 || seat >= state.humanCount) err('없는 좌석입니다.')
  const max = cardCountFor(state)
  if (!Number.isInteger(value) || value < 0 || value > max) {
    err(`입찰은 0 ~ ${max} 사이여야 합니다.`)
  }
  state.bids[seat] = value

  // 전원 입찰이 끝나면 플레이 시작
  if (state.bids.every((b) => b !== null)) {
    state.phase = 'playing'
    autoPlayGhost(state)
  }
}

/** 유령 차례면 손패 맨 위를 그냥 뒤집어 낸다. 선택 없음. */
function autoPlayGhost(state: SkGameState): void {
  // **2인 유령 변형일 때만 대신 둔다.**
  // 이 가드가 없으면 3인 이상 게임에서 좌석 2(GHOST_SEAT)에 앉은 진짜 사람의
  // 카드를 유령으로 착각해 저절로 내버린다 — "3번째 사람 패가 자동으로 나가는" 버그.
  if (!hasGhost(state.opts, state.humanCount)) return
  while (state.phase === 'playing' && currentSeat(state) === GHOST_SEAT) {
    const hand = state.hands[GHOST_SEAT] ?? []
    const card = hand.shift()
    if (!card) err('유령 손패가 비었습니다.')
    // 유령의 티그리스는 항상 도주 → tigressAs를 붙이지 않는다
    pushPlay(state, { seat: GHOST_SEAT, card })
  }
}

function pushPlay(state: SkGameState, play: SkPlay): void {
  state.trick.push(play)
  state.turn += 1
  if (state.turn >= state.order.length) finishTrick(state)
}

function applyPlay(state: SkGameState, seat: number, cardId: string, tigressAs?: TigressAs): void {
  if (state.phase !== 'playing') err('지금은 카드를 낼 때가 아닙니다.')
  if (currentSeat(state) !== seat) err('당신 차례가 아닙니다.')

  const hand = state.hands[seat] ?? []
  const idx = hand.findIndex((c) => c.id === cardId)
  if (idx < 0) err('손에 없는 카드입니다.')
  const card = hand[idx]!

  const legal = legalPlays(hand, state.trick)
  if (!legal.some((c) => c.id === cardId)) err('지금 낼 수 없는 카드입니다. (같은 색을 따라야 합니다)')
  if (card.kind === 'tigress' && tigressAs !== 'pirate' && tigressAs !== 'escape') {
    err('티그리스는 해적/도주 중 하나를 선언해야 합니다.')
  }

  hand.splice(idx, 1)
  pushPlay(state, tigressAs ? { seat, card, tigressAs } : { seat, card })
  // 사람이 낸 다음 차례가 유령이면 바로 뒤집어 낸다.
  // 이걸 빼먹으면 2인 게임이 유령 차례에서 영원히 멈춘다.
  autoPlayGhost(state)
}

function finishTrick(state: SkGameState): void {
  const outcome = resolveTrick(state.trick, state.opts)
  state.tricks.push(outcome)
  state.lastTrick = { plays: [...state.trick], outcome }
  state.phase = 'trickEnd'
}

/** trickEnd / roundEnd에서 다음 단계로 */
function applyAdvance(state: SkGameState, rng: Rng): void {
  if (state.phase === 'trickEnd') {
    const outcome = state.lastTrick?.outcome
    if (!outcome) err('넘어갈 트릭이 없습니다.')

    const handsEmpty = state.hands.every((h) => h.length === 0)
    state.trick = []
    state.leader = outcome.nextLeader
    if (state.leader !== GHOST_SEAT) state.lastHumanLeader = state.leader

    if (handsEmpty) {
      finishRound(state)
      return
    }
    state.order = trickOrderFor(state.opts, state.humanCount, state.leader, state.lastHumanLeader)
    state.turn = 0
    state.phase = 'playing'
    autoPlayGhost(state)
    return
  }

  if (state.phase === 'roundEnd') {
    state.roundIndex += 1
    if (state.roundIndex >= totalRounds(state.opts)) {
      state.phase = 'gameEnd'
      return
    }
    startRound(state, rng)
    return
  }

  err('지금은 넘어갈 단계가 아닙니다.')
}

function finishRound(state: SkGameState): void {
  const bids = state.bids.map((b) => b ?? 0)
  const scores = scoreRound(
    { cardCount: cardCountFor(state), bids, tricks: state.tricks },
    state.opts,
  )
  scores.forEach((s) => {
    state.totals[s.seat] = (state.totals[s.seat] ?? 0) + s.total
  })
  state.history.push(scores)
  state.lastRoundScores = scores
  state.phase = 'roundEnd'
}

/**
 * 액션 적용. 상태를 직접 수정하지 않고 복사본을 돌려준다.
 * rng는 다음 라운드 카드를 돌릴 때만 쓰인다.
 */
export function reduce(state: SkGameState, action: SkAction, rng: Rng): SkGameState {
  const next = cloneState(state)
  switch (action.type) {
    case 'bid':
      applyBid(next, action.seat, action.value)
      break
    case 'play':
      applyPlay(next, action.seat, action.cardId, action.tigressAs)
      break
    case 'advance':
      applyAdvance(next, rng)
      break
  }
  return next
}

function cloneState(s: SkGameState): SkGameState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    undealt: [...s.undealt],
    bids: [...s.bids],
    order: [...s.order],
    trick: [...s.trick],
    tricks: [...s.tricks],
    lastTrick: s.lastTrick ? { plays: [...s.lastTrick.plays], outcome: s.lastTrick.outcome } : null,
    lastRoundScores: s.lastRoundScores ? [...s.lastRoundScores] : null,
    totals: [...s.totals],
    history: s.history.map((h) => [...h]),
  }
}

export function isGhostSeat(state: SkGameState, seat: number): boolean {
  return hasGhost(state.opts, state.humanCount) && seat === GHOST_SEAT
}
