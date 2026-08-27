import { io, type Socket } from 'socket.io-client'
import type { ClientToServer, Identity, ServerToClient } from '@bg/core'

/**
 * 개발 중에는 vite(5173)와 서버(3001)가 따로 뜨므로 포트를 지정해야 한다.
 * 배포하면 서버가 정적 파일까지 같이 주므로 **같은 오리진**을 쓴다 → CORS 문제가 없어진다.
 */
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `http://${location.hostname}:3001` : location.origin)

export type GameSocket = Socket<ServerToClient, ClientToServer>

export const socket: GameSocket = io(SERVER_URL, { autoConnect: true })

/** 콜백 기반 emit을 Promise로 감싼다. 실패하면 throw. */
export function request<K extends keyof ClientToServer>(
  event: K,
  payload: Parameters<ClientToServer[K]>[0],
): Promise<NonNullable<Parameters<Parameters<ClientToServer[K]>[1]>[0]['data']>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('서버 응답이 없습니다.')), 8000)
    // socket.io 타입과 제네릭 조합이 까다로워 이 지점만 캐스팅한다
    ;(socket.emit as unknown as (e: string, p: unknown, cb: (r: { ok: boolean; error?: string; data?: unknown }) => void) => void)(
      event,
      payload,
      (res) => {
        clearTimeout(timer)
        if (!res.ok) reject(new Error(res.error ?? '알 수 없는 오류'))
        else resolve(res.data as never)
      },
    )
  })
}

// ── 재접속용 신원 저장 ──
const KEY = 'bg.identity'

export function saveIdentity(code: string, identity: Identity): void {
  localStorage.setItem(KEY, JSON.stringify({ code, identity }))
}

export function loadIdentity(): { code: string; identity: Identity } | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { code?: string; identity?: Identity }
    if (!parsed.code || !parsed.identity?.playerId || !parsed.identity?.token) return null
    return { code: parsed.code, identity: parsed.identity }
  } catch {
    return null
  }
}

export function clearIdentity(): void {
  localStorage.removeItem(KEY)
}

// ── 닉네임 기억 (매번 다시 입력하지 않게) ──
const NICK_KEY = 'bg.nickname'

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICK_KEY, name)
  } catch {
    // 저장 실패는 무시 (프라이빗 모드 등)
  }
}

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? ''
  } catch {
    return ''
  }
}

// ── 로그인 세션 토큰 ──
// 서버는 이 토큰의 해시만 갖고 있다. 원문은 이 브라우저에만 있다.
const AUTH_KEY = 'bg.auth'

export function saveAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_KEY, token)
  } catch {
    // 프라이빗 모드 등 — 저장 못 해도 이번 세션은 유지된다
  }
}

export function loadAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_KEY) ?? ''
  } catch {
    return ''
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    // 무시
  }
}
