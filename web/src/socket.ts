import { io, type Socket } from 'socket.io-client'
import type { ClientToServer, Identity, ServerToClient } from '@bg/core'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:3001`

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
