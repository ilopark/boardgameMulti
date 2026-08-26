import { useEffect, useMemo, useState } from 'react'
import { TURN_POLICY, type RoomPublic, type skullking } from '@bg/core'
import { request } from '../socket.js'
import Card from './Card.js'
import Countdown from './Countdown.js'

type View = skullking.SkPlayerView
type SkCard = skullking.SkCard

const GHOST_SEAT = 2

const LEAD_LABEL: Record<string, string> = {
  green: '앵무새(초록)',
  yellow: '보물상자(노랑)',
  purple: '지도(보라)',
  black: '졸리로저(검정)',
}

interface Props {
  room: RoomPublic
  view: View
  remainingMs: number | null
  seq: number
  waitingFor: number[]
  isHost: boolean
  onError: (message: string) => void
}

export default function GameView({ room, view, remainingMs, waitingFor, seq, isHost, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const [tigressPick, setTigressPick] = useState<SkCard | null>(null)

  useEffect(() => {
    setTigressPick(null)
  }, [view.phase, view.trick.length])

  const nameOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of room.players) if (p.seat !== null) map.set(p.seat, p.nickname)
    return (seat: number) =>
      seat === GHOST_SEAT && view.hasGhost ? '유령' : (map.get(seat) ?? `${seat + 1}번`)
  }, [room.players, view.hasGhost])

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      onError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const myTurn = view.currentSeat === view.seat
  const myBidPending = view.phase === 'bidding' && view.myBid === null
  const legal = new Set(view.legal)

  const playCard = (card: SkCard) => {
    if (card.kind === 'tigress') {
      setTigressPick(card)
      return
    }
    void run(() => request('game:play', { cardId: card.id }))
  }

  const totalMs =
    view.phase === 'bidding'
      ? TURN_POLICY.bidMs
      : view.phase === 'playing'
        ? TURN_POLICY.playMs
        : view.phase === 'trickEnd'
          ? TURN_POLICY.trickEndMs
          : TURN_POLICY.roundEndMs

  return (
    <div className="game">
      <TopBar view={view} />

      <TurnBanner
        view={view}
        myTurn={myTurn}
        myBidPending={myBidPending}
        waitingFor={waitingFor}
        nameOf={nameOf}
        remainingMs={remainingMs}
        totalMs={totalMs}
        seq={seq}
      />

      <PlayerBoard room={room} view={view} nameOf={nameOf} waitingFor={waitingFor} />

      {view.phase === 'bidding' && <Bidding view={view} busy={busy} run={run} />}

      {(view.phase === 'playing' || view.phase === 'trickEnd') && (
        <TrickArea view={view} nameOf={nameOf} />
      )}

      {view.phase === 'roundEnd' && <RoundResult view={view} nameOf={nameOf} />}
      {view.phase === 'gameEnd' && <GameEnd view={view} nameOf={nameOf} />}

      {view.phase !== 'gameEnd' && (
        <Hand
          view={view}
          myTurn={myTurn}
          legal={legal}
          busy={busy}
          onPlay={playCard}
        />
      )}

      {tigressPick && (
        <TigressModal
          busy={busy}
          onPick={(as) =>
            void run(() => request('game:play', { cardId: tigressPick.id, tigressAs: as })).then(() =>
              setTigressPick(null),
            )
          }
          onCancel={() => setTigressPick(null)}
        />
      )}

      {isHost && (
        <section className="panel panel--quiet">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void run(() => request('game:abort', {}))}
          >
            게임 끝내고 대기실로
          </button>
        </section>
      )}
    </div>
  )
}

function TopBar({ view }: { view: View }) {
  const won = view.tricksWon[view.seat] ?? 0
  return (
    <section className="topinfo">
      <div className="topinfo__round">
        <strong>라운드 {view.round}</strong>
        <span>/{view.totalRounds}</span>
        <em>{view.cardCount}장</em>
      </div>
      {view.myBid !== null && (
        <div className="topinfo__mine">
          <span className="bigstat">
            <em>내 입찰</em>
            <b>{view.myBid}</b>
          </span>
          <span className="bigstat__sep">/</span>
          <span className={won === view.myBid ? 'bigstat bigstat--ok' : 'bigstat'}>
            <em>획득</em>
            <b>{won}</b>
          </span>
        </div>
      )}
    </section>
  )
}

function TurnBanner({
  view,
  myTurn,
  myBidPending,
  waitingFor,
  nameOf,
  remainingMs,
  totalMs,
  seq,
}: {
  view: View
  myTurn: boolean
  myBidPending: boolean
  waitingFor: number[]
  nameOf: (seat: number) => string
  remainingMs: number | null
  totalMs: number
  seq: number
}) {
  let tone: 'me' | 'wait' | 'info' = 'info'
  let title = ''
  let sub = ''

  if (view.phase === 'bidding') {
    if (myBidPending) {
      tone = 'me'
      title = '몇 트릭 먹을지 고르세요'
      sub = '아래에서 숫자를 누르면 확정됩니다'
    } else {
      tone = 'wait'
      title = '다른 사람 입찰을 기다리는 중'
      sub = waitingFor.map(nameOf).join(', ')
    }
  } else if (view.phase === 'playing') {
    if (myTurn) {
      tone = 'me'
      title = '내 차례입니다'
      sub = '아래 손패에서 카드를 고르세요'
    } else {
      tone = 'wait'
      title = `${nameOf(view.currentSeat ?? -1)} 차례`
      sub = '기다리는 중…'
    }
  } else if (view.phase === 'trickEnd') {
    title = '트릭 종료'
    sub = '곧 다음 트릭으로 넘어갑니다'
  } else if (view.phase === 'roundEnd') {
    title = `라운드 ${view.round} 종료`
    sub = '곧 다음 라운드가 시작됩니다'
  } else {
    title = '게임 종료'
  }

  return (
    <section className={`turnbanner turnbanner--${tone}`}>
      <div className="turnbanner__text">
        <strong>{title}</strong>
        {sub && <span>{sub}</span>}
      </div>
      <Countdown remainingMs={remainingMs} totalMs={totalMs} seq={seq} />
    </section>
  )
}

function PlayerBoard({
  room,
  view,
  nameOf,
  waitingFor,
}: {
  room: RoomPublic
  view: View
  nameOf: (seat: number) => string
  waitingFor: number[]
}) {
  const connected = new Map(
    room.players.filter((p) => p.seat !== null).map((p) => [p.seat!, p.connected]),
  )
  const seats = Array.from({ length: view.humanCount }, (_, i) => i)
  const waiting = new Set(waitingFor)

  return (
    <section className="board">
      {seats.map((seat) => {
        const isMe = seat === view.seat
        const isTurn = view.currentSeat === seat || (view.phase === 'bidding' && waiting.has(seat))
        const bid = view.bids[seat]
        const placed = view.bidPlaced[seat]
        const won = view.tricksWon[seat] ?? 0
        const met = bid !== null && won === bid

        const bidText = view.bidsRevealed ? (bid ?? '—') : placed ? (isMe ? bid : '✓') : '…'

        return (
          <div
            key={seat}
            className={['seatcard', isMe ? 'is-me' : '', isTurn ? 'is-turn' : ''].filter(Boolean).join(' ')}
          >
            <div className="seatcard__head">
              <span className="seatcard__name">{nameOf(seat)}</span>
              <span className="seatcard__flags">
                {view.dealer === seat && <em className="flagchip">딜러</em>}
                {connected.get(seat) === false && <em className="flagchip flagchip--warn">끊김</em>}
              </span>
            </div>
            <div className={met && view.bidsRevealed ? 'tally tally--ok' : 'tally'}>
              <span className="tally__won">{won}</span>
              <span className="tally__slash">/</span>
              <span className="tally__bid">{bidText}</span>
            </div>
            <div className="seatcard__foot">
              <span className="seatcard__label">획득 / 입찰</span>
              <span className="seatcard__total">{view.totals[seat] ?? 0}점</span>
            </div>
          </div>
        )
      })}
      {view.hasGhost && (
        <div className="seatcard seatcard--ghost">
          <div className="seatcard__head">
            <span className="seatcard__name">유령</span>
          </div>
          <div className="tally">
            <span className="tally__won">{view.handCounts[GHOST_SEAT] ?? 0}</span>
          </div>
          <div className="seatcard__foot">
            <span className="seatcard__label">남은 카드</span>
            <span className="seatcard__total">점수 없음</span>
          </div>
        </div>
      )}
    </section>
  )
}

function Bidding({
  view,
  busy,
  run,
}: {
  view: View
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const options = Array.from({ length: view.cardCount + 1 }, (_, i) => i)
  const done = view.myBid !== null

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>트릭 선택</h2>
        <span className="muted">이번 라운드에 몇 번 이길지 고르세요</span>
      </div>
      <div className="bidrow">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            className={view.myBid === n ? 'bid bid--on' : 'bid'}
            disabled={busy || done}
            onClick={() => void run(() => request('game:bid', { value: n }))}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="muted">
        맞히면 <b>+20 × 입찰</b>{' '}
        {view.cardCount > 0 && <>(0이면 <b>+{10 * view.cardCount}</b>)</>}, 틀리면{' '}
        <b>−10 × 차이</b>. 다른 사람 입찰은 전원 확정 후 공개됩니다.
      </p>
      {done && <p className="muted">입찰 완료. 다른 사람을 기다리는 중…</p>}
    </section>
  )
}

function TrickArea({ view, nameOf }: { view: View; nameOf: (seat: number) => string }) {
  const showing = view.phase === 'trickEnd' && view.lastTrick ? view.lastTrick.plays : view.trick
  const outcome = view.phase === 'trickEnd' ? view.lastTrick?.outcome : null

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>테이블</h2>
        {view.leadColor && (
          <span className={`leadhint leadhint--${view.leadColor}`}>
            {LEAD_LABEL[view.leadColor]} 따라내기
          </span>
        )}
      </div>
      {showing.length === 0 ? (
        <p className="muted">첫 카드를 기다리는 중…</p>
      ) : (
        <div className="tablerow">
          {showing.map((p, i) => {
            const won = outcome && outcome.winner === p.seat
            return (
              <div
                key={`${p.seat}-${p.card.id}-${i}`}
                className={won ? 'played is-won' : 'played'}
              >
                <Card card={p.card} tigressAs={p.tigressAs} size="md" />
                <span className="played__name">{nameOf(p.seat)}</span>
              </div>
            )
          })}
        </div>
      )}
      {outcome && (
        <div className="outcome">
          <strong>{outcome.destroyed ? '트릭 소멸' : `${nameOf(outcome.winner ?? -1)} 획득`}</strong>
          <span className="muted"> — {outcome.reason}</span>
          {outcome.bonuses.length > 0 && (
            <ul className="bonuslist">
              {outcome.bonuses.map((b, i) => (
                <li key={i}>
                  +{b.points} {b.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Hand({
  view,
  myTurn,
  legal,
  busy,
  onPlay,
}: {
  view: View
  myTurn: boolean
  legal: Set<string>
  busy: boolean
  onPlay: (card: SkCard) => void
}) {
  const blocked = view.phase === 'playing' && myTurn && legal.size < view.hand.length

  return (
    <section className={myTurn && view.phase === 'playing' ? 'panel hand hand--active' : 'panel hand'}>
      <div className="panel__head">
        <h2>내 손패 <span className="muted">({view.hand.length}장)</span></h2>
        {view.phase === 'playing' && myTurn && <span className="nowtag">지금 낼 차례</span>}
      </div>
      {view.hand.length === 0 ? (
        <p className="muted">손패를 다 냈습니다.</p>
      ) : (
        <div className="handrow">
          {view.hand.map((c) => {
            const playable = myTurn && view.phase === 'playing' && legal.has(c.id)
            return (
              <Card
                key={c.id}
                card={c}
                size="lg"
                playable={playable}
                disabled={!playable || busy}
                onClick={playable ? () => onPlay(c) : undefined}
              />
            )
          })}
        </div>
      )}
      {blocked && <p className="muted">흐린 카드는 리드색을 따라야 해서 지금은 낼 수 없습니다.</p>}
    </section>
  )
}

function TigressModal({
  busy,
  onPick,
  onCancel,
}: {
  busy: boolean
  onPick: (as: 'pirate' | 'escape') => void
  onCancel: () => void
}) {
  return (
    <div className="modal" role="dialog">
      <div className="modal__box">
        <h2>티그리스를 어떻게 낼까요?</h2>
        <p className="muted">낼 때 반드시 선언해야 하고, 나중에 바꿀 수 없습니다.</p>
        <div className="modal__actions">
          <button type="button" className="primary" disabled={busy} onClick={() => onPick('pirate')}>
            해적으로 (인어·숫자를 이김)
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => onPick('escape')}>
            도주로 (반드시 짐)
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  )
}

function RoundResult({ view, nameOf }: { view: View; nameOf: (seat: number) => string }) {
  const scores = view.lastRoundScores ?? []
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>라운드 {view.round} 결과</h2>
      </div>
      <table className="scoretable">
        <thead>
          <tr>
            <th>이름</th>
            <th>입찰</th>
            <th>획득</th>
            <th>입찰점</th>
            <th>보너스</th>
            <th>합계</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.seat} className={s.bidMet ? 'row--ok' : 'row--miss'}>
              <td>{nameOf(s.seat)}</td>
              <td>{s.bid}</td>
              <td>{s.taken}</td>
              <td>{s.bidPoints > 0 ? `+${s.bidPoints}` : s.bidPoints}</td>
              <td>{s.bonusPoints ? `+${s.bonusPoints}` : '—'}</td>
              <td>
                <strong>{s.total > 0 ? `+${s.total}` : s.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function GameEnd({ view, nameOf }: { view: View; nameOf: (seat: number) => string }) {
  const rows = view.totals.map((total, seat) => ({ seat, total })).sort((a, b) => b.total - a.total)
  const best = rows[0]?.total

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>게임 종료</h2>
      </div>
      <ol className="ranking">
        {rows.map((r, i) => (
          <li key={r.seat} className={r.total === best ? 'rank rank--win' : 'rank'}>
            <span className="rank__no">{i + 1}</span>
            <span className="rank__name">{nameOf(r.seat)}</span>
            <span className="rank__score">{r.total}점</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
