import { randomUUID } from 'node:crypto'
import type { Account, AccountStore } from './types.js'

interface Row {
  account: Account
  passwordHash: string
  lastSeenAt: number | null
}

interface SessionRow {
  userId: string
  expiresAt: number
  ipHash: string | null
}

/**
 * 프로세스 안에서만 사는 계정 저장소.
 *
 * 테스트와, DATABASE_URL 없이 돌려보는 로컬 개발용이다.
 * 여기 만든 계정은 서버를 끄면 사라진다.
 */
export class MemoryAccountStore implements AccountStore {
  private readonly rows = new Map<string, Row>()
  /** 토큰 해시 → 세션 */
  private readonly sessions = new Map<string, SessionRow>()

  private findRow(username: string): Row | undefined {
    // DB 의 citext 와 같은 규칙 — 대소문자를 구분하지 않는다
    const key = username.toLowerCase()
    for (const row of this.rows.values()) {
      if (row.account.username.toLowerCase() === key) return row
    }
    return undefined
  }

  isUsernameTaken(username: string): Promise<boolean> {
    return Promise.resolve(this.findRow(username) !== undefined)
  }

  create(input: {
    username: string
    passwordHash: string
    nickname: string
    tag: string
  }): Promise<Account> {
    if (this.findRow(input.username)) {
      // DB 의 unique 제약과 같은 실패를 흉내낸다
      return Promise.reject(new Error('이미 쓰이고 있는 아이디입니다'))
    }
    const account: Account = {
      id: randomUUID(),
      username: input.username,
      nickname: input.nickname,
      tag: input.tag,
      createdAt: Date.now(),
      isBanned: false,
    }
    this.rows.set(account.id, { account, passwordHash: input.passwordHash, lastSeenAt: null })
    return Promise.resolve(account)
  }

  findForLogin(username: string): Promise<{ account: Account; passwordHash: string } | null> {
    const row = this.findRow(username)
    return Promise.resolve(row ? { account: row.account, passwordHash: row.passwordHash } : null)
  }

  findById(id: string): Promise<Account | null> {
    return Promise.resolve(this.rows.get(id)?.account ?? null)
  }

  updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const row = this.rows.get(userId)
    if (row) row.passwordHash = passwordHash
    return Promise.resolve()
  }

  touchLastSeen(userId: string): Promise<void> {
    const row = this.rows.get(userId)
    if (row) row.lastSeenAt = Date.now()
    return Promise.resolve()
  }

  createSession(input: {
    userId: string
    tokenHash: string
    expiresAt: number
    ipHash: string | null
  }): Promise<void> {
    this.sessions.set(input.tokenHash, {
      userId: input.userId,
      expiresAt: input.expiresAt,
      ipHash: input.ipHash,
    })
    return Promise.resolve()
  }

  findSession(tokenHash: string): Promise<{ account: Account; expiresAt: number } | null> {
    const session = this.sessions.get(tokenHash)
    if (!session) return Promise.resolve(null)
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(tokenHash)
      return Promise.resolve(null)
    }
    const account = this.rows.get(session.userId)?.account
    if (!account) return Promise.resolve(null)
    return Promise.resolve({ account, expiresAt: session.expiresAt })
  }

  touchSession(tokenHash: string, expiresAt: number): Promise<void> {
    const session = this.sessions.get(tokenHash)
    if (session) session.expiresAt = expiresAt
    return Promise.resolve()
  }

  deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash)
    return Promise.resolve()
  }

  purgeExpiredSessions(): Promise<number> {
    const now = Date.now()
    let removed = 0
    for (const [hash, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(hash)
        removed++
      }
    }
    return Promise.resolve(removed)
  }

  // ── 테스트용 ──

  /** 밴 처리 (관리자 기능이 붙기 전까지 테스트에서만 쓴다) */
  setBanned(userId: string, banned: boolean): void {
    const row = this.rows.get(userId)
    if (row) row.account = { ...row.account, isBanned: banned }
  }

  get size(): number {
    return this.rows.size
  }
}
