# Message V2 脚本正规化实施

## Task Overview

在 message-v2、stream、loop、look_at 相关源码主线已全部收口后，继续处理工作区中最后剩余的未跟踪资产：`services/agent-gateway/scripts/message-v2-integration-test.mjs` 与 `message-v2-deep-conversation-test.mjs`。目标是把这两份手工脚本正规化为**正式的验证资产或合规脚本**，纳入仓库约定的验证/文档体系，而不是继续以本地实验脚本存在。

## Current Analysis

- 当前两份脚本的主要问题：
  - 依赖 `../dist/*`
  - 读取真实 SQLite / 真实 provider
  - 硬编码 userId / provider 假设
  - 未接入 `services/agent-gateway/package.json` 的正式 test scripts
- 现有 gateway 正式验证资产已经集中在 `src/verification/verify-*.ts`。
- 因此本轮不是继续扩 message-v2 功能，而是**把手工验证收口到仓库认可的验证形式**。

## Solution Design

- 将原两份 `scripts/*.mjs` 正规化成两层：
  1. `src/verification/verify-*.ts` 作为正式验证资产（源码导入、临时 DB、可控环境）
  2. `services/agent-gateway/scripts/*.mjs` 保留为兼容 wrapper，只负责转发到正式 verification
- 新增 `package.json` 命令：
  - `test:message-v2`
  - `test:message-v2:projection`
  - `test:message-v2:deep`
- 并把 `test:message-v2` 收编进 `test:verification`。

## Complexity Assessment

- Atomic steps: 3–4（模式对齐、脚本重写/迁移、验证接线、提交） → 0
- Parallel streams: no → 0
- Modules/systems/services: 3+（scripts / src/verification / package.json / docs） → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 2
- **Chosen mode**: Lightweight
- **Routing rationale**: 这是边界清晰的脚本正规化任务，值得建一张 workflow 跟踪，但不需要单独 runtime 协调目录。

## Implementation Plan

### Phase 1：模式确认
- [x] T-01：确认两份脚本应迁移到的正式落点（`src/verification` / 合规 `scripts` / package.json test entry）✅
- [x] T-02：冻结最小保留能力与排除项 ✅

### Phase 2：实现与验证
- [x] T-03：完成脚本正规化改造 ✅
- [x] T-04：运行最贴边验证并修复问题 ✅

### Phase 3：提交与归档
- [x] T-05：按原子边界提交改动并同步 agentdocs ✅

## Notes

- 已新增正式 verification：
  - `services/agent-gateway/src/verification/verify-message-v2-event-projection.ts`
  - `services/agent-gateway/src/verification/verify-message-v2-deep-conversation.ts`
- 已将原脚本收口为兼容 wrapper：
  - `services/agent-gateway/scripts/message-v2-integration-test.mjs`
  - `services/agent-gateway/scripts/message-v2-deep-conversation-test.mjs`
- 已接线：
  - `services/agent-gateway/package.json` 新增 `test:message-v2*`
  - `test:verification` 现已包含 `test:message-v2`
  - `services/agent-gateway/AGENTS.md` 已补充命令和验证分层说明
- 已验证通过：
  - `pnpm --filter @openAwork/agent-gateway run test:message-v2`
  - `node services/agent-gateway/scripts/message-v2-integration-test.mjs`
  - `node services/agent-gateway/scripts/message-v2-deep-conversation-test.mjs`
  - `pnpm --filter @openAwork/agent-gateway run test:verification`
  - `pnpm --filter @openAwork/agent-gateway typecheck`
- Memory sync: completed
