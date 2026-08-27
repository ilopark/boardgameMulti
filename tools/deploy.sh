#!/bin/bash
# 로컬 커밋을 Oracle 서버에 배포한다.
#   1) GitHub 에 push  2) 서버에서 git pull + build + 재시작
set -e
SERVER="ubuntu@161.33.213.129"
KEY="$HOME/.ssh/id_ed25519"
echo "== GitHub 에 push =="
git push origin main
echo "== Oracle 서버 배포 =="
ssh -i "$KEY" "$SERVER" 'bash ~/deploy.sh'
