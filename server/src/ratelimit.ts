/**
 * 아주 단순한 시간창 방식 속도 제한.
 *
 * 필요한 곳은 두 군데다.
 *  1) 로그인 — 비밀번호를 계속 찍어보는 걸 막는다.
 *  2) 방 훔쳐보기 — 6자리 코드를 무작위로 넣어 남의 비밀방을 찾는 걸 막는다.
 *     코드 공간이 31^6 ≈ 8.8억이라 대입 자체가 비현실적이지만,
 *     막지 않으면 시도하는 쪽에 비용이 전혀 들지 않는다.
 *
 * 프로세스 메모리에만 있다. 서버를 여러 대로 늘리면 대당 한도가 되므로
 * 그때는 Redis 로 옮겨야 한다 — 지금은 한 대라 이걸로 충분하다.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 지금 요청을 허용할지. 허용하면 기록에 남긴다. */
  take(key: string): boolean {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const times = (this.hits.get(key) ?? []).filter((t) => t > cutoff)

    if (times.length >= this.limit) {
      // 막힌 시도도 기록에 남긴다 — 계속 두드리면 창이 계속 밀린다
      this.hits.set(key, times)
      return false
    }
    times.push(now)
    this.hits.set(key, times)
    return true
  }

  /** 로그인에 성공하면 그 사람의 실패 기록은 지운다 */
  clear(key: string): void {
    this.hits.delete(key)
  }

  /** 다시 시도할 수 있을 때까지 남은 초 (안내 문구용) */
  retryAfterSeconds(key: string): number {
    const times = this.hits.get(key)
    const oldest = times?.[0]
    if (!oldest) return 0
    return Math.max(1, Math.ceil((oldest + this.windowMs - Date.now()) / 1000))
  }

  /** 오래된 기록 청소. 주기적으로 부른다. */
  sweep(): void {
    const cutoff = Date.now() - this.windowMs
    for (const [key, times] of this.hits) {
      const live = times.filter((t) => t > cutoff)
      if (live.length === 0) this.hits.delete(key)
      else this.hits.set(key, live)
    }
  }

  get size(): number {
    return this.hits.size
  }
}

/**
 * 소켓에서 상대 IP 를 꺼낸다.
 *
 * Cloudflare 터널이나 리버스 프록시 뒤에 있으면 실제 주소가 헤더로 들어온다.
 * 헤더는 위조할 수 있지만, **우리 앞단이 프록시일 때만** 신뢰하도록
 * TRUST_PROXY 를 켠 경우에만 본다.
 */
export function clientIp(handshake: {
  address?: string
  headers?: Record<string, string | string[] | undefined>
}): string {
  if (process.env.TRUST_PROXY === '1') {
    const header = handshake.headers?.['cf-connecting-ip'] ?? handshake.headers?.['x-forwarded-for']
    const raw = Array.isArray(header) ? header[0] : header
    // x-forwarded-for 는 "실제IP, 프록시1, 프록시2" 형태라 맨 앞만 쓴다
    const first = raw?.split(',')[0]?.trim()
    if (first) return first
  }
  return handshake.address ?? 'unknown'
}
