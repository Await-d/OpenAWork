# 260405 LSP 多 server 选择与 eslint/biome 实施

## Task Overview

在 richer LSP 的核心语义工具与主要 language server coverage（Rust、JSON/HTML/CSS、YAML、Dockerfile、Bash、Compose/Bake）都完成并归档后，继续推进剩余的参考库方向集成：**补齐可配置的多 server 选择/覆盖底座，并把 Tauri 侧已有的 `eslint` / `biome` 对齐到 gateway-side。**

## Current Analysis

- 当前 OpenAWork `packages/lsp-client/src/server.ts` 仍是：
  - `ALL_SERVERS: LSPServerInfo[]`
  - `findServerForFile(filePath): LSPServerInfo | undefined`
  - 语义上是**一文件只选一个 server**
- 但 `packages/lsp-client/src/tauri.ts` 已经有 Tauri 侧 extra servers：
  - `eslint`
  - `biome`
- 这两者和当前 gateway-side 既有 coverage 存在重叠：
  - `eslint` 覆盖 `.js/.jsx/.ts/.tsx/.mjs/.cjs`
  - `biome` 覆盖 `.js/.jsx/.ts/.tsx/.json/.jsonc`
  - 当前 gateway-side 已有 `typescript`、`json` 等 server
- 参考库 `temp/opencode/packages/opencode/src/lsp/index.ts` 的关键差异：
  - server 集合是 `Record<string, LSPServer.Info>`
  - 支持配置覆盖 / 禁用 / 自定义 command
  - `getClients(file)` 会返回**多个** client，而不是单个 client
- 因此当前真正剩余的 LSP 主线缺口不是“再加一个 server”，而是：
  1. 让 gateway-side 支持**多 server 命中 / 选择**
  2. 让 server 集合支持**配置覆盖 / 禁用 / 新增**
  3. 再把 `eslint` / `biome` 纳入这套机制

## Solution Design

- 本轮 scope 冻结为：
  1. 把 `lsp-client` 的 server 选择从“单 server”升级为“每文件可匹配多个 server”
  2. 引入最小的配置覆盖机制，使 gateway-side 可控制启用/禁用/替换 server
  3. 对齐 `eslint` / `biome` 到 gateway-side
- 保守原则：
  - 不改 richer semantic query tool surface
  - 不扩到更多新语言 server
  - 先保证现有 server 行为不回归，再让重叠 server 成为“可选并存”而不是强行替换

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 结构冻结 / server selection 改造 / eslint-biome 接线 / 测试与文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + 相关测试/验证 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是当前 richer LSP 剩余集成的结构性缺口，涉及选择模型、配置入口、server 定义与测试矩阵，不能按单文件微调处理。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：冻结“多 server 选择 + 配置覆盖 + eslint/biome 对齐”的最小范围与非目标

### Phase 1：选择模型与配置底座

- [x] T-02：把 `lsp-client` 的 server 选择升级为每文件支持多 server 命中
- [x] T-03：补最小 server 覆盖/禁用机制（参考 `opencode`，但按 OpenAWork 当前架构收敛实现）

### Phase 2：eslint / biome 对齐

- [x] T-04：把 `eslint` / `biome` 的 gateway-side server definition 正式接入 `packages/lsp-client`
- [x] T-05：补齐与重叠 server 选择相关的测试矩阵

### Phase 3：验证与收口

- [x] T-06：运行 diagnostics、`pnpm --filter @openAwork/lsp-client test`、`pnpm --filter @openAwork/lsp-client build`
- [x] T-07：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-08：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 本轮继续遵守用户新增边界：若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。
- 本轮非目标：
  - 继续新增更多语言 coverage
  - 修改 semantic query tool 形状
  - 一次性做全量 editor-style 配置系统
- 本轮冻结后的最小方案：
  - `LSPManager` 从“单文件一个 server”升级为“单文件可命中多个 server”
  - 但仍区分 **primary semantic server** 与 **supplemental lint server**
  - `eslint` / `biome` 作为 supplemental server 接入 Node/gateway-side
  - 若同一文件同时命中 `eslint` 与 `biome`，按同一 linter slot 的优先级只选择一个（避免双重 lint 噪音）
  - 只补最小 disable 机制，不做更大的配置系统
- 当前主线程验证已通过：
  - `packages/lsp-client/src/types.ts`、`server.ts`、`index.ts`、`__tests__/server.test.ts`、`__tests__/manager.test.ts` diagnostics 无错误
  - `pnpm --filter @openAwork/lsp-client test` 通过（68 tests）
  - `pnpm --filter @openAwork/lsp-client build` 通过
- 本轮实际落地内容：
  - `LSPServerInfo` 新增 `role / slot / priority` 元数据
  - `LSPManager` 新增多 server 解析与最小 disable 机制，`touchFile()` 可对同一文件触发多个匹配 server
  - `diagnostics()` 现已从多 client 合并结果而非覆盖最后一个来源
  - `server.ts` 已新增 `ESLintServer` / `BiomeServer`
  - `findServerForFile()` 保持 primary 语义 server 选择，同时新增 `findServersForFile()` 供多 server 路由使用
  - `manager.test.ts` 已覆盖 primary+supplemental 选择、同 slot 优先级、disable 机制与 diagnostics 合并
- Librarian/参考结论：eslint-language-server 与 biome 在 JS/TS 生态下更适合作为与 TypeScript 并存的补充型 lint/format server，而不是直接替代 semantic server；本轮据此采用 primary+supplemental 模式。
- Oracle 复核结论：当前多 server 选择、supplemental lint server、Node 侧 `eslint` / `biome` 接入、diagnostics 聚合与测试矩阵均已闭环，工作流可归档。
- Memory sync: completed
