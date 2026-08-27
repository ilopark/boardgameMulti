import type { GameId, PublicRoomSummary, RoomPhase, RoomVisibility, skullking, tichu } from '@bg/core'

/**
 * 저장소에 들어가는 방.
 *
 * 프로세스에만 존재하는 것들(타이머 핸들, 소켓 ID, 난수 함수 인스턴스)은 빠져 있다.
 * 난수는 함수 대신 `rngState` 숫자 하나로 들어가고, 되살릴 때 `createRng(rngState)` 로 복원한다.
 * 이 값 덕분에 서버가 재시작해도 남은 카드가 원래 나왔을 순서 그대로 나온다.
 */
export interface RoomSnapshot {
  code: string
  game: GameId
  hostId: string
  phase: RoomPhase
  visibility: RoomVisibility
  title: string | null
  /** Map 은 JSON 이 못 담아서 배열로 눕힌다 */
  players: PlayerSnapshot[]
  options: Record<string, unknown>
  dealerSeat: number | null
  skGame: skullking.SkGameState | null
  tichuGame: tichu.TichuGameState | null
  seatArrangement: number[] | null
  tichuAutoPass: boolean[]
  /** mulberry32 내부 상태. 게임을 아직 안 시작했으면 null */
  rngState: number | null
  /**
   * 지금 턴의 마감 시각(epoch ms).
   * 되살릴 때 이미 지났으면 곧바로 시간초과 처리한다.
   */
  turnDeadline: number | null
  createdAt: number
  updatedAt: number
}

export interface PlayerSnapshot {
  id: string
  token: string
  nickname: string
  seat: number | null
  ready: boolean
  isBot: boolean
  /**
   * 스냅샷에는 socketId 가 없다 — 서버가 바뀌면 의미가 없는 값이라
   * 되살릴 때 전원 "끊김" 으로 시작하고, 각자 재접속하면서 자리를 되찾는다.
   */
  disconnectedAt: number | null
  /** 로그인한 계정이면 그 id. 게스트면 null (전적을 남기지 않는다) */
  userId: string | null
}

export interface ListFilter {
  game?: GameId
  /** 대기 중인 방만 (기본값: 전부) */
  waitingOnly?: boolean
}

/**
 * 진행 중인 방을 담아두는 곳.
 *
 * 메모리 구현은 이 프로세스 안에서만 살고, Redis 구현은 재시작을 넘겨 살아남는다.
 * 어느 쪽이든 게임 로직은 이걸 몰라도 되게 인터페이스 뒤에 숨긴다.
 */
export interface RoomStore {
  /** 서버가 뜰 때 되살릴 방 전부 */
  loadAll(): Promise<RoomSnapshot[]>
  save(snapshot: RoomSnapshot): Promise<void>
  remove(code: string): Promise<void>
  /** 로비에 띄울 공개방 목록 */
  listPublic(filter?: ListFilter): Promise<PublicRoomSummary[]>
  close(): Promise<void>
}
