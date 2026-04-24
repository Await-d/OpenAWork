# .agentdocs/workflow/260418-permission-第三阶段内核收口.md

## Task Overview
在前两阶段完成 workspace 权限真相源统一、shared/web-client/web 权限协议收口后，继续推进权限体系第三阶段：收拢 `agent-gateway` 内部剩余的局部权限字面量/局部类型，并评估 `agent-core` 历史权限抽象的兼容边界，避免权限模型继续双轨分叉。

## Current Analysis
- 第一阶段已统一 `.openawork.permissions.json` 的读写与最终规则求值语义。
- 第二阶段已把运行时权限协议的共享字面量与读模型 helper 下沉到 `packages/shared` + `packages/web-client`，并让 `apps/web` / `shared-ui` 消费共享类型。
- 当前潜在剩余分叉点主要在两处：
  - `services/agent-gateway` 内部仍可能保留局部权限联合字面量、事件映射和内部状态机重复定义。
  - `packages/agent-core/src/permissions/permission-manager.ts` 这套历史抽象仍然存在，需要判断是否保留为兼容层，还是继续收口。
- 本轮只动内核抽象与 gateway 内部协议映射，不扩展到 UI 展示层与外部 REST/stream 协议面。

## Solution Design
- 先并行摸清 gateway 内部剩余重复点与 agent-core 双轨抽象的真实使用边界。
- 如果 gateway 内部仅剩局部字面量重复，则优先改成直接复用 `packages/shared` 的权限协议类型。
- 如果 `agent-core` 历史抽象尚未进入主链，则本轮优先把它降级为兼容层或缩窄导出面，而不是激进删除。
- 保持最小切口：优先改对运行时真源和内部类型一致性有直接收益的部分。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: yes → +2
- Modules/systems/services: 3+ (`agent-gateway` / `agent-core` / `shared`) → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 第三阶段涉及权限体系内核抽象收口，需要并行确认重复点、评估兼容边界并验证运行时主链，因此继续采用完整编排模式。

## Implementation Plan

### Phase 1: 内核边界确认
- [x] T-01: 明确第三阶段目标边界：只收 gateway 内部类型与 agent-core 历史抽象，不扩展到 UI/外部协议
- [x] T-02: 梳理 gateway 内部剩余权限局部类型与字面量重复点
- [x] T-03: 梳理 agent-core 历史权限抽象的保留/兼容边界

### Phase 2: 最小切口实施
- [x] T-04: 选择第三阶段最小安全切口
- [x] T-05: 实现内核收口并补充相关测试

### Phase 3: 验证与归档
- [x] T-06: 运行 LSP、定向测试与相关构建
- [x] T-07: 归档 workflow 并同步 durable memory

## Notes
- 前两阶段归档分别见：
  - `.agentdocs/workflow/done/260418-permission-统一使用方式改造.md`
  - `.agentdocs/workflow/done/260418-permission-第二阶段协议收口.md`
- 实际切口：
  - 新增 `services/agent-gateway/src/permission-contract.ts`，统一 gateway 内部权限 enum、DTO 映射、timeout 解析与 approved resume payload 解析。
  - `routes/permissions.ts` 与 `routes/session-shared-read-routes.ts` 改为复用统一 permission contract。
  - `session-permission-events.ts` 与 `tool-sandbox.ts` 改为复用统一权限字面量与 timeout helper。
  - `packages/agent-core/src/permissions/permission-manager.ts` 与 `permissions/index.ts` 明确标记为兼容层，不再作为权限主链继续扩展。
- 代码落点：
  - `services/agent-gateway/src/permission-contract.ts`
  - `services/agent-gateway/src/routes/permissions.ts`
  - `services/agent-gateway/src/routes/session-shared-read-routes.ts`
  - `services/agent-gateway/src/session-permission-events.ts`
  - `services/agent-gateway/src/tool-sandbox.ts`
  - `packages/agent-core/src/permissions/permission-manager.ts`
  - `packages/agent-core/src/permissions/index.ts`
  - `services/agent-gateway/src/edit-replacers.ts`
- 验证结果：
  - `pnpm --filter @openAwork/agent-core build` ✅
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session-permission-events.test.ts src/__tests__/permissions-routes.request-binding.test.ts` ✅
  - `pnpm --filter @openAwork/agent-gateway build` ✅
  - 相关改动文件 `lsp_diagnostics` 均为 0。
- 为完成构建验证，顺手修复了一个与权限无关但阻塞 `agent-gateway build` 的现存严格类型错误：`services/agent-gateway/src/edit-replacers.ts` 中 `match[1]` 的可空索引访问。
- Memory sync: completed
