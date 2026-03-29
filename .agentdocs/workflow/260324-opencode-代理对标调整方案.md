# .agentdocs/workflow/260324-opencode-代理对标调整方案.md

## 任务概览

目标是对照 `temp/opencode` 的中转代理实现，理解其上游请求构造、流式解析与兼容策略，并将可复用的部分收敛到 OpenAWork 当前的 `agent-gateway` 上游代理链路中。

## 当前分析

- 当前 OpenAWork `services/agent-gateway/src/routes/stream.ts` 仍固定请求 `${apiBaseUrl}/chat/completions`，并直接拼接 `model/max_tokens/temperature/stream/tools/messages`。
- `services/agent-gateway/src/routes/stream-protocol.ts` 只支持 Chat Completions SSE `choices[].delta` 形状，不支持 Responses 事件流。
- `packages/agent-core/src/provider/utils.ts` 已有 `buildRequestOverrides()`，并对 GPT-5 家族自动加入 `omitBodyKeys=['temperature']`，但 gateway 发请求路径尚未接入该能力。
- 用户要求参考 `temp/opencode` 的真实实现来决定如何调整当前代理层，因此必须先完成参考仓库对照，再落代码。

## Complexity Assessment

- Atomic steps: 4 → 0
- Parallel streams: yes → +2
- Modules/systems/services: 2 → 0
- Long step (>5 min): yes → +1
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 2
- **Chosen mode**: Lightweight
- **Routing rationale**: 需要并行探索参考仓库与当前仓库，但整体仍是有限范围的实现对照与定向调整，适合轻量工作流推进。

## Implementation Plan

### Phase 1：参考实现核查
- [x] T-01：梳理 `temp/opencode` 中转代理入口、请求构造与流式解析主链路
- [x] T-02：提炼 `temp/opencode` 对模型兼容、工具调用和端点选择的关键策略

### Phase 2：当前仓库差距对照
- [x] T-03：对照 OpenAWork 当前 `stream.ts / stream-protocol.ts / model-router.ts` 的缺口
- [x] T-04：确定最小可落地调整点与风险边界

### Phase 3：落地与验证
- [x] T-05：实现当前仓库的代理兼容调整
- [x] T-06：补定向测试并完成 diagnostics/typecheck/build 验证

## Notes

- 优先关注与用户现有故障直接相关的差距：GPT-5 家族请求体裁剪、Chat→Responses 兼容、stream + tools 组合的上游适配。
- 2026-03-24：OpenAI 上游已切换为 `responses` 协议，gateway 新增 `upstreamProtocol`、Responses 请求体构造与 SSE 事件解析，同时保持对外 `StreamChunk` 结构不变。
- 2026-03-24：补齐了 `provider=openai + alias model` 的 Responses 回归覆盖：单元测试证明 provider 分支强制走 `/responses`，独立 `tsx` 脚本验证真实 `/sessions/:id/stream/sse` 链路会发送 `input/max_output_tokens` 形态的 Responses 请求体。
- 2026-03-25：Responses 集成脚本已扩展为 4 场景覆盖：文本完成、假工具触发的 tool_call/tool_result 回环、`response.incomplete -> max_tokens`、上游 502 -> `MODEL_ERROR`，并接入 `@openAwork/agent-gateway` 的 `test` 脚本。
- 2026-03-25：为避免 `mcp-client` 解析依赖 `dist` 产物，`services/agent-gateway/tsconfig.json` 已补充 `@openAwork/mcp-client` 与 `@openAwork/skill-types` 的 `paths/references`，恢复 MCP 相关 test/typecheck/build 稳定性。
- 2026-03-25：Responses 集成脚本已进一步加强为“关键事件有序子序列 + 终止事件唯一性”断言：文本/截断场景必须 `text_delta -> done`，工具场景必须 `tool_call_delta -> tool_result -> text_delta -> done` 且不出现 `tool_use done`，错误场景只允许 `MODEL_ERROR` 不允许 `done`。
- Memory sync: completed
