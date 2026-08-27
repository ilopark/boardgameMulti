import { beforeEach, describe, expect, it } from 'vitest'
import { createRng, skullking } from '@bg/core'
import {
  addBot,
  addPlayer,
  allRooms,
  createRoom,
  deleteRoom,
  fromSnapshot,
  getRoom,
  restoreAll,
  toSnapshot,
} from '../src/rooms.js'
import { MemoryRoomStore } from '../src/store/index.js'
import { isListable, sortForLobby, toSummary } from '../src/store/summary.js'
import type { RoomSnapshot } from '../src/store/index.js'

const SK_OPTS = skullking.SK_PRESETS.edition2021

function freshRoom(visibility: 'public' | 'private' = 'private', title: string | null = null) {
  const room = createRoom('skullking', { ...SK_OPTS }, visibility, title)
  return room
}

/** 테스트끼리 방이 새지 않게 매번 비운다 */
beforeEach(() => {
  for (const r of allRooms()) deleteRoom(r.code)
})

describe('방 스냅샷', () => {
  it('저장했다 되살려도 사람과 자리가 그대로다', () => {
    const room = freshRoom('public', '초보 환영')
    const a = addPlayer(room, '리로')
    const b = addPlayer(room, '친구')
    a.seat = 0
    b.seat = 1
    b.ready = true
    addBot(room)

    const revived = roundTrip(room.code)

    expect(revived.code).toBe(room.code)
    expect(revived.visibility).toBe('public')
    expect(revived.title).toBe('초보 환영')
    expect(revived.hostId).toBe(a.id)
    expect(revived.players.size).toBe(3)
    expect(revived.players.get(a.id)?.seat).toBe(0)
    expect(revived.players.get(b.id)?.seat).toBe(1)
    expect(revived.players.get(b.id)?.ready).toBe(true)
    expect([...revived.players.values()].filter((p) => p.isBot)).toHaveLength(1)
  })

  it('되살린 사람은 전원 끊긴 상태로 시작한다', () => {
    const room = freshRoom()
    const me = addPlayer(room, '리로')
    me.socketId = 'socket-abc' // 살아 있던 연결

    const revived = roundTrip(room.code)

    // 소켓 ID 는 프로세스가 바뀌면 의미가 없다
    expect(revived.players.get(me.id)?.socketId).toBeNull()
  })

  it('되살릴 때 사람의 끊긴 시각을 지금으로 다시 잡는다', () => {
    // 서버가 죽어 있던 시간을 "자리 비운 시간" 으로 계산하면
    // 재시작 직후 전원이 유예시간 초과로 쫓겨난다.
    const room = freshRoom()
    const me = addPlayer(room, '리로')
    me.disconnectedAt = Date.now() - 60 * 60_000 // 한 시간 전

    const before = Date.now()
    const revived = roundTrip(room.code)

    const at = revived.players.get(me.id)?.disconnectedAt
    expect(at).not.toBeNull()
    expect(at!).toBeGreaterThanOrEqual(before)
  })

  it('봇은 끊긴 것으로 치지 않는다', () => {
    const room = freshRoom()
    addPlayer(room, '리로')
    const bot = addBot(room)!

    const revived = roundTrip(room.code)
    expect(revived.players.get(bot.id)?.disconnectedAt).toBeNull()
  })

  it('타이머 핸들은 넘어가지 않는다', () => {
    const room = freshRoom()
    addPlayer(room, '리로')
    room.advanceTimer = setTimeout(() => {}, 60_000)
    room.turnTimer = setTimeout(() => {}, 60_000)

    const snapshot = toSnapshot(room)
    expect(JSON.stringify(snapshot)).not.toContain('Timeout')

    clearTimeout(room.advanceTimer)
    clearTimeout(room.turnTimer)

    const revived = fromSnapshot(snapshot)
    expect(revived.advanceTimer).toBeNull()
    expect(revived.botTimer).toBeNull()
    expect(revived.turnTimer).toBeNull()
  })

  it('턴 마감 시각은 그대로 살린다', () => {
    const room = freshRoom()
    addPlayer(room, '리로')
    room.turnDeadline = 1_700_000_000_000

    expect(roundTrip(room.code).turnDeadline).toBe(1_700_000_000_000)
  })

  it('스냅샷은 JSON 으로 온전히 오간다', () => {
    const room = freshRoom('public', '방 이름')
    addPlayer(room, '리로')
    addBot(room)
    room.rng = createRng(4242)
    room.skGame = skullking.createGame(2, SK_OPTS, 0, room.rng)

    const snapshot = toSnapshot(room)
    const json = JSON.stringify(snapshot)
    expect(JSON.parse(json)).toEqual(snapshot)
  })
})

describe('스냅샷 안의 난수', () => {
  it('재시작 뒤에도 카드가 원래 순서대로 나온다', () => {
    const room = freshRoom()
    addPlayer(room, '리로')
    room.rng = createRng(99)
    for (let i = 0; i < 25; i++) room.rng() // 몇 라운드 진행된 셈

    // 저장은 여기서 일어난다 — 이 시점 이후의 수열이 그대로 이어져야 한다
    const snapshot = JSON.parse(JSON.stringify(toSnapshot(room))) as RoomSnapshot

    // 재시작이 없었다면 이렇게 나왔을 값
    const expected = Array.from({ length: 20 }, () => room.rng!())

    // 되살린 방에서 뽑은 값
    const revived = fromSnapshot(snapshot)
    const actual = Array.from({ length: 20 }, () => revived.rng!())

    expect(actual).toEqual(expected)
  })

  it('게임을 시작하지 않은 방은 난수가 null 이다', () => {
    const room = freshRoom()
    addPlayer(room, '리로')
    expect(toSnapshot(room).rngState).toBeNull()
    expect(fromSnapshot(toSnapshot(room)).rng).toBeNull()
  })
})

describe('로비 목록', () => {
  it('공개방만 뜬다', async () => {
    const store = new MemoryRoomStore()
    await store.save(withHuman(freshRoom('public', '공개')))
    await store.save(withHuman(freshRoom('private')))

    const list = await store.listPublic()
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('공개')
  })

  it('사람 없이 봇만 남은 방은 숨긴다', async () => {
    const room = freshRoom('public', '유령방')
    addBot(room)
    const store = new MemoryRoomStore()
    await store.save(toSnapshot(room))

    expect(await store.listPublic()).toHaveLength(0)
  })

  it('게임 종류로 거를 수 있다', async () => {
    const store = new MemoryRoomStore()
    await store.save(withHuman(freshRoom('public', '스컬킹방')))
    const tichuRoom = createRoom('tichu', {}, 'public', '티츄방')
    await store.save(withHuman(tichuRoom))

    expect((await store.listPublic({ game: 'tichu' })).map((r) => r.title)).toEqual(['티츄방'])
  })

  it('대기중만 보기', () => {
    const waiting = withHuman(freshRoom('public', '대기'))
    const playing = { ...withHuman(freshRoom('public', '진행')), phase: 'playing' as const }

    expect(isListable(waiting, { waitingOnly: true })).toBe(true)
    expect(isListable(playing, { waitingOnly: true })).toBe(false)
    expect(isListable(playing)).toBe(true)
  })

  it('대기중이 진행중보다 먼저, 그 안에서는 최근 방부터', () => {
    const mk = (phase: 'lobby' | 'playing', createdAt: number, title: string) => ({
      ...toSummary(withHuman(freshRoom('public', title))),
      phase,
      createdAt,
    })
    const sorted = sortForLobby([
      mk('playing', 300, '진행-새것'),
      mk('lobby', 100, '대기-옛것'),
      mk('lobby', 200, '대기-새것'),
    ])
    expect(sorted.map((r) => r.title)).toEqual(['대기-새것', '대기-옛것', '진행-새것'])
  })

  it('목록에 손패나 토큰이 절대 실리지 않는다', async () => {
    const room = freshRoom('public', '방')
    const me = addPlayer(room, '리로')
    room.rng = createRng(1)
    room.skGame = skullking.createGame(2, SK_OPTS, 0, room.rng)

    const store = new MemoryRoomStore()
    await store.save(toSnapshot(room))
    const json = JSON.stringify(await store.listPublic())

    expect(json).not.toContain(me.token)
    expect(json).not.toContain('hands')
    expect(json).not.toContain('bids')
  })
})

describe('MemoryRoomStore', () => {
  it('넣고 빼고 지운다', async () => {
    const store = new MemoryRoomStore()
    const snapshot = withHuman(freshRoom('public', '방'))

    await store.save(snapshot)
    expect(await store.loadAll()).toHaveLength(1)

    await store.remove(snapshot.code)
    expect(await store.loadAll()).toHaveLength(0)
  })

  it('저장한 뒤 원본을 바꿔도 저장소 안은 안 바뀐다', async () => {
    const store = new MemoryRoomStore()
    const snapshot = withHuman(freshRoom('public', '원래이름'))
    await store.save(snapshot)

    snapshot.title = '바뀐이름'

    const [stored] = await store.loadAll()
    expect(stored!.title).toBe('원래이름')
  })

  it('restoreAll 로 여러 방을 한 번에 되살린다', () => {
    const a = withHuman(freshRoom('public', 'A'))
    const b = withHuman(freshRoom('private'))
    for (const r of allRooms()) deleteRoom(r.code)
    expect(allRooms()).toHaveLength(0)

    expect(restoreAll([a, b])).toBe(2)
    expect(getRoom(a.code)?.title).toBe('A')
    expect(getRoom(b.code)?.visibility).toBe('private')
  })
})

// ── 도우미 ──

function roundTrip(code: string) {
  const room = getRoom(code)!
  const json = JSON.stringify(toSnapshot(room))
  deleteRoom(code)
  return fromSnapshot(JSON.parse(json) as RoomSnapshot)
}

function withHuman(room: ReturnType<typeof createRoom>): RoomSnapshot {
  addPlayer(room, '리로')
  return toSnapshot(room)
}
