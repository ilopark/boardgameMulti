/**
 * 서버를 죽였다 살려도 진행 중이던 판이 살아남는지 확인한다.
 *
 * Redis 에 방을 저장하는 기능은 "평소엔 아무 일도 안 하다가 사고가 났을 때만"
 * 값을 하는 종류라, 일부러 사고를 내보지 않으면 망가진 걸 알 수가 없다.
 *
 *   1) 서버를 REDIS_URL 과 함께 띄운다
 *   2) node tools/restart-test.mjs setup     — 방 만들고 게임 시작, 손패를 적어둔다
 *   3) 서버를 kill -9 로 죽였다 다시 띄운다
 *   4) node tools/restart-test.mjs verify    — 같은 손패로 이어지는지 확인
 */
import { io } from 'socket.io-client'
import { readFileSync, writeFileSync } from 'node:fs'

const SERVER = process.env.TEST_URL ?? `http://localhost:${process.env.PORT ?? 3333}`
const STATE = new URL('./.restart-state.json', import.meta.url)
const phase = process.argv[2]

const connect = () =>
  new Promise((res, rej) => {
    const s = io(SERVER, { transports: ['websocket'] })
    s.on('connect', () => res(s))
    s.on('connect_error', rej)
    setTimeout(() => rej(new Error('연결 시간 초과')), 5000)
  })

const ask = (s, ev, payload) =>
  new Promise((res, rej) => {
    s.emit(ev, payload, (r) => (r.ok ? res(r.data) : rej(new Error(`${ev}: ${r.error}`))))
    setTimeout(() => rej(new Error(`${ev} 응답 없음`)), 5000)
  })

async function setup() {
  const host = await connect()
  const created = await ask(host, 'room:create', {
    nickname: '리로',
    game: 'skullking',
    visibility: 'public',
    title: '재시작 시험',
  })
  const code = created.room.code
  console.log(`방 ${code} 생성 (공개)`)

  // 봇 3명 채우고 시작
  for (let i = 0; i < 3; i++) await ask(host, 'room:addBot', {})
  await ask(host, 'room:ready', { ready: true })
  await ask(host, 'room:start', {})
  console.log('게임 시작')

  // 내 손패를 받아 적어둔다 — 재시작 뒤 같은 카드여야 한다
  const view = await new Promise((res) => host.on('game:view', (m) => res(m)))
  const hand = view.view.hand.map((c) => c.id).sort()
  console.log(`내 손패: ${hand.join(', ')}`)

  writeFileSync(
    STATE,
    JSON.stringify({ code, identity: created.identity, hand, round: view.view.round }, null, 2),
  )
  host.close()
  console.log('\n이제 서버를 죽였다 살린 뒤 verify 를 돌리세요')
}

async function verify() {
  const saved = JSON.parse(readFileSync(STATE, 'utf8'))
  const me = await connect()

  const joined = await ask(me, 'room:join', {
    code: saved.code,
    nickname: '리로',
    identity: saved.identity,
  })
  console.log(`방 ${saved.code} 재입장 — 단계: ${joined.room.phase}`)

  const view = await new Promise((res, rej) => {
    me.on('game:view', (m) => res(m))
    setTimeout(() => rej(new Error('game:view 안 옴 — 판이 사라졌습니다')), 5000)
  })

  const hand = view.view.hand.map((c) => c.id).sort()
  const same = JSON.stringify(hand) === JSON.stringify(saved.hand)

  console.log(`복원된 손패: ${hand.join(', ')}`)
  console.log(`라운드: ${saved.round} → ${view.view.round}`)
  console.log(`공개방 이름 유지: ${joined.room.title}`)
  console.log(`\n손패 동일: ${same ? '✅ 통과' : '❌ 다름'}`)
  console.log(`방 단계 유지: ${joined.room.phase === 'playing' ? '✅ 통과' : '❌ ' + joined.room.phase}`)

  // 로비 목록에도 살아 있는지
  const lobby = await ask(me, 'lobby:list', {})
  const found = lobby.rooms.find((r) => r.code === saved.code)
  console.log(`로비 목록에 남아있음: ${found ? '✅ 통과 (' + found.title + ')' : '❌ 없음'}`)

  me.close()
  process.exit(same && joined.room.phase === 'playing' && found ? 0 : 1)
}

await (phase === 'setup' ? setup() : verify())
process.exit(0)
