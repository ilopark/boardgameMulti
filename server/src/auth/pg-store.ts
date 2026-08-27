import type { Db } from '../db/pool.js'
import type { Account, AccountStore } from './types.js'

/** DB 한 줄 → Account. password_hash 는 여기서 절대 실어 보내지 않는다. */
interface UserRow {
  id: string
  username: string
  nickname: string
  tag: string
  created_at: Date
  is_banned: boolean
}

function toAccount(row: UserRow): Account {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    tag: row.tag,
    createdAt: row.created_at.getTime(),
    isBanned: row.is_banned,
  }
}

const USER_COLUMNS = 'id, username, nickname, tag, created_at, is_banned'

/**
 * Supabase(Postgres) 계정 저장소.
 *
 * 쿼리는 전부 파라미터 바인딩($1, $2…)만 쓴다. 사용자 입력을 SQL 문자열에
 * 붙이는 곳이 한 군데도 없어야 한다.
 */
export class PostgresAccountStore implements AccountStore {
  constructor(private readonly db: Db) {}

  async isUsernameTaken(username: string): Promise<boolean> {
    // username 은 citext 라 대소문자를 구분하지 않고 비교된다
    const { rowCount } = await this.db.query('select 1 from boardgame.users where username = $1', [
      username,
    ])
    return (rowCount ?? 0) > 0
  }

  async create(input: {
    username: string
    passwordHash: string
    nickname: string
    tag: string
  }): Promise<Account> {
    const { rows } = await this.db.query<UserRow>(
      `insert into boardgame.users (username, password_hash, nickname, tag)
       values ($1, $2, $3, $4)
       returning ${USER_COLUMNS}`,
      [input.username, input.passwordHash, input.nickname, input.tag],
    )
    const row = rows[0]
    if (!row) throw new Error('계정을 만들지 못했습니다')
    return toAccount(row)
  }

  async findForLogin(username: string): Promise<{ account: Account; passwordHash: string } | null> {
    const { rows } = await this.db.query<UserRow & { password_hash: string }>(
      `select ${USER_COLUMNS}, password_hash from boardgame.users where username = $1`,
      [username],
    )
    const row = rows[0]
    return row ? { account: toAccount(row), passwordHash: row.password_hash } : null
  }

  async findById(id: string): Promise<Account | null> {
    const { rows } = await this.db.query<UserRow>(
      `select ${USER_COLUMNS} from boardgame.users where id = $1`,
      [id],
    )
    const row = rows[0]
    return row ? toAccount(row) : null
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.query('update boardgame.users set password_hash = $2 where id = $1', [
      userId,
      passwordHash,
    ])
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.db.query('update boardgame.users set last_seen_at = now() where id = $1', [userId])
  }

  async createSession(input: {
    userId: string
    tokenHash: string
    expiresAt: number
    ipHash: string | null
  }): Promise<void> {
    await this.db.query(
      `insert into boardgame.auth_sessions (user_id, token_hash, expires_at, ip_hash)
       values ($1, $2, to_timestamp($3 / 1000.0), $4)`,
      [input.userId, input.tokenHash, input.expiresAt, input.ipHash],
    )
  }

  async findSession(tokenHash: string): Promise<{ account: Account; expiresAt: number } | null> {
    const { rows } = await this.db.query<UserRow & { expires_at: Date }>(
      `select ${USER_COLUMNS.split(', ')
        .map((c) => `u.${c}`)
        .join(', ')}, s.expires_at
       from boardgame.auth_sessions s
       join boardgame.users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [tokenHash],
    )
    const row = rows[0]
    return row ? { account: toAccount(row), expiresAt: row.expires_at.getTime() } : null
  }

  async touchSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.db.query(
      `update boardgame.auth_sessions
         set last_used_at = now(), expires_at = to_timestamp($2 / 1000.0)
       where token_hash = $1`,
      [tokenHash, expiresAt],
    )
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.query('delete from boardgame.auth_sessions where token_hash = $1', [tokenHash])
  }

  async purgeExpiredSessions(): Promise<number> {
    const { rowCount } = await this.db.query(
      'delete from boardgame.auth_sessions where expires_at <= now()',
    )
    return rowCount ?? 0
  }
}
