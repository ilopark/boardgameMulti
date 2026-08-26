/**
 * 친구들에게 링크 하나로 공유하기.
 *
 *   npm run share
 *
 * 프로덕션 빌드를 띄우고 Cloudflare Tunnel로 공개 주소를 만든다.
 * 계정도 카드도 필요 없다. 대신 **이 창을 닫으면 링크도 죽는다.**
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = process.env.PORT ?? '3100'

if (!existsSync(resolve(ROOT, 'web/dist/index.html')) || !existsSync(resolve(ROOT, 'server/dist/index.js'))) {
  console.error('빌드가 없습니다. 먼저 실행하세요:\n\n  npm run build\n')
  process.exit(1)
}

const children = []
const stop = () => {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

console.log(`서버 시작 (포트 ${PORT})…`)
const server = spawn('node', ['server/dist/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
children.push(server)
server.stdout.on('data', (d) => process.stdout.write(`[서버] ${d}`))
server.stderr.on('data', (d) => process.stderr.write(`[서버] ${d}`))

await new Promise((r) => setTimeout(r, 1500))

console.log('공개 주소 만드는 중…')
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
children.push(tunnel)

let announced = false
const watch = (chunk) => {
  const text = String(chunk)
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  if (match && !announced) {
    announced = true
    const url = match[0]
    console.log('\n' + '='.repeat(58))
    console.log('  친구들에게 이 링크를 보내세요')
    console.log()
    console.log(`  ${url}`)
    console.log()
    console.log('  이 창을 닫으면 링크가 끊깁니다. 종료는 Ctrl+C')
    console.log('='.repeat(58) + '\n')
  }
}
tunnel.stdout.on('data', watch)
tunnel.stderr.on('data', watch)

tunnel.on('exit', (code) => {
  if (code !== 0) {
    console.error('\ncloudflared 실행 실패. 설치가 필요합니다:\n\n  brew install cloudflared\n')
  }
  stop()
})
