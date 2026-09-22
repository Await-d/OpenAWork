# 附录 A：唤醒原语（T-19b）设计方案 —— 供评审

> 归属：`.agentdocs/workflow/done/260922-子代理对标opencode改造方案.md` 的 Phase 4 关键路径
> 状态：**已实施并验收**（T-19b-1…5 全部落地：`injectSyntheticSessionMessage` / `deliverTaskCompletion` /
> `continueSessionFromHistory` / 内部键注册 / 重启恢复扫描）；本文件保留为**设计依据与评审记录**。
> 前置事实由 R-18 给出；本文件只讨论「怎么做」。

---

## 1. 目标

让父会话在「子代理完成 → 通知已入库」之后**继续跑一轮**，且满足：

| # | 要求 | 理由 |
|---|---|---|
| G1 | **不新增用户轮** | 通知不是用户输入；现状靠 `task-auto-resume` 伪造用户请求，语义错误 |
| G2 | 模型能看到通知 | 对齐上游：synthetic 对模型可见（下发时降级为 `user`） |
| G3 | 幂等 | 重试/重启不得重复投递或重复唤醒 |
| G4 | 忙时不丢不轰炸 | 对齐上游：无 800/1500ms 重试风暴 |
| G5 | 不破坏 team resume | `teamResumeRootSessionId` 路径是既有高价值链路 |

---

## 2. 现状事实（已核实，带证据）

| 事实 | 证据 |
|---|---|
| 非 team-resume 路径**无条件持久化用户轮** | `routes/stream.ts:2467` `persistStreamUserMessage(...)` |
| 请求 schema 的 `message` **必填** | `routes/stream.ts:571` `message: z.string().max(32768)` |
| 存在「只进模型请求、不落库」的现成机制 | `routes/stream-model-round.ts:1300-1302`：`syntheticContinuationPrompt` 被作为 `{ role:'user', content }` **仅追加到模型请求** |
| 该机制已在用（同类问题） | todo 续跑 `stream.ts:2971`、ralph loop `:3015`、会话恢复 `:3066`、溢出续写 `:2947-2948` |
| 单飞判定在内存表 | `routes/stream-cancellation.ts:108` `getAnyInFlightStreamRequestForSession` |
| 会话三态 | `routes/stream.ts:225` `idle \| running \| paused` |
| 通知已可幂等入库 | T-18 `injectSyntheticSessionMessage`（`messageId = notificationId`） |

**结论**：缺的不是「让模型看到通知」（T-18 已解决，通知在历史里且 `toModelMessages` 会降级为 `user`），
缺的是**「不加用户轮就触发一轮」的入口**。

---

## 3. 候选方案

### 方案 A（推荐）：`handleStreamRequest` 新增 continue-from-history 模式

- 新增请求标记（如 `requestData.continueFromHistory: true`），在该模式下：
  1. **跳过** `persistStreamUserMessage`；
  2. `message` 允许为空——各检测器/标题/插件通知按「无用户可见消息」分支处理；
  3. 其余流程不变：直接从 DB 投影的历史构建模型请求。
- **为什么不需要 continuation prompt**：通知已在历史末尾且对模型表现为 `user` 轮，
  模型自然会作答；再追加 continuation prompt 反而会多一轮冗余输入。
- 幂等：`clientRequestId = notificationId`，复用既有「已完成请求的 replay」语义。
- 忙：在飞请求存在 → 直接返回 `deferred`，**不注册定时重试**（G4）。

### 方案 B：只用 `syntheticContinuationPrompt` 承载通知，不落库

- 落库问题绕开了，但**通知不进历史**：用户看不到通知卡片、下一次自然轮次也看不到。
- 且仍需「跳过 `persistStreamUserMessage`」这一同样的改动 → **收益为负**。否决。

### 方案 C：维持现状（伪造用户请求）

- 会同时产生 synthetic 通知 + 用户轮 → **双重投递**，比现状更差。否决（已记录）。

---

## 4. 推荐方案的影响面与回归清单

### 4.1 必改点

| 位置 | 改动 |
|---|---|
| `routes/stream.ts:571` | `message` 改为可选（或在 continue-from-history 模式下不校验） |
| `routes/stream.ts:2467` | 该模式下跳过 `persistStreamUserMessage` |
| `routes/stream.ts:2116-2118` | `userVisibleMessage` 在无消息时取空串，并跳过插件 `chat.message` 通知（`:2192`） |
| `routes/stream.ts:2112` | 唤醒请求**不得**视为「用户手动交互」（不得重置连续回流计数），比照现有 `task-auto-resume:` 的处理 |
| 检测器 `:2230 / :2243 / :2248 / :2466` | 空消息时短路（不得把空串当关键词命中） |
| 会话标题 `session/stream-session-title.ts` | 唤醒请求不得触发 LLM 自动标题 |
| `handoff/store/handoff-store.ts` | 新增内部键形状（`task-job:`），见 T-21 |

### 4.2 必须保持全绿的既有资产

- `verify-task-tool-auto-run.ts`、`verify-task-tool-no-permission.ts`、`verify-task-parent-auto-resume.ts`
- `verify-team-turn-rollback-internal-keys.ts`
- `verify-stream-attach-recovery.ts`、`verify-stream-runtime-durable-continuity.ts`
- `verify-session-single-flight.ts`（忙时行为）
- team resume 相关（`teamResumeRootSessionId`）全部验收

### 4.3 新增验收

| 脚本 | 断言 |
|---|---|
| `verify-task-job-wake.ts` | 唤醒后**父会话消息数不变**（无新用户轮）且产生 assistant 响应；通知在模型请求中可见 |
| 同上 | 忙时返回 `deferred` 且**不注册定时器**；空闲后重试成功 |
| 同上 | 同一 `notificationId` 重复唤醒**只跑一轮**（幂等） |
| 同上 | 进程重启后未投递通知可被补偿唤醒（配合 T-26） |

---

## 5. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `handleStreamRequest` 是网关最热函数，改动面广 | 🔴 | 独立实施窗口；先补 4.3 的验收再动刀；分两个提交（先加模式、再切换调用方） |
| `message` 可选引发的下游空值处理遗漏 | 🟠 | 「静默失效」是本任务反复出现的问题类型 → 用**编译期穷尽 + 显式分支**约束；空消息分支必须显式 |
| 唤醒与用户手动发消息并发 | 🟠 | 复用既有单飞；唤醒在飞时 `deferred`，由用户轮的回合边界自然消费（通知已在历史里） |
| 唤醒后会话永不空闲（长任务） | 🟡 | 通知已落库 → 下一次自然轮次模型仍能看到，不丢 |
| team resume 回归 | 🔴 | `teamResumeRootSessionId` 路径**不改**；列为发布门禁 |

---

## 6. 未决问题（评审时请一并定）

| # | 问题 | 备选 |
|---|---|---|
| Q1 | 入口形态：`requestData.continueFromHistory` 标记 vs 独立函数（如 `continueSessionFromHistory()`） | 标记改动小；独立函数边界更清晰 |
| Q2 | `message` 是「全局可选」还是「仅该模式可省」 | 建议后者（收窄影响面） |
| Q3 | 唤醒是否需要 continuation prompt 兜底（当历史末尾不是用户可见消息时） | 建议加，但仅在末尾非 user 时 |
| Q4 | 是否需要「连续唤醒上限」（现状是 10） | 对齐上游则不需要；但本仓曾有自激问题 |
| Q5 | T-26 的恢复扫描是否同期实施 | 建议同期，否则重启窗口内的通知只能等用户下一轮 |

---

## 7. 建议的实施顺序（若评审通过）

1. **T-19b-1**：新增 continue-from-history 模式（不动任何调用方）→ typecheck + 4.3 的验收脚本先写好
2. **T-19b-2**：`deliverTaskCompletion`（T-20）接入该模式 + `resume` 布尔
3. **T-19b-3**：`task-job:` 内部键注册（T-21）+ 单通道验收（T-24）
4. **T-19b-4**：重启恢复扫描（T-26）
5. **T-19b-5**：移除旧 `scheduleDrain` / `task-reminder` 路径（T-22 → 现编号 T-27）

> 每一步独立可回滚；第 5 步之前旧路径保持可用（双轨）。
