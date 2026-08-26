import { skullking } from '@bg/core'
import Card from './Card.js'

/**
 * 개발용 카드 갤러리. `/?cards` 로 접속하면 모든 카드를 한눈에 볼 수 있다.
 * 디자인을 고칠 때 게임을 처음부터 돌리지 않아도 되게 하려고 만들었다.
 */
export default function CardGallery() {
  const deck = skullking.buildDeck(skullking.DEFAULT_SK_OPTIONS)
  const numbers = deck.filter((c) => c.kind === 'number')
  const specials = deck.filter((c) => c.kind !== 'number')
  const byColor = (color: string) => numbers.filter((c) => c.kind === 'number' && c.color === color)

  return (
    <div className="game">
      <section className="panel">
        <div className="panel__head">
          <h2>카드 갤러리 (개발용)</h2>
          <span className="muted">{deck.length}장</span>
        </div>
        {(['green', 'yellow', 'purple', 'black'] as const).map((color) => (
          <div key={color}>
            <p className="muted">
              {{ green: '앵무새(초록)', yellow: '보물상자(노랑)', purple: '지도(보라)', black: '졸리로저(검정) — 트럼프' }[color]}
            </p>
            <div className="handrow">
              {byColor(color).map((c) => (
                <Card key={c.id} card={c} size="lg" />
              ))}
            </div>
          </div>
        ))}
        <p className="muted">특수 카드</p>
        <div className="handrow">
          {specials.map((c) => (
            <Card key={c.id} card={c} size="lg" />
          ))}
        </div>
        <p className="muted">작은 크기 (테이블에 깔릴 때)</p>
        <div className="handrow">
          {[...byColor('green').slice(0, 3), ...specials.slice(0, 6)].map((c) => (
            <Card key={`sm-${c.id}`} card={c} size="md" />
          ))}
        </div>
      </section>
    </div>
  )
}
