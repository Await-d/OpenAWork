# 260922-子代理对标 opencode 改造方案

## Task Overview

将 OpenAWork 的「子代理（task tool）结果回流」机制对标 `temp/opencode-v2.0.12`（tag `v2.0.12`）的
`subagent` 实现，把当前**五套并行通道**收敛为 opencode 式的**单一闭环**：

> Job 注册表 → 合成消息注入父会话 → 显式唤醒（resume）

**范围**：`task` 工具的结果交付、生命周期、持久化与恢复；**含为合成消息引入 `synthetic` role**。
**不在范围**：子代理的模型选择策略（`subagent-model-policy.ts` 业务语义）、team 层 `TeamMember` 编排、
子代理权限体系本身（仅沿用）、结果文本抽取丰富度（保留本仓优势）、`.NET` 网关镜像（已废弃，见 D-5）。

**基线**：`temp/opencode-v2.0.12`，核心文件 `packages/core/src/tool/plugin/subagent.ts`、
`packages/core/src/job.ts`、`packages/core/src/session/subagent-job.ts`、
`packages/core/src/session/subagent-completion.ts`、`packages/core/src/session/execution/restart.ts`。

**附录**：
- [附录 A：唤醒原语（T-19b）设计方案](260922-子代理对标opencode改造方案-附录A-唤醒原语设计.md) —— 供评审；Phase 4 关键路径

---

## Complexity Assessment

| 信号 | 判定 | 计分 |
|---|---|---|
| 原子步骤数 | 28 个 T-XX（≥5） | +2 |
| 多路可并行改造流 | Job 层 / synthetic role / 单通道交付 / 深度限制 | +2 |
| 涉及模块数 | agent-core、agent-gateway、message-v2、shared、web-client、shared-ui、apps/web、apps/mobile（≥3） | +1 |
| 单步 >5 分钟 | synthetic role 全链路 + 跨重启恢复 | +1 |
| 产物需落盘评审 | 是（含详细复查） | +1 |
| OpenCode 可用 | 是 | −1 |
| **合计** | | **+6** |

**选定模式**：Full orchestration
**路由理由**：D-1 决策（新增 role）把改动面从「网关内部」扩大到「shared 类型 + 模型上下文构建 + 前端白名单 +
移动端渲染」**四层八处**，且经审计确认**全链路零编译期保护、至少 7 处静默失效点**；失败表现是
「模型看不到子代理结果」或「前端把它渲染成 assistant 气泡」这类无报错的错误结果。
必须落 runtime 计划、分五阶段施工、并在每阶段用可观测断言验收。

---

## Current Analysis

### A. opencode 的机制（基线事实）

**1. 单一 Job 抽象**（`packages/core/src/job.ts:128-138`）

```ts
interface Interface {
  get / start / wait / block / background / backgroundAll / cancel
  pendingBackground: Effect<readonly Background[]>       // 重启恢复入口
  completeBackground: (notificationID) => Effect<void>   // 幂等清理
}
```

- Job 状态：`running | completed | error | cancelled`（`job.ts:28`）。
- `recovery` 区分 `shell` / `subagent`（`job.ts:13-27`）；subagent 记录
  `parentSessionID / childSessionID / agent / description`。
- 可恢复后台任务写入 KV `job.background/<notificationID>`（`job.ts:38,199-209`）；
  非可恢复结果进入 25 条消费历史（`COMPLETED_LIMIT = 25`，`job.ts:39`）。

**2. 工具执行与前台 / 后台分叉**（`tool/plugin/subagent.ts:100-269`）

- 工具名 `subagent`；输入 `agent/description/prompt/model?/sessionID?/background?`（`:29-48`）。
- depth 限制：沿 `parentID` 链累加，超 `experimental.subagent_depth`（默认 1）即
  `ToolFailure`（`:117-133`）。
- `agent.mode === "primary"` 不可作子代理（`:136-137`）。
- 前台：`jobs.block({id: child.id, sessionID: context.sessionID})`（`:234`）；
  `backgrounded` → 转后台通知；`error`/`cancelled` → `ToolFailure` 但**保留 sessionID**（`:245-251`）。
- 后台：立即返回占位文案，明示「不要 sleep / poll / 重复工作」（`:19-27,229-232`）。
- **模型可见内容与机器输出的双通道**（`:257-266`）：
  `content = <subagent sessionID="..." state="completed">…</subagent>`，`metadata = {sessionID, status}`。

**3. 结果交付：合成消息 + 唤醒**（`session/subagent-completion.ts:20-45`）

```ts
sessions.synthetic({
  id: notificationID,                 // 幂等键 = 消息 ID
  sessionID: recovery.parentSessionID,
  text: `<subagent sessionID="…" state="…" description="…">\n${text}\n</subagent>`,
  metadata: { source: "subagent", childID, agent, state },
  ...(resume === false ? { resume: false } : {}),
})
jobs.completeBackground(notificationID)
```

- `synthetic` 的准入 + 唤醒语义（`session/session.ts:267-308`）：
  经 `admission.admit({id, sessionID, item})` 幂等入队（重复 ID 冲突即 `SyntheticConflictError`），
  然后 `if (resume !== false && !revert) execution.wake(sessionID)`（`:304`）。
- 结果文本只取**最后一条成功 assistant 消息的 text**，空则 `NO_TEXT`（`subagent-completion.ts:8-18`）。
- 观察者按 `childSessionID:startedAt` 去重，每个 job generation 只观察一次
  （`session/subagent-job.ts:20-34`）。

**4. 重启恢复**（`session/execution/restart.ts:137-179`）

- 校验 child 仍属于 parent 且 parent 仍存在，否则 `completeBackground` 丢弃。
- `status !== "running"` → 直接投递；否则若 child 仍在执行则跳过，
  否则 `execution.resume(childID)` 续跑并在完成后投递。
- 父会话若处于挂起态，投递时传 `resume: false`（只入队不唤醒，`:153`）。

### B. 本仓现状（审计事实，含 file:line）

**当前是五套并行通道**：

| # | 通道 | 载体 | 幂等键 |
|---|---|---|---|
| 1 | 工具返回值（前台） | `<task_result>` 文本 `tools/delegated-task-display.ts:60-81` | — |
| 2 | run event | `task_update` `tools/tool-sandbox.ts:4886-4920` | `eventId = parent:task:status` |
| 3 | assistant 提醒消息 | `role:'assistant'` 的 `assistant_event` JSON `tools/tool-sandbox.ts:1065-1103` | `task-reminder:<taskId>:<status>:<updatedAt>` |
| 4 | 自动回流请求 | 新流请求 + `requestData.message` `task/task-parent-auto-resume.ts:173-226` | `task-auto-resume:<parent>:<uuid>` |
| 5 | 任务图持久化 | JSON 文件 `packages/agent-core/src/task-system/store.ts:15` + `task_parent_auto_resume_contexts` 表（`infra/db.ts:797-806`） | `child_session_id` PK |

**关键差异点（逐条）**：

- **无合成消息原语**：`MessageRole = user|assistant|tool|system`（`packages/shared/src/message-schema.ts:1`），
  没有 synthetic role；`synthetic` 目前只是 part 级布尔（`message-schema.ts:19`）。
  `appendSessionMessageV2`（`message/message-v2-adapter.ts:509`）**只写库 + 发事件，不触发模型运行**。
- **无唤醒原语**：无 `wakeSession`/`resumeSession`。唯一的自动续跑是
  `scheduleTaskParentAutoResume` → `scheduleDrain` → `runSessionInBackground`
  （`task/task-parent-auto-resume.ts:160-226`），**必须伪造一条新用户请求**。
- **并发判定靠内存表**：`SESSION_ALREADY_RUNNING` 由
  `getAnyInFlightStreamRequestForSession`（`routes/stream-cancellation.ts:108`）判定，
  **不看 `state_status`**；`task-parent-auto-resume.ts:136` 是唯一同时看两者之处。
- **状态机只有三态**：`idle|running|paused`（`routes/stream.ts:225`），
  无法表达 opencode 的「已入队但未唤醒」。
- **无子代理深度硬上限**：`executorType` 仅作标记（`packages/agent-core/src/task-system/types.ts:162`），
  嵌套深度无约束。
- **本仓独有且更强**：`empty-task-response-detector.ts`（空响应警告）、
  连续回流上限 10（`task-parent-auto-resume.ts:7`）、结果拼装含工具结果
  （`delegated-task-display.ts:257-276`）、`task-parent-auto-decision.ts`（子代理中途替它决策）。

### C. 回流前缀消费面（改动爆炸半径）

| 文件 | 前缀 | 用途 |
|---|---|---|
| `tools/tool-sandbox.ts:1062` | `task-reminder:` | 生产 |
| `task/task-result-extraction.ts:59` | `task-reminder:` | 过滤内部事件，跳过摘要提取 |
| `session/session-message-store.ts:156` | `task-reminder:` | 排除出模型上下文 |
| `task/task-parent-auto-resume.ts:8,130,229` | `task-auto-resume:` | 生产 + 判定 |
| `routes/stream.ts:2113` | `task-auto-resume:` | 命中则不重置连续回流计数 |
| `session/stream-session-title.ts:195` | `task-auto-resume:` | 命中则跳过 LLM 自动标题 |
| `task/task-parent-auto-decision.ts:16,231` | `task-parent-decision:` | 生产（本次保留，不合并） |
| `handoff/store/handoff-store.ts:365,424-435,481-507` | 三者 | **内部键唯一事实来源**（`isGatewayInternalRequestKey`） |
| `verification/verify-team-turn-rollback-internal-keys.ts:93-136` | 三者 | 守卫测试：源码扫描前缀必须已登记 |

**前端（apps/web / shared-ui / web-client）完全不引用这三个前缀**——
前端靠 JSON 内容判定（`type:'assistant_event'` + `payload.kind`）。
但**新增 role 会进入前端渲染白名单**，爆炸半径见 §D。

### D. D-1 决策后新增的爆炸半径：`synthetic` role 全链路

> 由 exhaustive 审计得出（覆盖 shared / web-client / agent-core / shared-ui / gateway / web / mobile / docs）。
> **核心事实：新增 role 不会触发任何编译错误；全链路至少 7 处静默失效点。**

| 层 | 位置 | 行为 | 判定 |
|---|---|---|---|
| 类型 | `packages/shared/src/message-schema.ts:1` | `MessageRole` 权威定义 | **必须改** |
| 类型 | `services/agent-gateway/src/message/message-v2-schema.ts:224-329` | `MessageInfo` 判别联合（`User/Assistant/Tool/System`） | **必须改**（否则无合法落点） |
| 写入 | `message/message-v2-adapter.ts:571-591` | 4 分支 if/else，**末尾 `else → role:'system'`** | **必须改（静默改写）** |
| 清理 | `message/message-v2-adapter.ts:1635-1651` + `routes/stream.ts:1175` | 请求作用域删除/回滚 `roles: ['assistant','tool']` | **必须改（否则孤儿行）** |
| 模型上下文 | `message/message-to-model-messages.ts:456-587` | `if user / if assistant / if system`，**无 else、无 assertNever** | **必须改（否则静默丢弃 → 模型看不到）** |
| 模型上下文 | `session/session-message-store.ts:626-755` | 旧归一化链同样无 else | **必须改** |
| 契约 | `routes/commands.ts:91-96` | `z.enum(['user','assistant','tool','system'])` | **必须改（否则 400 拒绝）** |
| 前端 | `apps/web/.../messages/normalize-chat-messages.ts:66-67` | 白名单 `user/assistant/tool`，其余 `continue` | 需决策（丢弃=满足不可见，但需显式） |
| 前端 | `apps/web/.../messages/{transcript-visibility,group-render-entries,message-equivalence,streaming-message-merge}.ts` | 按 role 分支/二分 | 可能需改 |
| 前端 | `packages/shared-ui/src/chat/ChatMessage.tsx:20` + `apps/mobile/src/components/chat-message-bubble.tsx:44` | `isUser = role === 'user'` 二元判断，**非 user 即按 assistant 渲染** | **风险点** |

**唯一的编译期穷尽网**：`message/native-message-bridge.ts:143-146` 的
`const exhaustive: never = message`——但它约束的是 **`UnifiedMessage`**
（`message-to-model-messages.ts:117-118`），**不改这里就不会有编译错误**。

**同名独立类型（改 shared 不会同步，易误判覆盖）**：
`packages/agent-core/src/session/session-summarizer.ts:1`、
`packages/opencode-llm/src/types/message.ts:6`、`packages/opencode-llm/src/types/stream.ts:34`。

---

## 决策记录（2026-09-22，**上游对齐优先**）

> 授权：用户明确「大部分都需要跟 opencode 方式对齐，不用问，你自己做决策，理念是对齐上游最好，
> 前端渲染展示也要设计进去」。以下决策按**上游优先**原则定档，凡与上游存在差异的均给出取舍理由。

| 编号 | 议题 | **最终决策** | 上游依据 | 与上游的取舍 |
|---|---|---|---|---|
| D-1 | 合成消息形态 | ✅ **新增 `synthetic` role**（独立消息类型） | 上游 `SessionInbox.Synthetic`（`schema/session-inbox.ts`）+ `message.type === "synthetic"` | **完全对齐**：上游本就是独立 synthetic 类型，不用 user 冒充 |
| D-2 | wake 实现 | ✅ **拆分 `runSessionInBackground`** → `admit` / `wake` | `session/session.ts:269-304`（admission.admit → execution.wake） | 完全对齐 |
| D-3 | 工具名 | ✅ **canonical 改 `subagent`，保留 `task` 作为别名** | 上游工具名 `subagent`；且上游本身做过 `task → subagent` 迁移（`v1/config/migrate.ts:119`） | 对齐 + 兼容：既有 prompt / 验收脚本不破 |
| D-4 | 子代理深度 | ✅ 配置键 **`subagent_depth`，默认 `1`** | 上游 `experimental.subagent_depth` 默认 1（`subagent.ts:129`） | 语义对齐；不引入上游的 `experimental.*` 命名空间 |
| D-5 | .NET 镜像 | ✅ **不纳入**（项目已废弃） | — | 不适用 |
| D-6 | 通知身份 | ✅ **身份 = `notificationID`（即 synthetic message ID）**，不再以 `clientRequestId` 前缀表征身份 | `subagent-completion.ts:36-44`（`id: notificationID` + `completeBackground`） | 对齐；旧前缀降级为内部键注册兼容 |
| D-7 | 交付投递语义 | ✅ 采纳 **`resume` 布尔**；暂不引入上游 `Delivery = steer \| queue` | `session/session.ts:290`（delivery 默认 steer）+ `restart.ts:153`（resume:false） | 部分对齐：本仓单飞模型无队列，delivery 无落点 |
| D-8 | 结果文本提取 | ✅ **保留本仓富抽取**（含工具结果），仅对齐外层包裹格式 | 上游只取最后一条 assistant text（`subagent-completion.ts:10-18`） | **有意偏离**：本仓信息更多，不降级 |
| D-9 | 前端渲染契约 | ✅ **对齐上游 Notice 契约**（见下节） | `session-ui/src/timeline/session-timeline-row.tsx:333-353,406-426` | 完全对齐 |

---

## Solution Design

### 目标架构（对标后的单闭环）

```
task tool 执行
  └─ TaskJob.start(recovery)                       ← 新增 task-job.ts
       ├─ 前台:   TaskJob.block(childID, parentID)   ← 替代裸 await + 返回值拼装
       └─ 后台:   TaskJob.background(recovery)       ← 立即返回占位文案
  └─ 子会话 terminal
       └─ TaskJob.settle(childID, {status, output, error})
            └─ TaskJob.deliver(recovery, notificationID)
                 ├─ injectSyntheticSessionMessage(...)     ← 新增：role='synthetic'，仅入库（幂等）
                 └─ if (resume !== false) wakeSession(...)  ← 新增：拆分自 runSessionInBackground
            └─ TaskJob.completeBackground(notificationID)  ← 幂等清理 + 表移除
```

### 三个新原语

**P1. `TaskJob` 注册表** — `services/agent-gateway/src/task/task-job.ts`（新增）

- 内存 registry：`Map<childSessionId, ActiveJob>`，配单飞 guard，语义对齐 `job.ts`。
- 持久化：新增 `task_jobs` 表（`id / notification_id / recovery_json / status / output / error / updated_at`），
  承载 opencode 的「KV `job.background/<notificationID>`」职责。
- API 对齐：`start / get / wait / block / background / backgroundAll / cancel /
  pendingBackground / completeBackground`。
- 状态枚举 `running | completed | error | cancelled`；消费历史上限 25；仅可恢复任务带 `notificationID`。
- 与现有 `task_parent_auto_resume_contexts` 表的关系：Phase 4 迁移后由其取代（T-21）。

**P2. `synthetic` role + `injectSyntheticSessionMessage`**

- role 侧：按 §D 清单改 shared 类型 → V2 schema → 写入 → 模型上下文 → 契约 → 前端。
- **关键映射规则**：synthetic 落库保持 `role:'synthetic'`；
  **下发上游 LLM 时显式降级为 `user`**（沿用现有先例
  `message-to-model-messages.ts:446-452` 的 `syntheticKind` 合成内容走 `role:'user'`）。
- 注入原语复用 `appendSessionMessageV2`，带 `synthetic:true` part flag，
  以 `messageId = notificationID` 幂等；**只入库，不跑模型**（对齐 `session/session.ts:267-308` 的 admit）。

**P3. `wakeSession`** — 从 `runSessionInBackground`（`routes/stream-runtime.ts:1092`）拆出

- `admit`（写合成消息）与 `wake`（跑模型）分离，对应 opencode 的
  `synthetic` 与 `execution.wake` 两段。
- 忙时语义：**不丢弃、不重试轰炸**——合成消息已在库中，等待下一自然回合
  或由空闲 drain 消费。替代当前 `scheduleDrain` 的 800/1500ms 重试模型
  （`task-parent-auto-resume.ts:5-6`）。
- `resume: false` 时只入库不唤醒（父会话挂起场景，对齐 `execution/restart.ts:153`）。
- **耦合警示**：`runSessionInBackground` 承载 team resume 路径
  （`teamResumeRootSessionId`，`stream-runtime.ts:1112-1119`），拆分必须回归覆盖。

---

## 前端渲染与展示设计（上游对齐）

### 上游契约（事实，逐条带证据）

| 维度 | 上游实现 | 证据 |
|---|---|---|
| 消息类型 | `message.type === 'synthetic'`（独立类型，非 user 冒充） | `session-ui/src/timeline/session-timeline-row.tsx:333` |
| 描述 | `message.description`（短标签） | 同上 `:352` |
| 元数据 | `metadata: { source:'subagent', childID, agent, state }` | `:335-339`、`:408-410` |
| 渲染形态 | **一行 Notice**（13px、truncate、弱化色） | `:456-482` |
| 文案 | `↳/! <Agent> <finished\|failed\|cancelled>` + ` · <description>` | `tui/src/routes/session/index.tsx:2034-2040` |
| 状态色 | error=feedback.error / cancelled=feedback.warning / 其余=feedback.info | 同上 `:2041-2046` |
| 交互 | `childID` 存在则点击/回车**跳转子会话**；有 href 用 `<a>`，否则 `div[role=link][tabIndex=0]` | `:412-432` |
| 可见性 | 非空 `description` 才成 Notice；`state==='error'` **强制可见** | `projection.ts:765-770`、`detail.ts:101-108` |
| 间距 | `grouped ? py-1 : pt-3 pb-1` | `:458` |
| 工具卡片 | 工具名 `subagent`/`task` 归入 `subagents` 详情分类 | `detail.ts:97` |
| 分享视图 | `part.type==='text' && part.synthetic===true` 不导出 | `web/src/components/Share.tsx:359` |

### 本仓落点设计

**现有等价物**：`assistant_event` + `payload.kind='agent'` 卡片（`tools/tool-sandbox.ts:1033-1052`）
→ 由 synthetic 消息 **取代**（Phase 5 移除）。

**新增共享组件 `SubagentNoticeRow`**（放 `packages/shared-ui/src/chat/`，Web / 桌面 / 移动端共用）：

```ts
interface SubagentNoticeRowProps {
  agent: string;                    // 子代理名
  state: 'done' | 'failed' | 'cancelled';
  description: string;              // 任务短标签
  childSessionId?: string;          // 有则可跳转
  grouped?: boolean;                // 连续 Notice 合组时收紧间距
  onOpenChild?: (id: string) => void;
}
```

- **布局**：单行 = 状态字形 + `<Agent>` + 状态标签 + ` · ` + `description`，`truncate`，`text-weak`。
- **三态色（E·Nebula token，禁止硬编码）**：
  `done` → 辅助色靛蓝（info）｜`failed` → 互补色珊瑚（danger）｜`cancelled` → 对比色琥珀（warning）。
- **交互**：可跳转时 `<button>`/`<a>` 二选一，`Enter`/`Space` 触发；hover/active/focus-visible 三态；
  focus ring = accent 2px outline + 4px subtle shadow（对齐 AGENTS.md 可访问性要求）。
- **可见性规则（对齐上游）**：非空 `description` 才渲染；`state === 'failed'` 强制渲染；
  其余空描述 → 不渲染。
- **文案（中文，本仓交互语言约束）**：`已完成` / `已失败` / `已取消`；
  完整行示例：`↳ explore 已完成 · 审计会话唤醒原语`。
- **移动端**：同一组件渲染，点击进入子会话详情（复用现有 `SubagentDetailModal`）。
- **响应式**：375px 下单行截断 + 点击整行触发；不引入横向滚动。

**数据来源映射**：synthetic 消息 `description` + `metadata = { source:'subagent', childID, agent, state }`
→ 直接喂给 `SubagentNoticeRow`，无需再解析 `assistant_event` JSON。

---

## Implementation Plan

> 原则：Phase 1 只新增、不改行为；Phase 2 是 synthetic role 全链路（可独立回滚）；
> Phase 3 是前端渲染展示（用户明确要求设计进去）；Phase 4 接单通道交付与上游命名对齐；
> Phase 5 才移除旧路径。每阶段独立可合并，不得破坏既有验收脚本。

### Phase 1：Job 骨架（只增不改行为）— ✅ 已完成（2026-09-22）

- [x] T-01 ✅: 新增 `services/agent-gateway/src/task/task-job.ts`：内存 registry + `start/settle/get/cancel/background/completeBackground/consume/waitForSettle/pendingBackground`
- [x] T-02 ✅: 新增 `task_jobs` 表（`infra/db.ts` 建表 + `notification_id` 唯一索引 + `sessions` FK CASCADE），实现 `persistJob` / `pendingBackground`
- [x] T-03 ✅: `runChildTaskSessionInBackground` 旁路 `start`、`finalizeChildTaskRun` terminal 分支旁路 `settle`（旧路径零改动）
- [x] T-04 ✅: `src/__tests__/task/task-job.test.ts` 13 例：start 幂等 / settle 幂等 / cancel / background 分配通知身份 / 先完成再转后台 / 消费历史 25 上限 / waitForSettle / FK CASCADE / 脏 recovery_json 容错

> **Phase 1 验收**：`vitest run task-job.test.ts` 13/13 ✅ ｜ `test:task-tool` 8/8 脚本 EXIT=0 ✅ ｜
> 网关 `typecheck` EXIT=0 ✅ ｜ 改动 4 文件 ESLint 0 error ✅ ｜ 实际修复 1 个自查缺陷
> （`background()` 误读 `job.recovery` 而非 `job.info.recovery`，导致通知身份未分配）。

### Phase 2：`synthetic` role 全链路（按 §D 清单）

- [x] T-05 ✅: `packages/shared/src/message-schema.ts` 增加 `'synthetic'`（带语义注释）；`Message` 新增 `description?` / `metadata?`（对齐上游 synthetic 的 `description` + `metadata` 契约）
- [x] T-06 ✅: `message/message-v2-schema.ts` 新增 `SyntheticMessage` 成员并加入 `MessageInfo` 联合
- [x] T-07 ✅: `message-v2-adapter.ts` 用**穷尽 switch + `never` 守卫**替换 `if/else` 链（消除 `else → system` 静默改写），新增 `buildMessageInfo` helper 与 `description`/`metadata` 入参；两处回滚角色过滤（`routes/stream.ts:1175`、`tools/tool-sandbox.ts` 回滚辅助）补 `'synthetic'`
- [x] T-08 ✅: `message-to-model-messages.ts` 新增 `SyntheticMessageUnified`（含 `syntheticKind: 'subagent-notice'`）与 synthetic 分支；`v2-runtime/upstream/native-message-bridge.ts` 新增**显式** `case 'synthetic'` 降级为上游 `user`（不塞进 default，保住穷尽网）
- [x] T-09 ✅: `UnifiedMessage` 加入 `SyntheticMessageUnified`，**激活 `native-message-bridge.ts:149-152` 的 `assertNever` 编译网**
      ｜worker-01 交付 + coordinator 独立复核 ✅（typecheck EXIT=0；新测试 3/3）

> **R-03 闭环证据（coordinator 亲自复现）**：向 `UnifiedMessage` 注入一个无渲染器的临时成员后，
> `pnpm --filter @openAwork/agent-gateway typecheck` 报
> `src/v2-runtime/upstream/native-message-bridge.ts(150,13): error TS2322: Type 'ProbeUnifiedForExhaustivenessCheck' is not assignable to type 'never'`；
> 还原后 `cmp` 字节级一致、探针零残留、typecheck 复跑 EXIT=0。
> **即：静默失效已被转为编译失败，R-03 关闭。**
>
> **路径勘误**：我先前给出的 `src/message/native-message-bridge.ts` 有误，真实路径为
> `src/v2-runtime/upstream/native-message-bridge.ts`（worker-01 主动纠正，已核实）。
> **范围确认**：`message-transforms.ts` 无需改动——它作用于 `ModelMessage[]`（role 域仅 user/assistant/tool），
> synthetic 在此之前已降级为 `user`，不可能到达该层（worker-01 核查结论，coordinator 认可）。
- [x] T-10 ✅: `session/session-message-store.ts` 旧归一化链把 `synthetic` **折叠进已有 user 分支**（输出上游 `user`，不扩本地联合——该联合被结构赋给 `UnifiedMessage`，扩它必然破坏类型安全）；计数逻辑经核查本就排除 synthetic，无需改动
      ｜worker-02 交付 + coordinator 独立复核 ✅（4/4 通过；消费者声明核实：仅 `session-compaction.ts:474`）
- [x] T-11 ✅: `routes/commands.ts` zod 枚举加入 `synthetic`（附语义注释）；全文件核查确认这是**唯一** role 枚举/校验点（其余 5 处为字面量构造、透传或定向筛选）；通过既有 `__testing` 约定导出 schema 并新增 2 例单测（接受 `synthetic` / 拒绝 `bogus`）
      ｜worker-03 交付 + coordinator 独立复核 ✅（9 文件 / 12 用例通过）
- [x] T-12 ✅: 前端可见性守卫——**三端边界本就把 synthetic 拒于 transcript 之外**（web `normalize-chat-messages.ts` 白名单、mobile `chat-message-content.ts:51-54` 白名单），故仅需把「意外排除」升级为「显式排除」并加测试：
      web 白名单补语义注释 + 2 例断言（含 failed 态）；mobile 白名单补注释 + 1 例断言；`packages/shared-ui/src/chat/ChatMessage.tsx` 新增 `role === 'synthetic'` 早返回（共享库防御，避免落成 assistant 气泡）+ 2 例渲染测试
      ｜**范围收窄发现**：R-06 的移动端风险实际已被既有白名单挡住（`MobileChatMessage.role` 仅两值，类型层不可能为 synthetic），无需改气泡组件
- [x] T-13 ✅: 收口——`normalize-chat-messages.test.ts` 扩充（T-12 已做）；新增 `__tests__/message/synthetic-role-roundtrip.test.ts` 4 例**真端到端往返**（真实 SQLite + 真实 projector）：
      ① 写入保持 `synthetic`，不被改写成 `system`；② 读路径带回 `description`/`metadata`（含 `v2ToV1Message` 客户端契约）；③ `toModelMessages` → bridge 降级为上游 `user`（模型可见）；④ `listSessionMessagesV2` 不因未知 role 丢消息
- [x] T-13 附带修复 ✅: **发现并修复一个真实缺陷（R-15）**——读路径 `v2ToV1Message` 丢弃 `description`/`metadata`，会让客户端只拿到光秃秃的 `role: 'synthetic'`，Phase 3 的 Notice 将无内容可渲染。写入侧本就持久化，仅读侧漏取

> **Stage A 验收（T-05…T-07）**：`shared` + `agent-gateway` 双 typecheck EXIT=0 ✅ ｜
> 改动 5 文件 ESLint 0 error ✅ ｜ `src/__tests__/message` + `src/__tests__/task` **18 文件 / 107 用例全绿** ✅
> **副产物**：typecheck 未报任何新错误，**实证了 R-03**（除新增的穷尽 switch 外，全链路对 synthetic 零编译期保护，
> 静默丢弃点确实存在）——这正是 T-08/T-09/T-10 的必要性证据。

### Phase 3：前端渲染展示（上游 Notice 契约，用户明确要求）

- [x] T-14 ✅: 定义 Notice 数据契约——`packages/shared/src/message-schema.ts` 新增类型 `SubagentNoticeState`（`done | failed | cancelled`）与 `SubagentNoticeMetadata`（`source: 'subagent'` + `childID?` / `agent?` / `state?`，对齐上游 `SubagentCompletion.deliver` 的 metadata）；提取器 `packages/shared-ui/src/chat/subagent-notice.ts` 的 `parseSubagentNotice(message)`（web/桌面 SSOT）
      ｜**可见性规则完全对齐上游**：非空 `description` 才成形（`isNotice`）、`failed` 无论有无描述都强制可见（`timelineNoticeRequired`）、`state` 缺失回落 `done`、`agent` 缺失回落中性占位
- [x] T-15 ✅: 新增 `packages/shared-ui/src/chat/SubagentNoticeRow.tsx`：单行 Notice（状态字形 + 代理名 + 状态标签 + ` · ` + 描述）、三态语义色（done→`--aux` / failed→`--danger` / cancelled→`--warning`，与上游 `feedback.info/error/warning` 映射一致）、可交互时用**原生 `button`**（Enter/Space 与 role 语义由浏览器保证）、hover 提升文字色、focus ring（`2px var(--accent)` + `4px var(--accent-subtle)`）、`grouped` 收紧上间距；全部走 `tokens.ts`，零硬编码色值/间距

> **Plan drift 记录（2026-09-22，T-16 拆分）**：T-16 原为一个任务，实施时发现渲染交错必须改动
> `ChatRenderEntry` / `ChatRenderGroup` 共用协议（chat + team 两侧消费方），风险与工作量都显著高于预期，
> 故拆为 **T-16a（纯数据层，已交付）** 与 **T-16b（渲染交错，待独立排期）**。
> **T-16b 设计要点（供后续实施）**：① 在 `ChatRenderEntry` 引入 notice 变体或并列数组，按 `createdAt`
> 与消息条目做有序归并；② 更新 chat 与 team 两侧的 entry 构造与渲染；③ 复用 `SubagentNoticeRow`；
> ④ 跳转走现有子会话详情入口；⑤ `Share` 视图对 `synthetic` part 不导出（对齐上游 `Share.tsx:359`）；
> ⑥ 375/768/1280 三视口视觉验收。

> **Phase 3 阶段性验收（T-14 / T-15 / T-16a / T-17）**：
> `shared` + `shared-ui` + `web` + `mobile` **四处 typecheck EXIT=0** ✅ ｜
> shared/shared-ui/移动端 相关文件 ESLint 0 error ✅（`apps/web` 按既定策略被根 ESLint 排除，非违规）｜
> 测试全绿：`packages/shared` **9/9** ✅ ｜ `packages/shared-ui` `src/chat` **3 文件 / 18 用例** ✅ ｜
> `apps/web` notices **5/5** ✅ ｜ `apps/mobile` **12 文件 / 266 用例** ✅
>
> ⚠️ **Gate 3 状态（如实区分两件事）**：以上全部是**单元/契约级**验证，已全绿。
> **三视口（375/768/1280）视觉与交互验收**已以**组件级真实浏览器**方式**通过**（见 T-30，**61 断言 × 3 视口**，
> 真实 Chromium 渲染真实组件 + 两条真实祖先链路）；且 **T-16b（Web 渲染交错）已落地**，
> chat 与 team 双端均渲染 Notice 行。
> **仍未覆盖的一项**：由真实 LLM 驱动的**端到端**数据路径（网关 API → 通知提取 → 群组合并 → 应用内滚动容器）
> —— 受 `.env` 中 `AI_API_KEY` 为空所限，环境不可行（见 T-30 ①）。此项**未通过、也未放弃**，步骤已就绪。

- [x] T-29 ✅: 移动端实时通知通道——worker-05 交付：**方案 B（事件驱动重拉 + 重算）**，并用时序证据证明可行性（`tool-sandbox.ts` 先 `await deliverTaskCompletion` 注入通知**再**发布终态 `task_update`，而移动端已消费该事件 ⇒ 近实时）；新增纯函数 `mergeMobileSubagentNotices`（按 id 合并、同 id 以最新为准）+ 在 `onDone`/`onError`/终态 `task_update` 三处触发刷新；验证：mobile typecheck exit 0、ESLint 0 error、**13 文件 / 273 用例全绿**（+1 文件 / +7 用例）
      ｜**A 方案不可行的证据**（worker 已取证）：`RunEvent` 联合无 synthetic 成员、注入只写 DB 不 publish、移动端 WS 只转发本次请求自己的 chunk
      ｜**残余缺口（如实登记）**：父回合**结束后**才结算的子代理，移动端无存活订阅，仍需下次交互可见
- [x] T-30 🟢 **组件级验收已通过（真实 Chromium，61 断言 × 3 视口）／端到端仍受环境阻塞（如实区分）**: Phase 3 三视口（375/768/1280）Notice 视觉与交互验收。
      **① 端到端变体 ⛔ 环境不可行**：真实视觉验收需一个**含真实 synthetic 通知**的会话，而通知只能由「父模型调用子代理工具 → 子会话结算」产生。
      实测 `.env` 的 **`AI_API_KEY` 长度为 0**（空值）→ 无可用 LLM → 模型不会发起工具调用 → 无子会话 → **通知无法产生**。
      （另一条理论路径是把通知直接写进运行中网关的 DB，但那会侵入**另一个并发会话正在使用的实时开发库**，**主动放弃**。）
      **② 组件级变体 ✅ 已完成（推翻「不可行」结论）**：先前判定「组件级也不可行」的依据是会话浏览器工具未连接
      （`browser.tabs.list({})` → `No desktop browser is connected to this session`）——该判定**过窄**：
      仓库自带 **Playwright + Chromium 二进制**（`PLAYWRIGHT_BROWSERS_PATH` 指向 `00-new-property/.playwright-browsers`），
      **不依赖桌面端连接**。据此新建可复现验收资产 `apps/web/harness/`（README 含运行命令）：
      用运行中的 vite dev server 在真实引擎里渲染**真实的 `SubagentNoticeRow`**，覆盖 jsdom 覆盖不到的部分。
      **断言 61 项 × 3 视口全绿**：五用例渲染｜截断样式恒定生效｜375/768 长描述**确实溢出并被裁剪**、1280 不溢出且行宽受容器约束｜
      **两条真实祖先链路**（chat 虚拟化 `position:absolute; left/right:0` 定位层、team `SPLIT_INNER_STYLE→CONVERSATION_STREAM_STYLE→scrollRegionStyle→contentColumnStyle` column-flex 链）内均不溢出视口｜
      三态语义色**分两条链验证**（**兜底链**：页面不定义任何组件 token → 落到 `tokens.ts` 的 hex 兜底；**主题链**：`.themed` 哨兵变量 → 组件跟随主题而非兜底。期望值**均从 token 模块推导**，杜绝写死值在 token 调整后静默脱钩——`tokens.ts` 的取值是 `var(--aux, #8b9cf5)` 形式，若页面把变量定义成与兜底同值，两条路径会被混为一谈）｜focus ring（solid 2px accent + offset 2px + accent subtle 阴影，期望值同源推导）｜点击回传子会话 id｜无 `childSessionId` 时渲染为 `div` 而非 `button`。
      **③ 过程中发现并纠正一个真实风险假设**：`white-space: nowrap` 会把 `min-content` 抬到整行文本宽度，
      若祖先链出现 **row 方向 flex 且缺 `min-width: 0`**，容器会被撑出视口、省略号失效。
      首版 harness 用合成的 row-flex 包裹层复现了该故障（clientWidth **955px** ≫ 375px 视口）；
      经查两端真实链路均为 column flex 或绝对定位（`CONVERSATION_STREAM_STYLE` 甚至显式 `minWidth: 0`）→ **当前无此问题**，
      该合成用例已被**两条真实链路**用例取代，作为回归守卫固化在 harness 中。
      **④ 仍未覆盖（如实登记）**：真实 LLM 触发的**端到端**数据路径（网关 API → 通知提取 → 群组合并 → 应用内真实滚动容器）
      未在真实会话中走通——组件级 harness 复刻了链路样式，但不等于跑过真实数据流。步骤仍就绪，待有 LLM 凭据时补验。
>
> **Plan drift 记录（2026-09-22，SSOT 位置修订）**：T-14 原计划把 `parseSubagentNotice` 放在
> `packages/shared-ui`。实施时通过测试失败发现 **`apps/web` 的 vitest 把 `@openAwork/shared-ui` 整体
> 别名到测试 mock**（`apps/web/vitest.config.ts:16-17` → `src/test/mocks/shared-ui.tsx`），核心解析逻辑
> 放那里在 Web 测试环境根本不可用。已**下沉到 `packages/shared`**（该包本就导出同类消息形状纯函数，
> 如 `parseAssistantTraceContent`，先例充分），并获得额外收益：移动端也能复用同一实现，消除三端重复。
- [x] T-16a ✅: Web 通知数据层——新增 `apps/web/.../conversation-runtime/messages/subagent-notices.ts` 的 `collectSubagentNotices(rawMessages)`：只做「原始行 → `Message` 形状」适配，提取语义**委托 `@openAwork/shared` 的 `parseSubagentNotice`**（SSOT，不在 Web 侧重复实现）；5 例测试
- [x] T-16b ✅: **Web 通知渲染交错（协议级）**——`ChatRenderGroup` 改为**判别联合**（`kind: 'messages' | 'subagent-notice'`，必填 → 编译期强制所有消费者窄化）；新增 `buildSubagentNoticeGroups` / `mergeNoticeGroupsIntoRenderGroups`（按 `createdAt` **时间位置**插入，同戳排在消息之后）；`ChatMessageGroupList` 渲染 `SubagentNoticeRow` + 复用既有 `openChildSessionInspector` 打开子会话；chat（`useChatRenderData`）与 **team**（`buildTeamGroupedMessageEntries`）双端接入；通知源为各自快照加载路径的 `collectSubagentNotices`
      ｜**关键设计取舍**：**不动 `ChatMessage.role`**（两值联合 + 全仓 101 处 role 分支），改扩**群组协议**——影响面从 101 处收窄到渲染层约 6 处，且由 `kind` 必填获得编译期保护
      ｜验证：web typecheck 0 error · **web 全量 513 文件 / 4972 用例 EXIT=0** · 新增 8 例纯函数测试
- [x] T-17 ✅: 移动端接入——worker-04 交付：`chat-message-content.ts` 新增 `parseMobileSubagentNotice` / `collectMobileSubagentNotices`、新建 `components/SubagentNoticeRow.tsx`（含 `SubagentNoticeList`）、`ChatScreen.tsx` 以 `ListFooterComponent` 接线（**不改 data/key/滚动逻辑**，低风险）、测试 2 → 15 例
      ｜**coordinator 收口修正**：worker 因「`@openAwork/shared` 入口指向 `dist/`，CI test job 不构建 shared」的顾虑**镜像了一份语义实现**。核实该顾虑**成立**（`ci.yml:80/111/134` 只构建 `opencode-llm`；mobile 无 vitest 配置 → 走包入口 → `dist/`）。但语义重复会漂移，故新增 `apps/mobile/vitest.config.ts` 把 `@openAwork/shared` 别名到源码，并让移动端**委托 shared 的同一个 `parseSubagentNotice`**——三端语义收归单一 SSOT，同时消除构建顺序耦合
      ｜worker 未做的两处限制已如实登记：① 移动端无 synthetic 事件通道，通知仅在会话加载/切换时出现，流式过程中完成需重载；② 通知集中在 footer（时间线内插会改动 data 下标，属高风险）

> **Plan drift 记录（2026-09-22，移动端 SSOT 收口）**：T-17 的首次交付在移动端镜像了通知语义。
> 作为协调者我核验后发现其技术顾虑成立，但**镜像不是最优解**——已通过 vitest alias 直连源码改为委托 SSOT。
> 交叉验证：worker 自写的 13 个用例在改为委托实现后**依然全绿**（`pnpm --filter @openAwork/mobile test` → 12 文件 / 266 用例），
> 证明委托实现的语义与原镜像等价。

### Phase 4：单通道交付与上游命名对齐 — ✅ 全部交付

- [x] T-18 ✅: 新增 `injectSyntheticSessionMessage`（role='synthetic'，`messageId = notificationID` 幂等，只入库）；通知身份前缀统一 `task-job:` ｜5/5 测试
- [x] T-19 ⚫ **已放弃（原假设错误）**: 原范围「从 `runSessionInBackground` 拆出 `wakeSession`」的调查结论是**本仓不存在可复用的唤醒原语**——`routes/stream.ts:2467` 的 `persistStreamUserMessage` 在非 team-resume 路径下**无条件持久化用户轮**，且 `streamRequestSchema.message` 必填（`:571`）。**由 T-19b-1 取代**（不改 schema、新增独立入口），R-18 记录完整证据
- [x] T-19b-1 ✅: **`handleStreamRequest` 新增 continue-from-history 模式**（`continueFromHistory?: boolean`）；三处守卫：不落用户轮（跳过 `persistStreamUserMessage`）、不派发用户消息插件事件、不计入「用户手动交互」；新增 `continueSessionFromHistory()` 入口（复用 `clientRequestId` 的已完成重放语义做幂等）。**默认路径逐字节不变**（529 文件 / 4036 用例回归得证）
- [x] T-19b-2 ✅: `deliverTaskCompletion`（= **T-20**）——单通道交付：幂等准入 → **纯函数决策**（`resolveTaskJobWakeDecision`：`resume:false` / `busy` / `parent-paused` / `wake`）→ `continueSessionFromHistory`；**忙时留库待消费、不注册任何定时重试**；`resume:false` 与父会话不存在时清理持久化记录，busy/paused 时保留供恢复扫描补偿 ｜10/10 测试
- [x] T-19b-3 ✅: **内部键注册（= T-21）**——`task-job:` 纳入 `GATEWAY_INTERNAL_REQUEST_KEY_SHAPES`（文档注释标注 `task-reminder:` / `task-auto-resume:` 为**待退役旧路径**）｜**并顺手补强守卫**：`task/` 纳入 `SCAN_DIRS`（原先不扫，正是新前缀未被发现的原因），并修正常量式前缀正则使其**连同分隔符一起捕获**——纳入扫描后立刻暴露的**既有扫描器缺陷**（`task-parent-decision` 被扫成不带冒号，`startsWith` 覆盖判定永不匹配）
- [x] T-19b-4 ✅: **重启恢复扫描（= T-26）**——`task/task-job-recovery.ts` 的 `recoverPendingTaskDeliveries()`：启动时扫描 `task_jobs` 全部持久化记录并重投（幂等由 `notificationId` 同时作消息 id 与唤醒键保证）。要点：① 用户 id 取自**子会话**（FK CASCADE 保证存在；父会话可能已删，由交付层清理）；② 父会话繁忙则保持延后、**保留记录**供下次启动再试；③ 单条失败计入 `failed` 且不阻断启动；④ 接入 `src/index.ts` 的 `gateway.task-job-recovery` 步骤，**放在 `listen` 之后**。为此在 `task-job.ts` 新增 `listPersistedBackgroundJobs()` ｜6/6 测试
- [x] T-19b-5 ✅: **交付主路径切换（= T-25）**——`finalizeChildTaskRun` 的终态交付改走 `deliverTaskCompletion`；旧的 `consumeTaskParentAutoResumeContext` + `scheduleTaskParentAutoResume` 从交付路径移除；取消态传 `resume: false`（只投递不唤醒，与旧语义一致）
- [x] T-20 ✅: = T-19b-2（`deliverTaskCompletion`）
- [x] T-21 ✅: = T-19b-3（内部键注册 + 守卫补强）
- [x] T-22 ✅: 子代理深度限制——沿 `metadata.parentSessionId` 链计算（复用 `parseSessionParentId`），配置键 `subagent_depth` 默认 `1`（对齐上游 `experimental.subagent_depth`），超限返回错误并保留在父会话内｜**仅约束新建子会话，恢复既有子会话不受限** ｜12/12 测试
- [x] T-23 ✅: 名称别名 + **输入形状桥接**（`agent` / `background` / `sessionID` → `subagent_type` / `run_in_background` / `session_id`；**规范字段优先、冲突即拒绝**）｜10/10 测试 + 既有 `task-tools-schema` 18/18 保持全绿
- [x] T-23b ✅: **工具暴露名切换为上游名 `subagent`**——`task-tools.ts` 新增 `TASK_TOOL_NAME` / `TASK_TOOL_LEGACY_NAME` / `isTaskToolName()`（**单一来源**），4 处内部按名判定改用谓词，两处兼容镜像表方向翻转为 `task → subagent`｜**有意保留**：`createdByTool: 'task'` 作为存量会话的**溯源标记**不变；`task` 别名端到端仍被接受｜34/34 回归
- [x] T-24 ✅: 单通道验收——`verify-task-job-wake.ts`（`test:task-wake`）断言：**`user` 角色消息数前后不变**（G1 不落用户轮）、**模型请求含通知正文**（G2 模型可见）、通知不重复、真实发起上游、产生 assistant 响应、**重复唤醒幂等**；「恰好一条通知」由 T-25 引入的脚本断言覆盖
- [x] T-25 ✅: = T-19b-5（主路径切换）
- [x] T-26 ✅: = T-19b-4（重启恢复扫描）
- [x] T-27 ✅（**按风险比例收窄**）: 移除**已被取代的可见旧路径**——删除 `appendParentTaskCompletionReminder` + 3 个辅助函数（86 行）与 **3 处调用点**（含 2 处包裹 `if`），并清理失效的 `truncateTaskReminderText`。**前置条件已满足**：T-16b 已让 chat **与 team** 双端渲染 synthetic 通知（运行期 `task_update` 卡片由 run event 独立产出，未受影响）｜**有意保留并说明理由**：`task-parent-auto-resume.ts` 其余函数仍被 **7 个文件**引用，`task-reminder:` 前缀判定保留为**存量数据只读兼容**（删除会让历史内部消息进入模型上下文）→ 模块与表的移除登记为 **T-31**（纯代码卫生、7+ 文件、零功能收益）
- [x] T-28 ✅（**归档门槛已达成**）: 更新 `AGENTS.md` 子代理章节 + 归档 workflow + memory sync。
      **① `AGENTS.md`**：**两处均已就位**——`services/agent-gateway/AGENTS.md` 原有「子代理交付 = 单通道」「`synthetic` 消息角色契约」「子代理工具名」章节（本任务维护，**新增唤醒预算说明**）；根 `AGENTS.md`「架构说明」新增一条浓缩版**子代理结果交付（单通道）**（含工具名 `subagent` + `task` 别名、`subagent_depth`、synthetic 通知契约、`deliverTaskCompletion` 三段式、唤醒预算、以及「禁止恢复定时重试/伪造用户请求」的约束）。
      （**勘误的勘误**：本任务原描述写「更新 `AGENTS.md` 子代理章节」；我初次只查了**根** `AGENTS.md`、未见该章节，便记为「章节不存在」——实际**章节在 `services/agent-gateway/AGENTS.md`**，原描述成立。教训：跨包仓库里「AGENTS.md」是多份文件，按名检索必须先确认是哪一份。）**② memory sync**：已完成（`.agentdocs/index.md` 架构决策 + 已知陷阱）。**③ 归档**：T-30 的**组件级三视口验收已通过**（61 断言 × 3 视口，真实 Chromium），仅剩「真实 LLM 驱动的端到端变体」受环境所限（`AI_API_KEY` 为空）——该项**未放弃、步骤就绪**，已按 `cleanup-policy.md` 要求**显式登记为环境阻塞**而非留作待办；据此归档门槛达成，workflow 移入 `workflow/done/`。

> **Plan drift 记录（2026-09-22，验收资产随契约更新）**：T-25 是唯一真正改变生产行为的一步，
> 两个既有验收脚本的契约随之变更，均已**忠实改写而非放宽**：
> 1. `verify-task-tool-auto-run.ts`：该脚本断言是**子侧**且基于 `fetchCalls` 下标，而新路径在父会话空闲时
>    **同步唤醒**会插入一次父侧上游请求、打乱下标（旧路径有 800ms 防抖故未暴露）。处置：把 4 处父会话
>    `state_status` 置为非空闲，让唤醒按设计「延后」以隔离两侧关注点（唤醒本身由专门的
>    `verify-task-job-wake.ts` 验收），并**新增**断言：父会话必须收到 synthetic 通知、且**不得**存在用户轮。
> 2. `verify-task-parent-auto-resume.ts`：判定标记由旧路径的伪造表头 `AUTO_RESUME_HEADER` 改为
>    **通知正文**；新增断言「恰好一条 synthetic 通知」「通知正文 = 子代理结果」「父会话无用户轮」。
>
> **T-16b 规模评估（已落地）**：`ChatMessage.role` 是两值联合且全仓 **101 处** role 分支 →
> 最终**不动 `ChatMessage`**，改为扩**群组协议**（判别联合，`kind` 必填），影响面收窄到渲染层约 6 处并获得编译期保护。
>
> **既有阻塞已修复（非本任务引入）**：`pnpm check:fastify-alignment` 曾失败（`packages/logger` 的
> `fastify: ^5.11.3` 与 lockfile 解析出的 `5.12.5` 不一致，触发源是工作树中其他工作的依赖 bump）；
> 已修 `packages/logger/package.json` + lockfile 收敛 → **exit 0**。

### Phase 5：切换、恢复与清理 — ✅ 主体已交付

- [x] T-25 ✅: 主路径切换（= T-19b-5）
- [x] T-26 ✅: 重启恢复扫描（= T-19b-4）；`task_parent_auto_resume_contexts` 表的退役登记为 T-31
- [x] T-27 ✅: 移除旧 `appendParentTaskCompletionReminder` 路径（旧前缀判定保留为只读兼容）
- [x] T-31 ✅（**按正确边界收窄**）: 清理旧 auto-resume 机制——删除 `task/task-parent-auto-resume.ts` 的**整套 drain / schedule / consume / clear / 计数 / 请求键判定**（约 300 行），并清理其消费点：`routes/stream.ts`（守卫 + 导入）、`session/stream-session-title.ts`、`session/stop-child-sessions.ts`、`routes/sessions.ts`、`routes/stream-routes-plugin.ts`（2 处）、`tools/tool-sandbox.ts`（8 处调用 + 1 组导入 + 2 个变为未使用的变量）；测试 mock 同步清理。
- [x] T-32 ✅（**关闭开放问题 Q3 / 风险 R-12**）: 补回**自动唤醒预算**——T-31 删除旧计数器后，单通道交付的唤醒路径**没有任何上限**；而唤醒是事件驱动的（子代理结算 → 投递通知 → 唤醒父会话），若被唤醒的父会话**又委派了新的后台子代理**，其完成会再次唤醒它 → **无界自激**（旧机制正是为此设了 10 次上限）。
      实现：新增 `task/task-wake-budget.ts`（`MAX_CONSECUTIVE_AUTO_WAKES = 10`，与旧值一致）；`deliverTaskCompletion` 在**真正要唤醒时**才消费预算（`resume:false` / 忙 / 暂停均不计入），耗尽时**仍然投递通知**（通知已入库，用户下次自然发言时模型依然看得到）→ 只返回 `wake: 'skipped'` + `deferReason: 'budget-exhausted'`，**不丢信息**；`routes/stream.ts` 在**非网关内部请求**时重置计数（复用 `isGatewayInternalRequestKey`，与标题守卫同一判定——否则唤醒自身会把计数清零，上限永远触发不了）。
      验证：`task-wake-budget.test.ts` 4 例 + `task-job-delivery.test.ts` 新增「预算耗尽仍投递但不唤醒」1 例 → **15/15 绿**；网关 typecheck 0 error、ESLint 0 error。
      注：进程内计数（与旧机制一致）——重启即清零，属可接受语义（重启后首次唤醒总是允许的）。
      **两处「不能删、必须迁移」的处置**：① `MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES` **不是死代码**——它被 `routes/stream.ts`（2 处 todo 续写）与 `routes/stream-runtime.ts`（1 处溢出续写）当作**续写轮次上限**使用 → 迁移为 `routes/stream-model-round.ts` 的 `MAX_CONTINUATION_ROUNDS`（**数值保持 10**）；② `stream-session-title` 的守卫**意图仍有效**（网关内部请求不生成 LLM 标题）→ 改用通用判定 `isGatewayInternalRequestKey`（覆盖新的 `task-job:` 前缀与旧前缀）。
      **🔴 险情（已修正，见 SR-10）**：初版把 `task_parent_auto_resume_contexts` 表与 `upsertTaskParentAutoResumeContext` **一并删除**，但该表仍被 `task/task-parent-auto-decision.ts` **消费**（子代理中途停顿时父代理需父会话原始请求数据来构造父级决策请求）→ 已按正确边界保留「上下文存储」：新建 `task/task-parent-context-store.ts`（`upsertTaskParentContext` / `clearTaskParentContext`），恢复建表与 2 条删除恢复语句，并恢复 2 处写入点 + 终态清理
      ｜验证：typecheck 0 error · `eslint services/agent-gateway/src` 0 error · **9 条验收脚本全 ok** · 全量单测（见 master_plan）

---

## 收口复盘（2026-09-22）

> 用户要求「全部完成后自己复盘检查并处理错误」。本节记录复查**发现的问题与处置**——
> 其中 SR-3 是**真实回归**（我引入），其余为陈旧断言/记录/环境层问题。

| 编号 | 严重度 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| SR-1 | 🟠 中 | `SubagentNoticeRow.test.tsx` 的工厂缺必填 `createdAt`（T-16b 给 `SubagentNotice` 加字段时漏改该工厂） | shared-ui typecheck TS2322 | ✅ 已修（补 `createdAt`）；shared-ui typecheck 0 error、18/18 通过 |
| SR-2 | 🟡 低 | `tool-sandbox-plugin.test.ts` 的 `sqliteGetMock` 推断类型缺 `{value}` 形状（**并发工作引入的既有错误**，非本任务） | 网关 typecheck TS2345 | ✅ 已修：给初始实现**加显式返回类型标注**（不改运行时行为——加分支会打挂一个用例，已实测） |
| SR-3 | 🔴 **高（真实回归）** | **T-23b 把 `task` 放进 legacy 重写表导致沙箱派发改道**：`rewriteLegacyToolRequest('task')` 返回 `subagent` → `incomingRequest.toolName` 被改写 → task 子会话**不再创建** | `tool-sandbox-permission-ladder.test.ts` 3 例失败（`insertedMetadata` 为 undefined）+ `verify-task-tool-no-permission` 失败；**决定性实验**：仅移除该映射即 43/43 通过 | ✅ 已修：`task` 是**运行期别名**（由 `isTaskToolName` 处理），**不属于** legacy 重写表（该表只用于「注册表已不认识的名字」）；已在表内加注释说明 + 补回归守卫测试「`task`/`subagent` 都不走 legacy 重写」 |
| SR-4 | 🟠 中 | T-27 删除 `assistant_event` 卡片后，**3 个验收脚本的断言变成陈旧**：`verify-task-tool-auto-run` / `verify-task-parent-auto-resume` / `verify-task-tool-failure-propagation` 仍在断言「持久化可见的完成提醒」 | 三条脚本 failed，错误信息直指 reminder 断言 | ✅ 已按新契约改写为 **synthetic 通知断言**（存在性 + 正文 + `metadata.state` + `metadata.childID`），非放宽 |
| SR-5 | 🟡 低 | workflow 文档 Phase 4/5 的**原始任务列表有 10 处陈旧未勾选**（与同文件内已更新的 T-19b-* 子项矛盾）+ 1 处重复 `T-28` | plan-maintenance-policy「不得把已完成项留为待办」 | ✅ 已整段重写；未完成项收敛为 2 条（T-30 阻塞 / T-28 归档待门槛） |
| SR-6 | 🟡 低 | `verify-team-turn-rollback-internal-keys.ts` **单独运行是空跑**（它只导出函数，由 `test:turn-rollback` 间接执行） | 独立执行 EXIT=0 但无任何输出 | ✅ 已登记到记忆（避免后续会话据此误判「守卫通过」） |
| SR-7 | 🟡 低 | 3 个文件未过 Prettier（早期编辑漏跑格式化） | `prettier --check` 报 warn | ✅ 已修；复检「All matched files use Prettier code style」 |
| SR-8 | 🟡 低 | **环境层**：`package.json` 声明 `packageManager: bun@1.3.12`（HEAD 既有），`pnpm run` 已拒绝执行脚本（「This project is configured to use bun」） | `pnpm run test:task-tool` 输出 2 行错误 | ✅ 改用 `bun run`（与正在进行的 bun 迁移一致）；不影响代码正确性 |
| SR-9 | 🟠 中 | **环境阻塞（非本任务）**：bun 迁移正在并发进行——`pnpm-lock.yaml` 已删除、`bun.lock` 已生成，而 `node_modules` 处于**部分安装**状态（`zod` / `vitest` 均不可解析），`bun run` 也解析不到 `tsx`/`vitest` 二进制 | 直跑验收脚本报 `ERR_MODULE_NOT_FOUND: Cannot find package 'zod'`；`tsc` 报 `Cannot find module 'vitest'` | ✅ 已按迁移方向执行 `bun install`；验收脚本改用 `bun src/verification/...` 直跑（bun 原生执行 TS，等价） |
| SR-10 | 🔴 **高（险情，已修正）** | **T-31 初版删过头**：把 `task_parent_auto_resume_contexts` 表与唯一写入方 `upsertTaskParentAutoResumeContext` 一并删除，但该表**仍被 `task/task-parent-auto-decision.ts:146-152` 消费**（子代理中途停下时父代理需父会话原始请求数据构造父级决策请求）→ 若直接发布，自动决策路径会**静默退化为「无父上下文」** | 残留 grep 命中 `task/task-parent-auto-decision.ts:147` 的 `FROM task_parent_auto_resume_contexts` | ✅ 已按**正确边界**收窄：保留上下文存储（新建 `task/task-parent-context-store.ts`，含 `upsertTaskParentContext` / `clearTaskParentContext`）、恢复建表与 2 条删除恢复语句、恢复 2 处写入点与终态清理；其余 drain/schedule/consume/计数照删。验证：2 条自动决策验收脚本 ok + 9 条验收脚本全 ok |
| SR-11 | 🟠 **中（收口阶段自查发现，已修正）** | **两条验收脚本在收口阶段稳定失败（退出码 1）**：`verify-task-tool-no-permission` 与 `verify-task-tool-failure-propagation` 断言**全部通过**（日志明确打印 `: ok`），但进程随后以 1 退出——原因是单通道交付的**同步唤醒**：父会话空闲时子代理结算会立即唤醒父会话，其**后台流**与脚本收尾竞态，脚本关库后该流仍在 flush 运行事件 → `Database has closed` → 抛错 | 复跑两次**确定性复现**（非偶发）；对照 `verify-task-tool-auto-run` 的既有隔离手法（父会话插入为 `state_status='paused'`，让唤醒按设计「留库待消费」）发现这两条脚本**缺该隔离** | ✅ 已按同一手法修复：两条脚本的父会话插入改为 `state_status='paused'` 并注释说明「本脚本关注点与唤醒无关 + 竞态成因」。**唤醒本身仍由 `verify-task-job-wake.ts` 专门验收**，覆盖未削弱。验证：两条脚本单独复跑 OK，且 9 条连续一遍全 ok |

**复盘结论**：SR-3 说明「工具名兼容」这类看似机械的改动**必须跑端到端验收**（单测与 typecheck 全绿也发现不了——
因为它只在「沙箱派发 → 子会话创建」这条链路上暴露）；SR-4 说明**删除生产者时必须同步清理所有消费方的断言**。

### 收口验证证据（依赖完好时逐条实测）

| 资产 | 结果 | 时点 |
|---|---|---|
| `tool-sandbox-permission-ladder.test.ts` | **43/43** ✅（SR-3 修复后） | 依赖完好 |
| `subagent-tool-name-and-input-aliases` / `tool-name-compat` / `task-tools-schema` | **9 + 6 + 18 全绿** ✅ | 依赖完好 |
| `verify-task-tool-no-permission` | ok ✅ | 依赖完好 |
| `verify-task-tool-auto-run` | ok ✅（SR-4 修复后） | 依赖完好 |
| `verify-task-parent-auto-resume` | ok ✅（SR-4 修复后） | 依赖完好 |
| `verify-task-tool-failure-propagation` | ok ✅（SR-4 修复后） | 依赖完好 |
| `verify-task-tool-pending-interaction-resume` | ok ✅ | 依赖完好 |
| `verify-task-tool-question-resume` | ok ✅ | 依赖完好 |
| `verify-task-tool-parent-auto-decision` | ok ✅ | 依赖完好 |
| `verify-task-tool-parent-auto-permission-decision` | ok ✅ | 依赖完好 |
| `verify-task-job-wake` | ok ✅ | 依赖完好 |
| web 全量 | **513 文件 / 4972 用例 EXIT=0** ✅ | T-16b 后 |
| mobile 全量 | **13 文件 / 273 用例** ✅ | T-29 后 |
| shared / shared-ui | 9/9 · 18/18 ✅ | 修复后 |
| `check:fastify-alignment` | exit 0 ✅ | 修复后 |

> ✅ **已补（bun 直跑，单次连续）**：9 条 task 相关验收脚本（含 `verify-task-job-wake`）**全部 ok**——
> 依赖恢复后以 `bun src/verification/run-with-test-env.ts -- <script>` 连续执行（`tsx` 二进制在迁移中缺失，bun 原生跑 TS 等价）。
> ✅ **网关全量单测最终快照**：**532 文件 / 4072 用例通过**（1 文件 3 用例既有 skip），**EXIT=0**。

---

## 详细复查（Gate 0 调整后）

**复查范围**：D-1 决策（新增 synthetic role）后的方案可行性；Phase 划分；爆炸半径完整性；
与既有资产（验收脚本、handoff 内部键、team resume、移动端渲染）的冲突。
**复查方法**：两路 exhaustive 审计（唤醒原语 / 前缀消费面 / synthetic role 全链路）+ 对方案逐条反证。

### 复查发现

| 编号 | 严重度 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| R-01 | 🔴 高 | **D-1 原描述不准确**：新增 role **不会**自动让「模型能看到」——主链无 else、无 assertNever，synthetic 会被静默丢弃 | `message-to-model-messages.ts:456-587`；`session-message-store.ts:626-755` | 已转成显式任务 T-08 / T-10，并在 §D 标注 |
| R-02 | 🔴 高 | **落库会被静默改写成 `system`**：`appendSessionMessageV2` 末尾 `else → system`；与前端白名单叠加会造成「落库 system、前端丢弃、模型也看不到」三重错位 | `message-v2-adapter.ts:571-591` | 已成 T-07（显式分支） |
| R-03 | 🔴 高 | **全链路零编译期保护**：只改 shared 类型不会有任何编译错误；唯一 `assertNever` 网作用在 `UnifiedMessage` 上 | `native-message-bridge.ts:143-146`；`message-to-model-messages.ts:117-118` | ✅ **已关闭**——T-09 把 synthetic 加入 `UnifiedMessage`，并由 coordinator 探针实测确认（注入未处理成员 → `TS2322 not assignable to type 'never'`） |
| R-04 | 🟠 中 | **请求作用域清理不覆盖 synthetic** → 回滚/删除后可能残留孤儿 synthetic 行 | `routes/stream.ts:1175`；`message-v2-adapter.ts:1635-1651` | 已并入 T-07 |
| R-05 | 🟠 中 | **execute-command 入口会 400 拒绝** synthetic 快照 | `routes/commands.ts:91-96` | 已成 T-11 |
| R-06 | 🟠 中 | **移动端与 shared-ui 会把 synthetic 渲染成 assistant 气泡**（`isUser` 二元判断） | `shared-ui/src/chat/ChatMessage.tsx:20`；`apps/mobile/src/components/chat-message-bubble.tsx:44` | 已并入 T-12 |
| R-07 | 🟠 中 | **前端白名单静默丢弃**满足「不可见」，但需显式决策 + 测试断言，避免被后续改动误放行 | `normalize-chat-messages.ts:66-67`；`normalize-chat-messages.test.ts:172-174` | 已并入 T-12 / T-13 |
| R-08 | 🟡 低 | **同名独立 `MessageRole`**（agent-core summarizer、opencode-llm）不会同步，易被误判为「已全链路覆盖」 | `session-summarizer.ts:1`；`opencode-llm/src/types/message.ts:6` | 方案显式声明「不在范围」，并在 T-05 备注 |
| R-09 | 🟡 低 | **DB 无 CHECK 约束**：role 脏值可静默落库 | `infra/db.ts:285`（`role TEXT NOT NULL`） | 决策：**不加 CHECK**（避免迁移风险），改为在写入层加运行时校验（并入 T-07） |
| R-10 | 🟡 低 | 原 Phase 划分与 T 编号因 D-1 变更已作废；`.NET` 已移出范围 | 本方案 v1（已重写） | 已重排为 5 phase / 28 task |
| R-13 | 🟠 中 | **前端渲染契约此前未纳入设计**：上游把 synthetic 子代理结果渲染为**可点击跳转子会话的一行 Notice**，本仓仅有 `assistant_event` 卡片 | `session-ui/.../session-timeline-row.tsx:333-353,406-432`；本仓 `tool-sandbox.ts:1033-1052` | 已补 `## 前端渲染与展示设计` 章节 + Phase 3（T-14…T-17） |
| R-14 | 🟡 低 | 工具名与上游不一致（上游 `subagent`，本仓 `task`），且上游本身做过 `task→subagent` 迁移 | `v1/config/migrate.ts:119` | 已成 T-23（canonical 改 `subagent` + 保留别名） |
| R-15 | 🔴 高 | **发现并已修复**：读路径 `v2ToV1Message` 丢弃 `description`/`metadata`——写入侧已持久化，但读侧未回传，客户端只会收到光秃秃的 `role: 'synthetic'`，Phase 3 Notice 无内容可渲染（**静默**：类型与测试都不会报） | `message-v2-adapter.ts` 的 `v2ToV1Message` 返回语句 | ✅ 已修（读路径回传两字段）；已补往返测试 `synthetic-role-roundtrip.test.ts` 覆盖，其中「读路径带回 description/metadata」一例即为该缺陷的回归守卫 |
| R-16 | 🟠 中 | **发现并已纠正**：`apps/web` 的 vitest 把 `@openAwork/shared-ui` 整体别名到测试 mock（`apps/web/vitest.config.ts:16-17`），因此**核心解析逻辑不能放在 `shared-ui`**——在 Web 测试环境根本不可用（真机才会走真实包） | `apps/web/vitest.config.ts:16-17` → `src/test/mocks/shared-ui.tsx` | ✅ 已纠正：`parseSubagentNotice` 下沉到 `packages/shared`（该包已有同类先例 `parseAssistantTraceContent`），三端共用同一实现 |
| R-17 | 🟠 中 | 移动端直接 `import '@openAwork/shared'` 会绑定构建顺序：包入口指向 `dist/`，而 CI 的 test job 只构建 `opencode-llm`（不构建 `shared`）→ 纯逻辑测试在 CI 会失败 | `ci.yml:80/111/134`；`packages/shared/package.json` exports | ✅ 已解决：新增 `apps/mobile/vitest.config.ts` 把 `@openAwork/shared` 别名到源码，移动端改为委托 shared SSOT（交叉验证 266/266 全绿） |
| R-18 | 🔴 高 | **T-19 的真实阻塞**：本仓**不存在**「不带新用户消息地唤醒会话」的能力——`routes/stream.ts:2467` 的 `persistStreamUserMessage` 在非 team-resume 路径下无条件落用户轮，且 `streamRequestSchema.message` 必填（`:571`）。原方案假设「拆分 `runSessionInBackground` 即可」**是错的** | `routes/stream.ts:2467`、`:571`；现成可用机制在 `stream-model-round.ts:1300-1302`（`syntheticContinuationPrompt`，只进模型请求不落库） | ⛔ **未解决**——已把 T-19 拆为 T-19b（需独立设计与验证窗口），并据此把 T-20/T-21/T-24 标记为被阻塞。**这是 Phase 4 收尾与 Phase 5 的关键路径** |
| R-11 | 🟠 中 | **未决**：拆分 `runSessionInBackground` 对 team resume 路径的影响未验证 | `stream-runtime.ts:1112-1119` | 列为 T-15 的强制回归项 + 开放问题 Q2 |
| R-12 | 🟡 低 | **未决**：连续回流上限 10 在「留库待消费」模型下的归属层 | `task-parent-auto-resume.ts:7` | 开放问题 Q4，T-16 时定 |

### 复查结论

- **方案可进入 Phase 1**：Phase 1（Job 骨架）与 D-1 决策解耦，只增不改行为，风险可控。
- **Phase 2 才是 D-1 的真实成本**：约 9 个任务（T-05…T-13），是本方案最大的一块；建议
  **Phase 2 单独一个 PR 边界**，并以 T-13 的往返单测作为完成门槛。
- **强烈建议保留 T-09**：它是把「静默失效」转成「编译失败」的唯一手段。若省略，
  未来任何人改动 `MessageInfo` 联合都可能让 synthetic 静默失效。
- **回归红线**：`verify-team-turn-rollback-internal-keys.ts` 必须在 T-17 后仍全绿
  （它是内部键注册表与源码扫描的一致性守卫）。
- **未决项**：R-11、R-12 不阻塞 Phase 1，但必须在进入 Phase 3 前关闭。

---

## 验证策略

### 新增验收（ATDD，走 `src/verification/verify-*.ts`，真实 SQLite + 真实 HTTP）

| 脚本 | 覆盖 |
|---|---|
| `verify-synthetic-role-roundtrip.ts` | role 全链路：落库保持 `synthetic` → 下发上游降级为 `user` → 前端不渲染 |
| `verify-task-job-single-channel.ts` | 单通道：恰好一条合成消息、恰好一次唤醒、重复投递幂等 |
| `verify-task-job-restart-recovery.ts` | 重启恢复：child 在跑 → 续跑；已终态 → 补投通知；父挂起 → `resume:false` |
| `verify-task-subagent-depth.ts` | 深度链计算与超限 ToolFailure（含 sessionID 可见） |

### 必须保持全绿的既有资产

- `verify-task-tool-auto-run.ts`、`verify-task-tool-no-permission.ts`
- `verify-task-tool-failure-propagation.ts`、`verify-task-tool-pending-interaction-resume.ts`
- `verify-team-turn-rollback-internal-keys.ts`（内部键注册表守卫）
- `verify-message-v2-event-projection.ts`、`verify-message-v2-deep-conversation.ts`（role 变更敏感）
- `test:task-tool` 全链路

### 单测

- `task-job.test.ts`：settle 幂等、25 条消费上限、cancel、并发 start
- synthetic role：`normalize-chat-messages.test.ts` 扩充 + 往返单测
- 深度计算纯函数单测

### 门禁

每阶段结束：改动包 `typecheck` exit 0 + 改动文件 ESLint 0 error + 上述相关验收脚本通过。

---

## 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| synthetic 静默失效（落库/上下文/渲染三处） | 模型看不到结果或前端渲染成 assistant | T-07/T-08/T-10/T-12 显式分支 + T-09 编译网 + T-13 往返单测 |
| 双通道并存期重复交付 | 父会话收到两条结果 | 统一 notificationID 幂等；T-19 断言「恰好一条」 |
| 忙时丢失结果（去掉重试后） | 结果滞留未唤醒 | 合成消息已持久化，靠自然回合兜底；恢复扫描补投 |
| 重启恢复重复跑子代理 | 重复副作用 | 复用 `started_at` 生成 generation key（对齐 `subagent-job.ts:23-26`） |
| 拆分 `runSessionInBackground` 破坏 team resume | team 会话无法续跑 | T-15 强制回归 + R-11 关闭作为进入 Phase 3 的门槛 |
| 内部键注册表漏改 | handoff 误把回流当用户回合 | 守卫测试强制登记 |
| `task_parent_auto_resume_contexts` 迁移 | 升级期丢上下文 | T-21 迁移脚本 + 旧表保留只读一个版本 |

**回滚策略**：Phase 1/2/3 全程 feature flag 双轨，回滚 = 关 flag；Phase 4 的移除动作拆为独立提交。
**严禁 `git reset`/`revert`/`restore`/`clean` 系列指令**（AGENTS.md 硬约束）；需要撤销时按允许方式手工回退。

---

## 明确不照抄的部分（保留本仓优势）

| 本仓能力 | 位置 | 对上游的差异 |
|---|---|---|
| 空响应警告 | `task/empty-task-response-detector.ts` | 上游只有 `NO_TEXT` 常量 |
| 连续回流上限 10 | `task/task-parent-auto-resume.ts:7` | 上游无自激保护 |
| 结果含工具结果拼装 | `task/delegated-task-display.ts:257-276` | 上游只取最后一条 assistant text |
| 子代理中途替决策 | `task/task-parent-auto-decision.ts` | 上游无等价能力 |
| 任务图 `task_*` 工具族 | `task/task-crud-tools.ts` | 上游只有 Job，无任务图 |

**结论**：借它的**状态机骨架（Job + synthetic + resume）**，不照抄它的**文本抽取与结果丰富度**。

---

## 开放问题

| 编号 | 问题 | 关闭时点 | 状态 |
|---|---|---|---|
| Q1 | synthetic 落库后，现有提示词/权限链是否会把它误判为用户输入？（`session-message-store.ts` 构建上游历史时对 role 与 part flag 的处理） | Phase 2 前 | ✅ **已关闭**：Phase 2 全链路改造（T-05…T-13）逐处穷尽 `switch` + `assertNever` 编译网 + 探针实测；模型上下文映射显式处理该角色，不进用户输入链 |
| Q2 | 拆分 `runSessionInBackground` 是否破坏 team resume（`teamResumeRootSessionId`）？ | 进入 Phase 3 前（阻塞） | ✅ **已关闭**：最终未做拆分，改为新增 `continueSessionFromHistory()` + `continueFromHistory` 模式（T-18/T-19b-1…5）；team resume 未受影响，验收脚本全绿 |
| Q3 | 连续回流上限 10 在「留库待消费」模型下是否保留？保留则归于哪一层？ | T-16 时 | ✅ **已关闭（T-32）**：**保留**，归属**交付层**——`task/task-wake-budget.ts`，由 `deliverTaskCompletion` 在**真正要唤醒时**消费预算；用户真实交互重置（复用 `isGatewayInternalRequestKey` 判定网关内部请求，唤醒自身不重置）。理由：唤醒是事件驱动的，若被唤醒的父会话又委派新的后台子代理，会形成**无界自激**，正是旧上限存在的理由 |
| Q4 | 前端是否需要为 synthetic 渲染专用卡片？（当前决策：不渲染） | T-12 时 | ✅ **已关闭（决策被推翻并升级）**：T-16b 决定**渲染**——不是"专用卡片"，而是**时间线内插的通知行**（`SubagentNoticeRow`，`ChatRenderGroup` 判别联合），chat + team 双端 + 移动端均接入 |

---

## Notes

- **本次规划与复查未改动任何生产代码**；Phase 1 需用户显式批准（Gate 1）后开工。
- 本方案与 `260921-opencode-v2能力对齐` 是并列关系：该方案覆盖工具面（`execute`/`read`/`browser` 等），
  本方案专攻**子代理结果交付语义 + synthetic role**，无重叠文件冲突（主战场 `task/` + `session/` + `message/`）。
- 上游版本锚点：`temp/opencode-v2.0.12`（tag `v2.0.12`）。后续若上游升版，需重核
  `subagent.ts` / `job.ts` / `subagent-completion.ts` 三个文件的语义。
- 事实来源：opencode 侧 5 个核心文件精读；本仓侧由三路 exhaustive 审计（会话唤醒原语 / 前缀消费面 /
  synthetic role 全链路）给出 file:line 证据，均已在正文明列。
- **Plan maintenance**（2026-09-22，Phase 1 交付）：T-01…T-04 已完成并勾选；master_plan 对应行同步为
  `✅ Completed`，T-05 由 `waiting` 升为 `pending`（前置 T-04 已满足）；新增 Execution Log 4 条；
  自查修复 1 个缺陷（`background()` 误读 `job.recovery`）并回归。
- **Plan maintenance**（2026-09-22，决策修订）：D-1 由「复用 user + synthetic:true」改为「新增 synthetic role」后，
  新增 T-05…T-13 共 9 个任务；随后按「上游对齐优先」修订 D-3/D-4/D-6 并补 Phase 3 前端渲染（T-14…T-17），
  最终重排为 5 phase / 28 task。原 v1 的 Phase 2/3 划分已废弃（R-10）。
- **未改动**：`subagent-model-policy.ts` 业务语义、team 层编排、`.NET` 镜像（已废弃）。
- **Memory sync**（2026-09-22）：**已完成**——向 `.agentdocs/index.md` 的「架构决策」写入 3 条（单通道交付 / 唤醒原语 / synthetic 角色契约），
  「已知陷阱」写入 7 条（web vitest mock shared-ui、shared 的 dist 解析与 CI 构建顺序、interface 索引签名、zod transform 与 `.shape`、内部键守卫两处盲区、
  验收脚本全局计数断言的假失败、`check:fastify-alignment` 现状）。
- **归档状态**：**已归档（2026-09-22）** → `.agentdocs/workflow/done/`。归档判据（见 `260916-agentdocs归档审计与runtime清理.md`）：
  **文档任务框全部勾选，或「未勾选项已有明确处置」**——本方案 T-01…T-32 全部完成；
  唯一残留的 T-30 **端到端**变体属**环境阻塞且已明确处置**（`AI_API_KEY` 为空 → 无 LLM → 无法产生真实通知；
  已在 T-30 ① 完整记录探针证据与就绪步骤），**非待办**。组件级三视口验收已通过（61 断言 × 3 视口）。
