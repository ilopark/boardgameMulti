/** 계정 하나. 비밀번호 해시는 이 타입 밖으로 나가지 않는다. */
export interface Account {
  id: string
  username: string
  nickname: string
  /** 닉네임이 겹쳐도 구분되도록 붙는 네 자리 (리로#4821) */
  tag: string
  createdAt: number
  isBanned: boolean
}

/** 로그인 결과로 브라우저가 들고 있게 되는 것 */
export interface AuthSession {
  /** 원문 토큰. **서버는 이 값을 저장하지 않는다** — 해시만 갖고 대조한다. */
  token: string
  expiresAt: number
  account: Account
}

/**
 * 계정 저장소.
 *
 * DATABASE_URL 이 없으면 계정 기능 전체가 꺼지고 게스트로만 논다.
 * 그래서 게임 서버는 이 인터페이스가 null 일 수 있다는 전제로 짜야 한다.
 */
export interface AccountStore {
  /** 아이디가 이미 쓰이고 있는지 (대소문자 무시) */
  isUsernameTaken(username: string): Promise<boolean>
  create(input: {
    username: string
    passwordHash: string
    nickname: string
    tag: string
  }): Promise<Account>
  /** 로그인 확인용. 해시가 필요하므로 이것만 예외적으로 함께 준다. */
  findForLogin(username: string): Promise<{ account: Account; passwordHash: string } | null>
  findById(id: string): Promise<Account | null>
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>
  touchLastSeen(userId: string): Promise<void>

  createSession(input: {
    userId: string
    tokenHash: string
    expiresAt: number
    ipHash: string | null
  }): Promise<void>
  /** 토큰 해시로 살아 있는 세션을 찾는다. 만료됐으면 null. */
  findSession(tokenHash: string): Promise<{ account: Account; expiresAt: number } | null>
  touchSession(tokenHash: string, expiresAt: number): Promise<void>
  deleteSession(tokenHash: string): Promise<void>
  /** 만료된 세션 청소. 주기적으로 부른다. */
  purgeExpiredSessions(): Promise<number>
}

export class AuthError extends Error {
  constructor(
    message: string,
    /** 클라이언트에 그대로 보여줘도 되는 메시지인지 */
    readonly safe = true,
  ) {
    super(message)
  }
}
