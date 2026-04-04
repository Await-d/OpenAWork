# 260404 LSP call hierarchy 分阶段实施

## Task Overview

基于已归档的 `260403-lsp-自动使用集成方案`、`260404-lsp-hover-轻量增强实施`、`260404-lsp-后续路线评估` 与 `260404-lsp-implementation-最小增量实施`，继续推进 OpenAWork richer LSP 主线的下一条 follow-up：**正式接入 call hierarchy**。

本轮目标是在不扩散到 UI / 更多 language server / 其他 LSP 功能的前提下，完成 call hierarchy 的协议接线、tool 设计、gateway 暴露、测试、verification 与文档收口。

## Current Analysis

- 当前 richer LSP 已正式支持：`definition / implementation / references / symbols / prepareRename / rename / hover / diagnostics / touch`。
- 路线评估结论已确认：
  - `implementation` 已先于 call hierarchy 完成，因为它与 `definition` 协议形状同构、接线成本最低。
  - call hierarchy 是下一条更复杂但仍合理的语义查询增量。
- 当前已知 call hierarchy 与现有 richer LSP 的差异在于：
  - 协议为三步：`textDocument/prepareCallHierarchy` → `callHierarchy/incomingCalls` → `callHierarchy/outgoingCalls`
  - 需要承载新的 `CallHierarchyItem` / incoming / outgoing 数据结构
  - 相比当前所有无状态 `(file, line, character) → result` 的查询工具，call hierarchy 更接近“先 prepare，再查询”的两段式模型
- 本轮需要先冻结：对外究竟暴露为 3 个协议镜像工具，还是做更高层的封装

## Solution Design

- 本轮优先原则：**协议忠实 + 工具可用 + 验证闭环**。
- 初始候选设计：
  1. 直接镜像协议，暴露 `prepare_call_hierarchy` / `incoming_calls` / `outgoing_calls` 三个工具
  2. 在 gateway 做高层封装，减少模型侧的多步负担
- 设计冻结前，先并行收集：
  - 内部接线点（lsp-client / agent-core / gateway / tests）
  - 外部协议最小能力面与 conservative capability 声明
- 无论最终选择哪种工具粒度，都必须满足：
  - capability 声明完整
  - sandbox / visibility / prompt guidance 同步
  - verification 覆盖正向链与 fallback/空结果

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 仓库接线点 / 外部协议 / workflow 文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + `packages/agent-core` + `services/agent-gateway` → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: call hierarchy 明显比 implementation 更复杂，既涉及三步协议与新类型，又需要重新冻结工具粒度；为避免设计漂移，继续采用 full orchestration 管理最稳妥。

## Implementation Plan

### Phase 0：范围与设计冻结

- [x] T-01：收集 call hierarchy 的内部接线点与外部协议约束
- [ ] T-02：冻结对外 tool 设计、scope、fallback 文案与非目标范围

### Phase 1：lsp-client 与 contract 接线

- [ ] T-03：在 `packages/lsp-client` 补齐 call hierarchy 相关 capability、types 与请求方法
- [ ] T-04：在 `packages/agent-core` 补齐 call hierarchy schema / metadata / exports

### Phase 2：gateway tool surface 暴露

- [ ] T-05：在 `services/agent-gateway/src/lsp-tools.ts` 实现 call hierarchy 工具定义与输出格式化
- [ ] T-06：在 `tool-definitions.ts`、`tool-sandbox.ts`、`session-tool-visibility.ts` 补齐 call hierarchy tool surface
- [ ] T-07：在 `stream-system-prompts.ts` 增补 call hierarchy guidance

### Phase 3：测试与验证

- [ ] T-08：扩展相关单测（tool-definitions / capabilities / capabilities-routes / session-tool-visibility / stream-system-prompts）
- [ ] T-09：扩展 `verify-lsp-tools.ts`，覆盖 call hierarchy 正向链与空结果 fallback
- [ ] T-10：运行 diagnostics、targeted vitest、`verify-lsp-tools.ts`、相关 build

### Phase 4：文档收口与复核

- [ ] T-11：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [ ] T-12：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 当前边界明确：不要把 call hierarchy 扩展成 UI 面板项目，也不要与 language server coverage 扩展混做。
- 参考既有 pitfall：新增 richer LSP 工具时，必须同时检查 `initialize.capabilities`、`tool-sandbox.ts`、`session-tool-visibility.ts` 与 `verify-lsp-tools.ts`，不能只看 gateway tool definition。
- 当前已收集到的关键证据：
  - 协议层固定为三步：`textDocument/prepareCallHierarchy` → `callHierarchy/incomingCalls` → `callHierarchy/outgoingCalls`
  - 最小 conservative capability 为 `capabilities.textDocument.callHierarchy = { dynamicRegistration: false }`
  - 主要设计分歧不在协议，而在工具面：是忠实镜像为 3 个工具，还是封装为 1 个高层工具以避免模型传递 `CallHierarchyItem.data`
