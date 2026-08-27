import { createClient, type RedisClientType } from 'redis'
import type { PublicRoomSummary } from '@bg/core'
import { isListable, sortForLobby, toSummary } from './summary.js'
import type { ListFilter, RoomSnapshot, RoomStore } from './types.js'

const KEY = (code: string): string => `room:${code}`
/** 지금 살아 있는 방 코드 모음. 만료된 코드는 읽을 때 게으르게 걷어낸다. */
const INDEX = 'rooms:index'

/**
 * 방을 얼마나 붙들고 있을지. 저장할 때마다 갱신되므로 "마지막 움직임 이후" 시간이다.
 * 한 판이 이보다 오래 걸릴 일은 없고, 버려진 방은 알아서 사라진다.
 */
const TTL_SECONDS = 6 * 60 * 60

/**
 * Redis 에 방을 담는다. 서버를 재시작해도 진행 중이던 판이 살아남는다.
 *
 * 한 가지 분명히 해둘 것: **이 저장소만으로 서버를 여러 대로 늘릴 수는 없다.**
 * 게임을 실제로 굴리는 건 각 프로세스의 메모리이고 Redis 는 그 사본이다.
 * 여러 대로 가려면 "방 코드 → 담당 서버" 고정(sticky routing)이 따로 필요하다.
 * 다만 그때 갈아끼울 자리는 여기 하나로 좁혀져 있다.
 */
export class RedisRoomStore implements RoomStore {
  private constructor(private readonly client: RedisClientType) {}

  static async connect(url: string): Promise<RedisRoomStore> {
    const client: RedisClientType = createClient({ url })
    // 연결이 끊겨도 프로세스를 죽이지 않는다 — 게임은 메모리에서 계속 굴러간다
    client.on('error', (err) => console.error('[Redis]', err))
    await client.connect()
    return new RedisRoomStore(client)
  }

  async loadAll(): Promise<RoomSnapshot[]> {
    const codes = await this.client.sMembers(INDEX)
    if (codes.length === 0) return []
    const raw = await this.client.mGet(codes.map(KEY))

    const rooms: RoomSnapshot[] = []
    const expired: string[] = []
    codes.forEach((code, i) => {
      const json = raw[i]
      if (typeof json !== 'string') {
        expired.push(code) // TTL 이 지나 사라진 방
        return
      }
      const parsed = parseSnapshot(json, code)
      if (parsed) rooms.push(parsed)
      else expired.push(code)
    })
    if (expired.length > 0) await this.client.sRem(INDEX, expired)
    return rooms
  }

  async save(snapshot: RoomSnapshot): Promise<void> {
    await this.client
      .multi()
      .set(KEY(snapshot.code), JSON.stringify(snapshot), { EX: TTL_SECONDS })
      .sAdd(INDEX, snapshot.code)
      .exec()
  }

  async remove(code: string): Promise<void> {
    await this.client.multi().del(KEY(code)).sRem(INDEX, code).exec()
  }

  async listPublic(filter: ListFilter = {}): Promise<PublicRoomSummary[]> {
    const all = await this.loadAll()
    return sortForLobby(all.filter((r) => isListable(r, filter)).map(toSummary))
  }

  async close(): Promise<void> {
    await this.client.quit()
  }
}

/** 깨진 JSON 하나가 로비 전체를 못 열게 만들면 안 된다 */
function parseSnapshot(json: string, code: string): RoomSnapshot | null {
  try {
    return JSON.parse(json) as RoomSnapshot
  } catch (err) {
    console.error(`[Redis] 방 ${code} 를 읽지 못했습니다 — 건너뜁니다`, err)
    return null
  }
}
