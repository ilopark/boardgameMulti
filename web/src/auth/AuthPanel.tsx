import { useState } from 'react'
import type { Auth } from './useAuth.js'

interface Props {
  auth: Auth
  /** 계정 없이 게스트 닉네임으로 시작 */
  onGuest: (nickname: string) => void
  /** 초대 링크로 들어온 방 코드가 있으면 안내 문구를 띄운다 */
  invitedCode?: string | null
  onError: (message: string) => void
}

type Mode = 'signup' | 'login'

/**
 * 첫 화면. 로그인 / 회원가입 / 게스트 시작.
 *
 * **게스트를 막지 않는다.** 친구가 보낸 링크를 눌렀는데 회원가입부터 나오면
 * 그냥 안 온다. 로그인은 "전적이 쌓인다" 는 유인으로만 권한다.
 */
export default function AuthPanel({ auth, onGuest, onError, invitedCode }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  // '게스트로 시작' 을 누르면 닉네임부터 받는다 (로비에서 비활성 버튼에 헷갈리지 않게)
  const [guestNaming, setGuestNaming] = useState(false)
  const [guestName, setGuestName] = useState('')

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'signup') await auth.signUp(username.trim(), password, nickname.trim())
      else await auth.logIn(username.trim(), password)
    } catch (e) {
      onError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    username.trim().length >= 3 &&
    password.length >= 8 &&
    (mode === 'login' || nickname.trim().length >= 1)

  // 모바일에서 autoFocus 는 키보드를 강제로 띄워 레이아웃을 밀어올린다 → 정밀 포인터(데스크톱)만.
  const canAutoFocus =
    typeof window !== 'undefined' && (window.matchMedia?.('(pointer: fine)').matches ?? false)

  // ── 게스트 닉네임 입력 단계 ──
  if (guestNaming) {
    const ok = guestName.trim().length >= 1
    return (
      <div className="authpanel">
        <div className="authpanel__brand">
          <span className="authpanel__logo">♠</span>
          <h1>티츄 · 스컬킹</h1>
          {invitedCode ? (
            <p className="muted">
              <b>{invitedCode}</b> 방에 초대받았어요 — 이름만 정하면 바로 입장!
            </p>
          ) : (
            <p className="muted">게임에 보일 이름을 정해주세요</p>
          )}
        </div>
        <section className="card">
          <form
            className="authform"
            onSubmit={(e) => {
              e.preventDefault()
              if (ok) onGuest(guestName.trim())
            }}
          >
            <label className="field">
              <span>게스트 이름</span>
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                maxLength={12}
                placeholder="1~12자 (한글 가능)"
                autoComplete="off"
                autoFocus={canAutoFocus}
              />
            </label>
            <button type="submit" className="primary" disabled={!ok}>
              {invitedCode ? '입장하기' : '시작하기'}
            </button>
          </form>
          {auth.enabled && (
            <button type="button" className="linkbtn authpanel__back" onClick={() => setGuestNaming(false)}>
              ← 로그인 / 회원가입으로
            </button>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="authpanel">
      <div className="authpanel__brand">
        <span className="authpanel__logo">♠</span>
        <h1>티츄 · 스컬킹</h1>
        {invitedCode ? (
          <p className="muted"><b>{invitedCode}</b> 방에 초대받았어요</p>
        ) : (
          <p className="muted">친구랑, 혹은 낯선 사람과 한 판</p>
        )}
      </div>

      {/* 비로그인·비초대 방문자에게 사이트 소개와 규칙 링크를 먼저 보여준다
          (첫 화면이 로그인 박스만 있으면 콘텐츠가 없어 보인다) */}
      {!invitedCode && (
        <section className="authland">
          <p className="authland__intro">
            설치·가입 없이 브라우저에서 바로 즐기는 <b>무료 온라인 보드게임</b>이에요.
            친구를 초대하거나 봇과 함께 티츄·스컬킹 한 판 하세요.
          </p>
          <div className="authland__games">
            <a className="authland__game" href="/guide/tichu/">
              <b>티츄</b>
              <span>규칙 보기 →</span>
            </a>
            <a className="authland__game" href="/guide/skullking/">
              <b>스컬킹</b>
              <span>규칙 보기 →</span>
            </a>
          </div>
        </section>
      )}

      {/* 계정 기능이 꺼져 있으면(서버에 DB 미연결) 게스트 시작만 보여준다 */}
      {!auth.enabled ? (
        <section className="card authpanel__guestonly">
          <p className="muted">지금은 계정 없이 이용할 수 있어요.</p>
          <button type="button" className="primary" onClick={() => setGuestNaming(true)}>
            시작하기
          </button>
        </section>
      ) : (
        <section className="card">
          <div className="authtabs">
            <button
              type="button"
              className={mode === 'login' ? 'authtab authtab--on' : 'authtab'}
              onClick={() => setMode('login')}
            >
              로그인
            </button>
            <button
              type="button"
              className={mode === 'signup' ? 'authtab authtab--on' : 'authtab'}
              onClick={() => setMode('signup')}
            >
              회원가입
            </button>
          </div>

          <form
            className="authform"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <label className="field">
              <span>아이디</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={20}
                placeholder="영문·숫자·밑줄, 3~20자"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={200}
                placeholder="8자 이상"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </label>

            {mode === 'signup' && (
              <>
                <label className="field">
                  <span>닉네임</span>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={12}
                    placeholder="게임에 보일 이름 (한글 가능)"
                    autoComplete="off"
                  />
                </label>
                <p className="authhint muted">
                  비밀번호를 잊으면 계정을 되찾을 수 없어요. 이메일을 받지 않는 대신
                  개인정보도 저장하지 않습니다.
                </p>
              </>
            )}

            <button type="submit" className="primary" disabled={busy || !canSubmit}>
              {mode === 'signup' ? '가입하고 시작' : '로그인'}
            </button>
          </form>

          <div className="authdivider"><span>또는</span></div>

          <button type="button" className="ghost authpanel__guest" onClick={() => setGuestNaming(true)}>
            게스트로 시작
          </button>
          <p className="authhint muted">게스트는 전적이 쌓이지 않아요.</p>
        </section>
      )}
    </div>
  )
}
