import { useState } from 'react'
import { GAME_LABEL, MIN_PLAYERS, SEAT_COUNT, type GameId } from '@bg/core'

interface Props {
  onCreate: (nickname: string, game: GameId) => Promise<void>
  onJoin: (code: string, nickname: string) => Promise<void>
  onError: (message: string) => void
}

const GAMES: GameId[] = ['tichu', 'skullking']

export default function Lobby({ onCreate, onJoin, onError }: Props) {
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [game, setGame] = useState<GameId>('skullking')
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="lobby">
      <label className="field">
        <span>닉네임</span>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={12}
          placeholder="1~12자"
          autoComplete="off"
        />
      </label>

      <section className="card">
        <h2>방 만들기</h2>
        <div className="gamepick">
          {GAMES.map((g) => (
            <button
              key={g}
              type="button"
              className={g === game ? 'chip chip--on' : 'chip'}
              onClick={() => setGame(g)}
            >
              {GAME_LABEL[g]}
              <small>
                {MIN_PLAYERS[g] === SEAT_COUNT[g]
                  ? `${SEAT_COUNT[g]}명`
                  : `${MIN_PLAYERS[g]}~${SEAT_COUNT[g]}명`}
              </small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy || nickname.trim().length === 0}
          onClick={() => void run(() => onCreate(nickname, game))}
        >
          {GAME_LABEL[game]} 방 만들기
        </button>
      </section>

      <section className="card">
        <h2>방 들어가기</h2>
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
          disabled={busy || nickname.trim().length === 0 || code.trim().length !== 6}
          onClick={() => void run(() => onJoin(code, nickname))}
        >
          입장
        </button>
      </section>
    </div>
  )
}
