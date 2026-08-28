# SEO · 애널리틱스 · 도메인 이관 런북

도메인을 새로 사면 이 문서 하나로 "현재 고정 주소 변경 → 재배포 → 검색엔진 재등록"까지 한 번에 처리한다.
클로드에게 아래 **§1의 한 줄**만 던지면 코드/배포는 클로드가 하고, 외부 등록은 단계별로 안내한다.

---

## 0. 현재 상태 (2026-08-29 기준)

- **구성**: React + Vite SPA + socket.io 서버. Oracle Cloud(`ubuntu@161.33.213.129`)에서 서버가 정적 파일까지 같은 오리진으로 서빙. 배포는 `npm run deploy`.
- **현재 주소**: `https://boardplay.dpdns.org` (무료 dpdns.org 서브도메인, HTTPS 적용됨)
- **완료됨**
  - GA4 설치·작동 확인 — 측정 ID `G-KZFBSP16H4` (`web/public/analytics.js` 한 곳에서 관리, 전 페이지 자동 로드)
  - 구글 서치콘솔: URL 접두어 속성 등록 + HTML 파일 소유확인(`web/public/google1c91177cc762bd2d.html`) + `sitemap.xml` 제출
- **보류됨**
  - 네이버 서치어드바이저 — 무료 서브도메인이라 "URL 호스트 단위 등록"을 요구해서 보류. **도메인 산 뒤 진행.**
- **계정 전략**: GA4·서치콘솔은 본계정(블로그+애드센스)과 **분리한 별도 구글 계정**으로 등록(저작권 리스크 격리). 네이버는 검색 색인용이라 애드센스와 무관 → 아무 계정 가능.

---

## 1. 도메인 사면 클로드에게 던질 한 줄 (복붙용)

> 도메인 샀어: `NEWDOMAIN.com`. Oracle 서버(161.33.213.129)에 A레코드 연결했어(또는: 아직 안 했어). HTTPS는 됨(또는: 아직). SEO-DOMAIN-RUNBOOK 대로 주소 변경부터 진행해줘.

이러면 클로드가 §3(코드 주소 일괄 교체) + §4 배포를 실행하고, §2·§5~§7(외부 설정·등록)을 순서대로 안내한다.

---

## 2. 서버 · DNS · HTTPS

- **A레코드**: `NEWDOMAIN.com` → `161.33.213.129` (도메인 등록업체 DNS에서 설정)
- **HTTPS**: 둘 중 하나
  - **Cloudflare 무료**(권장) — 네임서버를 Cloudflare로 옮기면 SSL + CDN 속도 + 봇차단 + 기본 트래픽 통계까지 한 번에. 프록시(주황 구름) 켜기.
  - **Let's Encrypt(certbot)** — 서버에 nginx/certbot으로 직접 발급.
- **서버 코드 수정 불필요**: 서버 CORS는 프로덕션에서 "같은 오리진"만 허용(`server/src/index.ts`의 `ORIGIN`), 프런트 소켓은 `location.origin` 사용(`web/src/socket.ts`) → 도메인이 바뀌어도 자동으로 새 도메인을 따라간다. (단, `CORS_ORIGIN` 환경변수를 굳이 지정해 뒀다면 그것만 새 도메인으로.)

---

## 3. 코드의 하드코딩 주소 일괄 교체 (클로드가 실행)

`boardplay.dpdns.org`는 canonical·og:url·JSON-LD·sitemap·robots에 들어 있다. **소스 10개 파일**만 바꾸면 된다(`web/dist`는 빌드로 재생성되므로 건드리지 않음):

- `web/index.html`
- `web/public/robots.txt`
- `web/public/sitemap.xml`
- `web/public/guide/index.html`
- `web/public/guide/tichu/index.html`
- `web/public/guide/skullking/index.html`
- `web/public/guide/tichu/strategy/index.html`
- `web/public/guide/skullking/strategy/index.html`
- `web/public/about/index.html`
- `web/public/privacy/index.html`

**한 방 명령** (`NEWDOMAIN` 을 실제 도메인으로 바꿔서):

```bash
cd /c/dev/boardgameMulti
grep -rl "boardplay.dpdns.org" web/index.html web/public | xargs sed -i 's#boardplay\.dpdns\.org#NEWDOMAIN#g'
```

> 확인: `grep -rn "boardplay.dpdns.org" web/index.html web/public` → 아무것도 안 나와야 함.

---

## 4. 재배포

```bash
cd /c/dev/boardgameMulti
npm run deploy
```

배포 후 확인: `curl https://NEWDOMAIN/health` → `{"ok":true,...}`, 규칙 페이지 200.

---

## 5. GA4 (거의 그대로)

- 측정 ID는 **도메인 무관** → 새 도메인에서도 그대로 작동. **필수 작업 없음.**
- (선택) GA4 관리 → 데이터 스트림 → 스트림 URL을 새 도메인으로 갱신.
- (선택) 관리 → 데이터 스트림 → 태그 설정 → 내부 트래픽 제외 규칙에 본인 IP 갱신.

---

## 6. 구글 서치콘솔 (새 도메인 = 새 속성)

1. **새 속성 추가**. 실도메인이면 **"도메인" 속성**(DNS TXT 인증) 권장 — www/비www, http/https 전부 커버.
   - DNS 방식이 번거로우면 "URL 접두어 + HTML 파일 인증"도 가능. 이 경우 클로드가 새 인증 파일을 `web/public/`에 넣고 배포해준다.
2. 소유확인 후 **Sitemaps → `sitemap.xml` 제출**.
3. **기존 dpdns 속성**: 설정 → **주소 변경(Change of address)** 으로 새 도메인 지정. (아래 §8 301 리다이렉트가 함께 있어야 인정됨)

---

## 7. 네이버 서치어드바이저 (이제 등록 가능)

1. 사이트 등록(새 도메인).
2. 소유확인 — HTML 파일 또는 메타태그. 발급 코드를 클로드에게 주면 `web/public/`(파일) 또는 `web/index.html`(메타)에 넣고 배포.
3. **사이트맵 제출** + 수집요청(RSS/사이트맵).
4. 네이버는 검색 색인용, 애드센스와 무관 → 아무 네이버 계정으로 OK.

---

## 8. 옛 주소 → 새 주소 301 리다이렉트 (권장)

옛 `dpdns.org`로 쌓인 색인·링크를 새 도메인으로 넘겨 SEO 자산을 보존한다.

- dpdns 서브도메인을 계속 서버로 향하게 둔 채, **서버/nginx/Cloudflare에서 옛 Host 요청을 새 도메인으로 301**.
- 구체 설정은 그때 클로드가 서버 상황(nginx 유무 등) 보고 안내.

---

## 9. 애드센스 (트래픽 쌓인 뒤, 마지막 단계)

- 신청 전 확인: 콘텐츠 충분(규칙·전략·계산기 등), 개인정보처리방침(있음)·소개(있음), HTTPS(있음), 정상 동작.
- **계정 주의**: 구글은 개인당 애드센스 1개 원칙. 이 사이트를 (a) 분리 계정으로 신규 신청 vs (b) 기존 계정에 사이트 추가 — 저작권 리스크 격리 ↔ 복수계정 문제의 트레이드오프. 그 시점에 애드센스 정책 확인 후 결정.

### 승인 후 광고 켜는 법 (자리는 이미 배치돼 있음)

광고 슬롯은 이미 코드에 심어져 있고(로비 하단, 스컬킹·티츄 **게임 종료 순위 아래**), 승인 전엔 실사용자에게 안 보인다. 켜려면 **3곳만** 채운다:

1. **`web/index.html`** — `<head>` 의 `adsbygoogle.js` 주석을 풀고 `client=ca-pub-...` 를 본인 게시자 ID로.
2. **`web/src/ads.tsx`** — `ADSENSE_CLIENT = ''` → `'ca-pub-XXXXXXXXXXXXXXXX'`.
3. 각 `<AdSlot slot="...">` — 애드센스에서 만든 광고단위 ID(data-ad-slot 숫자)를 넣는다. 현재 위치: `web/src/LobbyHome.tsx`, `web/src/game/GameView.tsx`, `web/src/game/TichuGameView.tsx`.

그 뒤 `npm run deploy`. **정책 주의**: 새 광고 자리는 반드시 게임 조작 버튼(입찰·카드)과 떨어진 곳에만 — 실수 클릭 유발 = 계정 제재. (지금 배치된 3곳은 안전지대.)

---

## 10. 아직 안 채운 placeholder

- 개인정보처리방침 시행일(`web/public/privacy/index.html`) 실제 값 확인.
- 문의 이메일은 커뮤니티 게시판으로 대체돼 **제거됨**(할 것 없음).

## 참고

- 배포 방법: [`docs/DEPLOY.md`](DEPLOY.md)
- DB 스키마(커뮤니티 posts 포함): `server/src/db/schema.sql`
- 관리자 아이디(커뮤니티 전체 열람): `ilo2918`
