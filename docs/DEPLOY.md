# 배포

## 현재 운영 배포 — Oracle Cloud (자체 서버)

지금 실제 서비스는 Oracle Cloud 무료티어 서버에서 돌아간다.

| 항목 | 값 |
|---|---|
| 서버 | `ubuntu@161.33.213.129` |
| SSH 키 | `~/.ssh/id_ed25519` (이 경로에 **실제 키 파일이 있어야** 함) |
| 도메인 | `boardplay.dpdns.org` (dpdns.org 무료 서브도메인) |
| 서버 포트 | `3001` (프론트 정적파일까지 같은 서버가 서빙) |

### 한 번에 배포

```bash
npm run deploy      # = bash tools/deploy.sh
```

이게 하는 일:
1. `git push origin main` — GitHub에 푸시
2. `ssh -i ~/.ssh/id_ed25519 ubuntu@161.33.213.129 'bash ~/deploy.sh'`
   — 서버에서 git pull + 빌드 + 재시작

### 수동으로 서버만 배포 (푸시는 이미 됐을 때)

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@161.33.213.129 'bash ~/deploy.sh'
```

> `ssh -i ~/.ssh/id_ed25519 ubuntu@161.33.213.129` 만 치면 **로그인만** 된다.
> 배포하려면 접속 후 `bash ~/deploy.sh` 를 돌리거나 위처럼 한 줄로 실행한다.

### 주의

- **키 파일이 없으면** `Identity file ... not accessible` / `Host key verification failed` 로 실패한다.
  새 PC에서 배포하려면 배포용 개인키를 `~/.ssh/id_ed25519` 에 두고,
  처음 접속 시 호스트 키를 한 번 승인(`yes`)해야 한다.
- **게임 중 배포 금지** — 방 상태가 메모리에만 있어 재시작하면 진행 중이던 방이 사라진다.
- 배포 후 `https://boardplay.dpdns.org/health` 로 정상 기동 확인.

---

## 왜 GitHub Pages로는 안 되나

이 게임은 **실시간 멀티플레이**라 항상 떠 있는 서버가 필요하다.
GitHub Pages는 HTML/CSS/JS만 올려주는 **정적 호스팅**이라 서버 프로세스를 못 돌린다.
같은 이유로 Vercel·Netlify도 안 된다 (서버리스 함수는 WebSocket을 유지 못 함).

## 플랫폼 비교 (2026년 8월 확인)

| 플랫폼 | 무료 | 카드 | WebSocket | 비고 |
|---|---|---|---|---|
| GitHub Pages | ✅ | — | ❌ | 정적 전용, 서버가 없음 |
| Vercel / Netlify | ✅ | — | ❌ | 서버리스라 소켓 유지 불가 |
| Render 무료 | ✅ | 불필요 | ⚠️ | **소켓이 5분마다 끊김** — 못 씀 |
| Render 유료 | $7/월 | 필요 | ✅ | 슬립 없음 |
| **Koyeb** | ❌ | — | ✅ | **2026년 2월 Mistral 인수 후 신규 무료 가입 중단** |
| Fly.io | ❌ | 필요 | ✅ | 2024년 무료 티어 폐지 |
| Railway | ❌ | 필요 | ✅ | $5 크레딧 소진 후 유료 |
| Northflank Sandbox | ✅ | **필요**(인증용) | ✅ | 항상 켜짐 |
| **Cloudflare Tunnel** | ✅ | **불필요** | ✅ | 내 컴퓨터가 켜져 있어야 함 |

> Koyeb은 이 프로젝트 초기에 추천했다가 인수 이후 무료 티어가 닫힌 걸 확인하고 뺐다.

---

## 추천 1: Cloudflare Tunnel — 가장 빠르고 계정도 필요 없다

친구들끼리 그때그때 모여서 하는 용도라면 이게 제일 낫다.
회원가입도, 카드도, 도메인도 필요 없다. **실제로 WebSocket까지 동작 확인함.**

```bash
brew install cloudflared    # 처음 한 번만
npm run build               # 처음 한 번, 코드 바뀔 때마다
npm run share
```

그러면 이런 게 뜬다:

```
==========================================================
  친구들에게 이 링크를 보내세요

  https://xxxx-yyyy-zzzz.trycloudflare.com

  이 창을 닫으면 링크가 끊깁니다. 종료는 Ctrl+C
==========================================================
```

**장점** — 콜드스타트 없음, 비용 0, 가입 절차 없음, 소켓이 안 끊김
**단점** — 내 컴퓨터가 켜져 있어야 하고, 껐다 켜면 **주소가 바뀐다**

주소를 고정하고 싶으면 Cloudflare 계정 + 도메인이 필요하다
(무료 계정으로 가능하지만 도메인은 따로 있어야 함).

### 항상 켜 두려면

맥미니처럼 상시 구동하는 기기가 있으면 거기에 올려두면 된다.
자동 실행 설정과 잠자기 방지는 [tools/macos/README.md](../tools/macos/README.md) 참고.

주소는 **터널이 살아 있는 동안 그대로**이고, 재부팅하면 바뀐다.
완전히 고정하려면 Cloudflare 계정 + 본인 도메인이 필요하다.

## 추천 2: Northflank 무료 Sandbox — 항상 켜두고 싶을 때

24시간 떠 있어야 하면 이쪽. 카드가 필요하지만 **인증 목적이고 Sandbox 자체는 무료**다.

1. https://northflank.com 가입
2. Create Service → **Build from Git** → `ilopark/boardgame`
3. Build type: **Dockerfile** (레포 루트)
4. Plan: **Sandbox (무료)**
5. Port `3001`, HTTP, public
6. Health check `/health`
7. 환경변수 `NODE_ENV=production`

## 그 외: 자체 서버에 상시 구동

항상 켜 두는 리눅스 머신이 있으면:

```bash
git clone git@github.com:ilopark/boardgame.git
cd boardgame
docker build -t boardgame .
docker run -d --restart=unless-stopped -p 3001:3001 \
  -e NODE_ENV=production --name boardgame boardgame
cloudflared tunnel --url http://localhost:3001
```

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
