import type { skullking } from '@bg/core'

type SkCard = skullking.SkCard

const COLOR_LABEL: Record<string, string> = {
  green: '앵무새',
  yellow: '보물상자',
  purple: '지도',
  black: '졸리로저',
}

const PIRATE_LABEL: Record<string, string> = {
  rosie: '로지',
  bahij: '바히즈',
  rascal: '라스칼',
  juanita: '후아니타',
  harry: '해리',
}

/** 카드 종류별 아이콘과 이름 */
export function cardFace(card: SkCard): { icon: string; name: string; sub?: string | undefined } {
  switch (card.kind) {
    case 'number':
      return {
        icon: { green: '🦜', yellow: '💰', purple: '🗺️', black: '🏴‍☠️' }[card.color] ?? '?',
        name: String(card.rank),
        sub: COLOR_LABEL[card.color],
      }
    case 'escape':
      return { icon: '🏳️', name: '도주' }
    case 'pirate':
      return { icon: '⚔️', name: '해적', sub: PIRATE_LABEL[card.pirate] }
    case 'mermaid':
      return { icon: '🧜‍♀️', name: '인어' }
    case 'skullking':
      return { icon: '💀', name: '스컬킹' }
    case 'tigress':
      return { icon: '🐯', name: '티그리스' }
    case 'loot':
      return { icon: '💎', name: '루트' }
    case 'kraken':
      return { icon: '🐙', name: '크라켄' }
    case 'whitewhale':
      return { icon: '🐋', name: '흰고래' }
  }
}

interface Props {
  card: SkCard
  /** 티그리스를 뭘로 선언했는지 (테이블에 깔린 카드용) */
  tigressAs?: 'pirate' | 'escape' | undefined
  disabled?: boolean | undefined
  selected?: boolean | undefined
  small?: boolean | undefined
  onClick?: (() => void) | undefined
}

export default function Card({ card, tigressAs, disabled, selected, small, onClick }: Props) {
  const face = cardFace(card)
  const colorClass = card.kind === 'number' ? `card--${card.color}` : 'card--special'
  const classes = [
    'card',
    colorClass,
    small ? 'card--small' : '',
    disabled ? 'card--disabled' : '',
    selected ? 'card--selected' : '',
    onClick ? 'card--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const body = (
    <>
      <span className="card__icon">{face.icon}</span>
      <span className="card__name">{face.name}</span>
      {tigressAs && (
        <span className="card__tag">{tigressAs === 'pirate' ? '해적으로' : '도주로'}</span>
      )}
      {!tigressAs && face.sub && <span className="card__sub">{face.sub}</span>}
    </>
  )

  if (!onClick) return <div className={classes}>{body}</div>
  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick}>
      {body}
    </button>
  )
}
