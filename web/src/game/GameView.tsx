import { useEffect, useMemo, useState } from 'react'
import type { RoomPublic, skullking } from '@bg/core'
import { request } from '../socket.js'
import Card from './Card.js'
import Scoreboard from './Scoreboard.js'

type View = skullking.SkPlayerView
type SkCard = skullking.SkCard

const GHOST_SEAT = 2

interface Props {
  room: RoomPublic
  view: View
  isHost: boolean
  onError: (message: string) => void
}

export default function GameView({ room, view, isHost, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const [tigressPick, setTigressPick] = useState<SkCard | null>(null)

  // 페이즈가 바뀌면 티그리스 선택창을 닫는다
  useEffect(() => {
    setTigressPick(null)
  }, [view.phase, view.trick.length])

  const nameOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of room.players) if (p.seat !== null) map.set(p.seat, p.nickname)
    return (seat: number) => (seat === GHOST_SEAT && view.hasGhost ? '유령' : (map.get(seat) ?? `${seat + 1}번`))
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
  const legal = new Set(view.legal)

  const playCard = (card: SkCard) => {
    if (card.kind === 'tigress') {
      setTigressPick(card)
      return
    }
    void run(() => request('game:play', { cardId: card.id }))
  }

  return (
    <div className="game">
      <section className="card gamebar">
        <div>
          <strong>라운드 {view.round}</strong>
          <span className="muted"> / {view.totalRounds} · {view.cardCount}장</span>
        </div>
        <div className="gamebar__right">
          {view.myBid !== null && (
            <span className="pill">
              내 입찰 {view.myBid} · 획득 {view.tricksWon[view.seat] ?? 0}
            </span>
          )}
        </div>
      </section>

      <Scoreboard room={room} view={view} nameOf={nameOf} />

      {view.phase === 'bidding' && <Bidding view={view} busy={busy} run={run} />}

      {(view.phase === 'playing' || view.phase === 'trickEnd') && (
        <TrickArea view={view} nameOf={nameOf} />
      )}

      {view.phase === 'roundEnd' && <RoundResult view={view} nameOf={nameOf} />}

      {view.phase === 'gameEnd' && <GameEnd view={view} nameOf={nameOf} />}

      {(view.phase === 'trickEnd' || view.phase === 'roundEnd') && (
        <section className="card actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void run(() => request('game:ready', {}))}
          >
            다음
          </button>
          <span className="muted">전원이 누르면 바로 넘어갑니다</span>
        </section>
      )}

      {view.phase !== 'gameEnd' && (
        <section className="card hand">
          <div className="hand__head">
            <h2>내 손패 ({view.hand.length}장)</h2>
            {view.phase === 'playing' && (
              <span className={myTurn ? 'turnflag turnflag--on' : 'turnflag'}>
                {myTurn ? '내 차례' : `${nameOf(view.currentSeat ?? -1)} 차례`}
              </span>
            )}
          </div>
          <div className="hand__cards">
            {view.hand.map((c) => (
              <Card
                key={c.id}
                card={c}
                disabled={!myTurn || !legal.has(c.id) || busy}
                onClick={myTurn && legal.has(c.id) ? () => playCard(c) : undefined}
              />
            ))}
            {view.hand.length === 0 && <p className="muted">손패를 다 냈습니다.</p>}
          </div>
          {view.phase === 'playing' && myTurn && legal.size < view.hand.length && (
            <p className="muted">흐린 카드는 리드색을 따라야 해서 낼 수 없습니다.</p>
          )}
        </section>
      )}

      {tigressPick && (
        <div className="modal" role="dialog">
          <div className="modal__box">
            <h2>티그리스를 어떻게 낼까요?</h2>
            <p className="muted">낼 때 반드시 선언해야 합니다. 나중에 못 바꿉니다.</p>
            <div className="modal__actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    request('game:play', { cardId: tigressPick.id, tigressAs: 'pirate' }),
                  ).then(() => setTigressPick(null))
                }
              >
                ⚔️ 해적으로
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    request('game:play', { cardId: tigressPick.id, tigressAs: 'escape' }),
                  ).then(() => setTigressPick(null))
                }
              >
                🏳️ 도주로
              </button>
              <button type="button" className="ghost" onClick={() => setTigressPick(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {isHost && (
        <section className="card">
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
    <section className="card">
      <h2>몇 트릭 먹을까요?</h2>
      <p className="muted">
        정확히 맞히면 +20×입찰(0이면 +10×{view.cardCount}), 틀리면 −10×차이.
        다른 사람 입찰은 전원 확정 후 공개됩니다.
      </p>
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
      {done && <p className="muted">입찰 완료. 다른 사람을 기다리는 중…</p>}
    </section>
  )
}

function TrickArea({ view, nameOf }: { view: View; nameOf: (seat: number) => string }) {
  const showing = view.phase === 'trickEnd' && view.lastTrick ? view.lastTrick.plays : view.trick
  const outcome = view.phase === 'trickEnd' ? view.lastTrick?.outcome : null

  return (
    <section className="card">
      <h2>테이블</h2>
      {showing.length === 0 ? (
        <p className="muted">첫 카드를 기다리는 중…</p>
      ) : (
        <div className="trick">
          {showing.map((p, i) => {
            const won = outcome && outcome.winner === p.seat
            return (
              <div key={`${p.seat}-${p.card.id}-${i}`} className={won ? 'trick__slot trick__slot--won' : 'trick__slot'}>
                <span className="trick__name">{nameOf(p.seat)}</span>
                <Card card={p.card} tigressAs={p.tigressAs} small />
              </div>
            )
          })}
        </div>
      )}
      {outcome && (
        <div className="outcome">
          <strong>
            {outcome.destroyed ? '트릭 소멸' : `${nameOf(outcome.winner ?? -1)} 획득`}
          </strong>
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
          {outcome.bonuses.length > 0 && (
            <p className="muted">보너스는 이 라운드 입찰을 맞춰야 실제로 들어옵니다.</p>
          )}
        </div>
      )}
    </section>
  )
}

function RoundResult({ view, nameOf }: { view: View; nameOf: (seat: number) => string }) {
  const scores = view.lastRoundScores ?? []
  return (
    <section className="card">
      <h2>라운드 {view.round} 결과</h2>
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
  const rows = view.totals
    .map((total, seat) => ({ seat, total }))
    .sort((a, b) => b.total - a.total)
  const best = rows[0]?.total

  return (
    <section className="card">
      <h2>게임 종료</h2>
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
