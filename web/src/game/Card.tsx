import type { JSX } from 'react'
import type { skullking } from '@bg/core'
import {
  ChestArt,
  EscapeArt,
  JollyRogerArt,
  KrakenArt,
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
    case 'kraken':
      return '크라켄'
    case 'whitewhale':
      return '흰고래'
  }
}

/**
 * 카드 그림.
 *
 * `src/assets/cards/` 에 파일을 넣으면 자동으로 쓰이고, 없으면 SVG 문장으로 폴백한다.
 * **빌드 시점에 실제로 있는 파일만 등록**되므로, 그림이 없을 때 404 요청이 나가지 않는다.
 *
 * 파일 이름 규칙 (png/jpg/webp 아무거나):
 *   숫자카드 — 문양당 한 장이면 된다. green / yellow / purple / black
 *   특수카드 — escape / pirate / mermaid / skullking / tigress / kraken / whitewhale
 *   해적을 개별로 주고 싶으면 pirate-rosie 처럼. 없으면 pirate 를 공용으로 쓴다.
 */
const CARD_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../assets/cards/*.{png,jpg,jpeg,webp}', {
      eager: true,
      query: '?url',
      import: 'default',
    }) as Record<string, string>,
  ).map(([path, url]) => [path.replace(/^.*\/(.+)\.\w+$/, '$1'), url]),
)

/** 이 카드에 쓸 그림. 없으면 undefined → SVG 문장으로 그린다. */
function cardImage(card: SkCard): string | undefined {
  // 숫자카드는 색·숫자별로 완성된 카드 그림을 쓴다 (예: green_7.png). 없으면 색 공용(green.png)으로 폴백.
  if (card.kind === 'number') return CARD_IMAGES[`${card.color}_${card.rank}`] ?? CARD_IMAGES[card.color]
  if (card.kind === 'pirate') return CARD_IMAGES[`pirate-${card.pirate}`] ?? CARD_IMAGES.pirate
  return CARD_IMAGES[card.kind]
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

  const imgSrc = cardImage(card)
  const useImage = imgSrc !== undefined

  const classes = [
    'pcard',
    `pcard--${size}`,
    `pcard--${suit}`,
    useImage ? 'has-image' : '',
    disabled ? 'is-dim' : '',
    playable ? 'is-playable' : '',
    onClick ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const face = (
    <>
      <span className="pcard__art">
        {useImage ? (
          <img
            className="pcard__img"
            src={imgSrc}
            alt={cardLabel(card)}
            loading="lazy"
            draggable={false}
          />
        ) : isNumber ? (
          suitArt(card.color, 'pcard__svg')
        ) : (
          specialArt(card, 'pcard__svg')
        )}
      </span>

      {/* 실제 카드 그림이 있으면 숫자·이름이 그림에 이미 그려져 있으므로 오버레이를 그리지 않는다 */}
      {!useImage &&
        (isNumber ? (
          <>
            <span className="pcard__rank">{card.rank}</span>
            <span className="pcard__suitname">{SUIT_NAME[card.color]}</span>
          </>
        ) : (
          <span className="pcard__title">{cardLabel(card)}</span>
        ))}

      {tigressAs && (
        <span className={`pcard__declared pcard__declared--${tigressAs}`}>
          {tigressAs === 'pirate' ? '해적' : '도주'}
        </span>
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
