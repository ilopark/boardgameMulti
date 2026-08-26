# syntax=docker/dockerfile:1

# ── 빌드 ──
FROM node:22-alpine AS build
WORKDIR /app

# 의존성 캐시를 살리려고 package.json만 먼저 복사한다
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# ── 실행 ──
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
# 서버 실행에 필요한 prod 의존성만 (web의 react 등은 빌드 결과물에 이미 번들돼 있어 불필요)
RUN npm ci --omit=dev --workspace=server --include-workspace-root && npm cache clean --force

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

# node 유저로 실행 (root로 돌리지 않는다)
USER node

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
