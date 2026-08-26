/**
 * 테스트용 봇. 혼자서도 게임을 돌려볼 수 있게 만든 도구다.
 *
 *   npm run bots -- ABC123              # 빈자리를 봇으로 채운다
 *   npm run bots -- ABC123 철수 영희     # 이름을 직접 지정
 *
 * 봇은 규칙만 지키는 수준으로 아무거나 낸다. 전략은 없다.
 */
import { io } from 'socket.io-client'

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3001'
const [code, ...names] = process.argv.slice(2)

if (!code) {
  console.error('사용법: npm run bots -- <방코드> [봇이름...]')
  process.exit(1)
}

const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const connect = () =>
  new Promise((res, rej) => {
    const s = io(SERVER, { transports: ['websocket'] })
    const t = setTimeout(() => rej(new Error('서버에 연결할 수 없습니다: ' + SERVER)), 8000)
    s.on('connect', () => {
      clearTimeout(t)
      res(s)
    })
    s.on('connect_error', (e) => {
      clearTimeout(t)
      rej(e)
    })
  })

const DEFAULT_NAMES = ['봇하나', '봇둘', '봇셋', '봇넷', '봇다섯']

/**
 * 방에 남은 자리 수를 알아내서 그만큼 채운다.
 *
 * 확인용으로 잠깐 들어갔다 나오는데, **반드시 room:leave로 나가야 한다.**
 * 그냥 연결만 끊으면 재접속 유예 때문에 자리를 계속 차지하고 있어서
 * 마지막 봇이 "방이 가득 찼습니다"로 튕긴다.
 */
async function seatsToFill() {
  const probe = await connect()
  const state = await new Promise((res) => {
    probe.once('room:state', res)
    void ask(probe, 'room:join', { code, nickname: '__probe__' })
  }).catch(() => null)
  await ask(probe, 'room:leave', {}).catch(() => {})
  probe.close()
  await wait(150)
  if (!state) return 0
  const taken = state.players.filter((p) => p.nickname !== '__probe__').length
  return Math.max(0, state.seatCount - taken)
}

/**
 * 봇 하나. 이벤트로 바로 처리하지 않고 **최신 뷰를 저장해두고 루프에서 처리**한다.
 * 이벤트 핸들러 안에서 await 하다 보면 그 사이 도착한 뷰를 놓쳐서 판이 멈춘다.
 */
async function runBot(nickname) {
  const s = await connect()
  const joined = await ask(s, 'room:join', { code, nickname })
  if (!joined.ok) {
    console.error(`  ${nickname}: ${joined.error}`)
    s.close()
    return null
  }
  await ask(s, 'room:ready', { ready: true })
  console.log(`  ${nickname} 입장`)

  let latest = null
  s.on('game:view', (msg) => {
    latest = msg
  })

  const loop = async () => {
    let lastSignature = ''
    for (;;) {
      await wait(300)
      if (!latest) continue
      const v = latest.view
      // 같은 상황에서 같은 행동을 반복하지 않도록 서명을 만든다
      const sig = JSON.stringify([v.phase, v.turn, v.hand?.length, v.myBid, v.grandDecided, v.passSubmitted])
      if (sig === lastSignature) continue
      const acted = await act(s, v)
      if (acted) lastSignature = sig
    }
  }
  void loop()
  return s
}

/** 상황에 맞는 행동 하나. 실제로 뭔가 했으면 true */
async function act(s, v) {
  // ── 스컬킹 ──
  if ('cardCount' in v) {
    if (v.phase === 'bidding' && v.myBid === null) {
      await wait(600)
      return (await ask(s, 'game:bid', { value: Math.floor(Math.random() * (v.cardCount + 1)) })).ok
    }
    if (v.phase === 'playing' && v.currentSeat === v.seat && v.legal?.length) {
      await wait(900)
      const id = v.legal[Math.floor(Math.random() * v.legal.length)]
      const card = v.hand.find((c) => c.id === id)
      const payload =
        card?.kind === 'tigress'
          ? { cardId: id, tigressAs: Math.random() < 0.5 ? 'pirate' : 'escape' }
          : { cardId: id }
      return (await ask(s, 'game:play', payload)).ok
    }
    return false
  }

  // ── 티츄 ──
  if (v.phase === 'grandTichu' && !v.grandDecided) {
    await wait(900)
    return (await ask(s, 'tichu:grand', { call: false })).ok
  }
  if (v.phase === 'passing' && !v.passSubmitted) {
    await wait(1200)
    return (await ask(s, 'tichu:pass3', { cardIds: v.hand.slice(0, 3).map((c) => c.id) })).ok
  }
  if (v.phase === 'dragonGift' && v.dragonTargets?.length) {
    await wait(700)
    return (await ask(s, 'tichu:dragon', { to: v.dragonTargets[0] })).ok
  }
  if (v.phase === 'playing' && v.turn === v.seat) {
    await wait(1100)
    // 약한 것부터 한 장씩 시도. 리드가 아니면 개는 건너뛴다.
    const sorted = [...v.hand].sort(
      (a, b) => (a.kind === 'number' ? a.rank : 99) - (b.kind === 'number' ? b.rank : 99),
    )
    for (const card of sorted) {
      if (card.kind === 'dog' && v.current !== null) continue
      if ((await ask(s, 'tichu:play', { cardIds: [card.id] })).ok) return true
    }
    return (await ask(s, 'tichu:pass', {})).ok
  }
  return false
}

const count = names.length > 0 ? names.length : await seatsToFill()
if (count <= 0) {
  console.log('빈자리가 없습니다.')
  process.exit(0)
}
const finalNames = names.length > 0 ? names : DEFAULT_NAMES.slice(0, count)

console.log(`방 ${code}에 봇 ${finalNames.length}명 투입`)
const socks = []
for (const n of finalNames) {
  const s = await runBot(n)
  if (s) socks.push(s)
}
if (socks.length === 0) {
  console.error('봇이 한 명도 못 들어갔습니다.')
  process.exit(1)
}
console.log('봇 대기 중. 종료하려면 Ctrl+C')

const stop = () => {
  for (const s of socks) s.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
