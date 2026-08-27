import { useEffect, useMemo, useRef, useState } from 'react'
import { TURN_POLICY, type RoomPublic, type skullking } from '@bg/core'
import { request } from '../socket.js'
import Card from './Card.js'
import Countdown from './Countdown.js'

type View = skullking.SkPlayerView
type SkCard = skullking.SkCard

const GHOST_SEAT = 2

/**
 * 내 차례가 시작된 직후 이만큼은 카드 클릭을 무시한다.
 *
 * 손패는 트릭 결과(trickEnd) 화면에서도 같은 자리에 그대로 있다가 다음 트릭이 시작되면
 * 곧바로 클릭 가능해진다. 모바일에서는 trickEnd 동안 손패를 무심코 건드린 터치가
 * 지연 발화(고스트 클릭)해서, 트릭이 시작되자마자 카드가 저절로 제출되는 일이 생긴다.
 * 스컬킹은 카드 클릭 = 확인 없이 즉시 제출이라 이 한 번이 돌이킬 수 없다.
 * 사람은 카드를 고르는 데 최소 1초는 걸리므로 이 짧은 무시가 정상 플레이를 방해하지 않는다.
 */
const PLAY_COOLDOWN_MS = 350

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
  const [railOpen, setRailOpen] = useState(true)

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

  // 내 차례(playing)가 막 시작된 시각. 그 직후의 고스트 클릭을 걸러내려고 본다.
  // **렌더 중에** 기록한다 — useEffect(화면을 그린 뒤 실행)에 두면, 전환 직후의 클릭이
  // useEffect보다 먼저 들어와 시각이 아직 0인 채로 통과해 버린다(고스트 클릭이 새어 든다).
  const canPlayNow = myTurn && view.phase === 'playing'
  const playReadyAt = useRef(0)
  const wasReady = useRef(false)
  if (canPlayNow && !wasReady.current) {
    playReadyAt.current = Date.now()
    wasReady.current = true
  } else if (!canPlayNow && wasReady.current) {
    wasReady.current = false
  }

  const playCard = (card: SkCard) => {
    // 트릭이 막 시작된 직후의 클릭은 무시한다 — 직전 화면에서 새어 든 고스트 클릭일 수 있다
    if (Date.now() - playReadyAt.current < PLAY_COOLDOWN_MS) return
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
    <div className={railOpen ? 'skgame' : 'skgame skgame--railclosed'}>
      {/* 좌측 레일: 플레이어 점수판 (접기 가능).
          폭은 CSS 에 맡긴다 — inline 으로 주면 모바일 세로 배치에서 그 값이 '높이'로 해석돼
          점수판이 화면을 먹고 가운데(입찰 버튼) 자리가 사라진다. */}
      <aside className={railOpen ? 'skrail' : 'skrail skrail--closed'}>
        <div className="skrail__head">
          <button
            type="button"
            className="skrail__collapse"
            onClick={() => setRailOpen((v) => !v)}
            title={railOpen ? '점수판 접기' : '점수판 펼치기'}
            aria-label={railOpen ? '점수판 접기' : '점수판 펼치기'}
          >
            {railOpen ? '‹' : '›'}
          </button>
          <div className="skrail__meta">
            <span className="skrail__round">
              라운드 <b>{view.round}</b>
              <em>/{view.totalRounds}</em>
            </span>
            <span className="skrail__cards">{view.cardCount}장</span>
          </div>
        </div>

        <PlayerRail room={room} view={view} nameOf={nameOf} waitingFor={waitingFor} />

        {isHost && (
          <button
            type="button"
            className="ghost skrail__abort"
            disabled={busy}
            onClick={() => void run(() => request('game:abort', {}))}
          >
            게임 끝내고 대기실로
          </button>
        )}
      </aside>

      {/* 우측 스테이지: 상태 → 낸 카드 → 내 손패 */}
      <section className="skstage">
        <Status
          view={view}
          myTurn={myTurn}
          myBidPending={myBidPending}
          waitingFor={waitingFor}
          nameOf={nameOf}
          remainingMs={remainingMs}
          totalMs={totalMs}
          seq={seq}
        />

        <div className="skstage__mid">
          {view.phase === 'bidding' && <Bidding view={view} busy={busy} run={run} />}
          {(view.phase === 'playing' || view.phase === 'trickEnd') && (
            <TrickArea view={view} nameOf={nameOf} />
          )}
          {view.phase === 'roundEnd' && <RoundResult view={view} nameOf={nameOf} />}
          {view.phase === 'gameEnd' && <GameEnd view={view} nameOf={nameOf} />}
        </div>

        {view.phase !== 'gameEnd' && (
          <Hand view={view} myTurn={myTurn} legal={legal} busy={busy} onPlay={playCard} />
        )}
      </section>

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
    </div>
  )
}

/** 큰 중앙 상태 표시 — 지금 뭘 해야 하는지 한눈에 + 큰 카운트다운 */
function Status({
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
    const iLead = view.leader === view.seat
    if (myBidPending) {
      tone = 'me'
      title = '입찰하세요'
      sub = iLead
        ? '★ 당신이 선턴입니다 — 첫 카드를 리드해요. 몇 트릭 이길지 고르세요'
        : `선턴: ${nameOf(view.leader)} · 몇 트릭 이길지 고르세요`
    } else {
      tone = 'wait'
      title = '입찰 대기 중'
      sub = `${waitingFor.map(nameOf).join(', ')} 기다리는 중…`
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
    <div className={`skstatus skstatus--${tone}`}>
      <strong className="skstatus__title">{title}</strong>
      {sub && <span className="skstatus__sub">{sub}</span>}
      <Countdown big remainingMs={remainingMs} totalMs={totalMs} seq={seq} />
    </div>
  )
}

/** 좌측 레일에 세로로 쌓이는 플레이어 점수판 — B(입찰)/W(획득) + 점수 */
function PlayerRail({
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
    <div className="railseats">
      {seats.map((seat) => {
        const isMe = seat === view.seat
        const isTurn = view.currentSeat === seat || (view.phase === 'bidding' && waiting.has(seat))
        const bid = view.bids[seat]
        const placed = view.bidPlaced[seat]
        const won = view.tricksWon[seat] ?? 0
        const met = bid !== null && won === bid

        // 입찰 공개 전에는 남의 입찰을 숨긴다 (본인 것만 숫자로)
        const bidText = view.bidsRevealed ? (bid ?? '—') : placed ? (isMe ? bid : '✓') : '…'

        return (
          <div
            key={seat}
            className={['railseat', isMe ? 'is-me' : '', isTurn ? 'is-turn' : ''].filter(Boolean).join(' ')}
          >
            <div className="railseat__body">
              <div className="railseat__namerow">
                <span className="railseat__name">{nameOf(seat)}</span>
                {connected.get(seat) === false && <em className="flagchip flagchip--warn">끊김</em>}
              </div>
              <div className={met && view.bidsRevealed ? 'railseat__bw is-ok' : 'railseat__bw'}>
                <span>B: <b>{bidText}</b></span>
                <span>W: <b>{won}</b></span>
              </div>
            </div>
            {view.leader === seat && (
              <span className="railseat__lead" title="선턴 — 첫 카드를 리드합니다" aria-label="선턴">
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                  <path d="M5 3l15 9-15 9V3z" fill="currentColor" />
                </svg>
                <b>선</b>
              </span>
            )}
            <span className="railseat__score">{view.totals[seat] ?? 0}</span>
          </div>
        )
      })}
      {view.hasGhost && (
        <div className="railseat railseat--ghost">
          <div className="railseat__body">
            <div className="railseat__namerow">
              <span className="railseat__name">유령</span>
            </div>
            <div className="railseat__bw">
              <span>남은 <b>{view.handCounts[GHOST_SEAT] ?? 0}</b></span>
            </div>
          </div>
          <span className="railseat__score">—</span>
        </div>
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
    <section className="panel bidpanel">
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
            const tag = cardTag(p.card, p.tigressAs)
            return (
              <div
                key={`${p.seat}-${p.card.id}-${i}`}
                className={won ? 'played is-won' : 'played'}
              >
                <Card card={p.card} tigressAs={p.tigressAs} size="lg" />
                <span className={`handcard__tag handcard__tag--${tag.suit}`}>{tag.text}</span>
                <span className="played__name">{nameOf(p.seat)}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const SUIT_KO: Record<string, string> = { green: '초록', yellow: '노랑', purple: '보라', black: '검정' }
const SPECIAL_KO: Record<string, string> = {
  escape: '도주',
  pirate: '해적',
  mermaid: '인어',
  skullking: '스컬킹',
  tigress: '티그리스',
  kraken: '크라켄',
  whitewhale: '흰고래',
}
/**
 * 카드 밑에 붙일 색+숫자 라벨 — 스컬킹은 색·숫자가 중요하므로 한눈에 보이게.
 * 티그리스는 낼 때 해적/도주 중 뭘로 선언했는지까지 보여준다(테이블에서 특히 중요).
 */
function cardTag(card: SkCard, tigressAs?: 'pirate' | 'escape'): { text: string; suit: string } {
  if (card.kind === 'number') return { text: `${SUIT_KO[card.color]} ${card.rank}`, suit: card.color }
  if (card.kind === 'tigress' && tigressAs) {
    return { text: `티그리스 · ${tigressAs === 'pirate' ? '해적' : '도주'}`, suit: 'special' }
  }
  return { text: SPECIAL_KO[card.kind] ?? '', suit: 'special' }
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
  // 낼 카드를 고르는 건 '내 차례의 playing' 단계뿐이다.
  // 입찰(bidding) 등 다른 단계에서는 손패를 흐리게 하지 않고 그대로 잘 보이게 둔다.
  const inPlay = view.phase === 'playing' && myTurn
  const blocked = inPlay && legal.size < view.hand.length

  return (
    <section className={inPlay ? 'panel hand hand--active' : 'panel hand'}>
      <div className="panel__head">
        <h2>내 손패 <span className="muted">({view.hand.length}장)</span></h2>
        {inPlay && <span className="nowtag">지금 낼 차례</span>}
      </div>
      {view.hand.length === 0 ? (
        <p className="muted">손패를 다 냈습니다.</p>
      ) : (
        <div className="handrow">
          {view.hand.map((c) => {
            const playable = inPlay && legal.has(c.id)
            // playing 단계에서 '낼 수 없는' 카드만 흐리게. 그 외 단계에서는 흐리게 하지 않는다.
            const dim = inPlay && !legal.has(c.id)
            const tag = cardTag(c)
            return (
              <div className="handcard" key={c.id}>
                <Card
                  card={c}
                  size="lg"
                  playable={playable}
                  disabled={dim}
                  onClick={playable && !busy ? () => onPlay(c) : undefined}
                />
                <span className={`handcard__tag handcard__tag--${tag.suit}`}>{tag.text}</span>
              </div>
            )
          })}
        </div>
      )}
      {blocked && <p className="muted">흐린 카드는 리드색을 따라야 해서 지금은 낼 수 없습니다.</p>}
    </section>
  )
}

const TIGRESS_DECIDE_MS = 10_000

function TigressModal({
  busy,
  onPick,
  onCancel,
}: {
  busy: boolean
  onPick: (as: 'pirate' | 'escape') => void
  onCancel: () => void
}) {
  const [left, setLeft] = useState(Math.ceil(TIGRESS_DECIDE_MS / 1000))
  // onPick은 렌더마다 새로 만들어지므로 ref로 최신 값만 참조 (타이머가 리셋되지 않게)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  // 10초 안에 안 고르면 자동으로 도주로 낸다
  useEffect(() => {
    const deadline = Date.now() + TIGRESS_DECIDE_MS
    const id = setInterval(() => {
      const s = Math.ceil((deadline - Date.now()) / 1000)
      setLeft(Math.max(0, s))
      if (deadline - Date.now() <= 0) {
        clearInterval(id)
        onPickRef.current('escape')
      }
    }, 200)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="modal" role="dialog">
      <div className="modal__box">
        <h2>
          티그리스를 어떻게 낼까요? <span className="tigress__timer">{left}초</span>
        </h2>
        <p className="muted">
          낼 때 반드시 선언해야 하고, 나중에 바꿀 수 없습니다. <strong>10초 안에 안 고르면 도주로 냅니다.</strong>
        </p>
        <div className="modal__actions">
          <button type="button" className="primary" disabled={busy} onClick={() => onPick('pirate')}>
            해적 (인어·숫자를 이김)
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => onPick('escape')}>
            도주 (반드시 짐)
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
