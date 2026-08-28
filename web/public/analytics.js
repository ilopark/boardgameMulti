/*
 * Google Analytics 4 (GA4) 로더 — 모든 페이지가 이 파일 하나만 불러온다.
 *
 * ▶ 사용법: 아래 GA4_ID 를 본인 GA4 측정 ID(G-로 시작)로 바꾸면 즉시 전 페이지에 적용됩니다.
 *   측정 ID 만드는 법: analytics.google.com → 관리 → 데이터 스트림 → 웹 → 측정 ID(G-XXXXXXXXXX)
 *
 * 아직 ID를 안 넣었으면(플레이스홀더 그대로면) 아무것도 로드하지 않습니다 → 안전.
 */
;(function () {
  var GA4_ID = 'G-KZFBSP16H4' // ← GA4 측정 ID

  if (!GA4_ID || GA4_ID.indexOf('XXXX') !== -1) return // 미설정이면 조용히 종료

  var s = document.createElement('script')
  s.async = true
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID
  document.head.appendChild(s)

  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag = gtag
  gtag('js', new Date())
  gtag('config', GA4_ID)
})()
