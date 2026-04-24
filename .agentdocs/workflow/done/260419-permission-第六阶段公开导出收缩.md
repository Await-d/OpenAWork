# .agentdocs/workflow/260419-permission-第六阶段公开导出收缩.md

## Task Overview
在前五阶段完成权限主链收口与内部兼容面退役后，继续评估并实施最后一层公开导出收缩：确认 `@openAwork/web-client` 与 `@openAwork/agent-core` 包根公开导出中，哪些权限相关导出仍有真实消费方，哪些可以安全收缩。

## Current Analysis
- `web-client` 内部兼容别名 `replySharedPermission` 已退役，shared-session 权限回复只保留正式入口 `replySharedSessionPermission`。
- `agent-core/src/permissions/*` 历史兼容层已删除，但 `packages/agent-core/src/index.ts` 仍保留 permission manager 与 workspace permission 两类包根导出。
- 第五阶段结束后，剩余不确定性主要在“公开 API 面”而非主链实现：仓库内是否还有真实 import 依赖这些包根导出，如果没有，是否值得继续收缩。

## Solution Design
- 并行审计 `@openAwork/web-client` 与 `@openAwork/agent-core` 包根权限导出的真实消费面。
- 若导出仍被内部使用，则保留并记录理由；若仅剩历史残留且无消费方，则以最小切口收缩。
- 本轮只动公开导出面与相关文档/知识库，不再动权限主链实现。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 3+ (`packages/web-client` / `packages/agent-core` / `services/agent-gateway`) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 公开导出收缩涉及跨包公开 API 与真实消费链确认，先审计再收缩更安全，因此继续采用完整编排模式。

## Implementation Plan

### Phase 1: 公开导出边界确认
- [x] T-01: 明确第六阶段目标：只评估并收缩公开导出面
- [x] T-02: 梳理 `@openAwork/web-client` 包根权限导出的真实消费面
- [x] T-03: 梳理 `@openAwork/agent-core` 包根权限导出的真实消费面

### Phase 2: 最小切口实施
- [x] T-04: 确定可安全收缩的公开导出最小切口
- [x] T-05: 实施收缩并同步文档/索引

### Phase 3: 验证与归档
- [x] T-06: 运行诊断、测试与相关构建
- [x] T-07: 归档 workflow 并同步 durable memory

## Notes
- 审计结论：
  - `@openAwork/web-client` 包根里，`replySharedSessionPermissionRequest` 与 `SharedSessionPermissionReplyInput` 在当前 monorepo 内没有真实外部消费方，可安全从根导出移除。
  - `@openAwork/agent-core` 包根里，`PermissionDecision`、`PermissionRequest`、`GrantedPermission`、`PermissionManager`、`PermissionManagerImpl` 在当前 monorepo 内没有真实业务侧根导入消费，可安全从根导出移除。
  - `@openAwork/agent-core` 包根中的 workspace permission 相关导出仍被 `services/agent-gateway/src/permission-rules.ts` 与 `src/workspace-safety.ts` 使用，因此本轮保留。
- 本轮只做公开导出收缩，不再扩展权限主链实现。
- 实际切口：
  - `packages/web-client/src/index.ts` 不再从包根导出 `replySharedSessionPermissionRequest` 与 `SharedSessionPermissionReplyInput`。
  - `packages/agent-core/src/index.ts` 不再从包根导出 `PermissionDecision`、`PermissionRequest`、`GrantedPermission`、`PermissionManager`、`PermissionManagerImpl`。
- 验证结果：
  - `pnpm --filter @openAwork/web-client build` ✅
  - `pnpm --filter @openAwork/agent-core build` ✅
  - `pnpm --filter @openAwork/web build` ✅
  - `pnpm --filter @openAwork/agent-gateway build` ✅
  - `packages/web-client/src/index.ts` 与 `packages/agent-core/src/index.ts` 的 `lsp_diagnostics` 为 0。
- Memory sync: completed
