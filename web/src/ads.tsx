import { useEffect } from 'react'

/**
 * 애드센스 광고 슬롯.
 *
 * 승인 전까지는 **실제 사용자에게 아무것도 렌더하지 않는다**(빈 광고 박스 노출 X).
 * 승인 후 켜는 법:
 *   1) index.html <head> 의 adsbygoogle 스크립트 주석을 풀고 client 를 채운다
 *   2) 아래 ADSENSE_CLIENT 를 'ca-pub-XXXXXXXXXXXXXXXX' 로 채운다
 *   3) 각 <AdSlot slot="..."> 의 slot 을 애드센스에서 만든 광고단위 ID(data-ad-slot)로 지정
 * 그러면 이미 배치해 둔 자리(로비·게임 결과)에 광고가 뜬다.
 *
 * ⚠️ 정책: 게임 조작 버튼(입찰·카드 내기) 근처엔 절대 넣지 않는다 — 실수 클릭 = 계정 제재.
 * 지금 배치된 곳은 모두 조작과 떨어진 안전 지대(로비 하단, 게임 종료 순위 아래).
 */
export const ADSENSE_CLIENT = '' // 예: 'ca-pub-1234567890123456'

interface Props {
  /** 애드센스 광고단위 ID (data-ad-slot). 승인 후 지정. */
  slot?: string
  label?: string
}

export default function AdSlot({ slot, label = '광고' }: Props) {
  const active = ADSENSE_CLIENT !== '' && !!slot

  useEffect(() => {
    if (!active) return
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] }
      w.adsbygoogle = w.adsbygoogle ?? []
      w.adsbygoogle.push({})
    } catch {
      /* 이미 채워진 슬롯 등 — 무시 */
    }
  }, [active])

  if (!active) {
    // 개발 중에만 자리 표시(어디 들어가는지 확인용). 배포된 실사용자 화면엔 아무것도 안 보인다.
    if (import.meta.env.DEV) {
      return (
        <div className="adslot adslot--ph" aria-hidden="true">
          광고 자리 · {slot ?? 'slot?'} (승인 후 표시)
        </div>
      )
    }
    return null
  }

  return (
    <div className="adslot">
      <span className="adslot__label">{label}</span>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
