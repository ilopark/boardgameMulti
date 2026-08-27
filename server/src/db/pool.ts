import pg from 'pg'

const { Pool } = pg

/**
 * Postgres 연결 풀.
 *
 * Supabase 무료 플랜은 동시 연결 수가 넉넉하지 않아서 풀을 작게 잡는다.
 * 게임 서버는 DB 를 자주 때리지 않는다 — 로그인, 판 시작·종료, 접속 기록 정도라
 * 몇 개면 충분하다. 게임 진행 자체는 메모리와 Redis 에서만 일어난다.
 */
const MAX_CLIENTS = 5

export type Db = pg.Pool

let pool: Db | null = null

/**
 * DATABASE_URL 이 없으면 null 을 준다 — **그리고 그건 정상이다.**
 * 계정 기능만 꺼지고 게스트로 게임은 그대로 돌아간다.
 */
export function createPool(url = process.env.DATABASE_URL): Db | null {
  if (!url) {
    console.log('[DB] DATABASE_URL 이 없습니다 — 계정 기능 없이 게스트로만 돌아갑니다')
    return null
  }
  pool = new Pool({
    connectionString: url,
    max: MAX_CLIENTS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Supabase 는 TLS 를 쓰지만 인증서 체인을 로컬에서 다 갖추기 번거롭다.
    // 연결 문자열에 sslmode 가 들어 있으면 pg 가 알아서 처리한다.
    ...(url.includes('sslmode=') ? {} : { ssl: { rejectUnauthorized: false } }),
  })

  // 유휴 커넥션이 끊겨도 프로세스를 죽이지 않는다. 게임은 DB 없이도 굴러간다.
  pool.on('error', (err) => console.error('[DB] 유휴 커넥션 오류', err))
  return pool
}

export function getPool(): Db | null {
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/** 연결이 실제로 되는지 한 번 확인한다. 서버 시작 로그에 찍으려고. */
export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.query('select 1')
    return true
  } catch (err) {
    console.error('[DB] 연결 확인 실패', err)
    return false
  }
}
