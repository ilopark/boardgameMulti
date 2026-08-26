# 맥에서 상시 운영하기

회사 맥미니처럼 항상 켜 두는 맥에서 게임 서버를 계속 띄워두는 방법.

## 준비

```bash
brew install cloudflared
cd /Users/ilo/dev/boardgame
npm ci
npm run build
```

## 자동 실행 등록

```bash
cp tools/macos/com.boardgame.share.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.boardgame.share.plist
```

이제 로그인할 때마다 자동으로 뜨고, 죽으면 알아서 다시 뜬다.
`caffeinate`가 걸려 있어서 **이게 도는 동안 맥이 잠들지 않는다.**

## 링크 확인

공개 주소는 로그에 찍힌다.

```bash
grep -o 'https://.*trycloudflare.com' ~/Library/Logs/boardgame.log | tail -1
```

## 해제

```bash
launchctl unload ~/Library/LaunchAgents/com.boardgame.share.plist
rm ~/Library/LaunchAgents/com.boardgame.share.plist
```

## 알아둘 것

- **주소는 터널이 살아 있는 동안 그대로다.** 맥을 재부팅하거나 터널이 죽으면 바뀐다.
  바뀌면 위 grep으로 새 주소를 확인해서 다시 공유하면 된다.
- 주소를 완전히 고정하려면 Cloudflare 계정 + **본인 소유 도메인**이 필요하다
  (named tunnel). 도메인이 없으면 임시 주소 방식이 최선이다.
- 코드를 고쳤으면 `npm run build` 후 서비스를 다시 로드해야 반영된다.
- 화면 잠금은 걸어도 된다. 잠자기(sleep)만 안 되면 된다.

## 나중에 집 컴퓨터로 옮길 때

똑같다. clone 받고 위 과정을 반복하면 된다.
리눅스면 launchd 대신 systemd나 Docker의 `--restart=unless-stopped`를 쓰면 된다.
