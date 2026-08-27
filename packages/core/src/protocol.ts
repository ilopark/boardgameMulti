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
  /** 방장이 추가한 봇. 서버가 자동으로 대신 행동한다. */
  isBot: boolean
}

/**
 * 공개방은 코드를 몰라도 로비 목록에서 눌러 들어간다.
 * 비밀방은 예전과 똑같이 코드를 아는 사람만 들어온다.
 */
export type RoomVisibility = 'public' | 'private'

/** 로비 목록에 한 줄로 뜨는 공개방. 방 안 내용(손패 등)은 절대 포함하지 않는다. */
export interface PublicRoomSummary {
  code: string
  game: GameId
  /** 방장이 붙인 이름. 없으면 클라이언트가 기본 문구를 만든다. */
  title: string | null
  hostNickname: string
  playerCount: number
  seatCount: number
  phase: RoomPhase
  /** 목록에 "500점" · "2021판" 같은 배지를 띄우려고 함께 준다 */
  options: Record<string, unknown>
  createdAt: number
}

export interface RoomPublic {
  code: string
  game: GameId
  hostId: string
  phase: RoomPhase
  visibility: RoomVisibility
  /** 공개방 이름. 비밀방이면 null */
  title: string | null
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

/** 방 안에서만 오가는 채팅 한 줄. 저장하지 않고 방이 사라지면 함께 사라진다. */
export interface ChatMessage {
  id: string
  /** 보낸 사람 영속 ID (내 메시지 구분용) */
  playerId: string
  nickname: string
  seat: number | null
  text: string
  /** 서버 기준 시각(epoch ms) */
  ts: number
}

/** 클라이언트 → 서버 */
export interface ClientToServer {
  'room:create': (
    p: { nickname: string; game: GameId; visibility?: RoomVisibility; title?: string },
    cb: (r: Ack<{ room: RoomPublic; identity: Identity }>) => void,
  ) => void
  /** 로비의 공개방 목록. 방에 들어가지 않아도 부를 수 있다. */
  'lobby:list': (
    p: { game?: GameId; waitingOnly?: boolean },
    cb: (r: Ack<{ rooms: PublicRoomSummary[] }>) => void,
  ) => void
  /** 방장이 공개/비밀과 방 이름을 바꾼다 (대기 중에만) */
  'room:visibility': (
    p: { visibility: RoomVisibility; title?: string },
    cb: (r: Ack<null>) => void,
  ) => void
  'room:join': (p: { code: string; nickname: string; identity?: Identity }, cb: (r: Ack<{ room: RoomPublic; identity: Identity }>) => void) => void
  'room:leave': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  'room:sit': (p: { seat: number }, cb: (r: Ack<null>) => void) => void
  'room:ready': (p: { ready: boolean }, cb: (r: Ack<null>) => void) => void
  'room:options': (p: { options: Record<string, unknown> }, cb: (r: Ack<null>) => void) => void
  'room:start': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 방장이 자리를 무작위로 섞는다. 입장 순서가 그대로 굳는 걸 막기 위한 것. */
  'room:shuffle': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 같은 방 사람들에게만 채팅을 보낸다 */
  'chat:send': (p: { text: string }, cb: (r: Ack<null>) => void) => void
  /** 방장이 빈자리에 봇을 추가한다. 봇은 서버가 자동으로 대신 행동한다. */
  'room:addBot': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 방장이 봇을 내보낸다 */
  'room:removeBot': (p: { playerId: string }, cb: (r: Ack<null>) => void) => void

  // ── 게임 진행 ──
  'game:bid': (p: { value: number }, cb: (r: Ack<null>) => void) => void
  'game:play': (p: { cardId: string; tigressAs?: 'pirate' | 'escape' }, cb: (r: Ack<null>) => void) => void
  /** 방장이 게임을 끝내고 대기실로 돌아간다 */
  'game:abort': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void

  // ── 티츄 전용 ──
  /** 8장 보고 그랜드 티츄를 부를지 결정 */
  'tichu:grand': (p: { call: boolean }, cb: (r: Ack<null>) => void) => void
  /** 교환할 3장 [왼쪽, 파트너, 오른쪽] */
  'tichu:pass3': (p: { cardIds: [string, string, string] }, cb: (r: Ack<null>) => void) => void
  /** 스몰 티츄 선언 */
  'tichu:call': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  'tichu:play': (
    p: { cardIds: string[]; phoenixAs?: number; asBomb?: boolean },
    cb: (r: Ack<null>) => void,
  ) => void
  'tichu:pass': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 폭탄 창구에서 "폭탄 내기" 예약 — 진행을 멈추고 제출 시간을 받는다 */
  'tichu:claimBomb': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /** 폭탄 예약 취소 */
  'tichu:cancelBomb': (p: Record<string, never>, cb: (r: Ack<null>) => void) => void
  /**
   * 이번 라운드 동안 자동으로 패스한다. 언제든 꺼서 취소할 수 있다.
   * 리드해야 하거나 마작 소원을 이행해야 하면 자동으로 풀린다.
   */
  'tichu:autopass': (p: { on: boolean }, cb: (r: Ack<null>) => void) => void
  /** 마작 소원. null이면 부르지 않음 */
  'tichu:wish': (p: { rank: number | null }, cb: (r: Ack<null>) => void) => void
  /** 용으로 딴 트릭을 상대팀 누구에게 줄지 */
  'tichu:dragon': (p: { to: number }, cb: (r: Ack<null>) => void) => void
}

/** 서버 → 클라이언트 */
export interface ServerToClient {
  'room:state': (room: RoomPublic) => void
  /**
   * 게임 상태. **받는 사람에 맞춰 가려진 뷰**라 사람마다 내용이 다르다.
   * view의 타입은 순환 참조를 피하려고 unknown으로 두고, 클라이언트가 캐스팅한다.
   */
  'game:view': (msg: GameViewMessage) => void
  /**
   * 방 전체에 잠깐 띄우는 알림. 티츄 선언처럼 **모두가 즉시 알아야 하는 일**에 쓴다.
   * 뷰에 실어보내면 다음 갱신 때 조용히 반영돼서 놓치기 쉽다.
   */
  'game:announce': (p: { kind: 'tichu' | 'grand'; seat: number; nickname: string }) => void
  'room:closed': (p: { reason: string }) => void
  /** 같은 방 사람들에게만 전달되는 채팅 */
  'chat:message': (p: ChatMessage) => void
  /** 서버가 판단한 에러를 토스트로 띄우기 위한 채널 */
  'error:toast': (p: { message: string }) => void
}

/**
 * 게임 뷰 + 진행 정보를 함께 담는다.
 *
 * 남은 시간을 **절대 시각이 아니라 남은 밀리초**로 보낸다.
 * 클라이언트 시계가 서버와 몇 초씩 어긋나는 경우가 흔해서,
 * 절대 시각을 보내면 카운트다운이 틀어진다.
 */
export interface GameViewMessage<V = unknown> {
  view: V
  /** 행동해야 하는 남은 시간(ms). null이면 제한 없음 */
  remainingMs: number | null
  /** 지금 기다리고 있는 좌석들 (입찰 단계면 여러 명) */
  waitingFor: number[]
  /** 티츄 전체 패스가 켜져 있는지 (받는 사람 기준) */
  autoPass?: boolean
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
