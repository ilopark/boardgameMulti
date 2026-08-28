import { useCallback, useEffect, useState } from 'react'
import type { AuthUser, Post } from '@bg/core'
import { request } from './socket.js'

interface Props {
  user: AuthUser | null
  onClose: () => void
  onError: (message: string) => void
}

const fmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * 커뮤니티 / 문의 게시판.
 *  - 관리자: 모든 글, 각 글에 답변 가능
 *  - 로그인 사용자: 자기 글만, 작성·수정·삭제
 *  - 게스트: 열람 UI만(글은 로그인 후)
 * 권한은 서버가 강제한다. 여기 표시는 편의용일 뿐.
 */
export default function Community({ user, onClose, onError }: Props) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [busy, setBusy] = useState(false)

  const [composing, setComposing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await request('posts:list', {})
      setPosts(res.posts)
      setIsAdmin(res.isAdmin)
      setCanWrite(res.canWrite)
    } catch (e) {
      onError(e instanceof Error ? e.message : '게시판을 불러오지 못했습니다.')
      setPosts([])
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setComposing(false)
    setEditingId(null)
    setTitle('')
    setBody('')
  }

  const submit = async () => {
    if (busy || !title.trim() || !body.trim()) return
    setBusy(true)
    try {
      if (editingId !== null) await request('posts:update', { id: editingId, title, body })
      else await request('posts:create', { title, body })
      resetForm()
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (p: Post) => {
    setEditingId(p.id)
    setComposing(true)
    setTitle(p.title)
    setBody(p.body)
  }

  const remove = async (id: number) => {
    if (busy || !window.confirm('이 글을 삭제할까요? 되돌릴 수 없습니다.')) return
    setBusy(true)
    try {
      await request('posts:delete', { id })
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : '삭제하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const doReply = async (p: Post) => {
    const text = window.prompt('답변을 입력하세요', p.reply ?? '')
    if (text === null || !text.trim()) return
    setBusy(true)
    try {
      await request('posts:reply', { id: p.id, reply: text })
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : '답변하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="community">
      <div className="community__head">
        <h1>커뮤니티 · 문의</h1>
        <button type="button" className="ghost" onClick={onClose}>
          ← 돌아가기
        </button>
      </div>

      {!canWrite ? (
        <p className="community__notice muted">
          로그인하면 문의·건의 글을 남기고, 내가 쓴 글을 볼 수 있어요. 게스트는 열람만 가능합니다.
        </p>
      ) : (
        <>
          {isAdmin && <p className="community__admin">관리자 모드 — 모든 사용자의 글을 봅니다.</p>}
          {composing ? (
            <section className="card community__form">
              <label className="field">
                <span>제목</span>
                <input
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 스컬킹 점수 계산이 이상해요"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>내용</span>
                <textarea
                  className="community__textarea"
                  value={body}
                  maxLength={4000}
                  rows={5}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="자세히 적어주실수록 좋아요…"
                />
              </label>
              <div className="community__formactions">
                <button type="button" className="ghost" onClick={resetForm}>
                  취소
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !title.trim() || !body.trim()}
                  onClick={() => void submit()}
                >
                  {editingId !== null ? '수정 저장' : '등록'}
                </button>
              </div>
            </section>
          ) : (
            <button type="button" className="primary community__new" onClick={() => setComposing(true)}>
              + 새 글 쓰기
            </button>
          )}
        </>
      )}

      {posts === null ? (
        <p className="muted">불러오는 중…</p>
      ) : posts.length === 0 ? (
        <p className="community__empty muted">
          {canWrite ? '아직 글이 없어요. 첫 글을 남겨보세요.' : '표시할 글이 없습니다.'}
        </p>
      ) : (
        <ul className="postlist">
          {posts.map((p) => (
            <li key={p.id} className="post card">
              <div className="post__head">
                <h2 className="post__title">{p.title}</h2>
                <span className="post__date">{fmt.format(new Date(p.createdAt))}</span>
              </div>
              {isAdmin && <span className="post__author">{p.authorName}</span>}
              <p className="post__body">{p.body}</p>
              {p.reply && (
                <div className="post__reply">
                  <strong>관리자 답변</strong>
                  <p>{p.reply}</p>
                </div>
              )}
              <div className="post__actions">
                {p.mine && (
                  <button type="button" className="linkbtn" onClick={() => startEdit(p)}>
                    수정
                  </button>
                )}
                {(p.mine || isAdmin) && (
                  <button type="button" className="linkbtn" onClick={() => void remove(p.id)}>
                    삭제
                  </button>
                )}
                {isAdmin && (
                  <button type="button" className="linkbtn" onClick={() => void doReply(p)}>
                    {p.reply ? '답변 수정' : '답변 달기'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
