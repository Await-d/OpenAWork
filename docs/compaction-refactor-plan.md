# OpenAWork 压缩系统改造方案

> 目标：对齐 Claude Code 的 4 层渐进式压缩体系，同时保留 OpenAWork 的多 Provider 兼容性和服务端架构优势。

## 实施状态

| Layer | 模块 | 状态 |
|-------|------|------|
| Layer 0 | Microcompact (`microcompact.ts`) | ✅ 已实现并集成 |
| Layer 1 | Session Memory Compact (`session-memory-compact.ts`) | ✅ 已实现并集成到 overflow 路径 |
| Layer 1 | Session Memory Store (`session-memory-store.ts`) | ✅ 已实现 |
| Layer 1 | Session Memory Extractor (`session-memory-extractor.ts`) | ✅ 已实现并集成到 stream 结束流程 |
| Layer 2 | Full Compact Prompt 升级 (`compaction-prompt.ts`) | ✅ 已升级为 9 章节 + analysis |
| Layer 2 | Tail Budget 增大 (`compaction-tail-budget.ts`) | ✅ 10K-40K |
| Layer 2 | Analysis 剥离 (`compaction-llm.ts`) | ✅ 已集成 stripAnalysisBlock |
| Layer 3 | Reactive Compact (`reactive-compact.ts`) | ✅ 已实现 |
| Layer 3 | Message Grouping (`message-grouping.ts`) | ✅ 已实现 |
| Layer 3 | 集成到 Overflow 触发器 | ✅ 已集成 |

---

## 一、改造总览

### 当前状态（2 层）

```
[Proactive Compaction] → [Overflow Compaction (Phase 2 truncation + Phase 3 LLM)]
```

### 目标状态（4 层）

```
Layer 0: Microcompact（每轮 API 调用前，清除旧 tool 输出）
Layer 1: Session Memory（后台持续提取，压缩时零 LLM 调用）
Layer 2: Full Compaction（LLM 摘要，对齐 Claude Code 的 9 章节 prompt）
Layer 3: Reactive Compaction（PTL 错误后逐组丢弃重试）
```

---

## 二、Layer 0 — Microcompact（微压缩）

### 2.1 设计目标

在每轮 API 调用前，自动清除旧的 tool_result 内容，延迟 Full Compaction 的触发时机。零 LLM 调用，纯本地操作。

### 2.2 实现方式

参照 Claude Code 的 `microCompact.ts`，在 `stream-model-round.ts` 的 `runModelRound()` 中，`toModelMessages()` 之后、发送 upstream 之前插入微压缩步骤。

**两种触发模式：**

1. **Count-based（计数触发）**：当可压缩的 tool_result 数量超过阈值（默认 20），清除最早的，保留最近 N 个（默认 8）
2. **Time-based（时间触发）**：当距离上次 assistant 消息超过阈值（默认 30 分钟，表示 cache 已冷），清除所有旧 tool_result，保留最近 N 个

**可压缩的工具列表（对齐 Claude Code）：**
- file_read / file_write / file_edit
- bash / shell
- grep / glob
- web_search / web_fetch

**不压缩的工具：**
- skill（技能内容需要跨压缩保留）

### 2.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `services/agent-gateway/src/compaction/microcompact.ts` | 新建 | 微压缩核心逻辑 |
| `services/agent-gateway/src/compaction/microcompact-config.ts` | 新建 | 配置（阈值、保留数量、可压缩工具列表） |
| `services/agent-gateway/src/routes/stream-model-round.ts` | 修改 | 在 `toModelMessages()` 后插入微压缩调用 |
| `services/agent-gateway/src/session/session-message-store.ts` | 修改 | 将现有 `pruneToolResultsByTokenBudget` 整合为微压缩的一部分 |

### 2.4 核心接口

```typescript
// compaction/microcompact.ts

export interface MicrocompactConfig {
  /** 触发阈值：可压缩 tool_result 数量超过此值时触发 */
  triggerThreshold: number;       // default: 20
  /** 保留最近 N 个 tool_result */
  keepRecent: number;             // default: 8
  /** 时间触发阈值（分钟）：距上次 assistant 消息超过此值时触发 */
  timeGapThresholdMinutes: number; // default: 30
  /** 可压缩的工具名称集合 */
  compactableTools: Set<string>;
  /** 受保护的工具名称集合（永不压缩） */
  protectedTools: Set<string>;
}

export interface MicrocompactResult {
  /** 是否执行了压缩 */
  applied: boolean;
  /** 清除的 tool_result 数量 */
  clearedCount: number;
  /** 估算节省的 token 数 */
  tokensSaved: number;
  /** 触发原因 */
  trigger: 'count' | 'time' | 'none';
}

/**
 * 对 UnifiedMessage[] 执行微压缩。
 * 在发送给 upstream 之前调用，不修改 DB 数据。
 */
export function microcompactMessages(
  messages: UnifiedMessage[],
  config?: Partial<MicrocompactConfig>,
  context?: { lastAssistantTimestamp?: number },
): MicrocompactResult & { messages: UnifiedMessage[] };
```

### 2.5 与现有代码的关系

- **替代** `microcompactByAge()`（已标记 deprecated）
- **整合** `pruneToolResultsByTokenBudget()` 的逻辑（作为 count-based 模式的实现基础）
- **不影响** `aggressiveTruncateToolOutputs()`（那是 overflow 恢复路径，保留）

---

## 三、Layer 1 — Session Memory（会话记忆）

### 3.1 设计目标

后台持续提取会话关键信息到结构化存储，压缩时直接使用已有的 session memory 作为摘要，避免额外 LLM 调用。

### 3.2 实现方式

参照 Claude Code 的 `SessionMemory/sessionMemory.ts`：

1. **后台提取**：在每轮 stream 结束后（`autoExtractMemoriesForRequest` 已有入口），使用子 Agent 提取会话记忆
2. **提取触发条件**：
   - 初始化阈值：context token 达到 30K 时首次提取
   - 更新阈值：距上次提取增长 15K token AND 工具调用数 ≥ 5
3. **存储格式**：Markdown 模板，包含目标、进度、关键决策、文件引用等
4. **压缩时使用**：当 session memory 存在且非空时，优先使用它作为摘要（跳过 LLM 调用）

### 3.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `services/agent-gateway/src/compaction/session-memory-compact.ts` | 新建 | Session Memory 压缩路径 |
| `services/agent-gateway/src/compaction/session-memory-extractor.ts` | 新建 | 后台提取逻辑 |
| `services/agent-gateway/src/compaction/session-memory-template.ts` | 新建 | 提取 prompt 和模板 |
| `services/agent-gateway/src/compaction/session-memory-config.ts` | 新建 | 配置（阈值、模板） |
| `services/agent-gateway/src/compaction/auto-compaction-trigger.ts` | 修改 | 在 Full Compact 前尝试 Session Memory Compact |
| `services/agent-gateway/src/memory/memory-runtime.ts` | 修改 | 整合 session memory 提取到现有 memory 系统 |

### 3.4 核心接口

```typescript
// compaction/session-memory-compact.ts

export interface SessionMemoryCompactConfig {
  /** 压缩后保留的最小 token 数 */
  minPreserveTokens: number;      // default: 10_000
  /** 压缩后保留的最小文本消息数 */
  minTextBlockMessages: number;   // default: 5
  /** 压缩后保留的最大 token 数 */
  maxPreserveTokens: number;      // default: 40_000
}

export interface SessionMemoryCompactResult {
  success: boolean;
  /** 压缩后的摘要内容 */
  summary: string;
  /** 保留的原始消息 */
  messagesToKeep: Message[];
  /** 压缩前 token 估算 */
  preCompactTokenEstimate: number;
  /** 压缩后 token 估算 */
  postCompactTokenEstimate: number;
}

/**
 * 尝试使用 Session Memory 进行压缩。
 * 如果 session memory 不存在或为空，返回 null（回退到 Full Compact）。
 */
export async function trySessionMemoryCompaction(input: {
  sessionId: string;
  userId: string;
  messages: Message[];
  metadataJson: string;
  autoCompactThreshold?: number;
}): Promise<SessionMemoryCompactResult | null>;
```

### 3.5 提取 Prompt 模板

```typescript
// compaction/session-memory-template.ts

export const SESSION_MEMORY_TEMPLATE = `# Session Memory

## 用户目标
- (待提取)

## 关键决策
- (待提取)

## 当前进度
### 已完成
- (待提取)

### 进行中
- (待提取)

## 重要文件
- (待提取)

## 错误与修复
- (待提取)

## 用户偏好与约束
- (待提取)
`;

export const SESSION_MEMORY_UPDATE_PROMPT = `你是一个会话记忆提取助手。根据最近的对话内容，更新下面的会话记忆文件。

规则：
1. 保留仍然有效的信息，删除已过期的
2. 合并新的事实和进展
3. 精确保留文件路径、命令、错误信息
4. 使用简短要点，不写段落
5. 只更新有变化的部分

当前会话记忆：
<current-memory>
{currentMemory}
</current-memory>

请根据最近的对话更新会话记忆，输出完整的更新后内容。`;
```

### 3.6 与现有 Memory 系统的关系

- 现有 `memory-runtime.ts` 中的 `autoExtractMemoriesForRequest()` 已经在 stream 结束时被调用
- Session Memory 提取可以作为该函数的扩展，或独立运行
- 两者的区别：现有 memory 是跨会话的持久化记忆，Session Memory 是单会话内的压缩辅助

---

## 四、Layer 2 — Full Compaction 改进

### 4.1 设计目标

对齐 Claude Code 的 Full Compact prompt 质量，增加信息保留密度，同时保留 OpenAWork 的锚点更新优势。

### 4.2 改进点

#### 4.2.1 Prompt 升级

将现有的 7 章节 prompt 升级为 Claude Code 风格的 9 章节 + analysis 草稿：

```
<analysis>（草稿，最终剥离）</analysis>
<summary>
1. 主要请求与意图
2. 关键技术概念
3. 文件与代码片段（保留完整代码）
4. 错误与修复（含用户反馈）
5. 问题解决过程
6. 所有用户消息（非工具结果的用户消息原文）
7. 待办任务
8. 当前工作（精确描述，含文件名和代码片段）
9. 下一步（含直接引用）
</summary>
```

#### 4.2.2 保留锚点更新模式

当 `previousSummary` 存在时，仍然使用锚点更新（OpenAWork 的优势），但升级 prompt 格式。

#### 4.2.3 增大尾部保留预算

```typescript
// compaction-tail-budget.ts 修改
export const MIN_PRESERVE_RECENT_TOKENS = 10_000;  // 从 2K → 10K
export const MAX_PRESERVE_RECENT_TOKENS = 40_000;  // 从 8K → 40K
```

#### 4.2.4 增加 maxTurns

```typescript
// 从默认 2 → 默认 4
const limit = input.maxTurns ?? 4;
```

#### 4.2.5 压缩后重新注入文件内容

参照 Claude Code 的 `createPostCompactFileAttachments()`，在压缩完成后重新注入最近读取的文件内容（最多 5 个文件，每个最多 5K token）。

#### 4.2.6 PTL 重试改进

参照 Claude Code 的 `truncateHeadForPTLRetry()`，当压缩 LLM 本身遇到 PTL 错误时，按 API round 分组从头部丢弃，而不是简单的 50% 裁剪。

### 4.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `services/agent-gateway/src/compaction/compaction-prompt.ts` | 重写 | 升级为 9 章节 + analysis 格式 |
| `services/agent-gateway/src/compaction/compaction-tail-budget.ts` | 修改 | 增大保留预算 |
| `services/agent-gateway/src/compaction/compaction-llm.ts` | 修改 | PTL 重试改为按组丢弃 |
| `services/agent-gateway/src/compaction/post-compact-attachments.ts` | 新建 | 压缩后文件重新注入 |
| `services/agent-gateway/src/session/session-compaction.ts` | 修改 | 整合 Session Memory 优先路径 |

---

## 五、Layer 3 — Reactive Compaction 改进

### 5.1 设计目标

当 API 返回 prompt-too-long 错误时，不再仅依赖 Phase 2 truncation + Phase 3 full compact，而是增加一个更快的"逐组丢弃"恢复路径。

### 5.2 实现方式

参照 Claude Code 的 reactive compact 逻辑：

1. 解析 PTL 错误中的 token gap（`actualTokens - limitTokens`）
2. 按 API round 分组消息（`groupMessagesByApiRound`）
3. 从头部逐组丢弃，直到覆盖 token gap
4. 如果 gap 不可解析，丢弃 20% 的组
5. 保留至少 1 组用于摘要

### 5.3 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `services/agent-gateway/src/compaction/reactive-compact.ts` | 新建 | 逐组丢弃逻辑 |
| `services/agent-gateway/src/compaction/message-grouping.ts` | 新建 | 按 API round 分组 |
| `services/agent-gateway/src/compaction/auto-compaction-trigger.ts` | 修改 | 在 overflow 路径中先尝试 reactive compact |

### 5.4 核心接口

```typescript
// compaction/reactive-compact.ts

export interface ReactiveCompactResult {
  /** 是否成功恢复 */
  recovered: boolean;
  /** 丢弃的消息数 */
  droppedMessages: number;
  /** 丢弃的组数 */
  droppedGroups: number;
  /** 剩余消息 */
  remainingMessages: Message[];
}

/**
 * 从头部逐组丢弃消息直到覆盖 token gap。
 * 比 Full Compact 更快（无 LLM 调用），但信息损失更大。
 * 作为 Full Compact 的前置快速恢复尝试。
 */
export function reactiveCompactByTokenGap(
  messages: Message[],
  tokenGap: number | undefined,
): ReactiveCompactResult | null;
```

---

## 六、Overflow 恢复流程重构

### 6.1 新的恢复优先级

```
Provider 返回 PTL/overflow 错误
  ↓
Step 1: 解析错误，发现实际 context window
  ↓
Step 2: 尝试 Reactive Compact（逐组丢弃，无 LLM）
  ↓ 如果不够
Step 3: 尝试 Session Memory Compact（用已有摘要，无 LLM）
  ↓ 如果不可用
Step 4: Phase 2 Aggressive Truncation（截断大型 tool 输出）
  ↓ 如果不够
Step 5: Full Compact with LLM（完整 LLM 摘要）
```

### 6.2 对 `triggerOverflowCompaction` 的修改

```typescript
export async function triggerOverflowCompaction(input): Promise<OverflowCompactionResult> {
  // Step 1: Parse error (existing)
  // Step 2: Reactive compact (NEW)
  const reactiveResult = reactiveCompactByTokenGap(allMessages, discoveredLimit?.tokenGap);
  if (reactiveResult?.recovered) {
    return { triggered: true, recovered: true, ... };
  }
  
  // Step 3: Session Memory compact (NEW)
  const smResult = await trySessionMemoryCompaction({ ... });
  if (smResult) {
    return { triggered: true, recovered: true, ... };
  }
  
  // Step 4: Aggressive truncation (existing)
  // Step 5: Full compact (existing)
}
```

---

## 七、Proactive 触发阈值调整

### 7.1 当前问题

- 现有阈值：`usable - max(30K, usable * 25%)`，约 75% 触发
- Claude Code 阈值：`effectiveContextWindow - maxOutputTokens - 13K`，约 93% 触发

### 7.2 调整方案

由于 OpenAWork 现在有了微压缩层持续释放空间，proactive 阈值可以适当提高：

```typescript
// session-message-store.ts
export const PROACTIVE_COMPACTION_BUFFER_TOKENS = 15_000; // 从 30K → 15K

export function isContextNearOverflow(...): boolean {
  // 新公式：usable - 15K（约 90% 触发）
  // 微压缩已经在持续释放空间，proactive 不需要那么早触发
  const buffer = reserved ?? PROACTIVE_COMPACTION_BUFFER_TOKENS;
  return totalTokens >= usable - buffer;
}
```

---

## 八、实施顺序

### Phase 1（高优先，1-2 周）

1. **Layer 0: Microcompact** — 零成本，立即见效
   - 新建 `microcompact.ts` + `microcompact-config.ts`
   - 修改 `stream-model-round.ts` 插入调用点
   - 整合现有 `pruneToolResultsByTokenBudget`

2. **Layer 2: 尾部保留预算增大** — 改配置即可
   - 修改 `compaction-tail-budget.ts` 的常量
   - 增加 `maxTurns` 默认值

### Phase 2（中优先，2-3 周）

3. **Layer 2: Prompt 升级** — 提升摘要质量
   - 重写 `compaction-prompt.ts`
   - 添加 `<analysis>` 草稿剥离逻辑
   - 保留锚点更新模式

4. **Layer 3: Reactive Compact** — 快速恢复
   - 新建 `reactive-compact.ts` + `message-grouping.ts`
   - 修改 `auto-compaction-trigger.ts` 的 overflow 路径

### Phase 3（中优先，3-4 周）

5. **Layer 1: Session Memory** — 后台提取
   - 新建 session memory 相关文件
   - 整合到 `autoExtractMemoriesForRequest` 入口
   - 修改 compaction 路径优先使用 session memory

6. **压缩后文件重新注入**
   - 新建 `post-compact-attachments.ts`
   - 跟踪最近读取的文件，压缩后重新注入

### Phase 4（低优先，可选）

7. **Proactive 阈值调整** — 在 Layer 0 稳定后再调
8. **PTL 重试改进** — 按组丢弃替代 50% 裁剪
9. **Prompt Cache 优化** — 如果主要用 Anthropic，考虑 cache_edits

---

## 九、配置体系

所有新增配置通过 `compaction_policy_v1` 用户设置扩展：

```typescript
export const compactionSettingsSchema = z.object({
  auto: z.boolean().default(true),
  prune: z.boolean().default(true),
  recentMessagesKept: z.number().int().min(0).default(6),
  reserved: z.number().int().min(0).optional(),
  // ─── 新增 ───
  microcompact: z.object({
    enabled: z.boolean().default(true),
    triggerThreshold: z.number().int().min(1).default(20),
    keepRecent: z.number().int().min(1).default(8),
    timeGapThresholdMinutes: z.number().min(1).default(30),
  }).default({}),
  sessionMemory: z.object({
    enabled: z.boolean().default(true),
    minPreserveTokens: z.number().int().min(0).default(10_000),
    maxPreserveTokens: z.number().int().min(0).default(40_000),
  }).default({}),
  tailBudget: z.object({
    minTokens: z.number().int().min(0).default(10_000),
    maxTokens: z.number().int().min(0).default(40_000),
    maxTurns: z.number().int().min(1).default(4),
  }).default({}),
});
```

---

## 十、测试策略

### 单元测试

- `microcompact.ts`：count-based 和 time-based 触发、保护工具不被清除
- `session-memory-compact.ts`：空 memory 回退、token 预算计算、tool pair 保护
- `reactive-compact.ts`：token gap 解析、分组丢弃、边界条件
- `compaction-prompt.ts`：analysis 剥离、格式化

### 集成测试

- 完整 stream 循环中微压缩的触发和效果
- Session Memory 提取 → 压缩使用的端到端流程
- Overflow → Reactive → Session Memory → Full Compact 的降级链

### 性能基准

- 微压缩对每轮延迟的影响（目标 < 5ms）
- Session Memory 压缩 vs Full Compact 的延迟对比
- 不同 context window 大小下的压缩触发频率

---

## 十一、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 微压缩过于激进导致模型丢失上下文 | `keepRecent` 默认 8，且保护关键工具 |
| Session Memory 提取质量不稳定 | 回退到 Full Compact；提取失败不阻塞主流程 |
| 尾部保留增大导致压缩后仍超限 | `maxPreserveTokens` 硬上限 + autoCompactThreshold 检查 |
| Reactive Compact 丢弃过多信息 | 只作为快速恢复，后续仍可触发 Full Compact |
| 多层压缩交互导致状态不一致 | 统一通过 `metadataJson` 追踪压缩状态 |
