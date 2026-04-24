# .agentdocs/workflow/260418-permission-第四阶段收尾评估.md

## Task Overview
在前三阶段完成权限真相源、共享协议、gateway 内部 helper 与 agent-core 兼容层收口后，继续评估并实施权限体系的第四阶段收尾，目标是找出剩余分叉点并完成最小安全闭环。

## Current Analysis
- 第一阶段已统一 `.openawork.permissions.json` 的读写与最终规则求值语义。
- 第二阶段已把运行时权限协议下沉到 `packages/shared` + `packages/web-client`，并让 `apps/web` / `shared-ui` 消费共享类型。
- 第三阶段已新增 `services/agent-gateway/src/permission-contract.ts`，收口 gateway 内部权限 helper，并将 `packages/agent-core/src/permissions/*` 明确为兼容层。
- 当前仍需判断：仓库里是否还有权限相关的剩余分叉点，尤其是 browser 权限边界是否属于当前主链。

## Solution Design
- 并行做 repo 级剩余分叉点排查与 browser 权限边界判断。
- 若存在仍属于当前权限主链的重复实现，则选择最小安全切口继续收口。
- 若只剩独立领域边界或兼容层，则完成确认、补充文档/测试并收尾，不做无意义重构。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 4+ (`agent-core` / `agent-gateway` / `shared` / `web-client`) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 第四阶段需要先确认剩余分叉点的真实边界，再决定是否继续改动，属于跨模块收尾编排任务，因此继续使用完整编排模式。

## Implementation Plan

### Phase 1: 剩余边界确认
- [x] T-01: 明确第四阶段目标：自动判断权限体系剩余收尾动作
- [x] T-02: 梳理仓库剩余权限重复点与分叉入口
- [x] T-03: 梳理 browser 权限边界是否属于当前主链

### Phase 2: 最小切口实施
- [x] T-04: 确定第四阶段最小安全切口
- [x] T-05: 实施第四阶段改造并补验证

### Phase 3: 验证与归档
- [x] T-06: 运行诊断、测试与相关构建
- [x] T-07: 归档 workflow 并同步 durable memory

## Notes
- 只读结论：`packages/agent-core/src/browser/index.ts` 中的 `BrowserPermissionManager` 属于浏览器站点信任/能力边界，当前没有接入运行时工具审批主链，因此不纳入本轮权限主链收口。
- 实际切口：
  - `packages/web-client/src/sessions.ts` 新增正式入口 `replySharedSessionPermission` 与内部共用 helper `replySharedSessionPermissionRequest`，旧 `replySharedPermission` 仅保留兼容别名。
  - `packages/web-client/src/team.ts` 改为复用同一个 shared-session 权限回复 helper。
  - `apps/web/src/pages/team/use-team-collaboration.ts` 与 `apps/web/src/pages/team/runtime/team-runtime-reference-data.tsx` 切到正式命名 `replySharedSessionPermission`。
  - 新增 `apps/web/src/utils/permission-reply.ts`，统一 Web 侧权限回复请求、成功文案与 HTTP 状态码提取；`Layout.tsx` 与 `ChatPage.tsx` 改为复用它。
- 代码落点：
  - `packages/web-client/src/sessions.ts`
  - `packages/web-client/src/team.ts`
  - `packages/web-client/src/index.ts`
  - `apps/web/src/pages/team/use-team-collaboration.ts`
  - `apps/web/src/pages/team/runtime/team-runtime-reference-data.tsx`
  - `apps/web/src/pages/team/runtime/team-runtime-reference-data.test.tsx`
  - `apps/web/src/utils/permission-reply.ts`
  - `apps/web/src/utils/permission-reply.test.ts`
  - `apps/web/src/components/Layout.tsx`
  - `apps/web/src/pages/ChatPage.tsx`
- 验证结果：
  - `pnpm --filter @openAwork/web-client build` ✅
  - `pnpm --filter @openAwork/web exec vitest run src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/team-runtime-reference-data.test.tsx` ✅
  - `pnpm --filter @openAwork/web exec vitest run src/utils/permission-reply.test.ts src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/team-runtime-reference-data.test.tsx` ✅
  - `pnpm --filter @openAwork/web build` ✅
  - 本轮新增/调整的辅助文件 `lsp_diagnostics` 为 0；`Layout.tsx` 仅剩既有未使用变量 hints，无新增错误。
- 为完成验证，顺手修复了一个与本轮权限切口直接相关的 team runtime 测试 mock 漂移：`templateCards` 替换旧 `templates` 字段。
- Memory sync: completed
