import { MemoryRoomStore } from './memory.js'
import { RedisRoomStore } from './redis.js'
import type { RoomStore } from './types.js'

export type { ListFilter, PlayerSnapshot, RoomSnapshot, RoomStore } from './types.js'
export { MemoryRoomStore } from './memory.js'
export { RedisRoomStore } from './redis.js'
export { isListable, sortForLobby, toSummary } from './summary.js'

/**
 * REDIS_URL 이 있으면 Redis, 없으면 메모리.
 *
 * Redis 를 켜라고 했는데 연결이 안 되면 **서버를 띄우지 않는다.**
 * 조용히 메모리로 내려가면 "재시작해도 판이 살아있다"고 믿고 있다가
 * 정작 필요할 때 전부 날아가기 때문이다.
 */
export async function createRoomStore(url = process.env.REDIS_URL): Promise<RoomStore> {
  if (!url) {
    console.log('[저장소] 메모리 — 서버를 재시작하면 진행 중이던 방이 사라집니다 (REDIS_URL 미설정)')
    return new MemoryRoomStore()
  }
  const store = await RedisRoomStore.connect(url)
  console.log('[저장소] Redis 연결됨 — 재시작해도 진행 중인 방이 유지됩니다')
  return store
}
