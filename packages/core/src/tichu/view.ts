import type { RoundScore, TichuGameState, TichuPhase, TichuPlay } from './game.js'
import { waitingSeats } from './game.js'
import { handPoints } from './deck.js'
import { teamOf, type Combo, type Declaration, type TichuCard } from './types.js'

/**
 * 한 플레이어에게 보내는 티츄 뷰.
 * **남의 손패는 장수만** 넣는다. 카드 자체는 절대 넣지 않는다.
 */
export interface TichuSeatInfo {
  seat: number
  team: 0 | 1
  /** 남은 손패 장수 */
  cards: number
  declaration: Declaration
  /** 이번 트릭에 낸 조합. 아직 안 냈으면 null */
  played: Combo | null
  /** 이번 트릭에서 패스했는지 — 화면에는 카드 뒷면으로 보여준다 */
  passed: boolean
  /** 지금 테이블을 잡고 있는 사람인지 */
  leading: boolean
  /** 손패를 다 털었으면 몇 번째로 끝났는지 (1부터). 아직이면 null */
  finished: number | null
}

export interface TichuPlayerView {
  seat: number
  team: 0 | 1
  phase: TichuPhase
  round: number
  targetScore: number

  /** 내 손패 (나만 받는다) */
  hand: TichuCard[]
  /** 좌석별 현황 — 화면 한 줄씩 그리는 데 쓴다 */
  seats: TichuSeatInfo[]
  /** 지금 행동해야 하는 좌석들 */
  waitingFor: number[]
  turn: number
  /** 테이블 위 조합 (이걸 이겨야 낸다) */
  current: Combo | null
  /** 지금 트릭에 깔린 것들 (순서대로) */
  trick: TichuPlay[]
  /** 마작 소원. 아직 이행 안 됨 */
  wish: number | null

  /** 그랜드 티츄 단계 — 내가 결정했는지 */
  grandDecided: boolean
  /** 교환 단계 — 내가 3장을 냈는지 */
  passSubmitted: boolean
  /** 아직 티츄를 선언할 수 있는지 (첫 카드 내기 전) */
  canCallTichu: boolean
  /** 용을 넘겨야 하는 상황이면 넘길 후보(상대팀 좌석) */
  dragonTargets: number[]

  /** 팀 누적 점수 */
  totals: [number, number]
  /** 내가 이번 라운드에 딴 카드 점수 (참고용) */
  myWonPoints: number
  lastRound: RoundScore | null
}

export function viewFor(state: TichuGameState, seat: number): TichuPlayerView {
  const lastPlayBySeat = new Map<number, Combo>()
  for (const p of state.trick) lastPlayBySeat.set(p.seat, p.combo)
  const leadingSeat = state.trick[state.trick.length - 1]?.seat ?? null

  const seats: TichuSeatInfo[] = [0, 1, 2, 3].map((s) => {
    const finishedIdx = state.finishOrder.indexOf(s)
    return {
      seat: s,
      team: teamOf(s),
      cards: state.hands[s]?.length ?? 0,
      declaration: state.declarations[s] ?? 'none',
      played: lastPlayBySeat.get(s) ?? null,
      passed: state.passed[s] ?? false,
      leading: leadingSeat === s,
      finished: finishedIdx >= 0 ? finishedIdx + 1 : null,
    }
  })

  const dragonTargets =
    state.phase === 'dragonGift' && state.pendingDragon?.winner === seat
      ? [0, 1, 2, 3].filter((s) => teamOf(s) !== teamOf(seat))
      : []

  return {
    seat,
    team: teamOf(seat),
    phase: state.phase,
    round: state.round,
    targetScore: state.opts.targetScore,
    hand: [...(state.hands[seat] ?? [])],
    seats,
    waitingFor: waitingSeats(state),
    turn: state.turn,
    current: state.current,
    trick: [...state.trick],
    wish: state.wish,
    grandDecided: state.grandDecided[seat] ?? false,
    passSubmitted: state.passSelections[seat] !== null,
    canCallTichu:
      !state.played[seat] &&
      state.declarations[seat] === 'none' &&
      (state.phase === 'passing' || state.phase === 'playing'),
    dragonTargets,
    totals: [...state.totals] as [number, number],
    myWonPoints: handPoints(state.won[seat] ?? []),
    lastRound: state.lastRound,
  }
}
