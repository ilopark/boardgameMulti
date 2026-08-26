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
  autoPass: boolean
  isHost: boolean
  onError: (message: string) => void
}

export default function TichuGameView({ room, view, remainingMs, seq, autoPass, isHost, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [phoenixChoices, setPhoenixChoices] = useState<tichu.Combo[] | null>(null)

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
  // 폭탄 창구/예약 상태
  const inBombWindow = view.bombWindow && view.bombClaim === null // 3초 창구, 아직 예약 없음
  const iClaimedBomb = view.bombClaim === view.seat // 내가 예약 → 폭탄 제출 시간
  const otherClaimedBomb = view.bombClaim !== null && view.bombClaim !== view.seat
  const pickedCards = view.hand.filter((c) => picked.includes(c.id))
  // 봉황을 단독으로 낼 때는 값이 테이블에서 정해진다 (직전 카드 + 0.5).
  // 서버와 같은 계산을 써야 "낼 수 있는데 못 낸다"고 표시되지 않는다.
  const combo = pickedCards.length > 0 ? tichu.parseAgainst(pickedCards, view.current) : null
  const canBeatNow = combo ? tichu.canBeat(combo, view.current) : false

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  /** 카드 내기 — 봉황 해석이 여러 개면 먼저 물어본다 */
  const submitPlay = (phoenixAs?: number) => {
    // 봉황 단독은 값이 자동으로 정해지므로 물어보지 않는다
    const lonePhoenix = pickedCards.length === 1 && pickedCards[0]?.kind === 'phoenix'
    const options = lonePhoenix ? [] : tichu.phoenixOptions(pickedCards)
    if (phoenixAs === undefined && options.length > 1) {
      setPhoenixChoices(options)
      return
    }
    const payload: { cardIds: string[]; phoenixAs?: number } = { cardIds: picked }
    if (phoenixAs !== undefined) payload.phoenixAs = phoenixAs
    void run(() => request('tichu:play', payload)).then(() => {
      setPicked([])
      setPhoenixChoices(null)
      // 마작을 내면 서버가 '소원 대기' 상태로 바꾼다 → view.awaitingWish 로 모달이 열린다
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

      {view.received.length > 0 && view.phase !== 'gameEnd' && (
        <ReceivedLog view={view} nameOf={nameOf} />
      )}

      {autoPass && view.phase === 'playing' && (
        <p className="autopassbar">
          <strong>트릭 패스 켜짐</strong> — 이번 트릭 동안 내 차례가 오면 자동으로 패스합니다.
          트릭이 끝나면 풀립니다. 리드하거나 마작 소원을 이행해야 하면 자동으로 풀립니다.
        </p>
      )}

      {view.wish !== null && (
        <div className="wishpin" role="status" aria-label={`마작 소원 ${rankLabel(view.wish)}`}>
          <span className="wishpin__icon">🀄</span>
          <span className="wishpin__label">마작 소원</span>
          <strong className="wishpin__rank">{rankLabel(view.wish)}</strong>
          <span className="wishpin__hint">낼 수 있으면 반드시 내야 함</span>
        </div>
      )}

      {view.awaitingWish !== null && view.awaitingWish !== view.seat && (
        <p className="wishbar">
          <strong>{nameOf(view.awaitingWish)}</strong>님이 소원을 정하는 중입니다… 잠시만 기다려주세요.
        </p>
      )}

      {inBombWindow && (
        <p className="bombbar">
          <strong>폭탄 창구</strong> — 폭탄이 있으면 아래 <strong>"폭탄 내기"</strong>를 누르세요. 진행이 멈추고 시간을 드립니다.
        </p>
      )}
      {iClaimedBomb && (
        <p className="bombbar">
          <strong>폭탄 준비</strong> — 던질 폭탄을 골라 <strong>"폭탄 투척"</strong>하세요. 시간 안에 안 내면 취소됩니다.
        </p>
      )}
      {otherClaimedBomb && (
        <p className="bombbar">
          <strong>{nameOf(view.bombClaim!)}</strong>님이 폭탄을 준비 중입니다 — 진행이 잠시 멈춥니다.
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
                {otherClaimedBomb ? (
                  <>
                    <strong>{nameOf(view.bombClaim!)}</strong>님이 폭탄을 준비 중… 잠시만요.
                  </>
                ) : iClaimedBomb ? (
                  picked.length === 0 ? (
                    '던질 폭탄을 고르세요 (같은 숫자 4장 / 같은 색 연속 5장+)'
                  ) : combo?.isBomb ? (
                    <>
                      <strong>{tichu.describeCombo(combo)}</strong>
                      <span className="playbar__bomb"> 폭탄!</span>
                      {!canBeatNow && <span className="playbar__warn"> — 이길 수 없습니다</span>}
                    </>
                  ) : (
                    <span className="playbar__warn">폭탄이 아닙니다</span>
                  )
                ) : inBombWindow ? (
                  '폭탄이 있으면 "폭탄 내기"를 누르세요 — 진행이 멈추고 시간을 드립니다'
                ) : picked.length === 0 ? (
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
                {otherClaimedBomb ? null : iClaimedBomb ? (
                  <>
                    <button
                      type="button"
                      className="bombbtn"
                      disabled={busy || !combo || !combo.isBomb || !canBeatNow}
                      onClick={() => submitPlay()}
                    >
                      폭탄 투척
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => void run(() => request('tichu:cancelBomb', {}))}
                    >
                      취소
                    </button>
                    {picked.length > 0 && (
                      <button type="button" className="ghost" onClick={() => setPicked([])}>
                        선택 해제
                      </button>
                    )}
                  </>
                ) : inBombWindow ? (
                  <button
                    type="button"
                    className="bombbtn"
                    disabled={busy || view.hand.length === 0}
                    title={view.hand.length === 0 ? '이미 손패를 다 냈습니다' : undefined}
                    onClick={() => void run(() => request('tichu:claimBomb', {}))}
                  >
                    폭탄 내기
                  </button>
                ) : (
                  <>
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
                    <button
                      type="button"
                      className={autoPass ? 'autopass autopass--on' : 'autopass'}
                      disabled={busy}
                      title="이번 트릭 동안 내 차례가 오면 자동으로 패스합니다. 트릭이 끝나면 풀립니다. 리드하거나 소원을 이행해야 하면 자동으로 풀립니다."
                      onClick={() => void run(() => request('tichu:autopass', { on: !autoPass }))}
                    >
                      {autoPass ? '트릭 패스 끄기' : '트릭 패스'}
                    </button>
                    {picked.length > 0 && (
                      <button type="button" className="ghost" onClick={() => setPicked([])}>
                        선택 해제
                      </button>
                    )}
                  </>
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

      {view.awaitingWish === view.seat && (
        <WishModal
          busy={busy}
          onPick={(rank) => void run(() => request('tichu:wish', { rank }))}
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
  const live = view.liveCardPoints
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
          {live[0] !== 0 && <i className="teamscore__live">이번 {live[0] > 0 ? '+' : ''}{live[0]}</i>}
        </span>
        <span className="teamscore__vs">vs</span>
        <span className={view.team === 1 ? 'teamscore__t is-mine' : 'teamscore__t'}>
          <em>2·4팀</em>
          <b>{b}</b>
          {live[1] !== 0 && <i className="teamscore__live">이번 {live[1] > 0 ? '+' : ''}{live[1]}</i>}
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
          {active && <em className="turnmark">▶</em>}
          {name}
          {me && <em className="flagchip">나</em>}
        </span>
        <span className="seatrow__meta">
          {info.declaration === 'tichu' && <em className="decl decl--small">티츄 선언</em>}
          {info.declaration === 'grand' && <em className="decl decl--grand">그랜드 티츄</em>}
          {info.finished !== null && <em className="flagchip">{info.finished}등 골인</em>}
          <em className="seatrow__count">{info.cards}장</em>
          {info.wonPoints !== 0 && (
            <em className={info.wonPoints > 0 ? 'wonpts' : 'wonpts wonpts--minus'}>
              {info.wonPoints > 0 ? '+' : ''}
              {info.wonPoints}점
            </em>
          )}
        </span>
      </div>

      {active && phase === 'playing' && <span className="seatrow__turnlabel">지금 차례</span>}

      <div className="seatrow__play">
        {info.played ? (
          <div className={info.playedDog ? 'seatrow__cards seatrow__cards--dog' : 'seatrow__cards'}>
            {info.played.cards.map((c) => (
              <TichuCard key={c.id} card={c} size="md" phoenixAs={info.played?.phoenixAs} />
            ))}
            {info.playedDog && <span className="doglabel">개 — 파트너에게 리드</span>}
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
        {targets.map((seat, i) => {
          const card = chosen[i]
          return (
            <div key={seat} className={card ? 'passslot is-filled' : 'passslot'}>
              <span className="passslot__label">
                {PASS_TARGETS[i]}
                <em>{nameOf(seat)}</em>
              </span>
              {card ? (
                // 슬롯을 눌러도 취소된다 (손패에서 다시 찾지 않아도 되게)
                <TichuCard card={card} size="md" onClick={() => toggle(card.id)} />
              ) : (
                <div className="passslot__empty" />
              )}
              {card && <span className="passslot__hint">눌러서 취소</span>}
            </div>
          )
        })}
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

/** 이번 라운드 교환에서 누가 나에게 뭘 줬는지. 접었다 펼 수 있다. */
function ReceivedLog({ view, nameOf }: { view: View; nameOf: (s: number) => string }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="recvlog">
      <button type="button" className="recvlog__head" onClick={() => setOpen((o) => !o)}>
        <span>내가 받은 카드</span>
        <em>{open ? '접기' : '펼치기'}</em>
      </button>
      {open && (
        <div className="recvlog__body">
          {view.received.map(({ from, card }) => (
            <div key={card.id} className="recvlog__item">
              <span className="recvlog__from">{nameOf(from)}</span>
              <TichuCard card={card} size="sm" />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
