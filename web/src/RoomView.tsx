import { useMemo, useState } from 'react'
import {
  GAME_LABEL,
  MIN_PLAYERS,
  skullking,
  tichu,
  type PlayerPublic,
  type RoomPublic,
} from '@bg/core'
import { request } from './socket.js'

interface Props {
  room: RoomPublic
  myId: string
  onLeave: () => Promise<void>
  onError: (message: string) => void
}

export default function RoomView({ room, myId, onLeave, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const me = room.players.find((p) => p.id === myId)
  const isHost = room.hostId === myId
  const seated = room.players.filter((p) => p.seat !== null)

  const bySeat = useMemo(() => {
    const map = new Map<number, PlayerPublic>()
    for (const p of room.players) if (p.seat !== null) map.set(p.seat, p)
    return map
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

  // 코드만 주면 상대가 '사이트 링크 + 코드' 두 번을 받아야 한다.
  // 링크에 코드를 심어(?j=CODE) 한 번에 그 방으로 들어오게 한다.
  const inviteLink = `${location.origin}${location.pathname}?j=${room.code}`
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      onError('초대 링크를 복사했습니다. 붙여넣어 보내면 바로 입장돼요.')
    } catch {
      onError(`복사 실패. 링크: ${inviteLink}`)
    }
  }

  const minPlayers = MIN_PLAYERS[room.game]
  const allReady = seated.length >= minPlayers && seated.every((p) => p.ready)
  const hasFreeSeat = seated.length < room.seatCount

  // 딜러 왼쪽 사람이 그 라운드 선턴
  const leaderSeat =
    room.dealerSeat === null ? null : skullking.roundFirstLeader(room.dealerSeat, seated.length)
  const dealerName = room.dealerSeat === null ? null : (bySeat.get(room.dealerSeat)?.nickname ?? null)
  const leaderName = leaderSeat === null ? null : (bySeat.get(leaderSeat)?.nickname ?? null)

  return (
    <div className="room">
      <section className="card">
        <div className="roomhead">
          <div>
            <h2>{GAME_LABEL[room.game]}</h2>
            <p className="muted">
              {room.phase === 'lobby' ? '대기 중' : room.phase === 'playing' ? '게임 중' : '종료'} ·{' '}
              {seated.length}/{room.seatCount}명
            </p>
          </div>
          <button
            type="button"
            className="codebadge"
            onClick={() => void copyInvite()}
            title="초대 링크 복사"
            aria-label={`방 코드 ${room.code}, 눌러서 초대 링크 복사`}
          >
            {room.code}
            <small>탭해서 초대 링크 복사</small>
          </button>
        </div>
      </section>

      <section className="card">
        <h2>자리</h2>
        <ul className="seats">
          {Array.from({ length: room.seatCount }, (_, seat) => {
            const p = bySeat.get(seat)
            const mine = p?.id === myId
            return (
              <li key={seat} className={p ? (mine ? 'seat seat--mine' : 'seat') : 'seat seat--empty'}>
                <button
                  type="button"
                  disabled={busy || room.phase !== 'lobby' || (Boolean(p) && !mine)}
                  onClick={() => void run(() => request('room:sit', { seat }))}
                >
                  <span className="seatno">{seat + 1}</span>
                  <span className="seatname">{p ? p.nickname : '빈자리'}</span>
                  <span className="seatflags">
                    {p?.id === room.hostId && <em className="tag">방장</em>}
                    {p?.isBot && <em className="tag">봇</em>}
                    {p && room.dealerSeat === seat && <em className="tag">딜러</em>}
                    {p && leaderSeat === seat && <em className="tag tag--lead">선턴</em>}
                    {p && !p.isBot && !p.connected && <em className="tag tag--warn">끊김</em>}
                    {p?.ready && !p.isBot && room.phase === 'lobby' && <em className="tag tag--ok">준비</em>}
                  </span>
                </button>
                {isHost && room.phase === 'lobby' && p && p.id !== myId && (
                  <button
                    type="button"
                    className="seat__kick"
                    disabled={busy}
                    title={p.isBot ? '봇 내보내기' : '내보내기'}
                    aria-label={`${p.nickname} 내보내기`}
                    onClick={() =>
                      void run(() =>
                        request(p.isBot ? 'room:removeBot' : 'room:kick', { playerId: p.id }),
                      )
                    }
                  >
                    추방
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {room.game === 'tichu' && <TeamHint room={room} />}
        {room.game === 'tichu' && room.phase === 'lobby' && (
          <TichuSettings room={room} isHost={isHost} busy={busy} run={run} />
        )}
        {room.game === 'skullking' && room.phase === 'lobby' && (
          <p className="muted">
            첫 딜러는 시작할 때 <strong>무작위</strong>로 정해집니다. 선턴은 딜러 왼쪽 사람이고,
            라운드마다 딜러가 한 칸씩 옮겨갑니다.
          </p>
        )}
        {isHost && room.phase === 'lobby' && (
          <div className="lobbytools">
            <button
              type="button"
              className="secondary"
              disabled={busy || !hasFreeSeat}
              onClick={() => void run(() => request('room:addBot', {}))}
            >
              봇 추가
            </button>
            {seated.length > 1 && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void run(() => request('room:shuffle', {}))}
              >
                자리 섞기
              </button>
            )}
          </div>
        )}
      </section>

      {room.phase === 'lobby' && (
        <section className="card actions">
          <button
            type="button"
            className={me?.ready ? 'secondary' : 'primary'}
            disabled={busy || me?.seat === null}
            onClick={() => void run(() => request('room:ready', { ready: !me?.ready }))}
          >
            {me?.ready ? '준비 취소' : '준비'}
          </button>
          {isHost && (
            <button
              type="button"
              className="primary"
              disabled={busy || !allReady}
              onClick={() => void run(() => request('room:start', {}))}
            >
              시작
            </button>
          )}
          <button type="button" className="ghost" disabled={busy} onClick={() => void run(onLeave)}>
            나가기
          </button>
        </section>
      )}

      {room.phase === 'playing' && (
        <section className="card">
          <h2>게임 화면</h2>
          {dealerName && leaderName && (
            <p className="muted">
              첫 딜러는 <strong>{dealerName}</strong>(무작위), 선턴은 <strong>{leaderName}</strong>입니다.
            </p>
          )}
          <p className="muted">
            카드 UI는 아직 구현 전입니다. 룰 엔진(트릭 판정·점수·조합 파싱·턴 순서)은 완성됐고,
            여기에 게임 상태머신을 붙이면 됩니다. docs/ROADMAP.md 2단계.
          </p>
          <button type="button" className="ghost" disabled={busy} onClick={() => void run(onLeave)}>
            나가기
          </button>
        </section>
      )}
    </div>
  )
}

/** 티츄 방 설정 — 방장만 바꿀 수 있다 */
function TichuSettings({
  room,
  isHost,
  busy,
  run,
}: {
  room: RoomPublic
  isHost: boolean
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const opts = room.options as Partial<tichu.TichuRuleOptions>
  const target = opts.targetScore ?? tichu.DEFAULT_TICHU_OPTIONS.targetScore
  const pairing = opts.teamPairing ?? tichu.DEFAULT_TICHU_OPTIONS.teamPairing

  const set = (patch: Partial<tichu.TichuRuleOptions>) =>
    void run(() => request('room:options', { options: patch as Record<string, unknown> }))

  return (
    <div className="settings">
      <div className="settings__row">
        <span className="settings__label">목표 점수</span>
        <div className="settings__opts">
          {tichu.TARGET_SCORES.map((n) => (
            <button
              key={n}
              type="button"
              className={target === n ? 'opt opt--on' : 'opt'}
              disabled={!isHost || busy}
              onClick={() => set({ targetScore: n })}
            >
              {n}점
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <span className="settings__label">팀 조합</span>
        <div className="settings__opts">
          {(['random', 'seats12', 'seats13', 'seats14'] as tichu.TeamPairing[]).map((p) => (
            <button
              key={p}
              type="button"
              className={pairing === p ? 'opt opt--on' : 'opt'}
              disabled={!isHost || busy}
              onClick={() => set({ teamPairing: p })}
            >
              {tichu.TEAM_PAIRING_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <p className="muted">
        {pairing === 'random'
          ? '시작할 때 팀이 무작위로 정해집니다.'
          : '고른 조합대로 마주 앉도록 자리가 재배치됩니다.'}
        {!isHost && ' 방장만 바꿀 수 있습니다.'}
      </p>
    </div>
  )
}

/** 지금 설정된 팀 조합을 자리 번호로 알려준다 */
function TeamHint({ room }: { room: RoomPublic }) {
  const opts = room.options as Partial<tichu.TichuRuleOptions>
  const pairing = opts.teamPairing ?? tichu.DEFAULT_TICHU_OPTIONS.teamPairing
  if (pairing === 'random') {
    return <p className="muted">팀은 시작할 때 무작위로 정해집니다.</p>
  }
  const [a, b] = tichu.teamsOf(tichu.seatArrangement(pairing))
  const fmt = (t: readonly number[]) => t.map((i) => `${i + 1}번`).join('·')
  return (
    <p className="muted">
      팀: <strong>{fmt(a)}</strong> vs <strong>{fmt(b)}</strong>
    </p>
  )
}
