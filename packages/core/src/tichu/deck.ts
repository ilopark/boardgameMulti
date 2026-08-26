import { SUITS, type TichuCard } from './types.js'

export function buildDeck(): TichuCard[] {
  const deck: TichuCard[] = []
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ id: `${suit}-${rank}`, kind: 'number', suit, rank })
    }
  }
  deck.push({ id: 'mahjong', kind: 'mahjong' })
  deck.push({ id: 'dog', kind: 'dog' })
  deck.push({ id: 'phoenix', kind: 'phoenix' })
  deck.push({ id: 'dragon', kind: 'dragon' })
  return deck
}

/** 카드 1장의 점수 */
export function cardPoints(card: TichuCard): number {
  switch (card.kind) {
    case 'dragon':
      return 25
    case 'phoenix':
      return -25
    case 'number':
      if (card.rank === 5) return 5
      if (card.rank === 10 || card.rank === 13) return 10
      return 0
    default:
      return 0
  }
}

export function handPoints(cards: readonly TichuCard[]): number {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0)
}
