/**
 * 카드 문장(紋章). 전부 SVG로 직접 그린다 — 실제 카드 아트는 저작권이 있어 쓸 수 없다.
 *
 * 스타일 방침: **좌우 대칭 기하 문장.** 캐릭터 일러스트를 흉내내면 조잡해지므로
 * 문장·아이콘 스타일로 간다. 작은 크기에서도 형태가 뭉개지지 않는 게 우선.
 * 모든 심볼은 viewBox "0 0 100 100" 기준.
 */
import type { JSX } from 'react'

type ArtProps = { className?: string }

const box = (children: JSX.Element, className?: string) => (
  <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
    {children}
  </svg>
)

/* ── 숫자 카드 4문양 ── */

/** 초록 — 앵무새 (옆모습). 대칭으로 그리면 고양이 얼굴처럼 보여서 옆모습으로 간다. */
export function ParrotArt({ className }: ArtProps) {
  return box(
    <g>
      <path d="M62 22c-14 0-24 11-24 25 0 9 3 15 3 22 0 8-6 12-13 15h34c11 0 20-9 20-21 0-6-2-11-5-15 4-4 6-9 6-14 0-7-6-12-13-12z" fill="currentColor" fillOpacity="0.28" />
      <path d="M62 22c-14 0-24 11-24 25 0 9 3 15 3 22 0 8-6 12-13 15h34c11 0 20-9 20-21 0-6-2-11-5-15 4-4 6-9 6-14 0-7-6-12-13-12z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="66" cy="32" r="4" fill="currentColor" />
      <path d="M78 32c6 1 10 4 10 7s-5 6-11 5" fill="currentColor" />
      <path d="M44 50c8 4 16 4 22 0" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M26 84h30" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M34 84c-4-6-6-12-6-12M42 84c-3-7-4-14-4-14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
    </g>,
    className,
  )
}

/** 노랑 — 보물상자 */
export function ChestArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 46a28 22 0 0 1 56 0z" fill="currentColor" fillOpacity="0.2" />
      <rect x="22" y="46" width="56" height="32" rx="3" fill="currentColor" fillOpacity="0.14" />
      <path d="M22 46h56" />
      <path d="M36 30v16M64 30v16" />
      <rect x="43" y="52" width="14" height="16" rx="2" fill="currentColor" fillOpacity="0.35" />
      <circle cx="50" cy="58" r="3" fill="currentColor" stroke="none" />
      <path d="M22 70h56" strokeWidth="3" opacity="0.6" />
    </g>,
    className,
  )
}

/** 보라 — 지도 (나침반 장미) */
export function MapArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="50" cy="50" r="32" />
      <circle cx="50" cy="50" r="24" strokeWidth="2" opacity="0.5" />
      <path d="M50 18l8 24 24 8-24 8-8 24-8-24-24-8 24-8z" fill="currentColor" fillOpacity="0.28" />
      <path d="M50 18l8 24-8 8-8-8z" fill="currentColor" stroke="none" />
      <circle cx="50" cy="50" r="4" fill="currentColor" stroke="none" />
    </g>,
    className,
  )
}

/** 검정 — 졸리로저 (트럼프) */
export function JollyRogerArt({ className }: ArtProps) {
  return box(
    <g>
      <path d="M24 78L76 44M76 78L24 44" stroke="currentColor" strokeWidth="7" strokeLinecap="round" opacity="0.55" />
      <path d="M50 16c-16 0-27 12-27 26 0 9 4 16 11 20v12h32V62c7-4 11-11 11-20 0-14-11-26-27-26z" fill="currentColor" />
      <ellipse cx="39" cy="43" rx="7.5" ry="8.5" fill="#0b0d12" />
      <ellipse cx="61" cy="43" rx="7.5" ry="8.5" fill="#0b0d12" />
      <path d="M50 54l-5 9h10z" fill="#0b0d12" />
      <path d="M40 68h4v6h-4zM48 68h4v6h-4zM56 68h4v6h-4z" fill="#0b0d12" />
    </g>,
    className,
  )
}

/* ── 특수 카드 ── */

/** 도주 — 흰 깃발 */
export function EscapeArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 16v70" strokeWidth="5" />
      <path d="M32 22h40l-9 12 9 12H32z" fill="currentColor" fillOpacity="0.28" />
      <path d="M26 86h18" strokeWidth="5" />
    </g>,
    className,
  )
}

/** 해적 — 교차 커틀러스. 졸리로저(해골)와 헷갈리지 않게 검만 쓴다. */
export function PirateArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {/* 왼쪽 검 */}
      <path d="M30 84L72 24c4-6 10-8 14-6-2 6-4 10-8 14L38 88" strokeWidth="5" fill="currentColor" fillOpacity="0.22" />
      <path d="M24 78l14 14" strokeWidth="6" />
      <circle cx="21" cy="75" r="5" strokeWidth="4" />
      {/* 오른쪽 검 */}
      <path d="M70 84L28 24c-4-6-10-8-14-6 2 6 4 10 8 14l40 56" strokeWidth="5" fill="currentColor" fillOpacity="0.22" />
      <path d="M76 78L62 92" strokeWidth="6" />
      <circle cx="79" cy="75" r="5" strokeWidth="4" />
    </g>,
    className,
  )
}

/** 인어 — 삼지창 + 물결 (대칭) */
export function MermaidArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M50 16v52" strokeWidth="5" />
      <path d="M32 26v-8M50 22v-10M68 26v-8" strokeWidth="5" />
      <path d="M32 26c0 8 8 12 18 12s18-4 18-12" />
      <path d="M50 68c-10 6-18 4-24-3 6 14 14 21 24 21s18-7 24-21c-6 7-14 9-24 3z" fill="currentColor" fillOpacity="0.3" />
      <path d="M22 54c6-5 12-5 18 0M60 54c6-5 12-5 18 0" strokeWidth="3" opacity="0.6" />
    </g>,
    className,
  )
}

/** 스컬킹 — 왕관 쓴 해골 */
export function SkullKingArt({ className }: ArtProps) {
  return box(
    <g>
      <path d="M22 32l7-16 8 11 13-15 13 15 8-11 7 16z" fill="#f2c94c" />
      <circle cx="29" cy="14" r="3.6" fill="#f2c94c" />
      <circle cx="50" cy="9" r="4" fill="#f2c94c" />
      <circle cx="71" cy="14" r="3.6" fill="#f2c94c" />
      <rect x="22" y="32" width="56" height="6" rx="2" fill="#d9ae35" />
      <path d="M50 40c-16 0-27 12-27 26 0 9 4 17 11 21v11h32V87c7-4 11-12 11-21 0-14-11-26-27-26z" fill="currentColor" />
      <ellipse cx="39" cy="66" rx="8" ry="9" fill="#0b0d12" />
      <ellipse cx="61" cy="66" rx="8" ry="9" fill="#0b0d12" />
      <circle cx="40.5" cy="64" r="2.4" fill="#e0483a" />
      <circle cx="62.5" cy="64" r="2.4" fill="#e0483a" />
      <path d="M50 78l-5 9h10z" fill="#0b0d12" />
      <path d="M40 92h4v6h-4zM48 92h4v6h-4zM56 92h4v6h-4z" fill="#0b0d12" />
    </g>,
    className,
  )
}

/** 티그리스 — 호랑이 얼굴 (대칭) */
export function TigressArt({ className }: ArtProps) {
  return box(
    <g>
      <path d="M22 24l10 18-14 4zM78 24L68 42l14 4z" fill="currentColor" />
      <path d="M50 22c-17 0-28 13-28 30s11 28 28 28 28-11 28-28-11-30-28-30z" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="4" />
      <path d="M30 40c3 7 3 15 0 22M70 40c-3 7-3 15 0 22" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="40" cy="50" r="4.5" fill="currentColor" />
      <circle cx="60" cy="50" r="4.5" fill="currentColor" />
      <path d="M50 58l-6 6h12z" fill="currentColor" />
      <path d="M50 64c-4 6-10 6-14 2M50 64c4 6 10 6 14 2" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path d="M20 56h12M68 56h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
    </g>,
    className,
  )
}

/** 루트 — 보석 (대칭) */
export function LootArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 34h44l12 16-34 34-34-34z" fill="currentColor" fillOpacity="0.24" />
      <path d="M16 50h68M28 34l6 16-6 0M72 34l-6 16 6 0M50 84L34 50l8-16M50 84l16-34-8-16" strokeWidth="3" />
    </g>,
    className,
  )
}

/** 크라켄 — 대칭 촉수 */
export function KrakenArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
      <path d="M50 16c14 0 23 11 23 24 0 8-3 14-7 18H34c-4-4-7-10-7-18 0-13 9-24 23-24z" fill="currentColor" fillOpacity="0.24" />
      <circle cx="40" cy="38" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="60" cy="38" r="4.5" fill="currentColor" stroke="none" />
      <path d="M36 60c-6 6-6 14-14 18M44 62c-4 10-4 20-12 24M56 62c4 10 4 20 12 24M64 60c6 6 6 14 14 18M50 62v26" />
    </g>,
    className,
  )
}

/** 흰고래 */
export function WhaleArt({ className }: ArtProps) {
  return box(
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M50 24c-4-8-4-14-4-14s8 4 12 12" strokeWidth="4" />
      <path d="M18 56c8-14 22-22 36-22 12 0 20 5 24 11-5 3-8 7-9 12-12 8-27 11-38 9-7-2-12-6-13-10z" fill="currentColor" fillOpacity="0.24" />
      <path d="M78 45c6-5 12-4 12-4s-2 8-8 11" />
      <circle cx="34" cy="49" r="3.2" fill="currentColor" stroke="none" />
      <path d="M22 62c10 4 24 4 34 0" strokeWidth="3" opacity="0.6" />
      <path d="M14 74c6-4 12-4 18 0s12 4 18 0 12-4 18 0 12 4 18 0" strokeWidth="3" opacity="0.45" />
    </g>,
    className,
  )
}
