# .agentdocs/workflow/260418-permission-统一使用方式改造.md

## Task Overview
把 OpenAWork 当前分散的权限使用方式，先收口到“统一 workspace 权限配置语义 + 统一 gateway 决策入口”这一最小可行闭环；保持现有异步中断/恢复模型，不做同步阻塞式重写。

## Current Analysis
- 当前仓库已具备 `allow / deny / ask` 与 `once / session / permanent / reject` 两层语义，但决策入口分散在 `services/agent-gateway` 与 `packages/agent-core`。
- 当前工作区存在大量与本任务无关的并行改动，因此本轮只允许触碰权限主链相关文件，避免误伤现有 .NET 迁移和聊天 UI 工作。
- `packages/agent-core/src/permission/index.ts` 已开始读取 `.openawork.permissions.json`，但仍存在两类风险：
  - 直接遍历 `rules` 会把被后续 `deny` 覆盖的 `allow` 也当成永久授权；
  - 保存某个 workspace 的永久授权时会把内存里的全部永久授权写回当前 workspace，存在跨工作区串写风险。

## Solution Design
- 第一阶段只统一 **workspace 权限配置读写语义**，让 `agent-core` 与 gateway 共用同一套解析规则。
- `PermissionManagerImpl.check()` 优先按工作区规则做最终动作解析：
  - `deny` → `reject`
  - `allow` → `permanent`
  - `ask` → 继续走 session grant / pending 审批
- `PermissionManagerImpl.reply('permanent')` 只把当前审批的 grant 写回对应 workspace，避免多工作区串写。
- UI / web-client / mobile 的进一步对齐留到下一阶段；它们现在主要消费事件，不是权限真源。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 4+ (`agent-core` / `agent-gateway` / `shared` / `web-client`) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是跨包权限模型收口，不仅要改代码，还要同步验证、留档并控制与现有并行改动的边界，因此采用完整编排模式。

## Implementation Plan

### Phase 1: 基线与边界确认
- [x] T-01: 对比当前仓库与参考仓库权限模型，确认最小切口是 workspace 配置语义统一
- [x] T-02: 核实仓库已有改动与在途文件，限制本轮只触碰权限主链

### Phase 2: 第一阶段代码收口
- [x] T-03: 在 `agent-core` 引入共享 workspace 权限配置 helper 并由 gateway 复用
- [x] T-04: 让 `PermissionManagerImpl` 使用统一规则求值，而不是原始遍历 `rules`
- [x] T-05: 修复永久授权保存时的跨 workspace 串写风险
- [x] T-06: 补充针对 deny 覆盖、wildcard 与多 workspace 保存边界的测试

### Phase 3: 验证与后续入口
- [x] T-07: 运行 LSP 诊断、权限相关单测与相关包构建
- [x] T-08: 记录首轮改造结果，并确认 web-client / UI 消费层已具备 feedback 与 auto-accept 配套能力

## Notes
- 参考资料保留在 `.agentdocs/permission-alignment-plan.md`，作为历史对齐记录；本 workflow 是当前实际执行文档。
- 验证结果：相关文件 `lsp_diagnostics` 全绿；`pnpm --filter @openAwork/agent-core exec vitest run src/permission/index.test.ts` 通过；`pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/workspace-safety.test.ts` 通过；`pnpm --filter @openAwork/agent-core build` 与 `pnpm --filter @openAwork/agent-gateway build` 通过。
- 消费层确认：`packages/web-client/src/permissions.ts` 已支持 `feedback`；`apps/web/src/pages/chat-page/permission-auto-respond.ts` 已实现 session 级 auto-accept；`apps/web/src/pages/ChatPage.tsx` 与 `apps/web/src/pages/chat-page/support.ts` 已接上 `permission_asked / permission_replied / feedback`。
- Memory sync: completed
