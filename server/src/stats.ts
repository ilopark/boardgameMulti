/**
 * 전적 기록.
 *
 * 게임이 끝나면 결과를 boardgame.games / game_players 에 남긴다.
 * **로그인한 사람만** user_id 가 채워지고(게스트·봇은 null), 그래서 전적은 계정에만 쌓인다.
 * 기록 실패는 게임 진행을 절대 막지 않는다(호출부에서 catch).
 */
import { getPool } from './db/pool.js'
import type { Player, Room } from './rooms.js'

/** 게임 종료 시 호출. 좌석에 앉은 사람들의 최종 점수·순위를 기록한다. */
export async function recordGame(room: Room): Promise<void> {
  const pool = getPool()
  if (!pool) return

  const seated = [...room.players.values()].filter((p): p is Player & { seat: number } => p.seat !== null)
  if (seated.length === 0) return

  let scoreOf: (p: Player & { seat: number }) => number
  let teamOf: (p: Player & { seat: number }) => number | null
  let endedRound: number | null = null

  if (room.game === 'skullking' && room.skGame) {
    const totals = room.skGame.totals
    scoreOf = (p) => totals[p.seat] ?? 0
    teamOf = () => null
    endedRound = typeof room.skGame.roundIndex === 'number' ? room.skGame.roundIndex : null
  } else if (room.game === 'tichu' && room.tichuGame) {
    const totals = room.tichuGame.totals
    scoreOf = (p) => totals[p.seat % 2] ?? 0
    teamOf = (p) => p.seat % 2
  } else {
    return
  }

  let bestScore = -Infinity
  for (const p of seated) bestScore = Math.max(bestScore, scoreOf(p))

  const ranked = [...seated].sort((a, b) => scoreOf(b) - scoreOf(a))
  const placement = new Map<string, number>()
  ranked.forEach((p, i) => placement.set(p.id, i + 1))

  const humanCount = seated.filter((p) => !p.isBot).length
  const botCount = seated.filter((p) => p.isBot).length

  const client = await pool.connect()
  try {
    await client.query('begin')
    const res = await client.query<{ id: string }>(
      `insert into boardgame.games
         (room_code, game, is_public, options, human_count, bot_count, ended_at, outcome, ended_round)
       values ($1, $2, $3, $4, $5, $6, now(), 'finished', $7)
       returning id`,
      [
        room.code,
        room.game,
        room.visibility === 'public',
        JSON.stringify(room.options ?? {}),
        humanCount,
        botCount,
        endedRound,
      ],
    )
    const gameId = res.rows[0]!.id
    for (const p of seated) {
      const score = scoreOf(p)
      await client.query(
        `insert into boardgame.game_players
           (game_id, seat, user_id, display_name, is_bot, team, score, placement, is_winner)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [gameId, p.seat, p.userId, p.nickname, p.isBot, teamOf(p), score, placement.get(p.id) ?? null, score === bestScore],
      )
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** 계정의 전적 요약. 게스트/DB없음이면 0. */
export async function getUserRecord(userId: string): Promise<{ games: number; wins: number }> {
  const pool = getPool()
  if (!pool) return { games: 0, wins: 0 }
  const res = await pool.query<{ games: number; wins: number }>(
    `select count(*)::int as games, count(*) filter (where is_winner)::int as wins
       from boardgame.game_players where user_id = $1`,
    [userId],
  )
  const row = res.rows[0]
  return { games: Number(row?.games ?? 0), wins: Number(row?.wins ?? 0) }
}
