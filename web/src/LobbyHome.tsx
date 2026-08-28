import { useCallback, useEffect, useState } from 'react'
import {
  GAME_LABEL,
  MIN_PLAYERS,
  SEAT_COUNT,
  type GameId,
  type PublicRoomSummary,
  type RoomVisibility,
} from '@bg/core'
import { request } from './socket.js'
import AdSlot from './ads.js'
import type { AuthUser } from '@bg/core'

interface Props {
  /** 로그인 사용자면 그 사람, 게스트면 null */
  user: AuthUser | null
  /** 방을 만들 때 쓸 닉네임 (게스트는 직접 입력, 로그인은 계정 닉네임) */
  nickname: string
  onNicknameChange: (name: string) => void
  onCreate: (game: GameId, visibility: RoomVisibility, title: string) => Promise<void>
  onJoin: (code: string) => Promise<void>
  onLogout: () => void
  onError: (message: string) => void
}

const GAMES: GameId[] = ['skullking', 'tichu']
const REFRESH_MS = 5000

export default function LobbyHome({
  user,
  nickname,
  onNicknameChange,
  onCreate,
  onJoin,
  onLogout,
  onError,
}: Props) {
  const [rooms, setRooms] = useState<PublicRoomSummary[] | null>(null)
  const [gameFilter, setGameFilter] = useState<GameId | 'all'>('all')
  const [waitingOnly, setWaitingOnly] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // 로그인 사용자의 전적 (게스트는 안 뜬다). 로비로 돌아올 때마다 새로 불러온다.
  const [record, setRecord] = useState<{ games: number; wins: number } | null>(null)

  useEffect(() => {
    if (!user) {
      setRecord(null)
      return
    }
    let alive = true
    request('stats:me', {})
      .then((r) => {
        if (alive) setRecord(r)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user])

  const loadRooms = useCallback(async () => {
    try {
      const res = await request('lobby:list', {
        ...(gameFilter !== 'all' ? { game: gameFilter } : {}),
        waitingOnly,
      })
      setRooms(res.rooms)
    } catch {
      // 목록 조회 실패는 조용히 둔다 — 다음 주기에 다시 시도한다
      setRooms((prev) => prev ?? [])
    }
  }, [gameFilter, waitingOnly])

  // 5초마다 새로고침. 로비는 계속 바뀌니까.
  useEffect(() => {
    void loadRooms()
    const timer = setInterval(() => void loadRooms(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadRooms])

  const run = async (fn: () => Promise<void>) => {
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

  const guestNameNeeded = user === null && nickname.trim().length === 0

  return (
    <div className="lobbyhome">
      <h1 className="visually-hidden">보드게임 로비 — 티츄 · 스컬킹</h1>
      <div className="lobbyhome__head">
        <div className="lobbyhome__me">
          {user ? (
            <>
              <span className="lobbyhome__nick">{user.nickname}</span>
              <span className="lobbyhome__tag">#{user.tag}</span>
              {record && record.games > 0 && (
                <span className="lobbyhome__rec">
                  {record.games}판 · {record.wins}승
                </span>
              )}
              <button type="button" className="linkbtn" onClick={onLogout}>
                로그아웃
              </button>
            </>
          ) : (
            <>
              <span className="lobbyhome__nick">{nickname}</span>
              <span className="lobbyhome__tag">게스트</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => setShowCreate((v) => !v)}
          disabled={guestNameNeeded}
        >
          + 방 만들기
        </button>
      </div>

      {showCreate && (
        <CreatePanel
          busy={busy}
          disabled={guestNameNeeded}
          onCancel={() => setShowCreate(false)}
          onCreate={(game, visibility, title) =>
            run(async () => {
              await onCreate(game, visibility, title)
              setShowCreate(false)
            })
          }
        />
      )}

      <section className="card lobbyjoin">
        <h2>코드로 참가</h2>
        <div className="lobbyjoin__row">
          <input
            className="codeinput"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="primary"
            disabled={busy || guestNameNeeded || code.trim().length !== 6}
            onClick={() => void run(() => onJoin(code))}
          >
            입장
          </button>
        </div>
      </section>

      <section className="lobbylist">
        <div className="lobbylist__head">
          <h2>공개방</h2>
          <div className="lobbylist__filters">
            <div className="segbtns">
              <button
                type="button"
                className={gameFilter === 'all' ? 'segbtn segbtn--on' : 'segbtn'}
                onClick={() => setGameFilter('all')}
              >
                전체
              </button>
              {GAMES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={gameFilter === g ? 'segbtn segbtn--on' : 'segbtn'}
                  onClick={() => setGameFilter(g)}
                >
                  {GAME_LABEL[g]}
                </button>
              ))}
            </div>
            <label className="checkfield">
              <input
                type="checkbox"
                checked={waitingOnly}
                onChange={(e) => setWaitingOnly(e.target.checked)}
              />
              <span>대기중만</span>
            </label>
          </div>
        </div>

        {rooms === null ? (
          <p className="lobbylist__empty muted">불러오는 중…</p>
        ) : rooms.length === 0 ? (
          <p className="lobbylist__empty muted">
            지금 열린 공개방이 없어요. 위에서 직접 만들어보세요.
          </p>
        ) : (
          <ul className="roomcards">
            {rooms.map((r) => (
              <RoomCard
                key={r.code}
                room={r}
                busy={busy || guestNameNeeded}
                onJoin={() => void run(() => onJoin(r.code))}
              />
            ))}
          </ul>
        )}
      </section>

      <AdSlot slot="" label="광고" />
    </div>
  )
}

function CreatePanel({
  busy,
  disabled,
  onCreate,
  onCancel,
}: {
  busy: boolean
  disabled: boolean
  onCreate: (game: GameId, visibility: RoomVisibility, title: string) => void
  onCancel: () => void
}) {
  const [game, setGame] = useState<GameId>('skullking')
  const [visibility, setVisibility] = useState<RoomVisibility>('public')
  const [title, setTitle] = useState('')

  return (
    <section className="card createpanel">
      <div className="createpanel__row">
        <span className="createpanel__label">게임</span>
        <div className="segbtns">
          {GAMES.map((g) => (
            <button
              key={g}
              type="button"
              className={game === g ? 'segbtn segbtn--on' : 'segbtn'}
              onClick={() => setGame(g)}
            >
              {GAME_LABEL[g]}
              <small>
                {MIN_PLAYERS[g] === SEAT_COUNT[g]
                  ? ` ${SEAT_COUNT[g]}명`
                  : ` ${MIN_PLAYERS[g]}~${SEAT_COUNT[g]}명`}
              </small>
            </button>
          ))}
        </div>
      </div>

      <div className="createpanel__row">
        <span className="createpanel__label">공개</span>
        <div className="segbtns">
          <button
            type="button"
            className={visibility === 'public' ? 'segbtn segbtn--on' : 'segbtn'}
            onClick={() => setVisibility('public')}
          >
            공개방
            <small> 목록에 뜸</small>
          </button>
          <button
            type="button"
            className={visibility === 'private' ? 'segbtn segbtn--on' : 'segbtn'}
            onClick={() => setVisibility('private')}
          >
            비밀방
            <small> 코드로만</small>
          </button>
        </div>
      </div>

      {visibility === 'public' && (
        <label className="field">
          <span>방 이름 (선택)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={20}
            placeholder="예: 초보 환영"
            autoComplete="off"
          />
        </label>
      )}

      <div className="createpanel__actions">
        <button type="button" className="ghost" onClick={onCancel}>
          취소
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || disabled}
          onClick={() => onCreate(game, visibility, title.trim())}
        >
          만들기
        </button>
      </div>
    </section>
  )
}

function RoomCard({
  room,
  busy,
  onJoin,
}: {
  room: PublicRoomSummary
  busy: boolean
  onJoin: () => void
}) {
  const full = room.playerCount >= room.seatCount
  const playing = room.phase !== 'lobby'
  const joinable = !full && !playing
  const badge = summarizeOptions(room)

  return (
    <li className={`roomcard roomcard--${room.game}`}>
      <div className="roomcard__main">
        <span className="roomcard__game">{GAME_LABEL[room.game]}</span>
        <span className="roomcard__title">
          {room.title || `${room.hostNickname}님의 방`}
        </span>
        {badge && <span className="roomcard__badge">{badge}</span>}
      </div>
      <div className="roomcard__meta">
        <span className="roomcard__count">
          {room.playerCount}/{room.seatCount}
        </span>
        <span
          className={
            playing ? 'roomcard__state roomcard__state--playing' : 'roomcard__state'
          }
        >
          {playing ? '게임중' : full ? '만석' : '대기중'}
        </span>
      </div>
      <button
        type="button"
        className="roomcard__join"
        disabled={busy || !joinable}
        onClick={onJoin}
      >
        {playing ? '진행중' : full ? '만석' : '입장'}
      </button>
    </li>
  )
}

/** 방 옵션에서 목록에 띄울 짧은 배지 하나를 뽑는다 */
function summarizeOptions(room: PublicRoomSummary): string | null {
  const o = room.options
  if (room.game === 'tichu') {
    const target = typeof o.targetScore === 'number' ? o.targetScore : null
    return target ? `${target}점` : null
  }
  // 스컬킹: 에디션 이름이 있으면 보여준다
  const edition = typeof o.label === 'string' ? o.label : null
  return edition
}
