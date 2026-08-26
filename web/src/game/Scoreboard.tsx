import type { RoomPublic, skullking } from '@bg/core'

type View = skullking.SkPlayerView

interface Props {
  room: RoomPublic
  view: View
  nameOf: (seat: number) => string
}

export default function Scoreboard({ room, view, nameOf }: Props) {
  const seats = Array.from({ length: view.humanCount }, (_, i) => i)
  const connected = new Map(room.players.filter((p) => p.seat !== null).map((p) => [p.seat!, p.connected]))

  return (
    <section className="card">
      <ul className="players">
        {seats.map((seat) => {
          const isMe = seat === view.seat
          const isTurn = view.currentSeat === seat
          const bid = view.bids[seat]
          const placed = view.bidPlaced[seat]
          const won = view.tricksWon[seat] ?? 0
          const classes = ['player', isMe ? 'player--me' : '', isTurn ? 'player--turn' : '']
            .filter(Boolean)
            .join(' ')

          return (
            <li key={seat} className={classes}>
              <span className="player__name">
                {nameOf(seat)}
                {view.dealer === seat && <em className="tag">딜러</em>}
                {connected.get(seat) === false && <em className="tag tag--warn">끊김</em>}
              </span>
              <span className="player__stats">
                <span className="stat">
                  <em>입찰</em>
                  {view.bidsRevealed
                    ? (bid ?? '—')
                    : placed
                      ? (isMe ? bid : '✓')
                      : '…'}
                </span>
                <span className="stat">
                  <em>획득</em>
                  {won}
                </span>
                <span className="stat stat--total">
                  <em>총점</em>
                  {view.totals[seat] ?? 0}
                </span>
              </span>
            </li>
          )
        })}
        {view.hasGhost && (
          <li className="player player--ghost">
            <span className="player__name">유령 <em className="tag">점수 없음</em></span>
            <span className="player__stats">
              <span className="stat">
                <em>남은 카드</em>
                {view.handCounts[2] ?? 0}
              </span>
            </span>
          </li>
        )}
      </ul>
    </section>
  )
}
