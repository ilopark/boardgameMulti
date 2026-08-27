import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * .env 를 읽어 process.env 에 올린다.
 *
 * 파일이 없으면 조용히 넘어간다 — 컨테이너나 서버에서는 진짜 환경변수로 넣기 때문이다.
 * dotenv 를 안 쓰는 이유는 Node 21.7 부터 이 기능이 내장돼서다.
 *
 * **다른 모듈보다 먼저 불러야 한다.** 모듈이 최상위에서 process.env 를 읽는 경우가 있어서,
 * 늦게 부르면 이미 undefined 로 굳어 있다.
 */
export function loadEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return
  try {
    // Node 21.7+ 내장. 이미 들어 있는 환경변수를 덮어쓰지 않는다.
    process.loadEnvFile(path)
    console.log(`[환경] ${file} 을 읽었습니다`)
  } catch (err) {
    console.error(`[환경] ${file} 을 읽지 못했습니다`, err)
  }
}
