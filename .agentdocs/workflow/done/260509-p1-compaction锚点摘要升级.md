# 260509 — P1 compaction 锚点摘要升级

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 1。

## Task Overview

把会话压缩从"每次从零总结"升级成"在锚点摘要上做增量更新 + 严格 Markdown 模板 + 工具输出二次截断 + 关键工具不剪枝 + summary/tail 顺序修复"，对齐 opencode `574b2c217` (#23870) 与 `811954880` (#25851)。

## Current Analysis

`services/agent-gateway/src/compaction-llm.ts` 当前是经典模式：

```@/home/await/project/OpenAWork/services/agent-gateway/src/compaction-llm.ts:9-58
const COMPACTION_SYSTEM_PROMPT = `你是一个专门负责会话摘要的 AI 助手。
... [中文模板：目标 / 用户原始请求 / 指令 / 发现 / 已完成 / 禁止事项 / 相关文件] ...
```

问题：
1. 每次都让 LLM 重新写完整摘要，多轮压缩后摘要质量逐步劣化（细节丢失、新事实未合并）。
2. 模板缺 `In Progress` / `Blocked` 拆分，长任务里"做了一半的事"不容易留痕。
3. 工具输出大时（图片 base64、长文件读出）整段进入压缩 context，自身就有可能撑爆 PTL，触发 PTL retry trim 50% 反而丢失关键 turn。
4. `compaction-policy.ts` 在剪枝时不区分 `skill` 工具结果，可能把 SKILL.md 注入丢了。
5. 存储与 replay 顺序：summary 必须在 retained tail 之前，否则 LLM 看到的"按时间序"逻辑混乱。

## Solution Design

### S1: 锚点摘要模板

```
const COMPACTION_SYSTEM_PROMPT = `你是一个针对编程会话的锚点上下文摘要助手。

只对给到你的对话历史做总结。最新若干轮可能保留在你的摘要之外，因此聚焦在仍然影响后续工作的"较老上下文"。

如果用户提示中包含 <previous-summary> 块，把它视为当前的锚点摘要：保留仍然成立的细节、删除已过期的、合并新事实，重新输出整份摘要。

严格按用户提示中的输出结构回复。保留每一节，即使为空。优先用简短要点，避免段落叙述，精确保留文件路径、命令、错误串与标识符。

不要回应对话本身。不要提及"摘要"、"压缩"、"合并上下文"等元信息。使用对话所用语言回复。`;
```

模板（user prompt 末尾追加）：

```
请按下列结构输出，节序保持不变：
---
## 目标
- [一句话任务摘要]

## 约束与偏好
- [用户的约束、偏好、规范，或 (无)]

## 进度
### 已完成
- [已完成工作或 (无)]

### 进行中
- [当前正在进行的工作或 (无)]

### 阻塞
- [阻塞项或 (无)]

## 关键决策
- [决策与原因，或 (无)]

## 下一步
- [下一步动作（有序）或 (无)]

## 关键上下文
- [重要技术事实 / 错误 / 待回答问题，或 (无)]

## 相关文件
- [文件或目录路径：作用，或 (无)]
---

规则：
- 保留每一节，即使为空。
- 用简短要点，不写段落。
- 精确保留文件路径、命令、错误串与标识符。
- 不要提及"摘要过程"或"上下文已被压缩"。
```

### S2: 锚点更新逻辑

`callCompactionLlm` 增加可选参数 `previousSummary?: string`：

```ts
function buildAnchorBlock(previousSummary?: string): string {
  if (!previousSummary) {
    return '基于以上对话历史创建一份新的锚点摘要。';
  }
  return [
    '请使用以上对话历史更新下面的锚点摘要。',
    '保留仍然成立的细节、删除已过期的、合并新事实。',
    '<previous-summary>',
    previousSummary,
    '</previous-summary>',
  ].join('\n');
}
```

调用点：从 `compaction-policy.ts` 把"上一次成功 compaction 的 summary"读出来传入。session-message-store 已经有 compaction marker 与 summary persistence，复用。

### S3: 工具输出二次截断

`callCompactionLlm` 内部对参与压缩的 messages 做一次安全转换：

```ts
const TOOL_OUTPUT_MAX_CHARS = 2_000;
function trimToolOutputsForCompaction(messages: UnifiedMessage[]): UnifiedMessage[] {
  // 复用 tool-output-truncator.ts 里的 stringifyAndTruncate 逻辑
}
```

复用 `services/agent-gateway/src/tool-output-truncator.ts` 已有的 `stringifyToolResultOutput`，但参数 `maxChars=TOOL_OUTPUT_MAX_CHARS`。

### S4: 关键工具不剪枝

`compaction-policy.ts` 剪枝白名单：

```ts
const PRUNE_PROTECTED_TOOLS = ['skill', 'read_skill'] as const;
```

确保 SKILL.md 注入对应的 tool result 在剪枝阶段保留（compaction LLM 看到、retained tail 也看得到）。

### S5: summary / tail 顺序

落到 `compaction-marker.ts` / `session-message-store.ts`：

- 写入摘要 message 时设定 `seq` 严格小于 retained tail 中最早 message 的 `seq`，或在加载阶段保证排序 key `[isCompactionSummary desc, seq asc]`。
- `buildPreparedUpstreamConversation` 加 invariant 校验：summary 必出现在所有 retained tail message 之前，违例直接 throw 让 CI 抓住。

## Complexity Assessment

- 原子步骤：5 → +2
- 并行流：S1/S3/S4/S5 可独立 → +2
- 模块：`compaction-llm`、`compaction-policy`、`compaction-marker`、`session-message-store`、`tool-output-truncator` → +1
- 单步 >5 min：是（S2/S5 需要小心 replay invariant）→ +1
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：7 → Full orchestration**
- **Routing rationale**：跨 5 个文件、含状态机 invariant，必须单独 workflow 维护

## Implementation Plan

### 现状盘点 — 大量 S3/S4/S5 已存在
盘点 `compaction-llm.ts` / `compaction-policy.ts` / `compaction-marker.ts` / `session-compaction.ts` / `session-message-store.ts` / `tool-output-truncator.ts`，**关键发现**：本工作流原计划的多项功能已经在仓库里实现到位，**真正缺的只有 S1+S2（锚点摘要更新 prompt）**。

| 工作流条目 | 实际状态 |
|---|---|
| S3 工具输出二次截断 | ✅ 已存在：`tool-output-truncator.ts` 各档位 + `pruneToolResultsByTokenBudget` 在 `buildPreparedUpstreamConversation` 中应用 |
| S4 关键工具不剪枝 | ✅ 已存在：`session-message-store.ts:302` `PRUNE_PROTECTED_TOOLS = new Set(['skill'])` |
| S5 summary/tail 顺序 | ✅ 已结构化保证：`session-message-store.ts:451-455` 在 fallback 路径用 `unshift` 把 summary 强制放到 normalized messages 最前；`tailStartMessageId` 已存在于 `compaction-marker.ts` |

### Phase 1: 锚点更新 prompt（S1+S2）✅
- [x] T-COMPACT-01: 新建 `services/agent-gateway/src/compaction-prompt.ts`
  - 导出 `COMPACTION_SYSTEM_PROMPT`（锚点风格中文系统提示，告诉模型识别 `<previous-summary>` 块）
  - 导出 `buildCompactionUserPrompt({ previousSummary? })`：
    - 无 anchor → "创建一份新的锚点摘要"
    - 有 anchor → 包裹 `<previous-summary>…</previous-summary>` + "保留仍然成立的细节、删除已过期的、合并新事实"
    - 始终追加结构化输出模板（10 节，所有节必出）
- [x] T-COMPACT-02: `compaction-llm.ts` 替换写死的旧模板为 `compaction-prompt.ts` 导出物
  - 新增 `previousSummary?: string` 参数到 `CompactionLlmInput`
  - PTL retry 路径自动继承 `previousSummary`（通过 `{...input, conversationMessages: trimmed}`）

### Phase 2: 调用点接入 ✅
- [x] T-COMPACT-03/04: `services/agent-gateway/src/session-compaction.ts`
  - 调 `readLastCompactionLlmSummary(input.metadataJson)` 拿到上一轮摘要
  - 透传给 `callCompactionLlm`

### Phase 3: 已存在能力（无需改动）
- [x] T-COMPACT-05/06: summary 在 retained tail 之前 — 由 `buildPreparedUpstreamConversation` 的 unshift 结构化保证
- [x] T-COMPACT-07: `PRUNE_PROTECTED_TOOLS` 早已含 `skill`

### Phase 4: 验收 ✅
- [x] T-COMPACT-V-01: typecheck + 全量 vitest 353/353 通过（新增 8 项）
- [ ] T-COMPACT-V-02: 多轮压缩 e2e（mock 上游，触发 3 轮压缩，验证摘要稳定）— 推迟到回归套件升级时一并做
- [ ] T-COMPACT-V-03: 手工触发含 thinking 的真实长会话压缩，肉眼对比锚点更新效果（待用户后续触发）

## Verification Commands

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/compaction-prompt.test.ts
# 全量回归（实测 353/353 通过）：
pnpm --filter @openAwork/agent-gateway exec vitest run
```

## 实测结果（2026-05-09）

- typecheck: ✅
- `compaction-prompt.test.ts` 8/8 通过（5-tier prompt assembly cases）
- agent-gateway 全量 45 文件 / 353 测试 全过（之前 345，新增 8）

## Risks & Rollback

- **锚点污染**：若 previousSummary 自身被注入恶意内容，可能影响后续 compaction。Mitigation: anchor block 之外仍要求 LLM 严格按模板输出；输出后做一次 markdown sanity check（必有的节都在）。
- **顺序 invariant 触发误报**：上线前先在 dev 跑 30 个真实会话回放，确认 invariant 不打老 session 的脸；必要时通过 `OPENAWORK_COMPACTION_INVARIANT=warn` 改为告警而非 throw。
- **PRUNE_PROTECTED_TOOLS 扩大** 不会让上下文增长太多（skill 调用相对小），但仍需统计验证。

## Notes

- 中文模板与 opencode 英文模板等价；保持中文以匹配 OpenAWork 默认中文场景。
- 完成后写一条 ADR：`compaction 改为锚点更新模式，summary 必须在 retained tail 之前`。
