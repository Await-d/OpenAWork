# 阶段 0：bun 运行时镜像（版本与仓库根 `.bun-version` 对齐，升级时两处一起改）。
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-alpine AS bun-runtime

FROM node:20-alpine AS builder
WORKDIR /app

# bun 二进制从阶段 0 取（官方 alpine / musl 镜像）。
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
# bun 的 musl 构建依赖 libstdc++；alpine 基础镜像默认不带。
RUN apk add --no-cache libstdc++

COPY package.json bun.lock .npmrc ./
COPY patches ./patches
# 只拷 apps/web 的 workspace 传递闭包清单（含 workspace 依赖的依赖）：
# bun 会校验「已包含 workspace 的 workspace 依赖是否在磁盘上」，缺一个就报
# "depends on workspace ... listed in bun.lock but not on disk"。
# 闭包外的 workspace（apps/*、agent-core 等）会被 bun 自动跳过。
COPY packages/artifacts/package.json ./packages/artifacts/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY packages/web-client/package.json ./packages/web-client/
COPY apps/web/package.json ./apps/web/
# apps/web 的部分页面（如 pages/misc/AboutPage.tsx）直接相对引用 apps/desktop/src/**，
# 因此 desktop 的清单与源码也必须在场，否则 tsc 报 TS2307（迁移前即存在的缺陷）。
COPY apps/desktop/package.json ./apps/desktop/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/artifacts ./packages/artifacts
COPY packages/logger ./packages/logger
COPY packages/shared ./packages/shared
COPY packages/shared-ui ./packages/shared-ui
COPY packages/web-client ./packages/web-client
COPY apps/web ./apps/web
COPY apps/desktop ./apps/desktop
# apps/web/vite.config.ts 直接引用根 scripts/build/*.mjs（版本插件、图标插件、
# SW 残留断言），旧 Dockerfile 未拷贝该目录 —— 迁移前即会构建失败。
COPY scripts ./scripts
RUN bun run --filter @openAwork/shared build
RUN bun run --filter @openAwork/shared-ui build
RUN bun run --filter @openAwork/web-client build
RUN bun run --filter @openAwork/web build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# 主配置必须显式下发：worker_connections 在 events{} 上下文，conf.d/*.conf 无法覆盖它。
COPY apps/web/nginx.main.conf /etc/nginx/nginx.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
