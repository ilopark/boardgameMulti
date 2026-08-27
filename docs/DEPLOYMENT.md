# 배포 정보 (Oracle Cloud)

> ⚠️ 이 문서엔 서버 IP 등이 있어 **레포가 private 인 전제**로 관리한다. public 전환 시 민감 정보 분리 필요.

멀티 버전은 Oracle Cloud Always Free VM 에서 24/7 가동. (2026-08-27 구축)

## 서버
- **IP**: 161.33.213.129 (Oracle AMD `VM.Standard.E2.1.Micro`, Ubuntu 22.04, 2코어, RAM 1GB + swap 2GB, 도쿄)
- **접속**: `ssh -i ~/.ssh/id_ed25519 ubuntu@161.33.213.129`
- **앱 경로**: `~/boardgameMulti`

## 서비스 (systemd, 부팅 자동시작)
| 서비스 | 역할 |
|---|---|
| `boardgame` | 게임 서버 (Node, PORT 3000, MemoryMax 700M) |
| `bg-tunnel` | cloudflared quick tunnel (공개 URL) |
| `redis-server` | 로컬 Redis (서버+Redis 한 머신) |

DB 는 Supabase(클라우드). 서버 `~/boardgameMulti/.env` 에 접속 정보.

## 공개 URL — ⚠️ 고정 아님
cloudflared **quick tunnel** 이라 터널/서버 재시작 시 URL 이 바뀐다. 현재 URL 확인:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@161.33.213.129 \
  "grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' ~/tunnel.log | head -1"
```
**도메인 구매 시** named tunnel 로 고정 URL 을 만든다. (미완)

## 자동배포 — `git push` 하면 끝
- `main` push → GitHub Actions(`.github/workflows/deploy.yml`) → 서버 SSH → `~/deploy.sh`
  (git pull + npm ci + build + `systemctl restart boardgame`)
- `deploy.sh` 는 **build 실패 시 restart 안 함** → 깨진 코드 push 돼도 서버는 이전 버전 유지
- 수동 배포: 로컬에서 `npm run deploy`

## 키 (분리)
| 키 | 위치 | 용도 |
|---|---|---|
| 배포 키 (private) | 로컬 `~/.ssh/boardgame_deploy` | GitHub Secret `DEPLOY_SSH_KEY` — Actions 가 서버 접속 |
| 배포 키 (public) | 서버 `~/.ssh/authorized_keys` | 위 키의 짝 |
| pull 키 (public) | GitHub 레포 Deploy Keys (read-only) | 서버가 private 레포 pull |
| pull 키 (private) | 서버 `~/.ssh/github_deploy` | 서버 `~/.ssh/config` 에서 github.com→이 키 |

레포는 **private**. 노출 시 해당 키만 폐기하면 됨(개인 키와 분리).

## 로그/디스크 관리
- journald 200MB 제한: `/etc/systemd/journald.conf.d/size.conf`
- tunnel.log logrotate 10MB: `/etc/logrotate.d/bg-tunnel`
- DB 통계(visits/games/room_events): Supabase 500MB — 소규모면 수년치, 차면 오래된 원본 정리

## 남은 일
- [ ] URL 고정 (도메인 구매 → named tunnel)
