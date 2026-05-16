# OpenAWork 架构规范

> version: 1.0
> 维护者：项目核心团队
> 修改方式：PR + review（禁止直接 push）
> 关联决策：D45（v3.8）+ D56（v3.9 版本演进）

---

## 1. 技术选型

### 必须使用

| 领域     | 技术                              | 版本要求 | 理由                              |
| -------- | --------------------------------- | -------- | --------------------------------- |
| 前端框架 | React                             | ^19.0.0  | 项目统一，Concurrent 特性         |
| 状态管理 | Zustand                           | ^5.0.0   | 轻量、TypeScript 友好             |
| 样式     | Tailwind CSS                      | ^4.0.0   | 原子化、与 Vite 集成              |
| 路由     | React Router                      | ^7.0.0   | SPA 路由标准                      |
| 后端框架 | Fastify                           | ^5.0.0   | 高性能、插件体系、TypeScript 原生 |
| ORM      | Drizzle ORM                       | ^0.36.4  | 类型安全、轻量、SQL-first         |
| 数据库   | SQLite（主）+ Postgres（可选）    | —        | 桌面端嵌入 + 服务端扩展           |
| LLM SDK  | Vercel AI SDK (`ai`)              | latest   | 统一多 provider 接口              |
| 构建工具 | Vite                              | ^6.0.0   | 快速 HMR、ESM 原生                |
| 测试框架 | Vitest                            | —        | 与 Vite 生态统一                  |
| E2E      | Playwright                        | —        | 跨浏览器 + 桌面端                 |
| 包管理   | pnpm                              | —        | workspace 协议、严格依赖          |
| 运行时   | Bun（gateway 编译）+ Node（开发） | —        | 二进制 sidecar                    |
| 桌面端   | Tauri v2                          | ^2.10.1  | Rust 安全、小体积                 |
| 移动端   | Expo Router（React Native）       | —        | 跨平台移动                        |
| 校验     | Zod                               | —        | 运行时类型校验、边界层强制        |
| 效果系统 | Effect                            | ^3.21.2  | 可组合错误处理（gateway）         |

### 禁止使用

| 技术                                     | 理由                                                |
| ---------------------------------------- | --------------------------------------------------- |
| Express                                  | 已选 Fastify，禁止混用                              |
| Jest                                     | 已选 Vitest，禁止混用                               |
| axios                                    | 前端用 fetch / web-client 封装；后端用 Fastify 内置 |
| request / got                            | 已弃用或不必要                                      |
| CommonJS（require / module.exports）     | 项目为纯 ESM                                        |
| CSS-in-JS（styled-components / emotion） | 已选 Tailwind                                       |
| Redux / MobX                             | 已选 Zustand                                        |
| Prisma                                   | 已选 Drizzle                                        |
| Webpack                                  | 已选 Vite                                           |

---

## 2. 设计模式

### 必须使用

| 模式                   | 适用场景                | 参考实现                                     |
| ---------------------- | ----------------------- | -------------------------------------------- |
| 有限状态机（FSM）      | Agent 生命周期          | `packages/agent-core/src/state-machine.ts`   |
| 注册表模式             | 工具注册、Provider 注册 | `packages/agent-core/src/tool-contract.ts`   |
| DAG 编排               | 多 Agent 工作流         | `packages/multi-agent/src/dag.ts`            |
| 插件模式               | Fastify 路由扩展        | `services/agent-gateway/src/routes/`         |
| 仓库模式（Repository） | 数据访问                | `*-store.ts` 文件                            |
| 观察者/事件            | 流式输出、状态变更通知  | SSE + WebSocket                              |
| 哈希锚定编辑           | 文件修改防漂移          | `packages/agent-core/src/tools/hash-edit.ts` |

### 禁止使用

| 反模式               | 理由                               |
| -------------------- | ---------------------------------- |
| 全局单例（非注册表） | 测试困难、隐式依赖                 |
| 继承层级 > 2 层      | 组合优于继承                       |
| 裸 `new Error()`     | 必须用自定义错误类（`src/error/`） |
| 回调地狱             | 使用 async/await                   |
| 魔法字符串路由       | 路由必须类型化                     |

---

## 3. 命名规范

| 目标             | 规范                             | 示例                               |
| ---------------- | -------------------------------- | ---------------------------------- |
| 类 / 接口 / 类型 | PascalCase                       | `AgentState`、`ToolRegistry`       |
| 函数 / 变量      | camelCase                        | `withRetry`、`computeDelay`        |
| 常量             | UPPER_SNAKE_CASE                 | `MAX_RETRIES`、`DEFAULT_TIMEOUT`   |
| 文件名           | kebab-case                       | `state-machine.ts`、`hash-edit.ts` |
| 目录名           | kebab-case                       | `agent-core/`、`shared-ui/`        |
| 包名             | `@openAwork/kebab-case`          | `@openAwork/agent-core`            |
| 前缀 `_`         | 有意忽略的变量                   | `_unused`（ESLint 豁免）           |
| React 组件文件   | PascalCase.tsx 或 kebab-case.tsx | 跟随现有模式                       |
| Hook 文件        | `use-*.ts` 或 `use*.ts`          | `use-team-workspace-state.ts`      |
| 测试文件         | `*.test.ts` 同级放置             | `state-machine.test.ts`            |

---

## 4. 目录约定

### apps/web/src/

```
src/
├── components/     # 通用 UI 组件（跨页面复用）
├── hooks/          # 通用 hooks
├── pages/          # 页面级组件（按路由组织）
├── routes/         # 路由定义
├── stores/         # Zustand stores
├── utils/          # 纯工具函数
├── test/           # 测试辅助
├── App.tsx         # 根组件 + 路由注册
└── main.tsx        # 入口
```

### packages/ 通用结构

```
packages/<name>/
├── src/
│   ├── index.ts    # 唯一公开导出入口（禁止消费者导入内部路径）
│   ├── *.ts        # 实现文件
│   └── __tests__/  # 或同级 *.test.ts
├── package.json
└── tsconfig.json
```

### services/agent-gateway/src/

```
src/
├── routes/         # Fastify 路由（每个文件 = 一个路由模块）
├── channels/       # 消息渠道（Telegram/Discord/Slack/...）
├── __tests__/      # 集成测试
├── db.ts           # 数据库 schema + 连接
├── auth.ts         # 认证逻辑
└── *.ts            # 各功能模块
```

---

## 5. 模块边界

### 依赖方向（单向，禁止反向）

```
apps/web ──→ packages/* ──→ packages/shared
apps/desktop ──→ apps/web（直接 TS 导入）
apps/mobile ──→ packages/*
services/agent-gateway ──→ packages/*

禁止：
  packages/* ──✗──→ apps/*
  packages/* ──✗──→ services/*
  apps/web ──✗──→ services/agent-gateway（通过 HTTP/WS 通信，不直接导入）
```

### 包间依赖规则

| 包               | 可依赖                 | 禁止依赖       |
| ---------------- | ---------------------- | -------------- |
| `shared`         | 无（零依赖）           | 任何业务包     |
| `shared-ui`      | `shared`               | 业务逻辑包     |
| `agent-core`     | `shared`、`logger`     | UI 包、gateway |
| `multi-agent`    | `agent-core`、`shared` | UI 包          |
| `web-client`     | `shared`               | 后端包         |
| `skill-registry` | `agent-core`、`shared` | UI 包          |

---

## 6. 错误处理

- **禁止空 catch 块**——必须记录日志或重新抛出
- **使用自定义错误类**（`packages/agent-core/src/error/`）而非裸 `Error`
- **异步函数必须处理 rejection**——禁止 unhandled promise rejection
- **Zod 校验在边界层**（路由入口 / 网关入口）统一处理，返回结构化错误
- **Effect 用于 gateway 复杂流程**——可组合错误处理链
- **retry 策略**：使用 `packages/agent-core/src/retry.ts` 的 `withRetry`

---

## 7. 测试要求

- **框架**：Vitest（单元 + 集成）、Playwright（E2E）
- **覆盖率目标**：核心包 ≥ 80%（agent-core / multi-agent / skill-registry）
- **测试文件位置**：同级 `*.test.ts` 或 `__tests__/` 目录
- **TDD 优先**（D44 e 层维度 4 = A 强制 TDD）：先写测试再写实现
- **Mock 策略**：优先使用 Vitest 内置 mock，外部服务用 MSW
- **E2E 范围**：关键用户流程（登录、会话创建、Agent 交互）

---

## 8. 性能规范

- **单文件行数上限**：1500 行（1300-1500 预警区间）
- **API 响应时间**：p95 < 200ms（非 LLM 调用路径）
- **前端 bundle**：首屏 JS < 500KB（gzip 后）
- **LLM 流式首 token**：< 2s（provider 正常时）
- **WebSocket 心跳**：30s 间隔
- **SQLite 查询**：单次 < 50ms

---

## 9. 安全规范

- **凭据**：全部走环境变量（`.env`），禁止硬编码
- **JWT**：`@fastify/jwt`，secret ≥ 32 字符
- **输入校验**：所有外部输入经 Zod schema 校验
- **XSS**：React 默认转义 + 富文本用 DOMPurify
- **CSRF**：SameSite cookie + Origin 校验
- **文件访问**：Agent 工具受 `crush-ignore` 规则限制
- **MCP 沙箱**：外部 MCP server 在隔离进程运行
- **memory 注入安全**：13 条威胁模式扫描（D39）

---

## 10. 工程纪律

- **提交规范**：`type(scope): <中文描述>`（commitlint 强制）
- **ESLint**：`no-explicit-any` / `ban-ts-comment` / `consistent-type-imports` / `no-empty-function` / `no-empty` 全部 error
- **Prettier**：单引号 / 分号 / 尾随逗号 / 行宽 100 / 2 空格
- **模块系统**：NodeNext（导入必须带 `.js` 扩展名）
- **包导出**：必须经 `src/index.ts`，禁止消费者导入内部路径
- **禁止 dist/ 导入**：使用 `workspace:*` 依赖
- **禁止 git 回滚指令**：除非用户书面授权
- **CI 流水线**：lint + typecheck + test 必须全过

---

## 版本演进记录

| 版本 | 日期       | 变更                                |
| ---- | ---------- | ----------------------------------- |
| 1.0  | 2026-05-15 | 初版，基于 AGENTS.md + 代码扫描提取 |
