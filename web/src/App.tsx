import { useCallback, useEffect, useState } from 'react'
import { GAME_LABEL, type GameId, type RoomPublic, type skullking, type tichu } from '@bg/core'
import { clearIdentity, loadIdentity, request, saveIdentity, socket } from './socket.js'
import { applyTheme, loadTheme, type Theme } from './theme.js'
import Lobby from './Lobby.js'
import RoomView from './RoomView.js'
import GameView from './game/GameView.js'
import TichuGameView from './game/TichuGameView.js'
import CardGallery from './game/CardGallery.js'

type SkView = skullking.SkPlayerView

/** 개발용 카드 갤러리 — /?cards */
const IS_GALLERY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('cards')

interface GameMsg {
  view: unknown
  remainingMs: number | null
  waitingFor: number[]
  autoPass?: boolean
  /**
   * 메시지마다 증가하는 번호.
   * 서버가 같은 remainingMs를 다시 보내면 React가 "값이 안 바뀌었다"고 보고
   * 카운트다운을 재시작하지 않는다. 그래서 별도의 신호를 하나 준다.
   */
  seq: number
}

export default function App() {
  const [room, setRoom] = useState<RoomPublic | null>(null)
  const [game, setGame] = useState<GameMsg | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [connected, setConnected] = useState(socket.connected)
  const [toast, setToast] = useState<string | null>(null)
  const [announce, setAnnounce] = useState<{ kind: 'tichu' | 'grand'; nickname: string } | null>(null)
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const notify = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3000)
  }, [])

  useEffect(() => {
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onState = (next: RoomPublic) => {
      setRoom(next)
      // 대기실로 돌아오면 게임 화면을 치운다
      if (next.phase === 'lobby') setGame(null)
    }
    let seq = 0
    const onGameView = (msg: unknown) =>
      setGame({ ...(msg as Omit<GameMsg, 'seq'>), seq: ++seq })
    // 티츄 선언은 모두가 즉시 알아야 하므로 화면 가운데에 잠깐 띄운다
    let announceTimer: ReturnType<typeof setTimeout> | undefined
    const onAnnounce = (p: { kind: 'tichu' | 'grand'; nickname: string }) => {
      setAnnounce(p)
      clearTimeout(announceTimer)
      announceTimer = setTimeout(() => setAnnounce(null), 1600)
    }
    const onClosed = ({ reason }: { reason: string }) => {
      notify(reason)
      setRoom(null)
      setGame(null)
      clearIdentity()
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:state', onState)
    socket.on('game:view', onGameView)
    socket.on('game:announce', onAnnounce)
    socket.on('room:closed', onClosed)
    // 리스너를 붙이기 전에 이미 connect가 끝났을 수 있다. 현재 상태를 한 번 맞춰준다.
    setConnected(socket.connected)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:state', onState)
      socket.off('game:view', onGameView)
      socket.off('game:announce', onAnnounce)
      clearTimeout(announceTimer)
      socket.off('room:closed', onClosed)
    }
  }, [notify])

  // 새로고침 후 자동 재입장
  useEffect(() => {
    const saved = loadIdentity()
    if (!saved) return
    let cancelled = false
    const rejoin = async () => {
      try {
        const res = await request('room:join', {
          code: saved.code,
          nickname: '',
          identity: saved.identity,
        })
        if (cancelled) return
        setRoom(res.room)
        setMyId(res.identity.playerId)
      } catch {
        clearIdentity()
      }
    }
    if (socket.connected) void rejoin()
    else socket.once('connect', () => void rejoin())
    return () => {
      cancelled = true
    }
  }, [])

  const handleCreate = useCallback(async (nickname: string, game: GameId) => {
    const res = await request('room:create', { nickname, game })
    setRoom(res.room)
    setMyId(res.identity.playerId)
    saveIdentity(res.room.code, res.identity)
  }, [])

  const handleJoin = useCallback(async (code: string, nickname: string) => {
    const res = await request('room:join', { code: code.toUpperCase().trim(), nickname })
    setRoom(res.room)
    setMyId(res.identity.playerId)
    saveIdentity(res.room.code, res.identity)
  }, [])

  const handleLeave = useCallback(async () => {
    await request('room:leave', {})
    clearIdentity()
    setRoom(null)
    setGame(null)
    setMyId(null)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">보드게임</span>
        <span className="topbar__right">
          <span className={connected ? 'status status--on' : 'status status--off'}>
            {connected ? '연결됨' : '연결 끊김'}
          </span>
          <button
            type="button"
            className="themebtn"
            title={theme === 'dark' ? '라이트 모드로' : '다크 모드로'}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </span>
      </header>

      <main className="main">
        {IS_GALLERY && <CardGallery />}
        {IS_GALLERY ? null : room && myId && game && room.phase !== 'lobby' ? (
          room.game === 'tichu' ? (
            <TichuGameView
              room={room}
              view={game.view as tichu.TichuPlayerView}
              remainingMs={game.remainingMs}
              seq={game.seq}
              autoPass={game.autoPass ?? false}
              isHost={room.hostId === myId}
              onError={notify}
            />
          ) : (
            <GameView
              room={room}
              view={game.view as SkView}
              remainingMs={game.remainingMs}
              waitingFor={game.waitingFor}
              seq={game.seq}
              isHost={room.hostId === myId}
              onError={notify}
            />
          )
        ) : room && myId ? (
          <RoomView room={room} myId={myId} onLeave={handleLeave} onError={notify} />
        ) : (
          <Lobby onCreate={handleCreate} onJoin={handleJoin} onError={notify} />
        )}
      </main>

      <footer className="footer">
        {room ? `${GAME_LABEL[room.game]} · 방코드 ${room.code}` : '친구랑 하는 티츄 / 스컬킹'}
      </footer>

      {toast && <div className="toast">{toast}</div>}

      {announce && (
        <div className={`announce announce--${announce.kind}`} role="status">
          <span className="announce__who">{announce.nickname}</span>
          <strong className="announce__what">
            {announce.kind === 'grand' ? '그랜드 티츄!' : '티츄!'}
          </strong>
          <span className="announce__sub">
            {announce.kind === 'grand' ? '성공 +200 / 실패 −200' : '성공 +100 / 실패 −100'}
          </span>
        </div>
      )}
    </div>
  )
}
