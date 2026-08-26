import { useEffect, useState } from 'react'

interface Props {
  /** 서버가 알려준 남은 시간(ms). 값이 바뀌면 다시 센다 */
  remainingMs: number | null
  /** 전체 제한시간 — 진행바 비율 계산용 */
  totalMs: number
  label?: string
  urgentUnder?: number
}

/**
 * 남은 시간 카운트다운.
 * 서버는 "남은 ms"만 보내고 시각 계산은 여기서 한다 — 클라이언트 시계가 어긋나도 안 틀어진다.
 */
export default function Countdown({ remainingMs, totalMs, label, urgentUnder = 10 }: Props) {
  const [left, setLeft] = useState(remainingMs ?? 0)

  useEffect(() => {
    if (remainingMs === null) return
    const deadline = Date.now() + remainingMs
    setLeft(remainingMs)
    const id = setInterval(() => {
      const next = Math.max(0, deadline - Date.now())
      setLeft(next)
      if (next === 0) clearInterval(id)
    }, 200)
    return () => clearInterval(id)
  }, [remainingMs])

  if (remainingMs === null) return null

  const seconds = Math.ceil(left / 1000)
  const ratio = totalMs > 0 ? Math.min(1, left / totalMs) : 0
  const urgent = seconds <= urgentUnder

  return (
    <div className={urgent ? 'countdown countdown--urgent' : 'countdown'}>
      <div className="countdown__bar">
        <div className="countdown__fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="countdown__text">
        {label ? `${label} ` : ''}
        {seconds}초
      </span>
    </div>
  )
}
