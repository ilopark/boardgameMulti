/**
 * 서버 ↔ 클라이언트 공용 프로토콜.
 * 서버가 모든 상태의 주인이고, 클라이언트는 자기가 볼 수 있는 것만 받는다.
 * (손패를 클라이언트에 보내고 숨기는 방식은 절대 금지 — 개발자도구로 다 보인다)
 */

export type GameId = 'tichu' | 'skullking'
export type RoomPhase = 'lobby' | 'playing' | 'finished'

export interface PlayerPublic {
  /** 소켓 ID와 별개인 영속 ID. 새로고침/재접속해도 자리를 유지한다. */
  id: string
  nickname: string
  seat: number | null
  connected: boolean
  ready: boolean
}

export interface RoomPublic {
  code: string
  game: GameId
  hostId: string
  phase: RoomPhase
  players: PlayerPublic[]
  seatCount: number
  /**
   * 이번 라운드 딜러 좌석. 게임 시작 시 **무작위**로 정해진다 (로비 입장 순서와 무관).
   * 라운드 첫 트릭은 딜러 왼쪽 사람이 리드하고, 라운드가 끝나면 딜러가 왼쪽으로 한 칸 이동한다.
   * 대기 중에는 null.
   */
  dealerSeat: number | null
  /** 게임별 룰 옵션 (스컬킹 SkRuleOptions 등) */
  options: Record<string, unknown>
}

export interface Ack<T> {
  ok: boolean
  error?: string
  data?: T
}

export interface Identity {
  playerId: string
  token: string
}

/** 클라이언트 → 서버 */
export interface ClientToServer {
  'room:create': (p: { nickname: string; game: GameId }, cb: (r: Ack<{ room: RoomPublic; identity: Identity }>) => void) => void
  'room:join': (p: { code: string; nickname: string; identity?: Identity }, cb: (r: Ack<{ room: RoomPublic; identity: Identity }>) => void) => void
  'room:leave': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  'room:sit': (p: { seat: number }, cb: (r: Ack<null>) => void) => void
  'room:ready': (p: { ready: boolean }, cb: (r: Ack<null>) => void) => void
  'room:options': (p: { options: Record<string, unknown> }, cb: (r: Ack<null>) => void) => void
  'room:start': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 방장이 자리를 무작위로 섞는다. 입장 순서가 그대로 굳는 걸 막기 위한 것. */
  'room:shuffle': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void

  // ── 게임 진행 ──
  'game:bid': (p: { value: number }, cb: (r: Ack<null>) => void) => void
  'game:play': (p: { cardId: string; tigressAs?: 'pirate' | 'escape' }, cb: (r: Ack<null>) => void) => void
  /** 트릭/라운드 결과를 다 봤으니 넘어가자 (전원이 누르면 타이머를 기다리지 않는다) */
  'game:ready': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 방장이 게임을 끝내고 대기실로 돌아간다 */
  'game:abort': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
}

/** 서버 → 클라이언트 */
export interface ServerToClient {
  'room:state': (room: RoomPublic) => void
  /**
   * 게임 상태. **받는 사람에 맞춰 가려진 뷰**라 사람마다 내용이 다르다.
   * 타입은 순환 참조를 피하려고 unknown으로 두고, 클라이언트가 SkPlayerView로 캐스팅한다.
   */
  'game:view': (view: unknown) => void
  /** 결과 화면에서 몇 명이 "다음"을 눌렀는지 */
  'game:ready': (p: { ready: number; total: number }) => void
  'room:closed': (p: { reason: string }) => void
  /** 서버가 판단한 에러를 토스트로 띄우기 위한 채널 */
  'error:toast': (p: { message: string }) => void
}

export const SEAT_COUNT: Record<GameId, number> = {
  tichu: 4,
  skullking: 6,
}

/**
 * 시작 가능한 최소 인원.
 * 티츄는 2:2 팀전이라 정확히 4명이어야 한다.
 * 스컬킹은 공식 룰북이 2~6명이고, 2인은 Graybeard's Ghost 변형으로 돌아간다.
 */
export const MIN_PLAYERS: Record<GameId, number> = {
  tichu: 4,
  skullking: 2,
}

export const GAME_LABEL: Record<GameId, string> = {
  tichu: '티츄',
  skullking: '스컬킹',
}

/** 마지막 글자에 받침이 있는가 */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1)
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false
  return (code - 0xac00) % 28 !== 0
}

/**
 * 한글 조사 붙이기. `은(는)` 같은 표기를 피하려고 쓴다.
 * josa('스컬킹', '은는') → '스컬킹은',  josa('티츄', '은는') → '티츄는'
 */
export function josa(word: string, pair: '은는' | '이가' | '을를' | '와과' | '으로로'): string {
  if (pair === '으로로') {
    const code = word.charCodeAt(word.length - 1)
    const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0
    // ㄹ받침(8)은 '로'를 쓴다
    return word + (jong === 0 || jong === 8 ? '로' : '으로')
  }
  return word + (hasBatchim(word) ? pair[0] : pair[1])
}
