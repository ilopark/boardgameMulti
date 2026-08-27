/**
 * 붙어야 할 곳에 다 붙는지 확인한다.
 *
 *   npm run check:infra
 *
 * 서버를 띄우기 전에 이걸 먼저 돌리면, 게임 도중에 "어? DB 가 안 붙네" 를 겪지 않는다.
 * 어느 하나가 없어도 게임은 돌아가지만 **무엇이 꺼져 있는지 알고 쓰는 것**이 중요하다.
 */
import { loadEnv } from '../env.js'

loadEnv()

import { createRng } from '@bg/core'
import { Accounts } from '../auth/accounts.js'
import { MemoryAccountStore } from '../auth/memory-store.js'
import { PostgresAccountStore } from '../auth/pg-store.js'
import { closePool, createPool, pingDb } from '../db/pool.js'
import { RedisRoomStore } from '../store/redis.js'
import type { RoomSnapshot } from '../store/types.js'

const ok = (msg: string): void => console.log(`  [32m✓[0m ${msg}`)
const bad = (msg: string): void => console.log(`  [31m✗[0m ${msg}`)
const skip = (msg: string): void => {
  skipped++
  console.log(`  [33m–[0m ${msg}`)
}

let failed = false
let skipped = 0

async function checkDb(): Promise<void> {
  console.log('\nDB (Supabase)')
  const url = process.env.DATABASE_URL
  if (!url) {
    skip('DATABASE_URL 없음 — 계정 기능 없이 게스트로만 돌아갑니다')
    return
  }

  const db = createPool(url)
  if (!db) {
    bad('풀을 만들지 못했습니다')
    failed = true
    return
  }

  if (!(await pingDb(db))) {
    bad('연결 실패 — 접속 문자열과 비밀번호를 확인하세요')
    failed = true
    return
  }
  ok('연결됨')

  // 스키마가 실제로 올라가 있는지 (SQL 을 실행했는지) 확인한다
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'boardgame' order by table_name`,
  )
  const found = rows.map((r) => r.table_name)
  const need = ['auth_sessions', 'game_players', 'games', 'room_events', 'users', 'visits']
  const missing = need.filter((t) => !found.includes(t))

  if (missing.length > 0) {
    bad(`boardgame 스키마에 테이블이 없습니다: ${missing.join(', ')}`)
    bad('  → server/src/db/schema.sql 을 Supabase SQL Editor 에서 실행하세요')
    failed = true
  } else {
    ok(`테이블 ${found.length}개 확인 (${found.join(', ')})`)
  }

  // 실제로 쓰고 읽고 지울 수 있는지 — 권한 문제는 여기서 드러난다
  const accounts = new Accounts(new PostgresAccountStore(db))
  const probe = `_check_${Date.now().toString(36)}`
  try {
    const session = await accounts.signUp({
      username: probe,
      password: '점검용임시비밀번호',
      nickname: '점검',
    })
    const resumed = await accounts.resume(session.token)
    if (resumed?.id !== session.account.id) throw new Error('세션 복구 실패')
    ok('가입 · 로그인 · 세션 동작 확인')

    await db.query('delete from boardgame.users where id = $1', [session.account.id])
    ok('점검용 계정 정리 완료')
  } catch (err) {
    bad(`쓰기/읽기 실패: ${(err as Error).message}`)
    failed = true
  }
}

async function checkRedis(): Promise<void> {
  console.log('\nRedis')
  const url = process.env.REDIS_URL
  if (!url) {
    skip('REDIS_URL 없음 — 재시작하면 진행 중이던 방이 사라집니다')
    return
  }

  let store: RedisRoomStore | null = null
  try {
    store = await RedisRoomStore.connect(url)
    ok('연결됨')

    // 방 하나를 넣었다 빼서 실제로 오가는지 본다
    const probe = makeProbeRoom()
    await store.save(probe)
    const loaded = (await store.loadAll()).find((r) => r.code === probe.code)
    if (!loaded) throw new Error('저장한 방을 다시 읽지 못했습니다')

    // 난수가 이어지는지 — 재시작 내성의 핵심
    const revived = createRng(loaded.rngState!)
    const original = createRng(probe.rngState!)
    if (revived() !== original()) throw new Error('난수 상태가 이어지지 않습니다')
    ok('방 저장 · 복원 · 난수 이어받기 확인')

    await store.remove(probe.code)
    ok('점검용 방 정리 완료')
  } catch (err) {
    bad(`실패: ${(err as Error).message}`)
    failed = true
  } finally {
    await store?.close()
  }
}

function makeProbeRoom(): RoomSnapshot {
  const rng = createRng(12345)
  rng()
  return {
    code: `_CHK${Date.now().toString(36).toUpperCase().slice(-2)}`,
    game: 'skullking',
    hostId: 'probe',
    phase: 'lobby',
    visibility: 'private',
    title: null,
    players: [],
    options: {},
    dealerSeat: null,
    skGame: null,
    tichuGame: null,
    seatArrangement: null,
    tichuAutoPass: [false, false, false, false],
    rngState: rng.state,
    turnDeadline: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

async function checkPasswordHashing(): Promise<void> {
  console.log('\n비밀번호 해시')
  // 메모리 저장소로 가입·로그인을 한 바퀴 돌려 본다. DB 없이도 이 경로는 항상 검사한다.
  const accounts = new Accounts(new MemoryAccountStore())
  const started = Date.now()
  const session = await accounts.signUp({
    username: 'probe',
    password: '점검용임시비밀번호',
    nickname: '점검',
  })
  const elapsed = Date.now() - started
  const relogin = await accounts.logIn({ username: 'probe', password: '점검용임시비밀번호' })

  if (relogin.account.id !== session.account.id) {
    bad('로그인이 같은 계정을 돌려주지 않습니다')
    failed = true
    return
  }
  ok(`scrypt (Node 내장) — 해시 1회 ${elapsed}ms, 네이티브 빌드 필요 없음`)
}

async function main(): Promise<void> {
  console.log('연결 점검을 시작합니다')
  await checkPasswordHashing()
  await checkDb()
  await checkRedis()
  await closePool()

  // 검사하지 않은 걸 "정상" 이라고 말하면 안 된다.
  // 게임은 돌아가지만 무엇이 꺼져 있는지는 분명히 알려준다.
  if (failed) {
    console.log('\n[31m문제가 있습니다. 위 항목을 확인하세요.[0m\n')
  } else if (skipped > 0) {
    console.log(
      `\n[33m확인한 것은 정상이지만 ${skipped}개를 건너뛰었습니다.[0m\n` +
        '  .env 를 만들고 값을 채우면 그때부터 검사합니다 (cp .env.example .env)\n',
    )
  } else {
    console.log('\n[32m전부 정상입니다.[0m\n')
  }
  process.exit(failed ? 1 : 0)
}

void main()
