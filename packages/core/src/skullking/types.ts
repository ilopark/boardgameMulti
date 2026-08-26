export type SkColor = 'green' | 'yellow' | 'purple' | 'black'

/** 검정(졸리로저)이 트럼프 */
export const TRUMP: SkColor = 'black'
export const COLORS: readonly SkColor[] = ['green', 'yellow', 'purple', 'black']

/** Legendary 확장의 고유 능력 해적 5인 */
export type PirateName = 'rosie' | 'bahij' | 'rascal' | 'juanita' | 'harry'
export const PIRATES: readonly PirateName[] = ['rosie', 'bahij', 'rascal', 'juanita', 'harry']

export type SkCard =
  | { id: string; kind: 'number'; color: SkColor; rank: number }
  | { id: string; kind: 'pirate'; pirate: PirateName }
  | { id: string; kind: 'escape' }
  | { id: string; kind: 'mermaid' }
  | { id: string; kind: 'skullking' }
  | { id: string; kind: 'tigress' }
  | { id: string; kind: 'kraken' }
  | { id: string; kind: 'whitewhale' }

export type SkCardKind = SkCard['kind']

/** 티그리스는 낼 때 해적/도주를 선언해야 한다. */
export type TigressAs = 'pirate' | 'escape'

export interface SkPlay {
  seat: number
  card: SkCard
  tigressAs?: TigressAs
}

export type BonusKind =
  | 'colored14'
  | 'black14'
  | 'skCapturesPirate'
  | 'mermaidCapturesSk'
  | 'pirateCapturesMermaid'

export interface BonusEvent {
  seat: number
  kind: BonusKind
  points: number
  /** UI에 "왜 받았는지" 보여주기 위한 설명 */
  detail: string
}

export interface TrickOutcome {
  /** 트릭 승자 좌석. 크라켄으로 소멸하면 null */
  winner: number | null
  /** 다음 트릭 리드 좌석. 크라켄 소멸 시에도 "크라켄이 없었다면 이겼을 사람" */
  nextLeader: number
  destroyed: boolean
  /** 리드색. 특수카드만 나왔으면 null */
  leadColor: SkColor | null
  /** 입찰 성공 시에만 실제 지급되는 보너스 후보 */
  bonuses: BonusEvent[]
  /** 판정 근거. UI 툴팁 + 디버깅 */
  reason: string
}
