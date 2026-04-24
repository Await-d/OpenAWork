# .agentdocs/workflow/260418-permission-第二阶段协议收口.md

## Task Overview
在第一阶段完成 workspace 权限配置语义统一后，继续把权限“使用方式”往统一协议收口：重点梳理并减少 `agent-gateway`、`shared`、`web-client`、`apps/web` 之间的权限协议重复定义与重复映射。

## Current Analysis
- 第一阶段已经让 `agent-core` 与 `agent-gateway` 共用 `.openawork.permissions.json` 的读写与最终规则求值语义。
- 当前前端消费层并非空白：`packages/web-client/src/permissions.ts` 已支持 `feedback`，`apps/web/src/pages/chat-page/permission-auto-respond.ts` 已实现 session 级自动审批 helper。
- 仍待确认的风险点在于：权限事件、客户端请求类型、页面本地 view-model 与 shared-ui props 之间是否存在重复契约，导致后续继续分叉。
- 本轮仍需避开仓库里与权限无关的大量在途改动，只动权限协议与其最小必要测试。

## Solution Design
- 先只查清“协议真源 vs 页面本地拼装”的边界，再决定最小切口。
- 优先统一可复用的权限契约类型与映射层，避免在 `shared` / `web-client` / `apps/web` 继续各写一份相似接口。
- 不在本轮大改 shared-ui 展示层；只有在 props 已经承载协议耦合时才收口。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 4 (`agent-gateway` / `shared` / `web-client` / `apps/web`) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是跨包权限协议继续收口，需要并行定位重复契约、选择最小切口并验证跨包类型与消费行为，因此采用完整编排模式。

## Implementation Plan

### Phase 1: 协议边界确认
- [x] T-01: 明确第二阶段目标：只收口权限协议，不重写 UI 展示层
- [x] T-02: 梳理 shared / web-client / web / mobile / desktop 的权限协议重复点
- [x] T-03: 梳理 shared-ui 权限组件 props 与上游数据契约的耦合点

### Phase 2: 最小切口实施
- [x] T-04: 选择下一批最小可行统一切口
- [x] T-05: 实现协议层统一并更新相关测试

### Phase 3: 验证与归档
- [x] T-06: 运行 LSP、定向测试与相关构建
- [x] T-07: 归档 workflow 并同步 durable memory

## Notes
- 第一阶段归档见 `.agentdocs/workflow/done/260418-permission-统一使用方式改造.md`。
- 实际切口：把运行时权限协议的共享字面量与读模型 helper 下沉到 `packages/shared` + `packages/web-client`，并让 `apps/web` 只保留最薄的页面 view-model 包装。
- 代码落点：
  - `packages/shared/src/index.ts`
  - `packages/web-client/src/permissions.ts`
  - `packages/web-client/src/index.ts`
  - `apps/web/src/utils/pending-permission-state.ts`
  - `apps/web/src/utils/session-list-events.ts`
  - `apps/web/src/pages/chat-page/recovery-read-model.ts`
  - `apps/web/src/pages/chat-page/session-runtime.ts`
  - `apps/web/src/pages/ChatPage.tsx`
  - `packages/shared-ui/src/PermissionPrompt.tsx`
  - `packages/shared-ui/src/PermissionHistory.tsx`
- 验证结果：
  - `pnpm --filter @openAwork/shared build` ✅
  - `pnpm --filter @openAwork/web-client build` ✅
  - `pnpm --filter @openAwork/shared-ui build` ✅
  - `pnpm --filter @openAwork/shared-ui exec vitest run src/PermissionPrompt.test.ts` ✅
  - `pnpm --filter @openAwork/web exec vitest run src/utils/session-list-events.test.ts src/pages/chat-page/session-runtime.test.ts` ✅
  - `pnpm --filter @openAwork/web build` ✅
  - 相关新增/调整文件 `lsp_diagnostics` 均为 0。
- Memory sync: completed
