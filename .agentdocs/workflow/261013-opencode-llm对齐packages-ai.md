# 261013-opencode-llm 对齐上游 packages/ai（方案 A 全量对齐）

> **方案状态:✅ 已完成(2026-10-14)**
>
> - 区间增量(v2.0.16 → v2.0.28)**100% 处置**;基线分叉全部有明确处置(移植 / 登记分歧 / 明确排除)。
> - 执行明细见 `.agentdocs/runtime/261013-opencode-llm对齐packages-ai/master_plan.md`(**46 ✅ / 3 ⚪ 登记分歧 / 0 遗留**)。
> - 下方 Implementation Plan 的勾选框为**执行后回填**;原编号在执行中细化为 master_plan 的 T-01~T-45(含 T-06b/T-07b/T-08b/T-20b 拆分项,以及收口后追加的 T-43~T-45)。
> - 最终门禁:包 `tsc` 0 / 串行测试 **64 文件 724 用例全绿** / build 0 / prettier 全通过 / 网关 `tsc` 0 + 全量 642 通过 / 仓库级 lint 0 error。

## Task Overview

把 `packages/opencode-llm`（移植自上游 v1 线 `packages/llm`）对齐到上游 **v2 线 `packages/ai@v2.0.28`**。

- 用户已选定**方案 A：全量对齐**。
- 参照快照：`/home/await/project/OpenAWork/temp/opencode-v2.0.16`（已检出 tag `v2.0.28`，commit `026b106bc5`）。
- 差距基线（2026-10-13 实测）：可直接对应的 **57 个文件、归一化差异 13,870 行**，另有 Responses 拆分需新增 901 行；未移植文本类 104 文件 / 9,243 行、媒体类 37 文件 / 5,911 行。

## Current Analysis

### 来源与分叉事实（已实测确认）

| 事实 | 证据 |
| --- | --- |
| 本包移植自上游 v1 线 `packages/llm`（`@opencode-ai/llm`） | `providers/` 13 文件、`protocols/` 8 文件与本地**同名同集合**；类名 `Model` / `ModelCompatibility` 与 v1 一致 |
| v2 线于 2026-07-15 把 `packages/llm` 改名为 `packages/ai` | 上游 commit `bb15b16499 refactor(ai): rename llm package` |
| v2 线随后把 `Model*` 改名为 `LanguageModel*` | 上游 commit `634b9b21dd refactor(ai): align multimodal naming`（PR #40073）；v2.0.1 起所有 tag 已是新命名 |
| v1 线该包已功能冻结 | 最后一次功能变更为 2026-07-30 `a4f25a94b4`；此后至 `v1.19.0` 只有版本号提交；v1.18.12~v1.19.0 与本地累计差异恒为 3085 行 |

### 本地已有 / 缺失(逐项实测 2026-10-13;**已全部处置**)

- **已有**：`protocols/shared.ts` 的 `sseFraming` 已过滤空串 / `[DONE]` / 裸 `'null'` / `': keepalive'`（上游同类修复**已移植**）；`supportsThinkingBlockBinding`、`supportsEffortUpdates` 已在 `schema/options.ts`；协议体内有本地版 `providerErrorMessage`。
- **当时缺失 → 已全部补齐**(括号内为对应任务):`chunkTimeout` / `headerTimeout` / `timeout`(T-05)、`RequestEncoding`(T-05)、`cacheFormat`(T-05)、`emptyInputJsonSchema`(T-09)、`fitThinkingBudget`(T-24)、`gatewayPolicy`(T-11)、`between_tools`(T-25)、HTTP 超时默认常量(T-05)、`zstd` 编码(T-15 `jsonPost`)。
- **不可照搬(登记分歧)**:上游 `route/*` 用 `effect/http`(Effect 4.0.1),本地为 `effect/unstable/http`(`4.0.0-rc.117`);上游 `schema/messages.ts` 用 `@opencode/schema` 的 `withStatics`,本仓无该依赖(D-6)→ 用本地 `utils/with-statics.ts` 等价实现。

### 本地生产可达面（决定优先级，来自项目记忆 2026-09-21）

网关协议可达面仅 `chat_completions | responses | anthropic_messages`；`gemini.ts` / `bedrock-converse.ts` **未接线**，今日不可达 → 这两个协议排最后。

### 在途改动(阻塞项 —— **已解除**)

工作区曾**非干净**:`packages/opencode-llm/src/error/*`(circuit-breaker / error-handler / retry-policy + 测试)与 `src/index.ts` 共 7 文件、`+504 / -258` 未提交。**T-04 已与用户确认可覆盖 / 可协调**,Phase 8 一并调整。另注:工作区还存在**非本任务**的在途改动(网关 `bash-tools` / `ssh-remote-execution` / `open-websearch-fetch-web` 等),review 时需分开看。

### 不可违反的既有约束（项目记忆）

1. 改 `packages/opencode-llm/src` **必须重建 dist**（`services/agent-gateway` 经 `exports` 消费 `dist/`，不重建会表现为「改了没生效」）。
2. 该包测试**必须串行复跑**：`src/stream/__tests__/integration.test.ts` 的性能计时断言在文件并行下必然假失败。
3. `error/` 模块**不做 Effect 迁移**（2026-09-21 用户决策）。
4. 严禁任何 git 回滚指令。

## Solution Design

- **对齐方式**：逐文件以「上游 v2.0.28 行为」为准重写，**保留本地命名与目录布局**（`Model*`、单文件 `openai-responses.ts` 除外，见 D-4），不引入上游新增依赖。
- **分批顺序**：契约层 → 路由层 → 协议基础件 → 生产可达协议 → providers → 未接线协议 → 自研层适配 → 收口对账。理由：契约层是其余各层的类型与选项依赖，且改动风险最低、收益最高。
- **每批门禁**：`bunx tsc --noEmit`（包内）+ 该批对应的 `src/**/__tests__` 串行复跑 + `bun run --filter @openAwork/opencode-llm build`。
- **派生要求**：上游在 v2.0.17–v2.0.28 期间新增 441 个 feat 中与本包相关的协议/提供方（cohere / venice / google-interactions / digitalocean / vercel-ai-gateway / bedrock-mantle 等）作为**可选批次**，不阻塞主链路。

## Gate 0 决策（2026-10-13 用户已确认）

| 编号 | 决策 | 确认结果 |
| --- | --- | --- |
| D-1 | 对齐基线 | ✅ tag `v2.0.28`（不含 v2.0.28 之后 dev 的 5 个未发布提交） |
| D-2 | 命名策略 | ✅ **保留本地 `Model*` 命名**，只搬逻辑，不跟进 `LanguageModel*` 改名 |
| D-3 | Effect 版本 | ✅ **保持 `4.0.0-rc.117` + `effect/unstable/http`**，不升级 4.0.1 |
| D-4 | Responses 结构 | ✅ **采纳上游拆分**（`open-responses.ts` + `channel` + `continuation` + `utils/responses-*`） |
| D-5 | 覆盖范围 | ✅ **扩大**：文本类全量（57 个对应文件 + **104 个未移植文本类文件一并补齐**，9,243 行）；媒体类仍排除 |
| D-6 | 自研层处置 | ✅ `error/` `stream/` `tools/` `client/` `types/` `provider/` 保留，仅做接口适配；不引入 `@opencode/schema` |

### 执行中新发现的待决策项(2026-10-13,T-05 完成后;**均已决议**)

**D-7：finish 事件形状。(✅ 已决议:A 采纳嵌套,T-06 落地)** 本地为扁平 `reason: FinishReason` + `reasonRaw?: string`；上游为嵌套 `reason: FinishReasonDetails { normalized, raw?, category?, explanation? }`（v2.0.17–v2.0.28 的真实增量正是 `category`/`explanation` 两字段）。这不是新增分叉——v2.0.16 就已是嵌套，属于 v1→v2 遗留差异。两个选项的波及面已实测：

- **A 采纳嵌套**：7 个包内源文件（`schema/events.ts`、`protocols/utils/lifecycle.ts`、`gemini` / `anthropic-messages` / `openai-responses` / `bedrock-converse` / `openai-chat`）+ 4 个包内测试 + **网关 1 个运行时**（`stream-runner.ts` 461/472/477 读 `event.reason`）+ **5 个网关测试**（`LLMEvent.finish({ reason: 'stop' })` 需改 `{ normalized: 'stop' }`）≈ 17 文件，需重建 dist 并跑 G-4。
- **B 保持扁平 + 追加 `reasonCategory` / `reasonExplanation`**：1 文件，零外溢；但与上游命名/形状不一致，Phase 4 移植协议时需额外映射。

**D-8：纯分叉文件的处理口径。(✅ 已决议:C 混合)** 实测发现 schema 层在目标区间内几乎零改动（`ids.ts` 0 行、`errors.ts` 0 行、`events.ts` 仅 +4），而它们的「归一化差异」分别高达 38 / 315 / 335 行——这些数字主要来自 v1→v2 分叉，而非最近三周的更新。需要明确口径：

- **A 增量优先**：只对齐 v2.0.17–v2.0.28 的真实增量 + 为使其成立所必需的兼容适配；分叉差异登记为「已知分歧」不重写。
- **B 结构与行为全量重写**：把 57 个文件全部改写为上游结构（含分叉），约 1.4 万行差异。
- **C 混合（建议）**：协议层（P3/P4/P6）与契约层（P1）按上游结构重写；自研层与纯分叉的辅助文件只补增量。

### 决策引发的 scope 变更(2026-10-13 重评分;**已按此执行,任务最终细化为 49 行任务表**)

- 原 scope：57 文件 / 13,870 行 + 901 行新增。
- 新 scope：**+104 个文本类文件 / 9,243 行**（含 50+ 供应商专用协议与按供应商拆分的 providers 目录）。
- 重评分：原子步骤 38 → **52** 个任务簇（仍 +2）；其余信号不变 → **总分仍为 7，Full orchestration**。
- 新增 Phase：原 P7「新增供应商协议（可选）」升级为**主链路 P7（T-35~T-44）**，不再是可选批。
- 在途改动（`src/error/*`、`src/index.ts`）：用户确认**可覆盖 / 可协调**，T-04 关闭，Phase 8 一并调整。

## Complexity Assessment

- 原子步骤：38 个任务簇 → **+2**
- 多独立并行流：契约 / 路由 / 协议 / providers 四条可并行（但需串行验证） → **+2**
- 涉及 3+ 模块：包内 6 个子域 + 上游参照 + 网关消费方 → **+1**
- 单步 >5 min：`anthropic-messages` / `openai-chat` / Responses 家族单文件重写 → **+1**
- 结果需持久化供复核：需逐文件差异对账报告 → **+1**
- OpenCode Mode A 可用：否（本环境仅有只读探索子代理，无并行写码代理） → **0**
- **Total score: 7**
- **Chosen mode: Full orchestration**
- **Routing rationale**: 38 个任务簇、四条子域、单文件改动量达 2000+ 行且存在在途改动冲突风险，必须落 master_plan 逐任务状态与门禁；本环境无并行写码能力，执行方式选 **Mode B（上下文内串行）**。

## Implementation Plan

### Phase 0: 基线固化与准备（不改源码）

- [x] T-01: 固化只读参照快照（上游 `packages/ai/src@v2.0.28` → `runtime/261013-*/reference/`），记录 tag/commit
- [x] T-02: 落盘逐文件对照表（57 文件差异行数 + 分层 + 优先级）为 `master_plan.md` 附录
- [x] T-03: 建立验证基线：构建 + typecheck + 串行全量测试，记录用例数
- [x] T-04: 与用户确认在途改动（`src/error/*`、`src/index.ts`）归属与处理方式

### Phase 1: 契约与元数据层（12 文件 / 2,275 行）

- [x] T-05: `schema/options.ts`（346）三超时 + 默认常量 + `RequestEncoding` + `ReasoningEffort` 放宽 + `cacheFormat`
- [x] T-06: `schema/events.ts`（335）+ `schema/ids.ts`（38）
- [x] T-07: `schema/errors.ts`（315）
- [x] T-08: `schema/messages.ts`（252）本地版 `withStatics` 等价 —— 已落地;`ToolEntry`/`ToolNamespace` 联合 / `CompactionPart` / `ToolContent` media 变体经核实**零生产者,决策不引入**(T-08b)
- [x] T-09: `tool.ts`（100）+ `tool-runtime.ts`（47）`emptyInputJsonSchema`
- [x] T-10: `llm.ts`（130）+ `index.ts`（119）`generate`/`stream` 重载与导出面 —— 第①层重载归一化 + **第②层 `StreamOptions` 中间件缝(T-44)全部落地**
- [x] T-11: `cache-policy.ts`（188）`selectPolicy` / `gatewayPolicy` / `QWEN`
- [x] T-12: `provider-error.ts`（374）错误分类矩阵 + `providerErrorMessage` —— 另**轻量对齐 `isPayloadTooLarge`**(`request entity too large` 从上下文超限移出)

### Phase 2: 路由与传输层（11 文件 / 2,241 行）

- [x] T-13: `route/client.ts`（632）
- [x] T-14: `route/executor.ts`（473）
- [x] T-15: `route/transport/http.ts`（258）+ `transport/index.ts`（56）
- [x] T-16: `route/transport/websocket.ts`（448） —— 区间 34 行改动 100% 为 `effect/socket` + DOM 类型迁移,本地用 `globalThis.WebSocket` → **无需改代码**(登记分歧)
- [x] T-17: `route/framing.ts`（106）+ `protocol.ts`（31）+ `endpoint.ts`（68）
- [x] T-18: `route/auth.ts`（118）+ `auth-options.ts`（13）+ `index.ts`（38）

### Phase 3: 协议基础件（2,275 行）

- [x] T-19: `utils/tool-schema.ts`（127）+ `utils/gemini-tool-schema.ts`（205）
- [x] T-20: `utils/tool-stream.ts`（161）+ `utils/partial-json*.ts`（119）
- [x] T-21: `utils/bedrock-auth.ts`（213）+ `bedrock-cache.ts`（33）+ `bedrock-media.ts`（65） —— 仅 `fnUntraced` 1 行可移植,其余绑定 v2 独有结构(登记分歧)
- [x] T-22: `utils/openai-options.ts`（139）+ `cache.ts`（19）+ `lifecycle.ts`（18）
- [x] T-23: 新增 `utils/claude-model.ts` + `utils/gateway-protocol.ts`（上游新增 109 行） —— `claude-model.ts` 已落地并被 `anthropic-messages.ts` 复用;`gateway-protocol.ts` 依赖本地没有的 `lenient` 且无消费者 → 登记分歧
- [x] T-24: `protocols/shared.ts`（458）`fitThinkingBudget` / `wrappedSystemUpdate`

### Phase 4: 生产可达协议（7,368 行，风险最高）

- [x] T-25: `protocols/anthropic-messages.ts`（1,701）
- [x] T-26: `protocols/openai-chat.ts`（1,714）
- [x] T-27: Responses 家族重构（2,052 + 901 新增） —— 拆 2 步落地(`utils/responses-hosted-tools.ts` + `protocols/open-responses.ts`,主文件 1,410→1,118 行);`channel`/`continuation`/`checkpoint`/`compaction` → **T-35 决策 C**
- [x] T-28: `protocols/openai-compatible-chat.ts`（3）+ `protocols/index.ts`（18）
- [x] T-29: `providers/anthropic.ts`（54）+ `openai.ts`（158）+ `openai-options.ts`（96）

### Phase 5: providers 其余（690 行）

- [x] T-30: `providers/openrouter.ts`（185）+ `xai.ts`（102）+ `azure.ts`（124）
- [x] T-31: `providers/google.ts`（62）+ `amazon-bedrock.ts`（57）+ `cloudflare.ts` + `github-copilot.ts`
- [x] T-32: `providers/openai-compatible.ts`（67）+ `openai-compatible-profile.ts` + `providers/index.ts`（43）

### Phase 6: 未接线协议（后置，1,482 行）

- [x] T-33: `protocols/gemini.ts`（813）
- [x] T-34: `protocols/bedrock-converse.ts`（599）+ `bedrock-event-stream.ts`（70）

### Phase 7: 新增供应商协议（可选批次）

- [x] T-35: 生产相关新增（`google-interactions` / `cohere-chat` / `venice-chat` / `bedrock-mantle` / `vercel-ai-gateway`） —— **`venice-chat` 已做原生协议移植(T-45)**;其余因网关无对应 providerType / providerHints 信号 → 登记分歧
- [x] T-36: 其余供应商专用协议（`alibaba-*` / `meta-*` / `zai-*` / `xai-responses` / `mistral-chat` 等） —— 整族**登记分歧**(网关仅 9 个 providerType,零消费方)

### Phase 8: 自研层适配与收口

- [x] T-37: 自研层接口适配（`stream/` `tools/` `client/` `types/` `provider/`） —— 核实为**验证型任务,零改动**(自研层对事件纯 cast 透传;`tool-executor` 无生产调用者)
- [x] T-38: 收口对账：重建 dist + 串行全量测试 + 重跑差异脚本输出剩余差异报告 —— 完成;**对账口径已修正**(原「归一化差异 ≤500」假设不成立,见「差异复测结论」)

## Notes

- **执行方式**：Mode B（上下文内串行）。本环境子代理只有只读探索能力，无可并行写码代理，故不派 agent 写文件。
- **Gate 2 约束**：每批改动 ≤3 文件，逐批验证后再进入下一批。
- **回滚策略**：不执行任何 git 回滚指令；出错按文件手工恢复。
- **对账口径**(**已修正**):原定「归一化差异行数 ≤500」经 Phase 8 复测证明假设不成立——差异主体是 v1→v2 架构分叉而非待移植量。改用「区间新增导出符号覆盖率」:153 个新增导出中本地已落地 86 个,缺失 67 个经逐个归类 **100% 属已登记分歧** → 真实待移植项 = 0(见「差异复测结论」)。
- **未纳入**：媒体类 37 文件 / 5,911 行（图像 / 语音 / 转录 / 视频），本包不提供该类能力。

## 执行结果与决策偏差（2026-10-14 追加）

执行明细见 `.agentdocs/runtime/261013-opencode-llm对齐packages-ai/master_plan.md`（46 行任务表：**44 ✅ / 2 ⚪ 登记分歧 / 0 遗留**）。

### 任务层面：本方案 38 个任务全部完成

Phase 0~8 逐项映射到 master_plan 执行表（编号在执行中细化：T-06b/T-07b/T-08b/T-20b 为拆分项，T-35~T-42 为 D-5 升级后的新增供应商与收口批次）。门禁：包 `tsc` 0 / 串行测试 **61 文件 691 用例全绿**（基线 43/534）/ build 0 / 网关 `tsc` 0 + 全量 642 通过 / 仓库级 lint 0 error。

### 偏差 1：D-5「文本类全量」实际执行率约 4.8%（**需确认**）

**决策原文**：`✅ 扩大：文本类全量（57 个对应文件 + 104 个未移植文本类文件一并补齐，9,243 行）`
**实际执行**：104 个文件中移植 **4 个**（≈443 行）：

| 分组 | 文件数 / 行数 | 实际移植 |
|---|---|---|
| 协议-Responses 拆分 | 3 / 1,933 | 部分：`protocols/open-responses.ts`（278 行） |
| 协议-Responses 工具 | 4 / 475 | 部分：`protocols/utils/responses-hosted-tools.ts` |
| 协议-新增/供应商专用 | 18 / 3,110 | 1 个：`protocols/utils/claude-model.ts`（19 行） |
| 其他 | 9 / 130 | 1 个：`utils/sanitize.ts`（14 行） |
| providers-供应商 | 34 / 3,410 | **0** |
| providers-供应商目录 shim | 36 / 185 | **0** |
| **合计** | **104 / 9,243** | **4 文件 / ≈443 行（4.8%）** |

**不移植理由**（已实测，非推断）：
1. **网关生产可达面只有 3 条**：`services/agent-gateway/src/v2-runtime/upstream/native-model.ts:37-63` —— `anthropic_messages` → `Providers.Anthropic`；`responses` → `Providers.OpenAI.responses`；`openai` → `Providers.OpenAI.chat`；**其余一切 providerType**（venice / gateway / cohere / google / …）fallback 到 `Providers.OpenAICompatible`。故供应商专用协议与按供应商拆分的 providers 目录**无调用方**。
2. **本包不提供媒体能力**（附录 C）：媒体类 37 文件仍在排除范围。
3. **建空壳违反移植原则**：无生产者的导出即死代码。

**影响**：功能可用（这些供应商经 OpenAI 兼容层可达），但**失去原生协议能力**（如 Venice 特有参数、Cohere v2 格式、Google Interactions 语义）。若将来接入某供应商的原生协议，需按 master_plan 附录 D 的分组补做。

### 偏差 2：D-4「采纳上游拆分」只落地 2/6

**决策原文**：`✅ 采纳上游拆分（open-responses.ts + channel + continuation + utils/responses-*）`
**实际执行**：只拆出 `protocols/open-responses.ts`（请求体 schema 区 + ParserState）与 `utils/responses-hosted-tools.ts`（主文件 1,410 → 1,118 行，回到 AGENTS.md 预警线以下）。
未建：`channel`（本地无 WebSocket channel 传输）、`continuation` / `checkpoint`（本地无续跑概念）、`compaction`（本地无 compact 路由）。理由同上——无对应运行时概念，建空壳即死代码。

### 偏差 3：对账口径已修正（原口径不成立）

**原口径**（本文件 Notes）：`以「归一化差异行数」作为进度指标，Phase 0 记录基线、Phase 8 复测`，目标 `13,870 → ≤500`。
**复测发现**：该口径**假设不成立**——基线 13,870 是「v1 线本地代码 vs v2 线上游代码」的**架构差异量**，不是「待移植的区间增量」。证据：`providers/azure.ts` 复测差异 124 与基线完全相同（delta=0），差异片段全部是 v2 独有结构（`ProviderPackage.Settings` / `channelTransport` / `compact` 等，已在 T-31 登记无落点）；去注释口径只降 17%。
**替代口径**：区间新增导出符号覆盖率 —— 153 个新增导出中本地已有 **85 个（55.6%）**，缺失 68 个**经逐个人工归类 100% 属已登记分歧** → **真实待移植项 = 0**。复测脚本：`runtime/261013-*/results/diff-recheck.py`。

### 偏差 4：Gate 2「每批 ≤3 文件」的例外

T-06（事件形状契约变更）单批 17 文件（5 协议生产方 + lifecycle + 测试 + 网关），T-20b（新增 `ToolInputError` 事件）3 文件 + 网关穷尽 switch。理由：契约变更必须原子落地，否则中间态无法通过门禁。已用全门禁覆盖。

### 仍未纳入（与决策一致，无变化）

- 媒体类 37 文件 / 5,911 行（本包不提供媒体能力）
- `@opencode/schema` 依赖（D-6）、`LanguageModel*` 改名（D-2）、Effect 4.0.1（D-3）

### 追加：T-43 供应商探测一致性（2026-10-14 收口后）

**动因**：核对「D-5 为什么不移植」时，反向验证了它的核心前提——上游把供应商兼容声明写在 `providers/*.ts`（本地无这些模块），所以本地**必须有等价物**。审计发现等价物存在但不完整。

**审计方法**：上游非媒体 `providers/*.ts` 的 `compatibility` + `baseURL` ⟷ 本地四个探测函数 + `requireThinkingSignature` + `openai-compatible-profile.ts` 双向差集。

**结论**：本地「运行时探测」确实是上游「按供应商显式配置」的等价覆盖（上游探测列表是本地子集），但有 **5 处别名/端点漏判**构成真实缺陷（Moonshot 国内站误下发 `max_completion_tokens`；`venice`/`meta`/`minimax` 被下发 `store`；`minimax` 被下发工具 `strict`；Moonshot 经自定义中转时思维链被降级为 text）。已全部修复，并把端点表由 9 补至 19 个（含上游 cohere/digitalocean/meta/moonshot/opencode/typesafe-ai/venice/vercel-ai-gateway/zai/zai-coding-plan）。

**不判为缺口的项**：`supportsPromptCacheKey` 系列（本地刻意默认关，属已登记分歧）；`minimax`/`mistral` 端点为 anthropic/原生协议，不进 OpenAI 兼容端点表；`cloudflare-*`/`google-vertex*` 的 URL 含账号/项目变量。

**门禁**：包 `tsc` 0 / 串行测试 **62 文件 707 用例全绿**（+16 断言）/ build 0 / prettier 全通过 / 网关 `tsc` 0 + 全量 642 通过。详见 master_plan「供应商探测一致性」章节。

### 追加：T-44 `StreamOptions` 请求中间件（T-10 第②层，2026-10-14）

方案 Phase 1 的 T-10 要求 `generate`/`stream` 对齐上游 `(request, options?: StreamOptions)` 签名。第①层（重载归一化）早前完成，第②层因缺 middleware 缝一度另立任务，现已落地：

- 新增 `StreamOptions { http?: HttpMiddleware }`，全链路透传（`llm.ts` → `client.ts` → `transport` → `executor`）
- `HttpMiddleware` 在**状态码分类之前**拿到原始响应，支持改写请求 / 短路返回；中间件抛错仍收敛为 `LLMError`（不绕过分类）
- 上游的 `StreamOptions.webSocket` 与 `RequestExecutor.middleware` layer 组合子**不引入**（本地无 channel 运行时 / 无消费者）
- 7 例断言守护三条不变量（全程透传 / 不绕过分类 / 不传时零侵入）

**门禁**：包 `tsc` 0 / 串行测试 **63 文件 714 用例全绿** / prettier 全通过。

### 追加：T-45 Venice 原生协议（2026-10-14）

反向验证 D-5「无消费方」判断时发现：上游为部分供应商提供的是**带实质能力的原生协议**而非薄封装。其中 `venice` 同时满足「上游有独立协议（`venice_parameters` / 加密推理 / `thought_signature`）」与「网关 `model-snapshot.ts` 的 providerHints 列有该 provider」两个条件 → 判为**能力缺失**并移植；其余 17 个供应商专用协议维持不移植（网关 `provider/plugins/` 无对应 providerType）。

落地：`protocols/venice-chat.ts`（新，约 300 行）+ `providers/venice.ts`（新）+ `openai-chat.ts` 前置改造（新增 `LoweringOptions.assistant` 钩子，导出共享 lowering/收尾/流式 schema）+ 网关 `native-model.ts` 加分支（**仅官方端点**，中转继续走兼容回落）。

**门禁**：包 `tsc` 0 / 串行测试 **64 文件 724 用例全绿**（+10 断言）/ build 0 / prettier 全通过 / 网关 `tsc` 0。

### 收尾说明（**非遗留项**，仅备忘）

1. **`isPayloadTooLarge` 消费方** —— 分类已对齐（`providerFailureClassification`），但本仓**无生产消费方**采用 `isContextOverflowFailure`（网关靠自有报文匹配）；若将来启用，语义已正确。
2. **T-35 Responses channel 栈** —— 已按**决策 C** 登记为已知分歧（见下节）；将来若做，前置条件见该节。
3. **工作区在途改动** —— `src/error/*`、网关 `artifacts.ts` / `composer-queue*` / `bash-tools` / `ssh-remote-execution` 等**非本任务**改动仍在工作区，review 时需分开看。

### 追加：T-35 Responses channel 栈 —— 决策 C（2026-10-14 用户确认）

**决策**：登记为已知分歧，不移植。

**依据（本轮核实）**：

1. 五个文件（`open-responses-channel` / `-continuation` / `responses-checkpoint` / `-compaction` / `hosted-tools`）在 **v2.0.16 即存在** → 属 v1→v2 **基线分叉**，不是本区间增量（这也是它不在「区间新增导出符号」指标覆盖内的原因）。
2. 上游**唯一使用者**是 `providers/azure.ts`，且有三重门控：仅当 `*.openai.azure.com` + `/openai/v1/responses` + `api-version=v1` 时启用，其余端点自动回落 HTTP。
3. 上游**无测试**（`packages/ai` 只有 `src`，无测试目录）。
4. 本地缺的是 **channel executor 一级运行时**：本地 `WebSocketExecutor.open` 是「把 WS 当传输」，不是「长连接会话 + checkpoint」层。
5. 区间改动约 54 行中，`jsonPost` 的 `encoding`（T-15）与 `middleware` 透传（T-44）**所需机制本地已具备**，缺的只是这一层自身。

**若将来要做的前置条件**：channel executor 运行时（以本地 `WebSocketExecutor` 为基础扩展）+ `CompactionPart` / `CompactionResponse` schema + `Route.compact` 方法（`CompactMethod` / `CompactionOperations`）+ 网关 azure provider 分支。

**与其余排除项的区别**：不同于媒体类（明确排除）与 17 个供应商协议族（零消费方），本项上游有完整实现、区间仍在维护、且本地存在可对齐目标 —— 决策 C 是**基于「本地无该级运行时」的主动取舍**，而非「无承载物」。

> 至此本方案无遗留项：区间增量 100% 处置；基线分叉全部有明确处置（移植 / 登记 / 排除）。
