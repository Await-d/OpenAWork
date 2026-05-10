# 260509 — P0 provider 兼容性修复批（5 项打包）

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 0。

## Task Overview

把 5 项独立、低风险但收益直接的 provider/protocol 修复一次性收口：

1. **T-P0-A** GPT-5 reasoning_effort 按子型号精确分级
2. **T-P0-B** Gemini-3 vs 2.5 `thinkingLevel`/`thinkingBudget` 子集对齐
3. **T-P0-C** `server_is_overloaded` / `overloaded_error` 加入重试白名单
4. **T-P0-D** 工具列表确定性排序，提升 prompt cache 命中
5. **T-P0-E** Anthropic adaptive thinking 空 text 保留为单空格，避免 signature 错位

## Current Analysis

- `services/agent-gateway/src/v2-runtime/upstream/provider-options.ts` 当前用统一 5 档 `minimal/low/medium/high/xhigh`，对 GPT-5.1（不支持 `minimal`）、`gpt-5-pro`（仅 high）、`gpt-5-chat`（仅 medium）等会被 OpenAI 直接 400。
- 同文件 `mapGeminiThinkingLevel` 仅覆盖 gemini-3 的 high/low；`gemini-3-flash` 应支持 `minimal/low/medium/high`，`gemini-3-pro-image` 仅 high；`gemini-2.5-pro` 的 budget 上限是 32_768 而不是 24_576。
- `services/agent-gateway/src/upstream-retry-policy.ts` / `retry-classify.ts` 不识别 `server_is_overloaded`，被坑用户已经在反馈。
- `services/agent-gateway/src/tool-definitions.ts` / `dynamic-tool-loader.ts` 把工具按加载顺序传给 LLM，导致同一会话不同请求间工具顺序漂移，prompt cache 频繁失效。
- `services/agent-gateway/src/message-v2-adapter.ts` / `render-anthropic-messages.ts` 在 ADC 协议对齐时已经处理了 reasoning，但 **当 `text === ""` 与 signed reasoning 共存时**会丢分隔块，replay 时 Anthropic 会拒。

## Solution Design

### T-P0-A GPT-5 reasoning_effort 分级

参考 `temp/opencode/packages/opencode/src/provider/transform.ts` (`1cf8123bc`)，新增 `clampReasoningEffortForModel(modelApiId, requested)` 工具函数，规则：

```
gpt-5-pro                → ['high']
gpt-5-2-pro+ / 5-x-pro   → ['medium', 'high', 'xhigh']
gpt-5-x-codex (3+)       → ['none', 'low', 'medium', 'high', 'xhigh']
gpt-5-x-codex-max / 2+   → ['low', 'medium', 'high', 'xhigh']
gpt-5-x-chat             → ['medium']
gpt-5.1                  → ['none', 'low', 'medium', 'high']
gpt-5.2+ (含 nano/mini)  → ['none', 'low', 'medium', 'high', 'xhigh']
其余非 GPT-5              → 维持现行 5 档
```

调用点：在 `provider-options.ts` 把 `effort` 传给 OpenAI providerOptions 前 clamp。若 requested 不在子集，落到子集中"最接近且不超过"的档位（保守降级）。

### T-P0-B Gemini thinking 对齐

```
gemini-3-flash-image  → levels: ['minimal', 'high']
gemini-3-pro-image    → levels: ['high']
gemini-3-flash        → levels: ['minimal', 'low', 'medium', 'high']
gemini-3 其他         → levels: ['low', 'medium', 'high']
gemini-2.5-pro (非 flash) → thinkingBudget 上限 32_768
gemini-2.5 其他        → thinkingBudget 上限 24_576
```

`smallOptions` 走专用 `googleSmallThinkingConfig`：gemini-3 用 `thinkingLevel: 'minimal'`/'low'/'high'（按 levels 第一个可用），gemini-2.5 用 `thinkingBudget: 128`（pro）或 0（其他）。

### T-P0-C overloaded retry

`upstream-retry-policy.ts` 错误分类增加：

```ts
const OVERLOADED_PATTERNS = [
  'server_is_overloaded',
  'overloaded_error',
  'overloaded',
  'service_unavailable',
];
```

被识别后归到现有的"短重试可恢复"分支（指数退避 + max 3 次）。

### T-P0-D 工具排序

最终给 LLM 的工具表统一在出口处按 `name.localeCompare` 排序：

```ts
const sortedTools = Object.fromEntries(
  Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)),
);
```

落点：
- `services/agent-gateway/src/v2-runtime/upstream/upstream-request-builder.ts`（出口）
- 任何把 `tools` Record 直接传给 SDK 的位置

注意保留预批准白名单时也用 `Object.keys(sortedTools)` 而不是再次排序。

### T-P0-E reasoning 空 text 保留

参考 `233fc5b91`：在 `message-v2-adapter.ts`（或等价的 model messages 构建函数）里：

```ts
const hasSignedReasoning = msg.parts.some(p =>
  p.type === 'reasoning' &&
  (p.metadata?.anthropic?.signature != null ||
   p.metadata?.bedrock?.signature != null));

for (const part of msg.parts) {
  if (part.type === 'text') {
    const text = part.text === '' && hasSignedReasoning ? ' ' : part.text;
    // 推送 text part
  }
}
```

只在带 signature 的 reasoning 同时存在时把空字符串替换成单空格，其他场景不动。

## Complexity Assessment

- 原子步骤：5 → +2
- 并行流：5 项互相独立 → +2
- 模块：均在 `agent-gateway/v2-runtime` 与 `agent-gateway/src/*` → +0
- 单步 >5 min：每项 30 min – 1 h → 0
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：5 → Full orchestration（仍走 workflow doc 维护，单文件全收）**
- **Routing rationale**：5 项虽小但分散且互相独立，集中追踪比拆 5 份 lightweight 更好

## Implementation Plan

### Phase 1: 准备与基线
- [x] T-P0-PRE-01: `pnpm --filter @openAwork/agent-gateway typecheck` 取基线
- [x] T-P0-PRE-02: 跑相关 vitest 留作 before/after 对照

### Phase 2: 5 项各自落地（可并行）
- [x] T-P0-A: GPT-5 reasoning 分级 ✅
  - 修改 `services/agent-gateway/src/v2-runtime/upstream/provider-options.ts`：新增 `clampReasoningEffortForModel` 导出与子型号子集表，覆盖 gpt-5 / gpt-5-pro / gpt-5-{n}-pro / gpt-5-chat / gpt-5.1 / gpt-5.{2+} / gpt-5-codex 各档
  - 接入 `case 'openai'` 与 `case 'openrouter'` 的 effort clamp
  - 新增 `__tests__/clamp-reasoning-effort.test.ts`（20 项）
- [x] T-P0-B: Gemini thinking 子集 ✅
  - 修改 `provider-options.ts`：替换 `mapGeminiThinkingLevel` → 模型感知的 `googleThinkingLevels` / `googleThinkingLevelForEffort` / `googleThinkingBudgetForEffort` / `googleThinkingLowestLevel` / `googleSmallThinkingBudget`
  - 修复 disabled 路径：gemini-3 用 thinkingLevel（最低支持档），gemini-2.5-pro 用 budget=128（不能用 0）
  - 修复 gemini-2.5-pro 的 xhigh 上限到 32_768
  - 新增 `__tests__/gemini-thinking-alignment.test.ts`（19 项）
  - 复测现有 `v2-runtime-provider-options.test.ts` 25 项不变
- [x] T-P0-C: overloaded retry ✅
  - 修改 `services/agent-gateway/src/retry-classify.ts`：JSON 信封分支显式识别 `error.type ~= 'overloaded'`（含 `server_is_overloaded` / `overloaded_error`）
  - 注：substring 路径已隐式覆盖，新增结构化分支保护未来重构
  - 新增 4 项回归测试到 `__tests__/retry-classify.test.ts`
- [x] T-P0-D: 工具排序 ✅
  - 修改 `services/agent-gateway/src/v2-runtime/upstream/stream-runner.ts`：导出 `sortToolsByName`，在 `streamText` 调用前对 `incomingTools` 排序
  - 新增 `__tests__/sort-tools-by-name.test.ts`（6 项）
- [x] T-P0-E: reasoning 空 text ✅
  - **已存在**：`services/agent-gateway/src/v2-runtime/upstream/unified-message-bridge.ts:144-151` 早已实现等价方案（在签名 reasoning 块之间显式插入单空格 text 分隔）
  - 已有测试覆盖 `__tests__/v2-runtime-unified-bridge.test.ts:68-108`
  - 无需新代码

### Phase 3: 集成与验收
- [x] T-P0-V-01: typecheck 通过 ✅
- [x] T-P0-V-02: 全量 agent-gateway vitest 335/335 通过（含相关 7 个文件 107 项重点回归） ✅
- [ ] T-P0-V-03: 手工跑一次含 thinking 的 Anthropic 会话（待用户后续确认）
- [ ] T-P0-V-04: 手工触发一次 GPT-5.1/5-pro 请求验证 reasoning_effort 不报 400（待用户后续确认）

## Verification Commands

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/retry-classify.test.ts \
  src/__tests__/sort-tools-by-name.test.ts \
  src/__tests__/clamp-reasoning-effort.test.ts \
  src/__tests__/gemini-thinking-alignment.test.ts \
  src/__tests__/v2-runtime-provider-options.test.ts \
  src/__tests__/v2-runtime-unified-bridge.test.ts \
  src/__tests__/reasoning-blocks.test.ts
# 全量回归（实测 335/335 通过）：
pnpm --filter @openAwork/agent-gateway exec vitest run
```

## 实测结果（2026-05-09）

- typecheck: ✅
- 重点 7 个测试文件 107/107 通过
- agent-gateway 全量 43 个文件 335/335 通过

## Risks & Rollback

- **Clamp 过度保守** 可能让用户配置的 `xhigh` 在 GPT-5.1 上被降到 `high`：在 stream debug log 加一行降档原因，方便用户察觉。
- **工具排序** 改变历史会话的 prompt 顺序导致 cache miss 一次：可接受，长期更优。
- **空 text → 单空格** 仅作用于 `hasSignedReasoning` 路径，无该信号的会话完全不受影响。
- 任一修改若集成测试退化，单独 revert 即可，5 项无相互依赖。

## Notes

- 不动 `.NET` gateway，仅 TS 端落地。`.NET` 端的对应对齐进入后续 Wave 切片自行处理。
- 完成后在 `index.md` 的 `Known Pitfalls` 段补：
  - "GPT-5.1 不接受 reasoning_effort=minimal，必须 clamp 到 none/low"
  - "Anthropic adaptive thinking signed reasoning 之间空 text 必须保留为非空字符串"
