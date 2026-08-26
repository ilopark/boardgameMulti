import type { tichu } from '@bg/core'

type TCard = tichu.TichuCard

/**
 * 티츄 카드 그림.
 *
 * 티츄의 4문양(옥·검·탑·별)은 트럼프 4문양과 구조가 1:1이라 그대로 매핑한다.
 * 파일은 `src/assets/tichu/` 에 있고, 빌드 시점에 실제로 있는 것만 등록된다.
 */
const IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../assets/tichu/*.{png,jpg,jpeg,webp}', {
      eager: true,
      query: '?url',
      import: 'default',
    }) as Record<string, string>,
  ).map(([path, url]) => [path.replace(/^.*\/(.+)\.\w+$/, '$1'), url]),
)

/** 티츄 문양 → 트럼프 문양 파일 접미사 */
const SUIT_FILE: Record<string, string> = {
  sword: 'S', // 검 → 스페이드
  jade: 'C', // 옥 → 클로버
  pagoda: 'H', // 탑 → 하트
  star: 'D', // 별 → 다이아
}

const SUIT_LABEL: Record<string, string> = {
  sword: '검',
  jade: '옥',
  pagoda: '탑',
  star: '별',
}

const RANK_FILE: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

export function rankLabel(rank: number): string {
  return RANK_FILE[rank] ?? String(rank)
}

export function tichuCardLabel(card: TCard): string {
  switch (card.kind) {
    case 'number':
      return `${SUIT_LABEL[card.suit]}${rankLabel(card.rank)}`
    case 'mahjong':
      return '마작(1)'
    case 'dog':
      return '개'
    case 'phoenix':
      return '봉황'
    case 'dragon':
      return '용'
  }
}

function imageFor(card: TCard): string | undefined {
  if (card.kind === 'number') {
    return IMAGES[`${RANK_FILE[card.rank] ?? card.rank}${SUIT_FILE[card.suit]}`]
  }
  return IMAGES[card.kind]
}

export const CARD_BACK = IMAGES['card-back']

export type TichuCardSize = 'sm' | 'md' | 'lg'

interface Props {
  card: TCard
  size?: TichuCardSize | undefined
  selected?: boolean | undefined
  disabled?: boolean | undefined
  onClick?: (() => void) | undefined
  /** 봉황을 몇 값으로 냈는지 (테이블 표시용) */
  phoenixAs?: number | undefined
}

export default function TichuCard({ card, size = 'md', selected, disabled, onClick, phoenixAs }: Props) {
  const src = imageFor(card)
  const classes = [
    'tcard',
    `tcard--${size}`,
    `tcard--${card.kind}`,
    selected ? 'is-selected' : '',
    disabled ? 'is-dim' : '',
    onClick ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const face = (
    <>
      {src ? (
        <img className="tcard__img" src={src} alt="" draggable={false} />
      ) : (
        <span className="tcard__text">{tichuCardLabel(card)}</span>
      )}
      {phoenixAs !== undefined && card.kind === 'phoenix' && (
        <span className="tcard__as">={rankLabel(phoenixAs)}</span>
      )}
    </>
  )

  if (!onClick) {
    return (
      <div className={classes} title={tichuCardLabel(card)}>
        {face}
      </div>
    )
  }
  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick} title={tichuCardLabel(card)}>
      {face}
    </button>
  )
}

/** 뒤집힌 카드 — 패스했을 때, 남의 손패를 나타낼 때 */
export function CardBack({ size = 'md' }: { size?: TichuCardSize }) {
  return (
    <div className={`tcard tcard--${size} tcard--back`} aria-label="뒤집힌 카드">
      {CARD_BACK ? <img className="tcard__img" src={CARD_BACK} alt="" draggable={false} /> : null}
    </div>
  )
}
