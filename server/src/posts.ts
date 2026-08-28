/**
 * 커뮤니티 / 문의 게시판.
 *
 * 권한:
 *  - 관리자(ilo2918): 모든 글을 본다.
 *  - 로그인 사용자: 자기가 쓴 글만 본다.
 *  - 게스트: 아무 글도 못 본다(읽기 UI만 접근).
 * 쓰기·수정은 본인 글만, 삭제는 본인 또는 관리자, 답변은 관리자만.
 *
 * RLS 가 켜진 boardgame.posts 를 서버 직결로만 읽고 쓴다(브라우저는 Supabase 를 모른다).
 */
import type { Post } from '@bg/core'
import type { Account } from './auth/index.js'
import { getPool } from './db/pool.js'

/** 관리자 아이디 (대소문자 무시) */
const ADMIN_USERNAME = 'ilo2918'

const MAX_TITLE = 100
const MAX_BODY = 4000

/** 클라이언트에 그대로 보여줘도 되는 게시판 오류 */
export class PostError extends Error {}

export function isAdmin(account: Account | null | undefined): boolean {
  return !!account && account.username.toLowerCase() === ADMIN_USERNAME
}

interface Row {
  id: string
  author_id: string
  author_name: string
  title: string
  body: string
  reply: string | null
  replied_at: Date | null
  created_at: Date
  updated_at: Date
}

function toPost(row: Row, account: Account | null | undefined): Post {
  return {
    id: Number(row.id),
    authorName: row.author_name,
    title: row.title,
    body: row.body,
    reply: row.reply,
    repliedAt: row.replied_at ? row.replied_at.getTime() : null,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    mine: !!account && row.author_id === account.id,
  }
}

function pool() {
  const p = getPool()
  if (!p) throw new PostError('지금은 게시판을 쓸 수 없습니다.')
  return p
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new PostError(`${label}을(를) 입력해 주세요.`)
  const t = value.trim()
  if (!t) throw new PostError(`${label}을(를) 입력해 주세요.`)
  return t.slice(0, max)
}

function checkId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new PostError('잘못된 요청입니다.')
  }
  return id
}

/** 내가 볼 수 있는 글. 게스트면 빈 목록. */
export async function listPosts(account: Account | null | undefined): Promise<Post[]> {
  if (!account) return []
  const p = pool()
  const res = isAdmin(account)
    ? await p.query<Row>('select * from boardgame.posts order by created_at desc limit 500')
    : await p.query<Row>(
        'select * from boardgame.posts where author_id = $1 order by created_at desc limit 500',
        [account.id],
      )
  return res.rows.map((r) => toPost(r, account))
}

export async function createPost(account: Account, title: unknown, body: unknown): Promise<Post> {
  const t = cleanText(title, MAX_TITLE, '제목')
  const b = cleanText(body, MAX_BODY, '내용')
  const name = `${account.nickname}#${account.tag}`
  const res = await pool().query<Row>(
    'insert into boardgame.posts (author_id, author_name, title, body) values ($1, $2, $3, $4) returning *',
    [account.id, name, t, b],
  )
  return toPost(res.rows[0]!, account)
}

export async function updatePost(account: Account, id: unknown, title: unknown, body: unknown): Promise<void> {
  const pid = checkId(id)
  const t = cleanText(title, MAX_TITLE, '제목')
  const b = cleanText(body, MAX_BODY, '내용')
  const res = await pool().query(
    'update boardgame.posts set title = $1, body = $2, updated_at = now() where id = $3 and author_id = $4',
    [t, b, pid, account.id],
  )
  if (!res.rowCount) throw new PostError('글을 수정할 수 없습니다.')
}

export async function deletePost(account: Account, id: unknown): Promise<void> {
  const pid = checkId(id)
  const res = isAdmin(account)
    ? await pool().query('delete from boardgame.posts where id = $1', [pid])
    : await pool().query('delete from boardgame.posts where id = $1 and author_id = $2', [pid, account.id])
  if (!res.rowCount) throw new PostError('글을 삭제할 수 없습니다.')
}

/** 관리자 답변 */
export async function replyPost(account: Account, id: unknown, reply: unknown): Promise<void> {
  if (!isAdmin(account)) throw new PostError('권한이 없습니다.')
  const pid = checkId(id)
  const r = cleanText(reply, MAX_BODY, '답변')
  const res = await pool().query('update boardgame.posts set reply = $1, replied_at = now() where id = $2', [r, pid])
  if (!res.rowCount) throw new PostError('답변할 글을 찾을 수 없습니다.')
}
