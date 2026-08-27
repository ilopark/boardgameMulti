import type { PublicRoomSummary } from '@bg/core'
import { isListable, sortForLobby, toSummary } from './summary.js'
import type { ListFilter, RoomSnapshot, RoomStore } from './types.js'

/**
 * 프로세스 안에서만 사는 저장소.
 *
 * Redis 를 안 켜고 돌릴 때(로컬 개발, 테스트)와, Redis 가 잠깐 죽었을 때의 대비책이다.
 * 서버를 재시작하면 방이 전부 사라진다 — 그게 이 구현의 한계이자 존재 이유다.
 */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomSnapshot>()

  loadAll(): Promise<RoomSnapshot[]> {
    return Promise.resolve([...this.rooms.values()])
  }

  save(snapshot: RoomSnapshot): Promise<void> {
    // 저장소 안의 값이 바깥에서 바뀌지 않도록 끊어서 넣는다
    this.rooms.set(snapshot.code, structuredClone(snapshot))
    return Promise.resolve()
  }

  remove(code: string): Promise<void> {
    this.rooms.delete(code)
    return Promise.resolve()
  }

  listPublic(filter: ListFilter = {}): Promise<PublicRoomSummary[]> {
    const out: PublicRoomSummary[] = []
    for (const room of this.rooms.values()) {
      if (isListable(room, filter)) out.push(toSummary(room))
    }
    return Promise.resolve(sortForLobby(out))
  }

  close(): Promise<void> {
    this.rooms.clear()
    return Promise.resolve()
  }
}
