# 260404 LSP implementation 最小增量实施

## Task Overview

基于已归档的 `260403-lsp-自动使用集成方案` 与 `260404-lsp-hover-轻量增强实施`，以及新完成的 `260404-lsp-后续路线评估` 结论，继续推进 OpenAWork richer LSP 主线的下一条最自然 follow-up：**正式接入 `textDocument/implementation`，暴露为 `lsp_goto_implementation` 工具**。

本轮 scope 明确保持在 implementation-only：

- 做 `implementation` 的 client capability、lsp-client 请求方法、agent-core contract、gateway tool surface、sandbox、visibility、prompt guidance、tests、verification
- **不扩 scope** 到 call hierarchy
- **不扩 scope** 到新增 gateway-side language server
- **不扩 scope** 到前端 diagnostics/status/event 面板

## Current Analysis

- 当前 richer LSP 已有 8 个工具：`lsp_diagnostics`、`lsp_touch`、`lsp_goto_definition`、`lsp_find_references`、`lsp_symbols`、`lsp_prepare_rename`、`lsp_rename`、`lsp_hover`。
- 最近一轮修补已补齐：
  - `includeDeclaration` 真实透传
  - `references / symbols` 正向 verification
  - `lsp_hover` guidance
  - `lsp_rename` permission gating
  - `packages/lsp-client/src/client.ts` initialize capabilities 对齐
- 内部路线评估结论已明确：
  - `textDocument/implementation` 与现有 `textDocument/definition` 在参数/结果结构上**完全同构**，属于最小增量
  - call hierarchy 需要 prepare / incoming / outgoing 三步与新数据类型，复杂度显著更高
  - 扩展 language server 覆盖虽代码接线少，但环境依赖与 CI 验证不稳定，不适合作为当前主线

## Solution Design

- 延续现有 richer LSP 风格：新增单独的 `lsp_goto_implementation` 工具，而不是回退为单一多操作入口。
- 语义与现有查询类工具保持一致：
  - 查询前 `touch(true)`
  - 返回稳定的 location string 输出
  - 无结果时返回稳定 fallback（与 definition 风格一致）
- 协议对齐遵循“最小保守声明”：
  - `packages/lsp-client/src/client.ts` 在 `buildInitializeParams()` 中声明 `textDocument.implementation`
  - `linkSupport` 与当前 definition 对齐，避免过度承诺
- 文档与测试闭环保持对称：
  - tool surface
  - session visibility
  - prompt guidance
  - `verify-lsp-tools.ts` 正向链 / 空结果 fallback

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: workflow 文档 / lsp-client 与 gateway 接线 / tests 与 verification → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + `packages/agent-core` + `services/agent-gateway` → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: implementation 是最小 follow-up，但仍跨越 client contract、gateway surface、verification 与文档同步；采用 full orchestration 可保持与前两条 richer LSP workflow 一致的真相源与验收方式。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：冻结 `lsp_goto_implementation` 的输入/输出语义、fallback 文案与非目标范围

### Phase 1：lsp-client 与 contract 接线

- [x] T-02：在 `packages/lsp-client/src/client.ts` 声明 `textDocument.implementation` capability 并新增 `implementation()` 请求方法
- [x] T-03：在 `packages/lsp-client/src/types.ts` 与 `packages/lsp-client/src/index.ts` 补齐 `LSPClientInfo` / `LSPManager` implementation 方法
- [x] T-04：在 `packages/agent-core/src/tools/lsp.ts` 与 `packages/agent-core/src/index.ts` 新增 implementation schema / metadata / exports

### Phase 2：gateway tool surface 暴露

- [x] T-05：在 `services/agent-gateway/src/lsp-tools.ts` 新增 `lsp_goto_implementation` tool definition，并对齐现有 pre-touch / format / fallback 风格
- [x] T-06：在 `tool-definitions.ts`、`tool-sandbox.ts`、`session-tool-visibility.ts` 补齐 implementation tool surface
- [x] T-07：在 `stream-system-prompts.ts` 增补 implementation guidance，明确它与 `lsp_goto_definition` 的差异场景

### Phase 3：测试与验证

- [x] T-08：扩展相关单测（tool-definitions / capabilities / capabilities-routes / session-tool-visibility / stream-system-prompts）
- [x] T-09：扩展 `verify-lsp-tools.ts`，覆盖 implementation 正向链与空结果 fallback
- [x] T-10：运行 diagnostics、targeted vitest、`verify-lsp-tools.ts`、`@openAwork/lsp-client build`、`@openAwork/agent-gateway build`

### Phase 4：文档收口与复核

- [x] T-11：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-12：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 当前决策已冻结：`implementation` 是 hover 之后的下一条最自然 LSP follow-up。
- call hierarchy 与 language server coverage 保持为后续独立工作流，不混入本轮实施。
- 参考既有 pitfall：新增 richer LSP 工具时，必须同步检查 `initialize.capabilities` 与 `tool-sandbox.ts` 的 import / allowlist / register，不能只看 gateway tool surface。
- `lsp_goto_implementation` 的当前冻结语义：输入复用 definition 风格的 `{ filePath, line, character }`；查询前统一 `touch(true)`；输出沿用 location string；无结果时稳定返回 `No implementation found`。
- 当前主线程验证已通过：相关修改文件 diagnostics 全绿；`stream-system-prompts.test.ts`、`tool-definitions.test.ts`、`capabilities.test.ts`、`capabilities-routes.test.ts`、`session-tool-visibility.test.ts` 通过；`verify-lsp-tools.ts` 通过；`@openAwork/lsp-client`、`@openAwork/agent-core`、`@openAwork/agent-gateway` build 通过。
- Oracle 复核结论：`lsp_goto_implementation` 的 capability、request method、contract、gateway tool surface、sandbox、visibility、prompt guidance、verification 与文档状态均已闭环，工作流可归档。
- Memory sync: completed
