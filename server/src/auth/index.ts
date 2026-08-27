import { createPool, pingDb, type Db } from '../db/pool.js'
import { Accounts } from './accounts.js'
import { MemoryAccountStore } from './memory-store.js'
import { PostgresAccountStore } from './pg-store.js'

export { Accounts, SESSION_DAYS, cleanNickname, hashIp, hashToken, nicknameProblem, usernameProblem } from './accounts.js'
export { hashPassword, passwordProblem, verifyPassword } from './password.js'
export { MemoryAccountStore } from './memory-store.js'
export { PostgresAccountStore } from './pg-store.js'
export { AuthError, type Account, type AccountStore, type AuthSession } from './types.js'

export interface AuthSetup {
  /** 계정 기능. DB 가 없으면 null 이고 게스트로만 논다. */
  accounts: Accounts | null
  db: Db | null
}

/**
 * DATABASE_URL 이 있으면 Postgres 계정, 없으면 계정 기능을 끈다.
 *
 * **메모리 저장소로 조용히 내려가지 않는다.** 서버를 재시작할 때마다 가입한 계정이
 * 사라지는데 그걸 모르고 쓰는 게 훨씬 나쁘기 때문이다.
 * 메모리 저장소는 테스트에서 직접 넣어 쓴다.
 */
export async function setupAuth(url = process.env.DATABASE_URL): Promise<AuthSetup> {
  const db = createPool(url)
  if (!db) return { accounts: null, db: null }

  const ok = await pingDb(db)
  if (!ok) {
    // 연결이 안 되면 서버를 띄우지 않는다 — 계정으로 로그인하려던 사람들이
    // 영문도 모르고 실패하는 것보다 지금 알아채는 게 낫다.
    throw new Error('DATABASE_URL 이 설정됐지만 DB 에 연결하지 못했습니다')
  }
  console.log('[DB] 연결됨 — 계정·전적·통계가 저장됩니다')
  return { accounts: new Accounts(new PostgresAccountStore(db)), db }
}

/** 테스트용 — DB 없이 계정 기능을 돌린다 */
export function memoryAuth(): { accounts: Accounts; store: MemoryAccountStore } {
  const store = new MemoryAccountStore()
  return { accounts: new Accounts(store), store }
}
