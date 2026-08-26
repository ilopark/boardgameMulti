import { useEffect, useMemo, useState } from 'react'
import { TURN_POLICY, tichu, type RoomPublic } from '@bg/core'
import { request } from '../socket.js'
import Countdown from './Countdown.js'
import TichuCard, { CardBack, rankLabel, tichuCardLabel } from './TichuCard.js'

type View = tichu.TichuPlayerView
type TCard = tichu.TichuCard

interface Props {
  room: RoomPublic
  view: View
  remainingMs: number | null
  seq: number
  isHost: boolean
  onError: (message: string) => void
}

export default function TichuGameView({ room, view, remainingMs, seq, isHost, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [phoenixChoices, setPhoenixChoices] = useState<tichu.Combo[] | null>(null)
  const [wishOpen, setWishOpen] = useState(false)

  // 단계가 바뀌거나 테이블이 갱신되면 선택을 비운다
  useEffect(() => {
    setPicked([])
    setPhoenixChoices(null)
  }, [view.phase, view.trick.length, view.hand.length])

  const nameOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of room.players) if (p.seat !== null) map.set(p.seat, p.nickname)
    return (seat: number) => map.get(seat) ?? `${seat + 1}번`
  }, [room.players])

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

  const myTurn = view.turn === view.seat && view.phase === 'playing'
  const pickedCards = view.hand.filter((c) => picked.includes(c.id))
  const combo = pickedCards.length > 0 ? tichu.parseCombo(pickedCards) : null
  const canBeatNow = combo ? tichu.canBeat(combo, view.current) : false

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  /** 카드 내기 — 봉황 해석이 여러 개면 먼저 물어본다 */
  const submitPlay = (phoenixAs?: number) => {
    const options = tichu.phoenixOptions(pickedCards)
    if (phoenixAs === undefined && options.length > 1) {
      setPhoenixChoices(options)
      return
    }
    const payload: { cardIds: string[]; phoenixAs?: number } = { cardIds: picked }
    if (phoenixAs !== undefined) payload.phoenixAs = phoenixAs
    void run(() => request('tichu:play', payload)).then(() => {
      setPicked([])
      setPhoenixChoices(null)
      // 마작을 냈으면 소원을 부를 수 있다
      if (pickedCards.some((c) => c.kind === 'mahjong')) setWishOpen(true)
    })
  }

  const totalMs =
    view.phase === 'playing' || view.phase === 'dragonGift' ? TURN_POLICY.playMs : TURN_POLICY.bidMs

  return (
    <div className="game">
      <TichuTopBar view={view} />
      <TichuBanner view={view} nameOf={nameOf} remainingMs={remainingMs} totalMs={totalMs} seq={seq} />

      <section className="tseats">
        {view.seats.map((info) => (
          <SeatRow
            key={info.seat}
            info={info}
            me={info.seat === view.seat}
            active={view.waitingFor.includes(info.seat)}
            name={nameOf(info.seat)}
            phase={view.phase}
          />
        ))}
      </section>

      {view.wish !== null && (
        <p className="wishbar">
          마작 소원: <strong>{rankLabel(view.wish)}</strong> — 낼 수 있으면 반드시 내야 합니다
        </p>
      )}

      {view.phase === 'grandTichu' && <GrandTichuPanel view={view} busy={busy} run={run} />}
      {view.phase === 'passing' && (
        <PassPanel
          view={view}
          picked={picked}
          toggle={toggle}
          busy={busy}
          run={run}
          nameOf={nameOf}
          onDone={() => setPicked([])}
        />
      )}
      {view.phase === 'dragonGift' && view.dragonTargets.length > 0 && (
        <DragonPanel view={view} busy={busy} run={run} nameOf={nameOf} />
      )}
      {view.phase === 'roundEnd' && <TichuRoundResult view={view} nameOf={nameOf} />}
      {view.phase === 'gameEnd' && <TichuGameEnd view={view} nameOf={nameOf} />}

      {view.phase !== 'gameEnd' && view.phase !== 'passing' && (
        <section className={myTurn ? 'panel hand hand--active' : 'panel hand'}>
          <div className="panel__head">
            <h2>
              내 손패 <span className="muted">({view.hand.length}장)</span>
            </h2>
            <div className="handactions">
              {view.canCallTichu && (
                <button
                  type="button"
                  className="tichubtn"
                  disabled={busy}
                  onClick={() => void run(() => request('tichu:call', {}))}
                >
                  티츄!
                </button>
              )}
              {myTurn && <span className="nowtag">지금 낼 차례</span>}
            </div>
          </div>

          <div className="handrow">
            {view.hand.map((card) => (
              <TichuCard
                key={card.id}
                card={card}
                size="lg"
                selected={picked.includes(card.id)}
                disabled={busy || view.phase !== 'playing'}
                onClick={view.phase === 'playing' ? () => toggle(card.id) : undefined}
              />
            ))}
            {view.hand.length === 0 && <p className="muted">손패를 다 냈습니다.</p>}
          </div>

          {view.phase === 'playing' && (
            <div className="playbar">
              <span className="playbar__info">
                {picked.length === 0 ? (
                  '카드를 골라주세요'
                ) : combo ? (
                  <>
                    <strong>{tichu.describeCombo(combo)}</strong>
                    {!canBeatNow && <span className="playbar__warn"> — 테이블을 이길 수 없습니다</span>}
                    {combo.isBomb && <span className="playbar__bomb"> 폭탄!</span>}
                  </>
                ) : (
                  <span className="playbar__warn">유효한 조합이 아닙니다</span>
                )}
              </span>
              <div className="playbar__btns">
                <button
                  type="button"
                  className={combo?.isBomb ? 'bombbtn' : 'primary'}
                  disabled={busy || !combo || !canBeatNow}
                  onClick={() => submitPlay()}
                >
                  {combo?.isBomb ? '폭탄 투척' : '내기'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !myTurn || view.current === null}
                  onClick={() => void run(() => request('tichu:pass', {}))}
                >
                  패스
                </button>
                {picked.length > 0 && (
                  <button type="button" className="ghost" onClick={() => setPicked([])}>
                    선택 해제
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {phoenixChoices && (
        <div className="modal" role="dialog">
          <div className="modal__box">
            <h2>봉황을 몇으로 쓸까요?</h2>
            <p className="muted">해석이 여러 개라 골라야 합니다.</p>
            <div className="modal__actions">
              {phoenixChoices.map((opt) => (
                <button
                  key={`${opt.type}-${opt.rank}`}
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => submitPlay(opt.phoenixAs)}
                >
                  {tichu.describeCombo(opt)}
                </button>
              ))}
              <button type="button" className="ghost" onClick={() => setPhoenixChoices(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {wishOpen && (
        <WishModal
          busy={busy}
          onPick={(rank) =>
            void run(() => request('tichu:wish', { rank })).then(() => setWishOpen(false))
          }
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

function TichuTopBar({ view }: { view: View }) {
  const [a, b] = view.totals
  return (
    <section className="topinfo">
      <div className="topinfo__round">
        <strong>라운드 {view.round}</strong>
        <em>목표 {view.targetScore}점</em>
      </div>
      <div className="teamscore">
        <span className={view.team === 0 ? 'teamscore__t is-mine' : 'teamscore__t'}>
          <em>1·3팀</em>
          <b>{a}</b>
        </span>
        <span className="teamscore__vs">vs</span>
        <span className={view.team === 1 ? 'teamscore__t is-mine' : 'teamscore__t'}>
          <em>2·4팀</em>
          <b>{b}</b>
        </span>
      </div>
    </section>
  )
}

function TichuBanner({
  view,
  nameOf,
  remainingMs,
  totalMs,
  seq,
}: {
  view: View
  nameOf: (s: number) => string
  remainingMs: number | null
  totalMs: number
  seq: number
}) {
  const mine = view.waitingFor.includes(view.seat)
  let title = ''
  let sub = ''
  switch (view.phase) {
    case 'grandTichu':
      title = mine ? '그랜드 티츄를 부를까요?' : '다른 사람을 기다리는 중'
      sub = mine ? '8장만 보고 결정합니다. 성공 +200 / 실패 −200' : view.waitingFor.map(nameOf).join(', ')
      break
    case 'passing':
      title = mine ? '카드 3장을 넘기세요' : '다른 사람의 교환을 기다리는 중'
      sub = mine ? '왼쪽·파트너·오른쪽에게 한 장씩' : view.waitingFor.map(nameOf).join(', ')
      break
    case 'playing':
      title = view.turn === view.seat ? '내 차례입니다' : `${nameOf(view.turn)} 차례`
      sub = view.current === null ? '리드입니다 — 아무 조합이나 낼 수 있습니다' : '이겨서 내거나 패스하세요'
      break
    case 'dragonGift':
      title = view.dragonTargets.length > 0 ? '용으로 딴 트릭을 넘기세요' : '용 트릭을 넘기는 중'
      sub = '상대팀 중 한 명을 고릅니다'
      break
    case 'roundEnd':
      title = `라운드 ${view.round} 종료`
      sub = '곧 다음 라운드가 시작됩니다'
      break
    case 'gameEnd':
      title = '게임 종료'
      break
  }
  const tone = mine || view.turn === view.seat ? 'me' : view.phase === 'playing' ? 'wait' : 'info'
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

/** 플레이어 한 줄 — 닉네임, 선언, 손패 수, 이번 트릭에 낸 카드 */
function SeatRow({
  info,
  me,
  active,
  name,
  phase,
}: {
  info: tichu.TichuSeatInfo
  me: boolean
  active: boolean
  name: string
  phase: tichu.TichuPhase
}) {
  const classes = [
    'seatrow',
    `seatrow--team${info.team}`,
    me ? 'is-me' : '',
    active ? 'is-active' : '',
    info.leading ? 'is-leading' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div className="seatrow__who">
        <span className="seatrow__name">
          {name}
          {me && <em className="flagchip">나</em>}
        </span>
        <span className="seatrow__meta">
          {info.declaration === 'tichu' && <em className="decl decl--small">티츄</em>}
          {info.declaration === 'grand' && <em className="decl decl--grand">그랜드</em>}
          {info.finished !== null && <em className="flagchip">{info.finished}등 골인</em>}
          <em className="seatrow__count">{info.cards}장</em>
        </span>
      </div>

      <div className="seatrow__play">
        {info.played ? (
          <div className="seatrow__cards">
            {info.played.cards.map((c) => (
              <TichuCard key={c.id} card={c} size="md" phoenixAs={info.played?.phoenixAs} />
            ))}
          </div>
        ) : info.passed ? (
          <div className="seatrow__cards seatrow__cards--pass">
            <CardBack size="md" />
            <span className="passlabel">패스</span>
          </div>
        ) : (
          <span className="muted">{phase === 'playing' ? '—' : ''}</span>
        )}
      </div>
    </div>
  )
}

function GrandTichuPanel({
  view,
  busy,
  run,
}: {
  view: View
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  if (view.grandDecided) return <p className="muted">결정 완료. 다른 사람을 기다리는 중…</p>
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>그랜드 티츄</h2>
        <span className="muted">8장만 보고 결정합니다</span>
      </div>
      <div className="handrow">
        {view.hand.map((c) => (
          <TichuCard key={c.id} card={c} size="lg" />
        ))}
      </div>
      <div className="playbar__btns">
        <button
          type="button"
          className="grandbtn"
          disabled={busy}
          onClick={() => void run(() => request('tichu:grand', { call: true }))}
        >
          그랜드 티츄! (+200 / −200)
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => request('tichu:grand', { call: false }))}
        >
          안 부름
        </button>
      </div>
    </section>
  )
}

const PASS_TARGETS = ['왼쪽', '파트너', '오른쪽']

function PassPanel({
  view,
  picked,
  toggle,
  busy,
  run,
  nameOf,
  onDone,
}: {
  view: View
  picked: string[]
  toggle: (id: string) => void
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
  nameOf: (s: number) => string
  onDone: () => void
}) {
  if (view.passSubmitted) {
    return (
      <section className="panel">
        <p className="muted">교환할 카드를 냈습니다. 다른 사람을 기다리는 중…</p>
      </section>
    )
  }

  const targets = [1, 2, 3].map((i) => (view.seat + i) % 4)
  const chosen = picked.map((id) => view.hand.find((c) => c.id === id)).filter(Boolean) as TCard[]

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>카드 교환</h2>
        <span className="muted">고른 순서대로 왼쪽 → 파트너 → 오른쪽에게 갑니다</span>
      </div>

      <div className="passslots">
        {targets.map((seat, i) => (
          <div key={seat} className={chosen[i] ? 'passslot is-filled' : 'passslot'}>
            <span className="passslot__label">
              {PASS_TARGETS[i]}
              <em>{nameOf(seat)}</em>
            </span>
            {chosen[i] ? <TichuCard card={chosen[i]!} size="md" /> : <div className="passslot__empty" />}
          </div>
        ))}
      </div>

      <div className="handrow">
        {view.hand.map((card) => (
          <TichuCard
            key={card.id}
            card={card}
            size="lg"
            selected={picked.includes(card.id)}
            disabled={busy || (picked.length >= 3 && !picked.includes(card.id))}
            onClick={() => toggle(card.id)}
          />
        ))}
      </div>

      <div className="playbar__btns">
        <button
          type="button"
          className="primary"
          disabled={busy || picked.length !== 3}
          onClick={() =>
            void run(() =>
              request('tichu:pass3', { cardIds: picked as [string, string, string] }),
            ).then(onDone)
          }
        >
          {picked.length}/3 넘기기
        </button>
        {view.canCallTichu && (
          <button
            type="button"
            className="tichubtn"
            disabled={busy}
            onClick={() => void run(() => request('tichu:call', {}))}
          >
            티츄!
          </button>
        )}
        {picked.length > 0 && (
          <button type="button" className="ghost" onClick={onDone}>
            선택 해제
          </button>
        )}
      </div>
    </section>
  )
}

function DragonPanel({
  view,
  busy,
  run,
  nameOf,
}: {
  view: View
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
  nameOf: (s: number) => string
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>용으로 딴 트릭을 누구에게?</h2>
        <span className="muted">상대팀에게 줘야 합니다. 다음 리드는 그대로 내 것입니다</span>
      </div>
      <div className="playbar__btns">
        {view.dragonTargets.map((seat) => (
          <button
            key={seat}
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => request('tichu:dragon', { to: seat }))}
          >
            {nameOf(seat)}에게
          </button>
        ))}
      </div>
    </section>
  )
}

function WishModal({ busy, onPick }: { busy: boolean; onPick: (rank: number | null) => void }) {
  const ranks = Array.from({ length: 13 }, (_, i) => i + 2)
  return (
    <div className="modal" role="dialog">
      <div className="modal__box">
        <h2>소원을 부를까요?</h2>
        <p className="muted">
          부른 숫자를 가진 사람은 낼 수 있으면 <strong>반드시</strong> 내야 합니다. 누군가 이행할 때까지 유지됩니다.
        </p>
        <div className="wishgrid">
          {ranks.map((r) => (
            <button key={r} type="button" className="bid" disabled={busy} onClick={() => onPick(r)}>
              {rankLabel(r)}
            </button>
          ))}
        </div>
        <button type="button" className="ghost" disabled={busy} onClick={() => onPick(null)}>
          부르지 않음
        </button>
      </div>
    </div>
  )
}

function TichuRoundResult({ view, nameOf }: { view: View; nameOf: (s: number) => string }) {
  const r = view.lastRound
  if (!r) return null
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>라운드 {view.round} 결과</h2>
        {r.doubleWin !== null && <span className="decl decl--grand">원투 피니시!</span>}
      </div>
      <table className="scoretable">
        <thead>
          <tr>
            <th>팀</th>
            <th>카드 점수</th>
            <th>선언</th>
            <th>합계</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1].map((t) => (
            <tr key={t} className={r.total[t]! >= r.total[1 - t]! ? 'row--ok' : 'row--miss'}>
              <td>{t === 0 ? '1·3팀' : '2·4팀'}</td>
              <td>{r.doubleWin !== null ? '—' : r.cardPoints[t]}</td>
              <td>{r.declarationPoints[t] === 0 ? '—' : r.declarationPoints[t]}</td>
              <td>
                <strong>{r.total[t]}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.declarations.some((d) => d.declaration !== 'none') && (
        <ul className="bonuslist">
          {r.declarations
            .filter((d) => d.declaration !== 'none')
            .map((d) => (
              <li key={d.seat} className={d.success ? '' : 'miss'}>
                {nameOf(d.seat)} {d.declaration === 'grand' ? '그랜드 티츄' : '티츄'}{' '}
                {d.success ? '성공' : '실패'}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}

function TichuGameEnd({ view, nameOf }: { view: View; nameOf: (s: number) => string }) {
  const [a, b] = view.totals
  const winner = a === b ? null : a > b ? 0 : 1
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>게임 종료</h2>
      </div>
      <ol className="ranking">
        {[0, 1].map((t) => (
          <li key={t} className={winner === t ? 'rank rank--win' : 'rank'}>
            <span className="rank__no">{t === 0 ? '1·3' : '2·4'}</span>
            <span className="rank__name">
              {[0, 1, 2, 3].filter((s) => s % 2 === t).map(nameOf).join(' · ')}
            </span>
            <span className="rank__score">{view.totals[t]}점</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
