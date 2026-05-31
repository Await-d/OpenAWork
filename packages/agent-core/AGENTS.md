# agent-core — 知识库

## 概述

工作台的核心大脑：Agent 状态机、LLM Provider 管理、工具执行、会话持久化、路由分级，以及所有 Agent 子系统。

## 目录结构

```
src/
├── state-machine.ts        # Agent FSM：idle→running→tool-calling→retry→interrupted→error
├── types.ts                # AgentState、AgentEvent、ConversationSession、SessionCheckpoint
├── tool-contract.ts        # ToolDefinition、ToolRegistry、ToolCallRequest/Result
├── routing.ts              # R0–R3 路由分级（任务复杂度分层调度）
├── sqlite-session-store.ts # SQLite 会话存储（持久化对话历史）
├── session-store.ts        # InMemorySessionStore + SessionStore 接口
├── retry.ts                # withRetry、computeDelay、RetryAbortedError、RetryExhaustedError
├── index.ts                # 包公开导出（仅类型与类）
├── provider/               # LLM Provider 配置、管理器、OAuth、预设、持久化
├── tools/                  # hash-edit.ts、lsp.ts、web-search.ts
├── task-system/            # scheduler.ts、store.ts — 任务调度与持久化
├── worker/                 # Agent Worker 执行入口
├── session/                # session-summarizer.ts 会话摘要
├── stream/                 # 流式输出辅助
├── plan/                   # 计划历史数据
├── ralph-loop/             # 自指开发循环逻辑
├── catwalk/                # 模型评测与对比模块
├── crush-ignore/           # Agent 上下文的文件排除规则（类 .gitignore）
├── context/                # 上下文管理
├── permission/             # 运行时权限确认主链（审批、grant、workspace 权限配置）
├── oauth/                  # OAuth 流程辅助
├── onboarding/             # 引导向导状态
├── slash-command/          # 斜杠命令注册
├── plugin/                 # 插件系统
├── registry/               # Agent 注册中心
├── schedule/               # 定时任务 Agent 集成
├── workflow/               # 工作流执行
├── hooks/                  # Agent 钩子系统
├── quota/                  # Token 配额与预算追踪
├── token-usage/            # Token 用量计量
├── audit/                  # 审计日志
├── attribution/            # 归因追踪
├── multimodal/             # 多模态内容处理
├── browser/                # 浏览器自动化集成
├── filesystem/             # 文件系统工具辅助
├── ssh/                    # SSH 连接支持
├── log/                    # 内部日志
└── error/                  # 自定义错误类型
```

## 查找指引

| 任务                      | 位置                                     |
| ------------------------- | ---------------------------------------- |
| Agent 状态转换            | `src/state-machine.ts`                   |
| 工具注册                  | `src/tool-contract.ts` → `ToolRegistry`  |
| 哈希锚定文件编辑工具      | `src/tools/hash-edit.ts`                 |
| LSP 工具                  | `src/tools/lsp.ts`                       |
| 网页搜索工具              | `src/tools/web-search.ts`                |
| LLM Provider（新增/修改） | `src/provider/manager.ts` + `presets.ts` |
| Provider 类型定义         | `src/provider/types.ts`                  |
| 路由分级（R0–R3）         | `src/routing.ts`                         |
| 会话持久化（SQLite）      | `src/sqlite-session-store.ts`            |
| 重试逻辑                  | `src/retry.ts`                           |
| 任务调度                  | `src/task-system/scheduler.ts`           |

## 架构说明

- **状态机为纯函数**：`transition(state, event) → newState`，无副作用，完全可测试。
- **哈希锚定编辑**：`tools/hash-edit.ts` 使用 8 字符 SHA-256 行哈希（而非行号）防止跨版本编辑漂移。
- **路由分级**：R0=只读/回答，R1=本地单文件，R2=多文件，R3=架构级/高风险。由 `routing.ts` 中 5 个维度计算得出。
- **SessionStore 接口**：`sqlite-session-store.ts` 为生产实现；`InMemorySessionStore` 用于测试。
- **Provider 类型**：`ProviderType` 联合类型——`anthropic | openai | deepseek | gemini | ollama | openrouter | qwen | moonshot | mimo | custom`。
- **Provider Catalog（平台单一事实来源）**：`src/provider/catalog.ts` 的 `PROVIDER_CATALOG` 是所有平台信息的唯一来源——内置预设(`presets.ts` 由它派生)、API Key 环境变量、上游 baseUrl/协议变体、thinking 下发风格、host→type 推断、别名归一、前端 UI 元数据(logo/显示名/字形)全部从这里产生。**新增一个平台只需三步**：① 在 `types.ts` 的 `ProviderType` 加一个成员；② 在 `catalog.ts` 的 `PROVIDER_CATALOG` 加一个条目；③(可选)在 `apps/web/public/` 放 `logo-<type>.svg`。网关枚举/thinking 分支、前端选择器/设置页/团队模板下拉都会自动生效，无需再改其它文件。thinking 复用已有「风格」(`ProviderThinkingStyle`)时，连网关 `provider-options.ts` 都不必改。
- **权限主链**：统一位于 `src/permission/`；历史 `src/permissions/` 兼容层已退役，不再作为可用目录。

## 约定

- 所有导出必须经过 `src/index.ts`——禁止消费者直接导入内部模块。
- 所有本地导入必须使用 `.js` 扩展名（NodeNext 模块解析）。
- 纯类型导入必须使用 `import type { ... }`——ESLint 强制执行。
- 测试位于 `src/__tests__/`，使用 Vitest。
- 覆盖率使用 `@vitest/coverage-v8`。

## 禁止事项

- 禁止向 `state-machine.ts` 添加副作用——必须保持纯函数。
- 禁止从 `dist/` 导入——使用 `workspace:*`。
- 禁止绕过 `ToolRegistry`——所有工具必须通过 `tool-contract.ts` 注册。
- 新增 LLM Provider 必须同步更新 `provider/presets.ts` 和 `provider/types.ts`。
