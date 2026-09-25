# OpenAWork agent-gateway 生产镜像。
#
# 用 Debian（glibc）而不是 Alpine（musl）：packages/agent-core 依赖 better-sqlite3，
# 其预编译二进制只有 glibc 版本；musl 下要带整套编译工具链从源码构建。
#
# 包管理器是 bun（安装依赖 + 跑构建脚本），运行时仍是 Node（CMD node dist/index.js）。
#
# 构建参数（默认值与仓库根 `.bun-version` / docker-compose.yml 对齐，漂移由
# `bun run check:docker-versions` 拦截；发布流水线通过 --build-arg 注入真实版本）：
#   BUN_VERSION         bun 工具链版本（默认与 `.bun-version` 一致）
#   NODE_VERSION        Node 主版本，builder / runtime 基础镜像共用
#   OPENAWORK_VERSION   应用版本（package.json version），写入 OCI 标签与 ENV
#   OPENAWORK_GIT_SHA   构建提交，写入 OCI revision 标签

# ---------------------------------------------------------------------------
# 阶段 0 —— bun 运行时镜像（版本与仓库根 `.bun-version` 对齐，升级时两处一起改）
# ---------------------------------------------------------------------------
ARG BUN_VERSION=1.4.2
ARG NODE_VERSION=22
FROM oven/bun:${BUN_VERSION} AS bun-runtime

# ---------------------------------------------------------------------------
# 阶段 1 —— 安装网关的 workspace 依赖闭包、编译 TypeScript、裁剪 devDependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app

# bun 二进制从阶段 0 取（官方镜像），避免在 node 基础镜像里额外装包。
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

# 非交互模式：bun 清理或重装 node_modules 时不会因为没有 TTY 卡在确认提示。
ENV CI=true

# 原生依赖（better-sqlite3 / koffi / ffmpeg-static）取不到预编译产物时的兜底编译
# 工具链。随本阶段一起丢弃。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 先拷清单，让依赖层只在依赖变化时才失效。
# 只拷网关的 `workspace:*` 传递闭包 —— apps/* 与纯 UI 包（shared-ui、web-client、
# multi-agent）有意排除；bun 会跳过 bun.lock 中存在但磁盘上没有的 workspace
# （note: skipped N workspaces），因此不会把无关依赖带进 node_modules。
COPY package.json bun.lock .npmrc ./
COPY patches ./patches
COPY packages/agent-core/package.json ./packages/agent-core/
COPY packages/artifacts/package.json ./packages/artifacts/
COPY packages/browser-automation/package.json ./packages/browser-automation/
COPY packages/logger/package.json ./packages/logger/
COPY packages/lsp-client/package.json ./packages/lsp-client/
COPY packages/mcp-client/package.json ./packages/mcp-client/
COPY packages/opencode-llm/package.json ./packages/opencode-llm/
COPY packages/pairing/package.json ./packages/pairing/
COPY packages/platform-adapter/package.json ./packages/platform-adapter/
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY packages/resources/package.json ./packages/resources/
COPY packages/shared/package.json ./packages/shared/
COPY packages/skill-registry/package.json ./packages/skill-registry/
COPY packages/skill-types/package.json ./packages/skill-types/
COPY packages/skills/package.json ./packages/skills/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY services/agent-gateway/package.json ./services/agent-gateway/
RUN bun install --frozen-lockfile

# 源码（与上面的清单同一个闭包）。
COPY tsconfig.base.json ./
COPY packages/agent-core ./packages/agent-core
COPY packages/artifacts ./packages/artifacts
COPY packages/browser-automation ./packages/browser-automation
COPY packages/logger ./packages/logger
COPY packages/lsp-client ./packages/lsp-client
COPY packages/mcp-client ./packages/mcp-client
COPY packages/opencode-llm ./packages/opencode-llm
COPY packages/pairing ./packages/pairing
COPY packages/platform-adapter ./packages/platform-adapter
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/resources ./packages/resources
COPY packages/shared ./packages/shared
COPY packages/skill-registry ./packages/skill-registry
COPY packages/skill-types ./packages/skill-types
COPY packages/skills ./packages/skills
COPY packages/telemetry ./packages/telemetry
COPY services/agent-gateway ./services/agent-gateway

RUN bun run --filter "./packages/*" build \
    && bun run --filter @openAwork/agent-gateway build

# bash-tools.ts 在运行期读盘加载提示词模板，优先找编译产物同目录的 `./bash.txt`。
# tsc 不搬运非 TS 资源，少了这一步，任何编译态下该工具都会静默退化成 stub 提示词。
RUN cp services/agent-gateway/src/tools/bash.txt services/agent-gateway/dist/tools/bash.txt

# 剔除 devDependencies。
#
# bun 的等价物是 `bun prune --production`（`bun install --production` 对已存在的
# node_modules 是 no-op，不会裁剪）。这一步只删包目录，不重装、不重跑脚本，
# 因此上一步写进 node_modules/.bun 的原生产物（better-sqlite3 绑定、ffmpeg 二进制）
# 会原样保留 —— 与旧 pnpm 流程的 `install --prod --ignore-scripts` 语义一致。
RUN bun prune --production \
    && rm -rf packages/*/src services/agent-gateway/src packages/*/*.tsbuildinfo

# ffprobe-static 自带各操作系统的预编译二进制；在 Linux 上 darwin 与 win32 两棵树
# （约 237 MB）纯属冗余 —— 网关只会拉起 linux 那份（见 src/media/ffmpeg-bridge.ts）。
RUN rm -rf node_modules/.bun/ffprobe-static@*/node_modules/ffprobe-static/bin/darwin \
           node_modules/.bun/ffprobe-static@*/node_modules/ffprobe-static/bin/win32

# ---------------------------------------------------------------------------
# 阶段 2 —— 运行时（只带必要内容）
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 应用版本元数据：发布流水线注入真实值（package.json version + 提交 SHA），
# 本地构建保持 dev / unknown。运行时可 `docker inspect` 或容器内 env 查看。
ARG OPENAWORK_VERSION=dev
ARG OPENAWORK_GIT_SHA=unknown
LABEL org.opencontainers.image.title="OpenAWork agent-gateway" \
      org.opencontainers.image.description="OpenAWork AI Agent 工作台网关（Fastify 5 HTTP/WS 服务）" \
      org.opencontainers.image.source="https://github.com/Await-d/OpenAWork" \
      org.opencontainers.image.version="${OPENAWORK_VERSION}" \
      org.opencontainers.image.revision="${OPENAWORK_GIT_SHA}"
ENV OPENAWORK_VERSION=${OPENAWORK_VERSION}

# 网关的 bash / GitHub 工具链路期望 PATH 上有 git。
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# 浏览器实时预览是可选能力。默认镜像不带浏览器，/browser-live/status 会返回
# `browser-missing`。加 `--build-arg INSTALL_CHROMIUM=true` 会装上 Debian 的 chromium
# 及其系统依赖，落在 /usr/bin/chromium —— 正是
# packages/browser-automation/src/live-browser-availability.ts 所探测的 system-chromium
# 候选路径之一。运行时仍需 OPENAWORK_BROWSER_LIVE=1 才真正启用。
ARG INSTALL_CHROMIUM=false
RUN if [ "$INSTALL_CHROMIUM" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends chromium fonts-liberation \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# bun 的隔离式 node_modules 靠符号链接指向 node_modules/.bun，所以必须把整棵依赖树
# 与各 workspace 包目录一并拷入，否则链接会断。
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/agent-gateway ./services/agent-gateway

# docker-compose.yml 把命名卷 `gateway_data` 挂到这里。
RUN mkdir -p /var/lib/openawork

# 与 docker-compose.yml 对齐的默认值。JWT_SECRET 有意不在这里设置 —— 必须由运行时
# 环境注入。
ENV GATEWAY_PORT=3000 \
    GATEWAY_HOST=0.0.0.0 \
    OPENAWORK_DATA_DIR=/var/lib/openawork

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GATEWAY_PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/services/agent-gateway
CMD ["node", "dist/index.js"]
