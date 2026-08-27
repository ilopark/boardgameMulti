import { describe, expect, it } from 'vitest'
import { RateLimiter, clientIp } from '../src/ratelimit.js'

describe('속도 제한', () => {
  it('한도까지는 통과시킨다', () => {
    const rl = new RateLimiter(3, 60_000)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('a')).toBe(false)
  })

  it('키가 다르면 따로 센다', () => {
    const rl = new RateLimiter(1, 60_000)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('b')).toBe(true)
    expect(rl.take('a')).toBe(false)
  })

  it('시간창이 지나면 다시 열린다', async () => {
    const rl = new RateLimiter(1, 30)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('a')).toBe(false)
    await new Promise((r) => setTimeout(r, 40))
    expect(rl.take('a')).toBe(true)
  })

  it('성공하면 기록을 지울 수 있다', () => {
    const rl = new RateLimiter(2, 60_000)
    rl.take('a')
    rl.take('a')
    expect(rl.take('a')).toBe(false)
    rl.clear('a')
    expect(rl.take('a')).toBe(true)
  })

  it('막힌 뒤에도 계속 두드리면 계속 막힌다', () => {
    const rl = new RateLimiter(2, 60_000)
    rl.take('a')
    rl.take('a')
    for (let i = 0; i < 50; i++) expect(rl.take('a')).toBe(false)
  })

  it('남은 시간을 알려준다', () => {
    const rl = new RateLimiter(1, 10_000)
    expect(rl.retryAfterSeconds('a')).toBe(0) // 기록이 없으면 0
    rl.take('a')
    const wait = rl.retryAfterSeconds('a')
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(10)
  })

  it('오래된 기록을 청소한다', async () => {
    const rl = new RateLimiter(5, 20)
    rl.take('a')
    rl.take('b')
    expect(rl.size).toBe(2)
    await new Promise((r) => setTimeout(r, 30))
    rl.sweep()
    expect(rl.size).toBe(0)
  })
})

describe('IP 추출', () => {
  const withProxy = <T>(fn: () => T): T => {
    const before = process.env.TRUST_PROXY
    process.env.TRUST_PROXY = '1'
    try {
      return fn()
    } finally {
      if (before === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = before
    }
  }

  it('기본은 소켓 주소를 쓴다', () => {
    delete process.env.TRUST_PROXY
    expect(clientIp({ address: '1.2.3.4' })).toBe('1.2.3.4')
  })

  it('프록시를 안 믿으면 헤더를 무시한다', () => {
    // 헤더는 누구나 위조할 수 있다. 앞단이 프록시라고 우리가 정한 경우에만 본다.
    delete process.env.TRUST_PROXY
    expect(clientIp({ address: '1.2.3.4', headers: { 'x-forwarded-for': '9.9.9.9' } })).toBe('1.2.3.4')
  })

  it('프록시를 믿으면 헤더를 쓴다', () => {
    withProxy(() => {
      expect(clientIp({ address: '10.0.0.1', headers: { 'cf-connecting-ip': '5.6.7.8' } })).toBe('5.6.7.8')
    })
  })

  it('x-forwarded-for 는 맨 앞 주소만 쓴다', () => {
    withProxy(() => {
      expect(
        clientIp({ address: '10.0.0.1', headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.2, 10.0.0.3' } }),
      ).toBe('5.6.7.8')
    })
  })

  it('주소가 아무것도 없으면 unknown', () => {
    delete process.env.TRUST_PROXY
    expect(clientIp({})).toBe('unknown')
  })
})
