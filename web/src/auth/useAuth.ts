import { useCallback, useEffect, useState } from 'react'
import type { AuthUser } from '@bg/core'
import { clearAuthToken, loadAuthToken, request, saveAuthToken, socket } from '../socket.js'

export interface AuthState {
  /** 계정 기능이 서버에 켜져 있는지 (DB 연결 여부). false 면 게스트로만 논다. */
  enabled: boolean
  /** 로그인했다면 그 사람. 게스트면 null. */
  user: AuthUser | null
  /** 서버에 처음 물어보는 중 — 첫 화면에서 깜빡임을 막으려고 본다. */
  loading: boolean
}

export interface Auth extends AuthState {
  signUp: (username: string, password: string, nickname: string) => Promise<void>
  logIn: (username: string, password: string) => Promise<void>
  logOut: () => Promise<void>
}

/**
 * 로그인 상태를 앱 전체에서 하나로 관리한다.
 *
 * 연결될 때마다 저장해 둔 토큰으로 자동 로그인을 시도한다.
 * 소켓이 재연결되면(서버 재시작·네트워크 끊김) 서버 쪽 세션 정보가 날아가므로
 * 다시 이어줘야 한다 — 그래서 connect 이벤트마다 resume 을 건다.
 */
export function useAuth(): Auth {
  const [state, setState] = useState<AuthState>({ enabled: false, user: null, loading: true })

  const refresh = useCallback(async () => {
    const token = loadAuthToken()
    try {
      // 토큰이 있으면 그걸로 로그인 상태를 되찾는다
      if (token) {
        const resumed = await request('auth:resume', { token })
        const status = await request('auth:status', {})
        if (!resumed.user) clearAuthToken() // 토큰이 낡았다
        setState({ enabled: status.enabled, user: resumed.user, loading: false })
        return
      }
      const status = await request('auth:status', {})
      setState({ enabled: status.enabled, user: status.user, loading: false })
    } catch {
      // 서버가 잠깐 안 되는 것뿐이다. 게스트로 두고 다음 연결 때 다시 시도한다.
      setState((s) => ({ ...s, loading: false }))
    }
  }, [])

  useEffect(() => {
    if (socket.connected) void refresh()
    const onConnect = () => void refresh()
    socket.on('connect', onConnect)
    return () => {
      socket.off('connect', onConnect)
    }
  }, [refresh])

  const signUp = useCallback(async (username: string, password: string, nickname: string) => {
    const res = await request('auth:signup', { username, password, nickname })
    saveAuthToken(res.token)
    setState((s) => ({ ...s, enabled: true, user: res.user }))
  }, [])

  const logIn = useCallback(async (username: string, password: string) => {
    const res = await request('auth:login', { username, password })
    saveAuthToken(res.token)
    setState((s) => ({ ...s, enabled: true, user: res.user }))
  }, [])

  const logOut = useCallback(async () => {
    try {
      await request('auth:logout', {})
    } finally {
      // 서버 호출이 실패해도 이 브라우저에서는 로그아웃한다
      clearAuthToken()
      setState((s) => ({ ...s, user: null }))
    }
  }, [])

  return { ...state, signUp, logIn, logOut }
}
