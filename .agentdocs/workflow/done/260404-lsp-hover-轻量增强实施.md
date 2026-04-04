# lsp_hover 轻量增强实施

## Task Overview

基于已归档的 `260403-lsp-自动使用集成方案` Phase 5 结论，继续推进下一条最小增量：把 `packages/lsp-client` 已具备底层能力的 hover 正式暴露为 OpenAWork 可用的 `lsp_hover` 工具，并补齐 tool surface、测试、verification 与文档同步。

## Current Analysis

- `packages/lsp-client/src/client.ts` 已声明 hover capability，并已实现 `hover()` 请求。
- `packages/lsp-client/src/index.ts` 已提供 `LSPManager.hover()`。
- 当前缺口主要在：
  - `packages/agent-core/src/tools/lsp.ts` 尚无 `hover` schema / metadata
  - `packages/agent-core/src/index.ts` 尚无对应导出
  - `services/agent-gateway/src/lsp-tools.ts` 尚无 `lsp_hover` tool definition
  - `services/agent-gateway` 相关 tool surface / capabilities / visibility / verification 尚未纳入 `lsp_hover`
- 这条增量应保持在“轻量扩展已有 richer LSP tool surface”，不要外溢成 implementation / call hierarchy / UI 面板项目。

## Solution Design

- 延续现有 richer LSP 风格：新增单独的 `lsp_hover` 工具，而不是重构回单一 `lsp` 多操作入口。
- hover 执行语义对齐现有 LSP 查询工具：
  - 查询前统一 `touch(true)`
  - 返回稳定字符串输出
  - LSP 不可用或 hover 为空时，优雅降级为稳定 fallback
- 测试范围控制在最小闭环：
  - tool schema / tool surface / visibility
  - verification 脚本中的 hover 执行链与 fallback
  - 必要时补充 capabilities 断言

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: workflow 文档 / tool 合约与实现 / 测试与 verification → +2
- Modules/systems/services: `.agentdocs` + `packages/agent-core` + `services/agent-gateway` + `packages/lsp-client` → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 虽然 hover 本身是轻量功能，但本次任务同时要新建 follow-up workflow、委托子开发流修改多模块、补齐测试与 verification，因此按 full orchestration 管理最稳妥。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：确认 `lsp_hover` 的输入/输出语义与 fallback 文案
- [x] T-02：锁定需要修改的 agent-core / gateway / test / verification 文件清单

### Phase 1：Tool contract 与执行器暴露

- [x] T-03：在 `packages/agent-core/src/tools/lsp.ts` 新增 hover schema / metadata
- [x] T-04：在 `packages/agent-core/src/index.ts` 导出 hover schema / metadata
- [x] T-05：在 `services/agent-gateway/src/lsp-tools.ts` 新增 `lsp_hover` tool definition 并对齐现有 pre-touch / fallback 风格

### Phase 2：Tool surface 与测试

- [x] T-06：补齐 `tool-definitions` / `capabilities` / `session-tool-visibility` 等 surface 测试
- [x] T-07：扩展 `verify-lsp-tools.ts`，验证 hover 正向链路与空结果 fallback

### Phase 3：验证与文档同步

- [x] T-08：运行 diagnostics、相关 vitest、verification、build
- [x] T-09：同步 `.agentdocs/index.md` 与本 workflow 状态
- [x] T-10：Oracle 复核并决定是否归档本 workflow

## Notes

- 本轮继续遵循已有决策：不把 hover 扩展成更大范围的 richer LSP 二期。
- 若实现过程中发现 hover 输出结构在不同语言服务器间差异过大，应优先稳定格式化输出，而不是直接透传复杂原始对象。
- 主线程已补齐 `.agentdocs/index.md` 的活跃工作流登记，并新增一条 durable pitfall：新增 richer LSP 工具时不能漏掉 `tool-sandbox.ts` 的 import / allowlist / register 三处接线。
- 当前实现与复验状态：`lsp_hover` 已覆盖 agent-core schema/export、gateway tool definition、tool surface、session visibility、tool sandbox、targeted vitest、`verify-lsp-tools.ts` 与 `@openAwork/agent-gateway` build；剩余仅待 Oracle 只读复核并决定是否归档。
- Oracle 复核结论：当前 scope 保持为 hover-only，tool exposure / sandbox / visibility / verification / 文档状态均已闭环，工作流可归档。
- Memory sync: completed
