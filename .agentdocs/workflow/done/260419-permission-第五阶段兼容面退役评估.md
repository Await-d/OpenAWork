# .agentdocs/workflow/260419-permission-第五阶段兼容面退役评估.md

## Task Overview
在前四阶段完成权限主链收口后，继续评估最后一层兼容面：判断 `web-client` 与 `agent-core` 中仍保留的 deprecated alias / 兼容导出是否还有真实使用方，并据此决定是否可以安全删除或进一步缩窄。

## Current Analysis
- 第一阶段已统一 `.openawork.permissions.json` 的读写与最终规则求值语义。
- 第二阶段已统一 shared/web-client/web/shared-ui 的权限协议主链。
- 第三阶段已把 gateway 内部运行时权限 helper 收口到 `services/agent-gateway/src/permission-contract.ts`，并把 `packages/agent-core/src/permissions/*` 降级为兼容层。
- 第四阶段已确认 `BrowserPermissionManager` 不属于当前运行时工具审批主链，并把 shared-session 权限回复在 `web-client` 中固定为正式命名 `replySharedSessionPermission`，同时保留兼容别名。
- 当前最后一层不确定性是：这些兼容别名/兼容导出在仓库内是否还有真实使用方；如果没有，就具备进一步退役的条件。

## Solution Design
- 并行审计 `web-client` 和 `agent-core` 的兼容面真实引用链，不重复搜同一批符号。
- 如果兼容入口仍有内部消费，则优先缩窄内部调用面，不贸然删除公开 API。
- 如果兼容入口只剩公开导出且仓库内无真实使用，则优先做最小安全退役：删内部别名、保留必要公开兼容或继续下沉 deprecation 标记。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 3+ (`packages/web-client` / `packages/agent-core` / `apps/web`) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 兼容面退役涉及跨包公开导出与内部真实调用链，需要先并行摸清引用面再决定是否删除，因此继续采用完整编排模式。

## Implementation Plan

### Phase 1: 兼容面边界确认
- [x] T-01: 明确第五阶段目标：评估并推进最后一层兼容面退役
- [x] T-02: 梳理 `web-client` deprecated alias 的真实引用面
- [x] T-03: 梳理 `agent-core` 兼容导出是否仍有真实消费方

### Phase 2: 最小切口实施
- [x] T-04: 确定可安全删除或缩窄的兼容入口
- [x] T-05: 实施第五阶段改造并补验证

### Phase 3: 验证与归档
- [x] T-06: 运行诊断、测试与相关构建
- [x] T-07: 归档 workflow 并同步 durable memory

## Notes
- 审计结论：
  - `packages/web-client/src/sessions.ts` 中的 `replySharedPermission` 在仓库内已无真实消费方，因此可安全删除。
  - `packages/agent-core/src/permissions/*` 兼容层在仓库内已无真实代码消费方，只剩定义文件自身与历史文档记录，因此可安全退役。
  - `packages/agent-core/src/index.ts` 中 workspace permission 相关包根导出仍被 `services/agent-gateway/src/permission-rules.ts` 使用，因此本轮不动。
- 本轮只做兼容面退役，不再扩展权限主链实现。
- 实际切口：
  - `packages/web-client/src/sessions.ts` 删除 `SessionsClient.replySharedPermission` 兼容别名与对应实例实现，保留正式入口 `replySharedSessionPermission`。
  - 删除 `packages/agent-core/src/permissions/index.ts` 与 `packages/agent-core/src/permissions/permission-manager.ts` 兼容层文件。
  - 更新 `packages/agent-core/AGENTS.md`，明确权限主链固定在 `src/permission/`。
- 验证结果：
  - `pnpm --filter @openAwork/web-client build` ✅
  - `pnpm --filter @openAwork/agent-core build` ✅
  - `pnpm --filter @openAwork/web exec vitest run src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/team-runtime-reference-data.test.tsx` ✅
  - `packages/web-client/src/sessions.ts` 与 `packages/agent-core/src` 的 `lsp_diagnostics` 为 0。
- Memory sync: completed
