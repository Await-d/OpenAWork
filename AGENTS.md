# OpenAWork — 项目知识库

**生成时间：** 2026-03-21
**提交：** 7c73b44 | **分支：** main
**文档版本：** v2（含构建命令、测试命令、代码风格完整指引）

## 交互语言

- **所有对话必须使用中文**——包括回复、解释、提问、确认等一切交互内容，不得使用英文回复用户。

## 概述

跨平台 AI Agent 工作台：Fastify 网关 + React Web + Tauri 桌面端 + Expo 移动端。
技术栈：TypeScript（严格模式，NodeNext 模块），pnpm monorepo，Zod 校验，SQLite + Postgres + Redis。

## 目录结构

```
OpenAWork/
├── apps/
│   ├── web/          # React SPA（Vite），主要 UI
│   ├── desktop/      # Tauri v2 封装——通过相对导入直接复用 Web 页面
│   └── mobile/       # Expo Router（React Native），聊天 + 会话 + 设置
├── packages/
│   ├── agent-core/   # 核心 Agent 状态机、工具、会话、Provider 管理
│   ├── shared/       # 仅含消息/流类型——零业务逻辑
│   ├── shared-ui/    # 60+ React 组件，被所有应用使用
│   ├── multi-agent/  # 多 Agent 工作流 DAG 编排器
│   ├── skill-registry/ # 技能安装/生命周期/安全沙箱
│   ├── web-client/   # 浏览器端 WS + SSE 客户端及认证辅助
│   ├── platform-adapter/ # 平台路径解析（桌面 vs Web vs 移动端）
│   ├── mcp-client/   # MCP 协议客户端
│   ├── lsp-client/   # 网关 LSP 客户端
│   ├── pairing/      # 设备配对（二维码流程）
│   ├── browser-automation/ # 基于 Playwright 的浏览器工具
│   ├── logger/       # 结构化日志
│   ├── telemetry/    # Sentry + 分析
│   ├── artifacts/    # 产物存储与检索
│   └── skill-types/  # 共享技能类型定义
├── services/
│   └── agent-gateway/ # Fastify 5 HTTP/WS 服务器——后端
├── docs/             # 运行手册、技能开发指南、故障复盘模板
├── scripts/          # version.mjs、vite-plugin-version.mjs
└── .evidence/        # 参考实现（fastify、ioredis、postgres）——只读
```

## 查找指引

| 任务                | 位置                                                  |
| ------------------- | ----------------------------------------------------- |
| Agent 状态机        | `packages/agent-core/src/state-machine.ts`            |
| LLM Provider 配置   | `packages/agent-core/src/provider/`                   |
| 工具定义            | `packages/agent-core/src/tools/` + `tool-contract.ts` |
| 会话持久化          | `packages/agent-core/src/sqlite-session-store.ts`     |
| 多 Agent DAG        | `packages/multi-agent/src/dag.ts` + `orchestrator.ts` |
| 网关 HTTP 路由      | `services/agent-gateway/src/routes/`                  |
| 网关 WS 流式        | `services/agent-gateway/src/routes/stream.ts`         |
| 消息渠道            | `services/agent-gateway/src/channels/`                |
| 技能安装/安全       | `packages/skill-registry/src/`                        |
| 共享类型（消息/流） | `packages/shared/src/index.ts`                        |
| UI 组件             | `packages/shared-ui/src/`                             |
| Web 应用路由        | `apps/web/src/App.tsx`                                |
| 桌面 Tauri 命令     | `apps/desktop/src-tauri/src/`                         |
| 认证状态（Zustand） | `apps/web/src/stores/auth.ts`                         |
| 浏览器端网关客户端  | `packages/web-client/src/`                            |
| Docker 基础设施     | `docker-compose.yml`                                  |
| CI 流水线           | `.github/workflows/ci.yml`                            |
| Agent 路由逻辑      | `packages/agent-core/src/routing.ts`                  |

## 架构说明

- **桌面端复用 Web 页面**：`apps/desktop/src/App.tsx` 直接从 `../../web/src/pages/` 和 `../../web/src/stores/` 相对导入——非构建产物依赖，是直接 TS 导入。
- **网关作为桌面端 Sidecar**：通过 `bun build --compile` 编译为二进制，嵌入 Tauri 应用，路径为 `apps/desktop/src-tauri/sidecars/agent-gateway/`。
- **流式输出**：网关通过 SSE（`/stream` 路由）+ WebSocket 实现实时 Agent 输出。
- **消息渠道**：Telegram、Discord、飞书、钉钉、Slack 各自实现 `MessagingChannelService` 接口，位于 `services/agent-gateway/src/channels/`。
- **哈希锚定编辑**：自定义文件编辑工具（`packages/agent-core/src/tools/hash-edit.ts`）使用 SHA-256 行哈希替代行号，防止编辑漂移。
- **路由分级**：`packages/agent-core/src/routing.ts` 定义 R0–R3 路由分级（复杂度层级），用于 Agent 任务调度。
- **.evidence/**：fastify、ioredis、postgres 的只读参考源码，禁止编辑。

## 约定

### TypeScript

- `strict: true`、`noUncheckedIndexedAccess: true`、`noImplicitOverride: true`
- 模块系统：`NodeNext`（所有导入使用 `.js` 扩展名，即使源文件为 `.ts`）
- 强制使用 `consistent-type-imports`：纯类型导入必须使用 `import type { ... }`
- **禁止** `as any`、`@ts-ignore`、`@ts-expect-error`、空 catch 块、空函数——均视为错误

### 提交规范（husky + commitlint 强制执行）

- 格式：`type(scope): <中文描述>` — **scope 必填，描述必须以中文字符开头**
- 类型：feat | fix | docs | style | refactor | perf | test | build | chore | ci | revert
- 标题最大长度：100 字符
- 示例：`feat(gateway): 新增GitHub路由支持`
- scope 统一使用**小写**，优先采用模块 / 包 / 应用名（如 `gateway`、`web`、`shared-ui`、`agentdocs`）
- 正文 / 尾注可选；若使用 Sisyphus 协作尾注，必须使用仓库约定的标准 footer 与 `Co-authored-by` trailer 成对出现
- 详细说明与示例见：`docs/commit-convention.md`

### 代码风格（Prettier）

- 单引号（`singleQuote: true`）、分号（`semi: true`）、尾随逗号（`trailingComma: "all"`）
- 行宽 100（`printWidth: 100`）、2 空格缩进、空格括号（`bracketSpacing: true`）
- 箭头函数参数始终加括号（`arrowParens: "always"`）

### 包名规范

- 所有 workspace 包使用 `@openAwork/` scope
- 包内所有导出必须经过 `src/index.ts`——禁止消费者直接导入内部模块路径

### ESLint 范围与规则

- 代码检查仅运行在 `packages/` 和 `services/` 上——`apps/` 被根目录 ESLint 配置排除
- `@typescript-eslint/no-explicit-any`: error — 禁止 `any` 类型
- `@typescript-eslint/ban-ts-comment`: error — 禁止 `@ts-ignore`/`@ts-expect-error`
- `@typescript-eslint/consistent-type-imports`: error — 纯类型导入必须用 `import type`
- `@typescript-eslint/no-empty-function`: error — 禁止空函数体
- `no-empty`: error — 禁止空 catch 块
- 未使用变量以 `_` 前缀豁免（`_varName`，如 `_unused`）

### 命名约定

- 类/接口/类型：`PascalCase`（如 `AgentState`、`ToolRegistry`）
- 函数/变量：`camelCase`（如 `withRetry`、`computeDelay`）
- 常量：`UPPER_SNAKE_CASE`（如 `MAX_RETRIES`）
- 文件名：`kebab-case`（如 `state-machine.ts`、`sqlite-session-store.ts`）
- 前缀 `_` 表示有意忽略的变量（ESLint 豁免）

### 错误处理

- 禁止空 catch 块——必须记录日志或重新抛出
- 使用项目自定义错误类（`src/error/`）而非裸 `Error`
- 异步函数必须处理 rejection，禁止 unhandled promise rejection
- Zod 校验失败应在边界层（路由/网关入口）统一处理，返回结构化错误

## 常用命令

```bash
# 开发（所有包并行）
pnpm dev

# 构建所有包
pnpm build

# 代码检查（仅 packages + services）
pnpm lint
pnpm lint:fix

# 格式化
pnpm format
pnpm format:check

# 全量类型检查
pnpm typecheck

# 全量测试
pnpm test

# E2E（Web）
pnpm test:e2e

# 仅网关
pnpm --filter @openAwork/agent-gateway dev
pnpm --filter @openAwork/agent-gateway build:binary

# 清理所有
pnpm clean

# 单个包测试（以 agent-core 为例，替换包名即可）
pnpm --filter @openAwork/agent-core test

# 单个测试文件
pnpm --filter @openAwork/agent-core exec vitest run src/__tests__/state-machine.test.ts

# 匹配测试名称关键字
pnpm --filter @openAwork/agent-core exec vitest run -t "测试名称关键字"

# 带覆盖率
pnpm --filter @openAwork/agent-core exec vitest run --coverage

# 监听模式（开发时）
pnpm --filter @openAwork/agent-core exec vitest
```

## 环境变量

必需变量（参见 `.env.example`）：

- `JWT_SECRET` — 最少 32 字符，生成：`openssl rand -base64 32`
- `DATABASE_URL` — Postgres 连接字符串
- `REDIS_URL` — Redis 连接字符串
- `AI_API_KEY`、`AI_API_BASE_URL`、`AI_DEFAULT_MODEL`
- `GATEWAY_PORT`（默认 3000）、`GATEWAY_HOST`

Docker：`docker-compose up` 启动网关 + Web + Postgres + Redis。

## 代码组织规则

### 文件体积限制

- **单文件行数上限：1500 行**。1300–1500 行为预警区间，应主动评估拆分；超过 1500 行必须立即拆分，不得以任何理由豁免。
- 拆分时优先按**职责边界**切分，而非随机截断：
  - UI 渲染逻辑 → 独立子组件
  - 数据获取 / 副作用 → 独立 hook（`use*.ts`）
  - 纯计算 / 格式化 → `utils/` 工具函数
  - 常量 / 枚举 → `constants/` 或同级 `*.constants.ts`

### 组件提取原则

- **复杂 UI 优先组件化**：单个渲染块超过 80 行、或包含 3 层以上嵌套 JSX，必须提取为独立组件。
- **通用功能必须组件化**：在 2 个及以上页面/组件中重复出现的 UI 片段，提取到 `@openAwork/shared-ui` 或本地 `src/components/`。
- 提取规则：
  - 页面级子区域 → `src/components/<PageName>/` 子目录
  - 跨页面通用组件 → `src/components/` 或上报至 `packages/shared-ui/src/`
  - 与业务无关的纯展示组件 → 优先放 `shared-ui`

### 拆分检查清单（提交前自查）

在提交涉及页面/组件的改动前，确认以下各项：

- [ ] 当前文件是否超过 1500 行？→ 超过则必须拆分后再提交（1300–1500 行应主动评估）
- [ ] 是否有可提取为独立组件的渲染块（>80 行 或 >3 层嵌套）？
- [ ] 是否有在其他页面已存在的相似 UI 逻辑？→ 合并为共享组件
- [ ] 拆出的 hook/util 是否有对应单元测试？

### 反模式（禁止）

- 禁止在单个页面文件中堆砌多个独立功能的完整实现——每个功能域独立文件。
- 禁止用注释分隔替代文件拆分（`// ====== Section A ======`）——这是拆分信号，不是解决方案。
- 禁止因"暂时"而跳过拆分——技术债从第一次妥协开始累积。

## UI 设计规范

### 核心原则

- **设计质量优先**：UI 实现必须以用户体验和视觉美感为首要目标，功能完成不是降低设计标准的理由。
- **专业工具强制使用**：所有涉及 UI 的任务必须加载专业 skill，禁止在不参考设计规范的情况下徒手堆砌样式。
  - 视觉/布局/交互设计 → 加载 `frontend-design` skill
  - 组件库使用（antd/shadcn）→ 加载对应 skill（`ant-design` 等）
  - 响应式 / React 性能 → 加载 `vercel-react-best-practices` skill
  - Web 标准与可访问性审查 → 加载 `web-design-guidelines` skill

### 用户体验要求

- **操作流畅性**：交互元素必须有明确的 hover / active / focus 状态，禁止裸样式按钮。
- **视觉层次**：页面必须具备清晰的信息层级（主操作 > 次操作 > 辅助信息），禁止所有元素等权重平铺。
- **空间节奏**：间距、字号、色彩必须遵循统一的 design token，禁止魔法数字（如 `margin: 13px`）。
- **反馈完整性**：loading、empty、error 三态必须设计，禁止只实现 happy path。

### 执行约束

- 禁止以"先实现功能再优化样式"为由跳过设计——样式与功能同步交付。
- 禁止复制粘贴通用 AI 生成的平庸布局——每个页面需结合实际场景做针对性设计。
- 禁止忽略移动端适配——所有 Web 页面默认需响应式支持（最低 375px 宽度）。
- UI 改动提交前必须经过视觉自查：对齐、间距、色彩对比度（WCAG AA 标准）。

## 禁止事项

- 禁止从 monorepo 内的 `dist/` 导入——使用 TypeScript 项目引用解析的 `workspace:*` 依赖
- 禁止编辑 `.evidence/` 下的文件——仅作参考
- 禁止抑制 TS 错误（`as any`、`@ts-ignore`）——lint 视为错误
- 禁止使用纯英文提交描述——commitlint 会拒绝
- 禁止将包加入 `apps/` 的根 ESLint——设计上排除
- 禁止使用 CommonJS（`require`、`module.exports`）——项目为纯 ESM（`"type": "module"`）
- **严禁执行任何 git 回滚指令**，包括但不限于：`git reset --hard`、`git reset --soft`、`git reset --mixed`、`git revert`、`git checkout -- .`、`git restore`、`git clean -fd`——除非用户明确以书面形式授权，否则一律禁止

## 注意事项

- `apps/desktop` 使用 `useHasHydrated()` 模式（Zustand persist 水合守卫）——`apps/web` 中也有相同模式，两者均为有意保留，并非重复。
- 移动端使用手动屏幕状态机（非 React Navigation 栈）——`apps/mobile/src/navigation/AppNavigator.tsx`
- `packages/agent-core/src/catwalk/` — 模型评测/对比模块
- `packages/agent-core/src/crush-ignore/` — 文件排除规则（Agent 上下文的 .gitignore）
- `.agentdocs/` — AI 工作流规划文档，非运行时代码
- `.assistant/` — Agent 会话状态，非运行时代码
- 所有单元测试使用 Vitest（非 Jest），测试文件位于 `src/**/*.test.ts`
- E2E 使用 Playwright（Web + 桌面端）

## agent-core 子包说明

核心包结构（`packages/agent-core/src/`）：

| 模块                      | 说明                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `state-machine.ts`        | Agent FSM：idle→running→tool-calling→retry→interrupted→error（纯函数，无副作用）                                   |
| `tool-contract.ts`        | `ToolDefinition`、`ToolRegistry`——所有工具必须通过此注册                                                           |
| `routing.ts`              | R0–R3 路由分级（只读/单文件/多文件/架构级），5 维度计算                                                            |
| `sqlite-session-store.ts` | 生产级 SQLite 会话存储                                                                                             |
| `retry.ts`                | `withRetry`、`computeDelay`、`RetryAbortedError`                                                                   |
| `provider/`               | LLM Provider 管理：anthropic \| openai \| deepseek \| gemini \| ollama \| openrouter \| qwen \| moonshot \| custom |
| `tools/hash-edit.ts`      | SHA-256 行哈希锚定编辑，防止行号漂移                                                                               |
| `error/`                  | 自定义错误类型基类                                                                                                 |
