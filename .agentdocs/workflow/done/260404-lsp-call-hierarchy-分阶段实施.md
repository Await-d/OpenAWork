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
- [x] T-02：冻结对外 tool 设计、scope、fallback 文案与非目标范围

### Phase 1：lsp-client 与 contract 接线

- [x] T-03：在 `packages/lsp-client` 补齐 call hierarchy 相关 capability、types 与请求方法
- [x] T-04：在 `packages/agent-core` 补齐 call hierarchy schema / metadata / exports

### Phase 2：gateway tool surface 暴露

- [x] T-05：在 `services/agent-gateway/src/lsp-tools.ts` 实现 call hierarchy 工具定义与输出格式化
- [x] T-06：在 `tool-definitions.ts`、`tool-sandbox.ts`、`session-tool-visibility.ts` 补齐 call hierarchy tool surface
- [x] T-07：在 `stream-system-prompts.ts` 增补 call hierarchy guidance

### Phase 3：测试与验证

- [x] T-08：扩展相关单测（tool-definitions / capabilities / capabilities-routes / session-tool-visibility / stream-system-prompts）
- [x] T-09：扩展 `verify-lsp-tools.ts`，覆盖 call hierarchy 正向链与空结果 fallback
- [x] T-10：运行 diagnostics、targeted vitest、`verify-lsp-tools.ts`、相关 build

### Phase 4：文档收口与复核

- [x] T-11：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-12：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 当前边界明确：不要把 call hierarchy 扩展成 UI 面板项目，也不要与 language server coverage 扩展混做。
- 参考既有 pitfall：新增 richer LSP 工具时，必须同时检查 `initialize.capabilities`、`tool-sandbox.ts`、`session-tool-visibility.ts` 与 `verify-lsp-tools.ts`，不能只看 gateway tool definition。
- 当前已收集到的关键证据：
  - 协议层固定为三步：`textDocument/prepareCallHierarchy` → `callHierarchy/incomingCalls` → `callHierarchy/outgoingCalls`
  - 最小 conservative capability 为 `capabilities.textDocument.callHierarchy = { dynamicRegistration: false }`
  - 主要设计分歧不在协议，而在工具面：是忠实镜像为 3 个工具，还是封装为 1 个高层工具以避免模型传递 `CallHierarchyItem.data`
- Oracle 设计裁决：对外只暴露 **1 个高层读工具 `lsp_call_hierarchy`**，不要把 `prepareCallHierarchy / incomingCalls / outgoingCalls` 注册为 agent-facing 工具；内部仍实现 3 个协议级方法。
- 冻结后的输入/输出语义：
  - 输入：`{ filePath, line, character, direction?: 'incoming' | 'outgoing' | 'both' }`，`direction` 默认 `'both'`
  - 输出：人类可读字符串，按 `Incoming calls:` / `Outgoing calls:` 分段
  - fallback：prepare 为空或不支持时返回 `No call hierarchy found`；单方向为空时分别返回 `No incoming calls found` / `No outgoing calls found`
- 关键实现约束：
  - 查询前统一 `touch(true)`
  - `CallHierarchyItem.data` 必须作为 opaque payload 原样透传给 incoming/outgoing，禁止自行重建中间对象
  - v1 只做单跳 call hierarchy，不扩成递归树或 UI drill-down
- 当前主线程验证已通过：
  - 相关修改文件 diagnostics 全绿
  - `stream-system-prompts.test.ts`、`tool-definitions.test.ts`、`capabilities.test.ts`、`capabilities-routes.test.ts`、`session-tool-visibility.test.ts` 通过
  - `verify-lsp-tools.ts` 已覆盖 `lsp_call_hierarchy` 正向链、prepare 空结果、单方向空结果与 opaque item 透传
  - `@openAwork/lsp-client`、`@openAwork/agent-core`、`@openAwork/agent-gateway` build 通过
  - 额外修复了两个阻塞 `agent-gateway build` 的现存类型问题：`stream-attach-route.test.ts` 的 JWT mock 结构与 `stream-routes-plugin.ts` 的 logging payload 标量类型
- Oracle 复核结论：当前 `lsp_call_hierarchy` 的单工具设计、协议层接线、tool surface、sandbox、visibility、prompt guidance、verification 与文档状态均已闭环，工作流可归档。
- Memory sync: completed
