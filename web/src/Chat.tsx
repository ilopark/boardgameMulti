import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@bg/core'

interface Props {
  messages: ChatMessage[]
  myId: string
  onSend: (text: string) => Promise<void>
}

/**
 * 같은 방 사람들끼리만 쓰는 채팅. 저장하지 않으며, 방을 나가거나 새로고침하면 비워진다.
 * 화면 오른쪽 아래에 떠 있고 접었다 펼 수 있다.
 */
export default function Chat({ messages, myId, onSend }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [seenCount, setSeenCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 열려 있으면 새 메시지를 읽은 것으로 처리하고 맨 아래로 스크롤
  useEffect(() => {
    if (open) {
      setSeenCount(messages.length)
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [messages, open])

  // 채팅창을 열면 바로 입력할 수 있게 포커스를 준다
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const unread = open ? 0 : Math.max(0, messages.length - seenCount)

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await onSend(t)
      setText('')
    } finally {
      setSending(false)
      // 보내고 나서도 계속 입력할 수 있게 포커스를 입력창에 되돌린다
      inputRef.current?.focus()
    }
  }

  if (!open) {
    return (
      <button type="button" className="chatfab" onClick={() => setOpen(true)}>
        💬 채팅
        {unread > 0 && <span className="chatfab__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
    )
  }

  return (
    <section className="chat" aria-label="방 채팅">
      <header className="chat__head">
        <span className="chat__title">채팅</span>
        <button type="button" className="chat__close" onClick={() => setOpen(false)} aria-label="채팅 닫기">
          ✕
        </button>
      </header>

      <div className="chat__list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat__empty">아직 메시지가 없습니다.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.playerId === myId ? 'chatmsg chatmsg--me' : 'chatmsg'}>
              <span className="chatmsg__who">{m.nickname}</span>
              <span className="chatmsg__text">{m.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="chat__input">
        <input
          ref={inputRef}
          type="text"
          value={text}
          maxLength={300}
          placeholder="메시지 입력…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="primary" disabled={sending || !text.trim()} onClick={() => void send()}>
          보내기
        </button>
      </div>
    </section>
  )
}
