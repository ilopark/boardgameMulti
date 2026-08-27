import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN,
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from '../src/auth/password.js'

describe('비밀번호 해시', () => {
  it('맞는 비밀번호는 통과한다', async () => {
    const stored = await hashPassword('올바른말대추벌레건전지')
    expect(await verifyPassword('올바른말대추벌레건전지', stored)).toBe(true)
  })

  it('틀린 비밀번호는 막는다', async () => {
    const stored = await hashPassword('올바른말대추벌레건전지')
    expect(await verifyPassword('올바른말대추벌레건전기', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
    expect(await verifyPassword('올바른말대추벌레건전지 ', stored)).toBe(false)
  })

  it('저장된 값에 원문이 들어 있지 않다', async () => {
    const secret = 'MySecretPassword123'
    const stored = await hashPassword(secret)
    expect(stored).not.toContain(secret)
    expect(stored.toLowerCase()).not.toContain(secret.toLowerCase())
  })

  it('같은 비밀번호라도 저장값이 매번 다르다', async () => {
    // 소금이 매번 달라야 한다. 같으면 "이 두 사람은 비밀번호가 같다" 가 드러나고,
    // 미리 계산해 둔 표(레인보우 테이블)로 한 번에 뚫린다.
    const a = await hashPassword('같은비밀번호입니다')
    const b = await hashPassword('같은비밀번호입니다')
    expect(a).not.toBe(b)
    expect(await verifyPassword('같은비밀번호입니다', a)).toBe(true)
    expect(await verifyPassword('같은비밀번호입니다', b)).toBe(true)
  })

  it('유니코드 정규화가 다른 같은 글자도 통과한다', async () => {
    // macOS 와 Windows 는 한글을 다르게 분해해서 보낸다.
    // 정규화하지 않으면 "맥에서 만든 계정으로 윈도우에서 로그인이 안 되는" 일이 생긴다.
    const composed = '한글로만든비밀번호' // 완성형(NFC)
    const decomposed = composed.normalize('NFD')
    expect(composed).not.toBe(decomposed) // 바이트로는 다른 문자열

    const stored = await hashPassword(composed)
    expect(await verifyPassword(decomposed, stored)).toBe(true)
  })

  it('길이는 정규화한 뒤에 센다', async () => {
    // 분해형으로 오면 글자 수가 부풀어 보인다. 그걸로 통과시키면
    // 맥에서 만든 짧은 비밀번호가 윈도우에서는 로그인이 안 되는 일이 생긴다.
    const short = '한글비번' // 완성형 4자 → 거절되어야 한다
    expect(short.normalize('NFD').length).toBeGreaterThan(PASSWORD_MIN) // 분해하면 길어 보임
    expect(passwordProblem(short)).not.toBeNull()
    expect(passwordProblem(short.normalize('NFD'))).not.toBeNull()
  })

  it('저장 형식에 알고리즘 이름이 박혀 있다', async () => {
    // 나중에 argon2id 로 갈아탈 때 섞여 있는 값을 구분할 수 있어야 한다
    expect(await hashPassword('알고리즘표시확인')).toMatch(/^scrypt\$/)
  })
})

describe('깨진 저장값', () => {
  const junk = [
    '',
    'not-a-hash',
    'scrypt$',
    'scrypt$65536$8$1$onlyfourparts',
    'bcrypt$65536$8$1$c2FsdA==$aGFzaA==',
    'scrypt$abc$8$1$c2FsdA==$aGFzaA==',
    'scrypt$-1$8$1$c2FsdA==$aGFzaA==',
    'scrypt$0$8$1$c2FsdA==$aGFzaA==',
  ]

  it('던지지 않고 false 를 준다', async () => {
    // 로그인 창에서 예외가 새면 "이 계정만 뭔가 다르다" 는 힌트가 된다
    for (const stored of junk) {
      await expect(verifyPassword('아무비밀번호나입력', stored)).resolves.toBe(false)
    }
  })

  it('터무니없이 큰 N 은 계산하지 않고 거절한다', async () => {
    // 저장값이 조작됐을 때 서버가 메모리를 다 먹고 죽는 걸 막는다
    const evil = `scrypt$${2 ** 30}$8$1$c2FsdA==$aGFzaA==`
    const started = Date.now()
    expect(await verifyPassword('무엇이든', evil)).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('다시 해시해야 하는 값으로 표시된다', () => {
    for (const stored of junk) expect(needsRehash(stored)).toBe(true)
  })
})

describe('강도 갱신', () => {
  it('지금 강도로 만든 값은 그대로 둔다', async () => {
    expect(needsRehash(await hashPassword('충분히긴비밀번호'))).toBe(false)
  })

  it('예전에 약하게 만든 값은 다시 해시하라고 한다', () => {
    expect(needsRehash('scrypt$1024$8$1$c2FsdA==$aGFzaA==')).toBe(true)
  })
})

describe('입력 검사', () => {
  it('짧은 비밀번호를 거절한다', () => {
    expect(passwordProblem('short')).toContain(`${PASSWORD_MIN}자`)
    expect(passwordProblem('a'.repeat(PASSWORD_MIN))).toBeNull()
  })

  it('지나치게 긴 비밀번호를 거절한다', () => {
    // 긴 입력을 그대로 scrypt 에 넣으면 서버를 갈아 넣는 공격이 된다
    expect(passwordProblem('a'.repeat(5000))).toContain('너무 깁니다')
  })

  it('짧은 비밀번호는 해시 자체를 거부한다', async () => {
    await expect(hashPassword('1234')).rejects.toThrow()
  })
})

describe('작업 강도', () => {
  it('한 번 계산에 눈에 띄는 시간이 걸린다', async () => {
    // 너무 빠르면 무차별 대입을 막지 못한다. 20ms 는 아주 느슨한 하한선이다.
    const started = Date.now()
    await hashPassword('작업강도측정용비밀번호')
    expect(Date.now() - started).toBeGreaterThan(20)
  })
})
