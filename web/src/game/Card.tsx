import type { JSX } from 'react'
import type { skullking } from '@bg/core'
import {
  ChestArt,
  EscapeArt,
  JollyRogerArt,
  KrakenArt,
  LootArt,
  MapArt,
  MermaidArt,
  ParrotArt,
  PirateArt,
  SkullKingArt,
  TigressArt,
  WhaleArt,
} from './CardArt.js'

type SkCard = skullking.SkCard

const SUIT_NAME: Record<string, string> = {
  green: '앵무새',
  yellow: '보물상자',
  purple: '지도',
  black: '졸리로저',
}

const PIRATE_NAME: Record<string, string> = {
  rosie: '로지',
  bahij: '바히즈',
  rascal: '라스칼',
  juanita: '후아니타',
  harry: '해리',
}

function suitArt(color: string, className: string): JSX.Element {
  switch (color) {
    case 'green':
      return <ParrotArt className={className} />
    case 'yellow':
      return <ChestArt className={className} />
    case 'purple':
      return <MapArt className={className} />
    default:
      return <JollyRogerArt className={className} />
  }
}

function specialArt(card: SkCard, className: string): JSX.Element {
  switch (card.kind) {
    case 'escape':
      return <EscapeArt className={className} />
    case 'pirate':
      return <PirateArt className={className} />
    case 'mermaid':
      return <MermaidArt className={className} />
    case 'skullking':
      return <SkullKingArt className={className} />
    case 'tigress':
      return <TigressArt className={className} />
    case 'loot':
      return <LootArt className={className} />
    case 'kraken':
      return <KrakenArt className={className} />
    default:
      return <WhaleArt className={className} />
  }
}

export function cardLabel(card: SkCard): string {
  switch (card.kind) {
    case 'number':
      return `${SUIT_NAME[card.color] ?? ''} ${card.rank}`
    case 'escape':
      return '도주'
    case 'pirate':
      return `해적 ${PIRATE_NAME[card.pirate] ?? ''}`.trim()
    case 'mermaid':
      return '인어'
    case 'skullking':
      return '스컬킹'
    case 'tigress':
      return '티그리스'
    case 'loot':
      return '루트'
    case 'kraken':
      return '크라켄'
    case 'whitewhale':
      return '흰고래'
  }
}

export type CardSize = 'sm' | 'md' | 'lg'

interface Props {
  card: SkCard
  /** 티그리스를 뭘로 선언했는지 (테이블에 깔린 카드용) */
  tigressAs?: 'pirate' | 'escape' | undefined
  size?: CardSize | undefined
  disabled?: boolean | undefined
  playable?: boolean | undefined
  onClick?: (() => void) | undefined
}

export default function Card({ card, tigressAs, size = 'md', disabled, playable, onClick }: Props) {
  const isNumber = card.kind === 'number'
  // 특수카드는 종류별로 색을 다르게 준다. 전부 같은 색이면 손에서 구분이 안 된다.
  const suit = isNumber ? card.color : card.kind

  const classes = [
    'pcard',
    `pcard--${size}`,
    `pcard--${suit}`,
    disabled ? 'is-dim' : '',
    playable ? 'is-playable' : '',
    onClick ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const face = (
    <>
      <span className="pcard__art">
        {isNumber ? suitArt(card.color, 'pcard__svg') : specialArt(card, 'pcard__svg')}
      </span>

      {isNumber ? (
        <>
          <span className="pcard__rank">{card.rank}</span>
          <span className="pcard__suitname">{SUIT_NAME[card.color]}</span>
        </>
      ) : (
        <span className="pcard__title">{cardLabel(card)}</span>
      )}

      {tigressAs && (
        <span className="pcard__declared">{tigressAs === 'pirate' ? '해적으로' : '도주로'}</span>
      )}
    </>
  )

  if (!onClick) {
    return (
      <div className={classes} title={cardLabel(card)}>
        {face}
      </div>
    )
  }
  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick} title={cardLabel(card)}>
      {face}
    </button>
  )
}
