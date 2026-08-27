import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * 비밀번호 해시.
 *
 * **되돌릴 수 없다.** 서버도, DB 를 통째로 가져간 사람도 원문을 알 수 없다.
 * 로그인은 "받은 비밀번호를 같은 방식으로 해시해서 저장된 값과 같은지" 로만 확인한다.
 *
 * scrypt 를 쓰는 이유: Node 에 내장돼 있어 네이티브 빌드가 필요 없다.
 * argon2id 가 요즘 더 권장되지만 alpine(musl)+ARM 에서 빌드가 자주 깨지고,
 * 이 파일 뒤에 숨겨 뒀으므로 나중에 갈아끼우는 건 여기만 고치면 된다.
 * (그래서 저장 형식 맨 앞에 알고리즘 이름을 박아 둔다 — 섞여 있어도 구분된다)
 */

/**
 * scrypt 작업 강도.
 * N=2^16 은 한 번 계산에 약 100ms 안팎이 걸리도록 잡은 값이다.
 * 로그인 한 번에 100ms 는 사람이 못 느끼지만, 무차별 대입에는 치명적으로 느리다.
 */
const N = 65536
const R = 8
const P = 1
const KEYLEN = 64
const SALT_BYTES = 16
/** N*r*128 보다 넉넉해야 한다. 안 그러면 scrypt 가 메모리 초과로 던진다. */
const MAXMEM = 128 * N * R * 2

const PREFIX = 'scrypt'

/** 저장 형식: scrypt$N$r$p$소금(base64)$해시(base64) */
export async function hashPassword(password: string): Promise<string> {
  assertUsable(password)
  const salt = randomBytes(SALT_BYTES)
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return [PREFIX, N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

/**
 * 맞는 비밀번호인지 확인한다.
 *
 * 저장된 값이 깨졌거나 형식이 낯설면 **던지지 않고 false** 를 준다.
 * 로그인 창에서 예외가 새어 나가면 "이 계정은 뭔가 다르다" 는 힌트가 되기 때문이다.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false
  try {
    const key = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * parsed.N * parsed.r * 2,
    })
    // 길이가 다르면 timingSafeEqual 이 던진다
    if (key.length !== parsed.hash.length) return false
    // 앞에서부터 한 글자씩 비교하면 걸린 시간으로 몇 글자까지 맞았는지가 새어 나간다
    return timingSafeEqual(key, parsed.hash)
  } catch {
    return false
  }
}

/** 저장된 해시가 지금 쓰는 강도보다 약하면 로그인 성공 시 조용히 다시 해시한다 */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored)
  if (!parsed) return true
  return parsed.N < N || parsed.r < R || parsed.p < P
}

interface Parsed {
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

function parse(stored: string): Parsed | null {
  const parts = stored.split('$')
  if (parts.length !== 6) return null
  const [prefix, n, r, p, salt, hash] = parts as [string, string, string, string, string, string]
  if (prefix !== PREFIX) return null

  const N_ = Number(n)
  const r_ = Number(r)
  const p_ = Number(p)
  if (!isPositiveInt(N_) || !isPositiveInt(r_) || !isPositiveInt(p_)) return null
  // 저장된 값이 조작돼 터무니없이 큰 N 이 들어오면 서버가 메모리를 다 먹는다
  if (N_ > 1 << 20 || r_ > 64 || p_ > 16) return null

  try {
    return { N: N_, r: r_, p: p_, salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') }
  } catch {
    return null
  }
}

function isPositiveInt(v: number): boolean {
  return Number.isInteger(v) && v > 0
}

/** 최소 8자. 최대 200자 — 너무 긴 입력으로 서버를 갈아 넣는 걸 막는다. */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string') return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다`
  // **길이는 반드시 정규화한 뒤에 센다.**
  // 한글 '한글비번' 은 완성형(NFC)이면 4자지만 분해형(NFD)이면 11자다.
  // 정규화하지 않으면 같은 비밀번호가 맥에서는 통과하고 윈도우에서는 거절된다.
  const normalized = password.normalize('NFKC')
  if (normalized.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다`
  if (normalized.length > PASSWORD_MAX) return `비밀번호가 너무 깁니다 (최대 ${PASSWORD_MAX}자)`
  return null
}

function assertUsable(password: string): void {
  const problem = passwordProblem(password)
  if (problem) throw new Error(problem)
}
