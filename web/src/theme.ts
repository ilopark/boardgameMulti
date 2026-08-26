/**
 * 라이트 / 다크 테마.
 * 선택은 localStorage에 남기고, 처음 방문이면 OS 설정을 따른다.
 */
export type Theme = 'light' | 'dark'

const KEY = 'bg.theme'

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 시크릿 모드 등에서 접근이 막힐 수 있다
  }
  return systemTheme()
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 저장 못 해도 이번 세션에는 적용된다
  }
}
