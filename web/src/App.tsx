import { useCallback, useEffect, useState } from 'react'
import { GAME_LABEL, type GameId, type RoomPublic, type skullking } from '@bg/core'
import { clearIdentity, loadIdentity, request, saveIdentity, socket } from './socket.js'
import Lobby from './Lobby.js'
import RoomView from './RoomView.js'
import GameView from './game/GameView.js'

type SkView = skullking.SkPlayerView

export default function App() {
  const [room, setRoom] = useState<RoomPublic | null>(null)
  const [gameView, setGameView] = useState<SkView | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [connected, setConnected] = useState(socket.connected)
  const [toast, setToast] = useState<string | null>(null)

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
      if (next.phase === 'lobby') setGameView(null)
    }
    const onGameView = (v: unknown) => setGameView(v as SkView)
    const onClosed = ({ reason }: { reason: string }) => {
      notify(reason)
      setRoom(null)
      setGameView(null)
      clearIdentity()
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:state', onState)
    socket.on('game:view', onGameView)
    socket.on('room:closed', onClosed)
    // 리스너를 붙이기 전에 이미 connect가 끝났을 수 있다. 현재 상태를 한 번 맞춰준다.
    setConnected(socket.connected)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:state', onState)
      socket.off('game:view', onGameView)
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
    setGameView(null)
    setMyId(null)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">보드게임</span>
        <span className={connected ? 'status status--on' : 'status status--off'}>
          {connected ? '연결됨' : '연결 끊김'}
        </span>
      </header>

      <main className="main">
        {room && myId && gameView && room.phase !== 'lobby' ? (
          <GameView
            room={room}
            view={gameView}
            isHost={room.hostId === myId}
            onError={notify}
          />
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
    </div>
  )
}
