import { createHash, randomBytes, randomInt } from 'node:crypto'
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from './password.js'
import { AuthError, type Account, type AccountStore, type AuthSession } from './types.js'

/** 로그인 상태를 얼마나 유지할지. 쓸 때마다 다시 30일로 늘어난다. */
export const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const NICKNAME_MIN = 1
export const NICKNAME_MAX = 12

/**
 * 아이디에 허용하는 글자: 영문·숫자·밑줄.
 *
 * 한글을 막는 이유는 편의가 아니라 **보안**이다. 유니코드에는 눈으로 구분할 수 없는
 * 비슷한 글자가 많아서(키릴 'а' vs 라틴 'a'), 남의 아이디와 똑같아 보이는 계정을
 * 만들 수 있다. 닉네임은 한글을 자유롭게 쓸 수 있으니 표시에는 지장이 없다.
 */
const USERNAME_RE = /^[a-zA-Z0-9_]+$/

export function usernameProblem(username: string): string | null {
  if (typeof username !== 'string') return '아이디를 입력해 주세요'
  const v = username.trim()
  if (v.length < USERNAME_MIN) return `아이디는 ${USERNAME_MIN}자 이상이어야 합니다`
  if (v.length > USERNAME_MAX) return `아이디는 ${USERNAME_MAX}자 이하여야 합니다`
  if (!USERNAME_RE.test(v)) return '아이디는 영문·숫자·밑줄(_)만 쓸 수 있습니다'
  return null
}

export function nicknameProblem(nickname: string): string | null {
  if (typeof nickname !== 'string') return '닉네임을 입력해 주세요'
  // 화면을 깨뜨리는 제어문자와 좌우 공백을 먼저 걷어낸다
  const v = cleanNickname(nickname)
  if (v.length < NICKNAME_MIN) return '닉네임을 입력해 주세요'
  if (v.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}자 이하여야 합니다`
  return null
}

/**
 * 눈에 안 보이는 글자로 장난치는 걸 막는다.
 * 제어문자, 방향 바꾸기(RTL override), 폭 없는 공백을 지우고 공백을 하나로 접는다.
 */
export function cleanNickname(nickname: string): string {
  return nickname
    .normalize('NFC')
    // 제어문자 · 폭 없는 공백 · 방향 뒤집기(RTL override) 제거.
    // 이스케이프로 적는다 — 날것으로 박아 두면 나중에 아무도 못 읽고 못 고친다.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 닉네임이 겹쳐도 구분되도록 붙이는 네 자리 */
function makeTag(): string {
  return String(randomInt(0, 10000)).padStart(4, '0')
}

/** 세션 토큰은 저장하지 않고 이 해시만 저장한다 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  // 원문 IP 는 남기지 않는다. 같은 사람인지 세는 용도로만 쓴다.
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

export class Accounts {
  constructor(private readonly store: AccountStore) {}

  async signUp(input: {
    username: string
    password: string
    nickname: string
    ip?: string | null
  }): Promise<AuthSession> {
    const username = input.username.trim()
    const nickname = cleanNickname(input.nickname)

    for (const problem of [
      usernameProblem(username),
      passwordProblem(input.password),
      nicknameProblem(input.nickname),
    ]) {
      if (problem) throw new AuthError(problem)
    }

    if (await this.store.isUsernameTaken(username)) {
      throw new AuthError('이미 쓰이고 있는 아이디입니다')
    }

    const account = await this.store.create({
      username,
      passwordHash: await hashPassword(input.password),
      nickname,
      tag: makeTag(),
    })

    return this.issueSession(account, input.ip)
  }

  async logIn(input: { username: string; password: string; ip?: string | null }): Promise<AuthSession> {
    const found = await this.store.findForLogin(input.username.trim())

    if (!found) {
      // **아이디가 없을 때도 해시를 한 번 계산한다.**
      // 그러지 않으면 응답이 돌아오는 속도만 보고 어떤 아이디가 존재하는지 알아낼 수 있다.
      await verifyPassword(input.password, DUMMY_HASH)
      throw new AuthError('아이디 또는 비밀번호가 맞지 않습니다')
    }

    const ok = await verifyPassword(input.password, found.passwordHash)
    // 아이디가 틀렸는지 비밀번호가 틀렸는지 알려주지 않는다 — 알려주면 아이디 목록이 새어 나간다
    if (!ok) throw new AuthError('아이디 또는 비밀번호가 맞지 않습니다')

    if (found.account.isBanned) throw new AuthError('이용이 제한된 계정입니다')

    // 예전에 약한 강도로 만들어진 해시면 이 참에 조용히 올려둔다
    if (needsRehash(found.passwordHash)) {
      await this.store.updatePasswordHash(found.account.id, await hashPassword(input.password))
    }

    await this.store.touchLastSeen(found.account.id)
    return this.issueSession(found.account, input.ip)
  }

  /**
   * 브라우저가 들고 있던 토큰으로 로그인 상태를 되찾는다.
   * 쓸 때마다 만료를 다시 30일로 늘려서, 계속 오는 사람은 로그인이 풀리지 않는다.
   */
  async resume(token: string): Promise<Account | null> {
    if (!token) return null
    const tokenHash = hashToken(token)
    const found = await this.store.findSession(tokenHash)
    if (!found) return null
    if (found.account.isBanned) {
      await this.store.deleteSession(tokenHash)
      return null
    }
    await this.store.touchSession(tokenHash, Date.now() + SESSION_MS)
    await this.store.touchLastSeen(found.account.id)
    return found.account
  }

  async logOut(token: string): Promise<void> {
    if (token) await this.store.deleteSession(hashToken(token))
  }

  private async issueSession(account: Account, ip?: string | null): Promise<AuthSession> {
    // 32바이트 난수. 추측이 불가능하고, 서버에는 해시만 남는다.
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + SESSION_MS
    await this.store.createSession({
      userId: account.id,
      tokenHash: hashToken(token),
      expiresAt,
      ipHash: hashIp(ip),
    })
    return { token, expiresAt, account }
  }
}

/**
 * 없는 아이디로 로그인을 시도했을 때 시간을 맞추려고 돌리는 가짜 해시.
 * 실제 비밀번호와 무관하며 어떤 입력과도 일치하지 않는다.
 */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
