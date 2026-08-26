import { COLORS, PIRATES, type SkCard } from './types.js'
import type { SkRuleOptions } from './options.js'
import { DEFAULT_SK_OPTIONS } from './options.js'

export function buildDeck(opts: SkRuleOptions = DEFAULT_SK_OPTIONS): SkCard[] {
  const deck: SkCard[] = []

  for (const color of COLORS) {
    for (let rank = 1; rank <= opts.maxRank; rank++) {
      deck.push({ id: `${color}-${rank}`, kind: 'number', color, rank })
    }
  }

  for (let i = 0; i < 5; i++) deck.push({ id: `escape-${i}`, kind: 'escape' })
  for (const pirate of PIRATES) deck.push({ id: `pirate-${pirate}`, kind: 'pirate', pirate })
  deck.push({ id: 'skullking', kind: 'skullking' })

  if (opts.useTigress) deck.push({ id: 'tigress', kind: 'tigress' })
  if (opts.useMermaids) for (let i = 0; i < 2; i++) deck.push({ id: `mermaid-${i}`, kind: 'mermaid' })
  if (opts.useKraken) deck.push({ id: 'kraken', kind: 'kraken' })
  if (opts.useWhiteWhale) deck.push({ id: 'whitewhale', kind: 'whitewhale' })

  return deck
}

/** 이 라운드에 몇 명까지 가능한가 (덱 장수 ÷ 라운드 최대 장수) */
export function maxPlayers(opts: SkRuleOptions = DEFAULT_SK_OPTIONS): number {
  const maxCards = Math.max(...opts.roundCardCounts)
  return Math.floor(buildDeck(opts).length / maxCards)
}
