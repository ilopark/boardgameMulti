# 배포

## 왜 GitHub Pages로는 안 되나

이 게임은 **실시간 멀티플레이**라 항상 떠 있는 서버가 필요하다.
GitHub Pages는 HTML/CSS/JS만 올려주는 **정적 호스팅**이라 서버 프로세스를 못 돌린다.
같은 이유로 Vercel·Netlify도 안 된다 (서버리스 함수는 WebSocket을 유지 못 함).

## 플랫폼 비교 (2026년 8월 기준)

| 플랫폼 | 무료로 가능? | 걸리는 점 |
|---|---|---|
| GitHub Pages | ❌ | 정적 전용 |
| Vercel / Netlify | ❌ | 서버리스 — WebSocket 불가 |
| Render 무료 | ⚠️ **비추천** | **소켓이 5분마다 끊김**, 15분 무트래픽 시 슬립 + 콜드스타트 1분 |
| Render 유료 | ✅ | $7/월, 슬립 없음 |
| Fly.io | ❌ | 2024년 무료 티어 폐지, 카드 필수 |
| Railway | ❌ | $5 크레딧 소진 후 유료 |
| **Koyeb 무료** | ✅ **추천** | 카드 불필요, 512MB/0.1vCPU, 1시간 무트래픽 시 슬립(콜드스타트 1~5초) |
| 자체 서버 + Cloudflare Tunnel | ✅ | 서버가 항상 켜져 있어야 함, 슬립·콜드스타트 없음 |

> Render 무료는 소켓을 5분마다 끊어서 **게임 중에 튕긴다.** 쓰지 말 것.

---

## 추천 1: Koyeb (무료, GitHub 자동배포)

1. https://www.koyeb.com 가입 (GitHub 계정으로)
2. **Create Service → GitHub** → `ilopark/boardgame` 선택
3. 설정
   - Branch: `main`
   - Builder: **Dockerfile** (레포 루트의 Dockerfile을 자동 인식)
   - Instance: **Free**
   - Port: `3001` (HTTP)
   - Health check path: `/health`
4. 환경변수
   ```
   NODE_ENV=production
   ```
   (PORT는 Koyeb이 자동 주입. CORS_ORIGIN은 서버가 프론트까지 같이 주므로 불필요)
5. Deploy

이후 **main에 푸시하면 자동으로 재배포**된다. 별도 설정 없음.

## 추천 2: 자체 서버 + Cloudflare Tunnel (무료, 슬립 없음)

항상 켜 두는 리눅스 머신이 있으면 이게 가장 쾌적하다. 콜드스타트가 없다.

```bash
# 서버에서
git clone git@github.com:ilopark/boardgame.git
cd boardgame
docker build -t boardgame .
docker run -d --restart=unless-stopped -p 3001:3001 \
  -e NODE_ENV=production --name boardgame boardgame

# Cloudflare Tunnel (도메인 없이도 임시 주소 발급됨)
cloudflared tunnel --url http://localhost:3001
```

자동배포까지 원하면 서버에 [Watchtower](https://containrrr.dev/watchtower/)를 띄우거나,
GitHub Actions에서 SSH로 `git pull && docker compose up -d --build` 하도록 하면 된다.

---

## 로컬에서 배포 형태 그대로 돌려보기

```bash
docker build -t boardgame .
docker run --rm -p 3001:3001 -e NODE_ENV=production boardgame
```

http://localhost:3001 에서 프론트·서버가 한 주소로 뜬다.

Docker 없이:
```bash
npm run build
NODE_ENV=production node server/dist/index.js
```

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3001` | 서버 포트. 대부분의 PaaS가 자동 주입한다 |
| `NODE_ENV` | — | `production`이면 CORS를 같은 오리진으로 제한 |
| `CORS_ORIGIN` | 개발: 전체 허용 / 배포: 같은 오리진 | 프론트를 따로 호스팅할 때만 지정 |
| `WEB_DIST` | `../../web/dist` | 정적 파일 경로. Docker에선 건드릴 필요 없음 |

---

## 배포 전에 알아둘 것 (중요)

### 1. 서버가 재시작되면 진행 중인 게임이 사라진다

방 상태를 **메모리에만** 들고 있다. 그래서:

- **main에 푸시하면 자동 재배포 → 그 순간 게임 중이던 방이 전부 날아간다**
- Koyeb 무료는 1시간 무트래픽 시 슬립 → 깨어날 때도 방이 초기화된다

게임하는 중에는 푸시하지 말 것. 근본 해결은 방 상태를 SQLite나 Redis로 빼는 것
(ROADMAP 4단계).

### 2. 콜드스타트

Koyeb 무료는 1시간 아무도 안 들어오면 잠든다. 첫 사람이 들어올 때 1~5초 걸리고,
그 뒤로는 정상이다. 친구들 모으기 전에 링크를 한 번 열어두면 깔끔하다.

### 3. 방 코드만 알면 누구나 들어온다

로그인이 없다. 6자리 코드(31글자 알파벳 기준 약 9억 가지)라 찍어서 맞추긴 어렵지만,
공개된 인터넷에 떠 있다는 건 기억해 둘 것.

---

## CI

`.github/workflows/ci.yml`이 main 푸시와 PR마다 돌면서:

1. 룰 엔진 테스트 (100개)
2. server / web 타입체크
3. 프로덕션 빌드
4. Docker 이미지 빌드 + 컨테이너가 실제로 뜨는지 헬스체크

를 확인한다. **CI는 배포를 막지 않는다** — Koyeb은 푸시를 보고 바로 배포하므로,
CI가 빨간불이어도 배포는 진행된다. 이게 싫으면 Koyeb의 자동배포를 끄고
GitHub Actions에서 CI 통과 후 Koyeb API로 배포를 트리거하면 된다.
