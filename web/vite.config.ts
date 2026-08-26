import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 같은 와이파이의 친구가 바로 들어올 수 있게 (로컬 테스트용)
    host: true,
  },
})
