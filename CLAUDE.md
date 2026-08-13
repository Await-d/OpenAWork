# OpenAWork — 项目规则文档

本文档为 Claude Code 助手提供 OpenAWork 项目的核心规则、架构指引和开发约定。

## 核心要求

### 交互语言

**所有对话必须使用中文**——包括回复、解释、提问、确认等一切交互内容，不得使用英文回复用户。

### 项目概述

OpenAWork 是跨平台 AI Agent 工作台，采用 TypeScript monorepo 架构：

- **后端**：Fastify 5 网关（`services/agent-gateway`）
- **前端**：React Web（Vite）、Tauri v2 桌面端、Expo 移动端
- **核心包**：agent-core（状态机 + 工具）、multi-agent（DAG 编排）、skill-registry（技能沙箱）
- **技术栈**：TypeScript（strict + NodeNext）、pnpm workspace、Zod 校验、SQLite + Postgres + Redis

## 目录结构

```
OpenAWork/
├── apps/
│   ├── web/          # React SPA（Vite），主要 UI
│   ├── desktop/      # Tauri v2 封装，直接复用 Web 页面
│   └── mobile/       # Expo Router（React Native）
├── packages/
│   ├── agent-core/   # Agent 状态机、工具、Provider 管理
│   ├── shared/       # 消息/流类型（零业务逻辑）
│   ├── shared-ui/    # 60+ React 组件
│   ├── multi-agent/  # 多 Agent 工作流 DAG
│   ├── skill-registry/ # 技能安装/沙箱
│   ├── web-client/   # WS + SSE 客户端及认证
│   └── ...          # platform-adapter、mcp-client、lsp-client 等
├── services/
│   └── agent-gateway/ # Fastify HTTP/WS 服务器
├── docs/             # 运行手册、开发指南
└── .evidence/        # 参考实现（只读，禁止编辑）
```

## 快速查找

| 功能         | 位置                                                  |
| ------------ | ----------------------------------------------------- |
| Agent 状态机 | `packages/agent-core/src/state-machine.ts`            |
| LLM Provider | `packages/agent-core/src/provider/catalog.ts`         |
| 工具定义     | `packages/agent-core/src/tools/` + `tool-contract.ts` |
| 网关路由     | `services/agent-gateway/src/routes/`                  |
| 网关流式     | `services/agent-gateway/src/routes/stream.ts`         |
| UI 组件      | `packages/shared-ui/src/`                             |
| 认证状态     | `apps/web/src/stores/auth.ts`                         |
| 设计规范     | `packages/shared-ui/DESIGN-TOKENS.md`                 |

## TypeScript 规则

### 严格模式配置

- `strict: true`、`noUncheckedIndexedAccess: true`、`noImplicitOverride: true`
- 模块系统：`NodeNext`（所有导入使用 `.js` 扩展名）
- 纯类型导入必须使用 `import type { ... }`（ESLint 强制）

### 禁止项

- **禁止** `as any`、`@ts-ignore`、`@ts-expect-error`（ESLint error 级别）
- **禁止** 空 catch 块、空函数体
- **禁止** CommonJS（`require`、`module.exports`）——项目为纯 ESM

## 代码风格

### Prettier 配置

- 单引号、分号、尾随逗号（`trailingComma: "all"`）
- 行宽 100、2 空格缩进、空格括号
- 箭头函数参数始终加括号

### 命名约定

- 类/接口/类型：`PascalCase`（如 `AgentState`）
- 函数/变量：`camelCase`（如 `withRetry`）
- 常量：`UPPER_SNAKE_CASE`（如 `MAX_RETRIES`）
- 文件名：`kebab-case`（如 `state-machine.ts`）
- 前缀 `_` 表示有意忽略的变量

## 提交规范

### Commitlint 规则（husky 强制）

- 格式：`type(scope): <中文描述>`
- **scope 必填，描述必须以中文字符开头**
- 类型：feat | fix | docs | style | refactor | perf | test | build | chore | ci | revert | release
- 标题最大长度：100 字符
- 示例：`feat(gateway): 新增GitHub路由支持`

### 自动构建触发规则

- **普通提交不触发自动构建**：feat/fix/docs 等只跑 CI（lint + typecheck + test）
- **只有 `release(<scope>):` 提交会触发自动构建**：版本提升 + tag + 桌面端发布
- 推荐写法：`release(preview): 触发自动构建并发布桌面预览版`

## 文件组织规则

### 文件体积限制

- **单文件上限：1500 行**（1300–2000 预警，超过 2000 必须拆分）
- 拆分优先按**职责边界**：
  - UI 渲染 → 独立子组件
  - 数据获取/副作用 → 独立 hook（`use*.ts`）
  - 纯计算/格式化 → `utils/` 工具函数
  - 常量/枚举 → `constants/` 或 `*.constants.ts`

### 组件提取原则

- **复杂 UI 必须组件化**：单渲染块 >80 行或 >3 层嵌套 JSX，必须提取
- **通用功能必须组件化**：重复出现在 2+ 页面的 UI 片段，提取到 `@openAwork/shared-ui` 或本地 `src/components/`
- 提取规则：
  - 页面子区域 → `src/components/<PageName>/`
  - 跨页面通用 → `src/components/` 或 `packages/shared-ui/src/`
  - 纯展示组件 → 优先放 `shared-ui`

### 反模式（禁止）

- 禁止在单页面文件堆砌多个完整功能
- 禁止用注释分隔替代文件拆分（`// ====== Section A ======`）
- 禁止因"暂时"而跳过拆分

## UI 设计规范

### 核心原则

- **设计质量优先**：UI 实现必须以用户体验和视觉美感为首要目标
- **E · Nebula 色彩体系**：必须使用正式定稿的 token（靛青主强调 + 琥珀对比 + 珊瑚互补 + 靛蓝辅助）
- **专业工具强制使用**：所有涉及 UI 的任务必须加载专业 skill

### 色彩强制规则

- 主强调色（靛青）：仅用于 CTA / active / 选中态
- 对比色（琥珀）：仅用于 warning / 次级强调 / 数据高亮
- 互补色（珊瑚）：仅用于 danger / destructive
- 辅助色（靛蓝）：仅用于 info / 链接 / 代码高亮
- **禁止硬编码色值**，必须通过 CSS 变量引用

### 用户体验要求

- **操作流畅性**：交互元素必须有明确的 hover/active/focus 状态
- **视觉层次**：页面必须具备清晰的信息层级
- **空间节奏**：间距遵循 4/8/12/16/20/24/32/48 token 阶梯
- **反馈完整性**：loading/empty/error 三态必须设计
- **Focus 可访问性**：可交互元素必须有 focus ring

### 执行约束

- 禁止"先实现功能再优化样式"——样式与功能同步交付
- 禁止复制粘贴通用 AI 生成的平庸布局
- 禁止忽略移动端适配（最低 375px 宽度）
- **新增/修改组件前必须阅读** `packages/shared-ui/DESIGN-TOKENS.md`

## 常用命令

```bash
# 开发（所有包并行）
pnpm dev

# 构建所有包
pnpm build

# 代码检查
pnpm lint
pnpm lint:fix

# 格式化
pnpm format

# 全量类型检查
pnpm typecheck

# 全量测试
pnpm test

# 仅网关
pnpm --filter @openAwork/agent-gateway dev
pnpm --filter @openAwork/agent-gateway build:binary

# 单个包测试
pnpm --filter @openAwork/agent-core test

# 单个测试文件
pnpm --filter @openAwork/agent-core exec vitest run src/__tests__/state-machine.test.ts

# 匹配测试名称关键字
pnpm --filter @openAwork/agent-core exec vitest run -t "测试名称关键字"
```

## 环境变量

必需变量（参见 `.env.example`）：

- `JWT_SECRET` — 最少 32 字符
- `OPENAWORK_DATA_DIR` — Gateway 持久化数据根目录
- `REDIS_URL` — Redis 连接字符串
- `AI_API_KEY`、`AI_API_BASE_URL`、`AI_DEFAULT_MODEL`
- `GATEWAY_PORT`（默认 3000）、`GATEWAY_HOST`

## 核心禁止事项

### 代码层面

1. **禁止从 `dist/` 导入**——使用 TypeScript 项目引用的 `workspace:*` 依赖
2. **禁止编辑 `.evidence/`**——仅作参考，只读
3. **禁止抑制 TS 错误**（`as any`、`@ts-ignore`）
4. **禁止使用纯英文提交描述**
5. **禁止在 `apps/`、`packages/` 中直接调用 `fetch()` 访问网关**——必须通过 `@openAwork/web-client` 封装客户端

### Git 操作

**严禁执行任何 git 回滚指令**，包括但不限于：

- `git reset --hard/soft/mixed`
- `git revert`
- `git checkout -- .`
- `git restore`
- `git clean -fd`

**除非用户明确以书面形式授权，否则一律禁止**

## 架构关键点

### 桌面端复用 Web 页面

`apps/desktop/src/App.tsx` 直接从 `../../web/src/pages/` 相对导入——非构建产物依赖，是直接 TS 导入。

### 网关作为桌面端 Sidecar

通过 `bun build --compile` 编译为二进制，嵌入 Tauri 应用，路径为 `apps/desktop/src-tauri/sidecars/agent-gateway/`。

### 流式输出

网关通过 SSE（`/stream` 路由）+ WebSocket 实现实时 Agent 输出。

### 路由分级

`packages/agent-core/src/routing.ts` 定义 R0–R3 路由分级（复杂度层级），用于 Agent 任务调度。

## 错误处理

- 禁止空 catch 块——必须记录日志或重新抛出
- 使用项目自定义错误类（`src/error/`）而非裸 `Error`
- 异步函数必须处理 rejection
- Zod 校验失败应在边界层统一处理

## 注意事项

### Fastify 依赖对齐

若 `agent-gateway` 类型突然出现 `app.jwt`、`request.user` 等属性缺失：

1. 优先运行 `pnpm check:fastify-alignment`
2. 这类问题常由 `pnpm-lock.yaml` 中多份 `fastify` 版本引起
3. 该检查已接入 `lint-staged`，改动 `package.json`/`pnpm-lock.yaml` 后提交前自动运行

### Husky Hook 本地状态

`.husky/` 被 `.gitignore` 忽略，hook 属于本地机器状态，不随 Git 提交共享。排查"本地能拦、远端没拦"时，应确认规则是否落在 `package.json`、`scripts/` 或 `.github/workflows/` 中。

### agent-core 子包结构

| 模块                      | 说明                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `state-machine.ts`        | Agent FSM：idle→running→tool-calling→retry→interrupted→error |
| `tool-contract.ts`        | `ToolDefinition`、`ToolRegistry`                             |
| `routing.ts`              | R0–R3 路由分级                                               |
| `sqlite-session-store.ts` | 生产级 SQLite 会话存储                                       |
| `retry.ts`                | `withRetry`、`computeDelay`                                  |
| `provider/catalog.ts`     | LLM Provider 单一事实来源（anthropic、openai、deepseek 等）  |
| `tools/hash-edit.ts`      | SHA-256 行哈希锚定编辑                                       |

### 测试框架

- 单元测试：Vitest（非 Jest），测试文件位于 `src/**/*.test.ts`
- E2E：Playwright（Web + 桌面端）

## 开发工作流

### 新增功能

1. 阅读相关现有代码，理解架构模式
2. 遵循 TypeScript strict 模式，零 `any`、零 `@ts-ignore`
3. 组件超过 80 行或 3 层嵌套 JSX 必须拆分
4. 涉及 UI 必须参考 `packages/shared-ui/DESIGN-TOKENS.md`
5. 提交前运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`
6. 提交信息遵循 `type(scope): 中文描述` 格式

### 修复 Bug

1. 定位问题所在模块
2. 添加单元测试复现问题
3. 修复后确保测试通过
4. 提交格式：`fix(scope): 中文描述问题`

### 重构代码

1. 确保有足够的测试覆盖
2. 重构过程中保持测试通过
3. 遵循文件体积限制（1500 行）
4. 提交格式：`refactor(scope): 中文描述重构内容`

## 特殊模块说明

- `packages/agent-core/src/catwalk/` — 模型评测/对比模块
- `packages/agent-core/src/crush-ignore/` — 文件排除规则（Agent 上下文的 .gitignore）
- `.agentdocs/` — AI 工作流规划文档，非运行时代码
- `.assistant/` — Agent 会话状态，非运行时代码

## 包名规范

- 所有 workspace 包使用 `@openAwork/` scope
- 包内所有导出必须经过 `src/index.ts`
- 禁止消费者直接导入内部模块路径

## 项目文档

- 提交规范详细说明：`docs/commit-convention.md`
- 设计 Token 完整文档：`packages/shared-ui/DESIGN-TOKENS.md`
- 技能开发指南：`docs/` 目录
- 环境变量示例：`.env.example`
