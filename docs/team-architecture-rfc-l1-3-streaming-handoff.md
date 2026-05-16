# RFC: L1.3 流式 Handoff 增量改造

> **状态**：草稿（待团队 review）
> **作者**：架构组
> **创建**：2026-05-16
> **关联**：
>
> - L1 基线（v1.1）：`team-architecture-l1-baseline.md`
> - 详细设计（v1.1）：`team-architecture-l1-3-streaming-handoff-spec.md`
> - 追溯审计（必读）：`team-architecture-traceback-audit.md`
> - Phase B 实施记录：`.agentdocs/workflow/done/260515-team-phase-b-实施方案.md`
> - Phase C 实施记录：`.agentdocs/workflow/done/260515-team-phase-c-实施方案.md`
> - Phase D 实施记录：`.agentdocs/workflow/done/260516-team-phase-d-实施方案.md`

---

## 1. 摘要

完成 `services/agent-gateway/src/handoff/artifact-chain.ts` 行 22 注释承诺的"Phase D 加阻塞门禁"——让 c 层的 [NEEDS CLARIFICATION] 能真正等待用户回答，而不是推送后直接做 plan/tasks。

**核心改造**：4 项（详见 §4），工作量 13.5 天。

**最大阻塞期望**：c session 在等用户回答时**不能销毁也不能重启**。这是与 v3.10 原子 handoff 设计的根本差别。

---

## 2. 问题陈述

### 2.1 用户可见症状

当前用户在 c 阶段提了一个含歧义的需求时：

1. c 输出 spec，标注 `[NEEDS CLARIFICATION: 用 OAuth 1.0 还是 2.0]`
2. WS 推送给前端，前端显示"需要澄清"
3. **但 c 不等用户回答，直接开始写 plan 和 tasks**
4. 用户回答后没有地方写回去——回答的内容被忽略
5. 最终产物是基于 c 自己猜测的（往往猜错）

### 2.2 代码层面的根本原因

`services/agent-gateway/src/handoff/artifact-chain.ts::runArtifactChain` 是**线性 6 步**：

```
spec → parse clarifications → plan → constitution check → tasks → write result
```

整个过程**没有**等待外部输入的能力。`session_inbound_messages` 表不存在，c 没有"反向通道"接收用户的澄清答案。

### 2.3 影响

- 用户需求频繁被错误理解（spec/plan/tasks 基于错误假设）
- 团队体验"AI 不听人说话"
- 用户绕过 team 模式，回到普通对话

### 2.4 为什么 Phase D 没补上这个门禁

`pm2-runner.ts` 行 22 注释写"Phase D 加阻塞门禁"，但 Phase D 实际只补了 Constitution Check 硬门禁，没碰 clarifications 阻塞——因为：

1. 没有反向通道协议（需要 `session_inbound_messages`）
2. c session 在 LLM 调用循环中没有"等待"语义（需要 substate 状态机）
3. cancel/pause 信号没有 inbound 通道（与 D33/D42 协议未对齐）

这 3 个问题是耦合的，必须**一次性**解决。

---

## 3. 目标与非目标

### 3.1 目标（必须做到）

1. **G1**：c 层在产生 [NEEDS CLARIFICATION] 时阻塞自己，等待用户答案
2. **G2**：c session 在等待期间**不重启**——保持 LLM 上下文 + 7 层注入栈不变
3. **G3**：用户答案能回写到 c session 的对话流（通过 `session_inbound_messages`）
4. **G4**：上游（b）能任意时刻看到 c 当前在哪个子状态（spec_ready / clarifying / plan_ready / tasks_ready）
5. **G5**：cancel/pause 信号能通过反向通道传到任意正在运行的层
6. **G6**：所有改造对老路径（feature flag 关闭时）零影响

### 3.2 非目标（本次不做）

- ❌ d 层 review 的完整实施（spec review + quality review）—— 由独立 RFC 处理
- ❌ b 层拆分为 router + companion + scheduler —— 现状够用
- ❌ architecture review check 点 —— 与 d.2 一起延后
- ❌ 跨进程 watcher 协调 —— 仍单进程
- ❌ 多用户协同澄清 —— 单用户即可

---

## 4. 改造范围

### 改造 1：`session_inbound_messages` 表（新增）

#### 4.1.1 Schema

```ts
// 在 services/agent-gateway/src/db.ts 中加入
db.exec(`
  CREATE TABLE IF NOT EXISTS session_inbound_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    from_role_layer TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT,
    expires_at TEXT,
    consumed_by_loop_iteration INTEGER
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_session_inbound_to_pending
    ON session_inbound_messages(to_session_id, state, created_at)
    WHERE state = 'pending'
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_session_inbound_cancel
    ON session_inbound_messages(to_session_id, message_type)
    WHERE message_type = 'cancel_signal' AND state = 'pending'
`);
```

#### 4.1.2 message_type 取值规约

| message_type           | 来源       | 目标      | 用途                                |
| ---------------------- | ---------- | --------- | ----------------------------------- |
| `clarification_answer` | reception  | pm1 (c)   | 用户对 [NEEDS CLARIFICATION] 的回答 |
| `user_input`           | reception  | pm1/pm2   | 用户中途追加的要求                  |
| `cancel_signal`        | system     | 任意      | 级联取消（D33）                     |
| `pause_signal`         | system     | 任意      | 级联暂停（D42）                     |
| `resume_signal`        | system     | 任意      | 级联恢复（D42）                     |
| `escalation_request`   | pm1/pm2/eg | reception | 反向通知（L1.4 escape hatch #1）    |
| `progress_report`      | 任意       | reception | 进度上报（L1.4 escape hatch #2）    |

#### 4.1.3 模块文件

新建 `services/agent-gateway/src/handoff/session-inbound-store.ts`：

```ts
export interface SessionInboundMessage {
  id: string;
  userId: string;
  toSessionId: string;
  fromRoleLayer: 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer' | 'system';
  messageType:
    | 'clarification_answer'
    | 'user_input'
    | 'cancel_signal'
    | 'pause_signal'
    | 'resume_signal'
    | 'escalation_request'
    | 'progress_report';
  payload: Record<string, unknown>;
  state: 'pending' | 'consumed' | 'expired';
  createdAt: string;
  consumedAt: string | null;
  expiresAt: string | null;
  consumedByLoopIteration: number | null;
}

export function postInbound(input: {
  toSessionId: string;
  userId: string;
  fromRoleLayer: SessionInboundMessage['fromRoleLayer'];
  messageType: SessionInboundMessage['messageType'];
  payload: Record<string, unknown>;
  ttlMs?: number; // 默认 24h；cancel/pause 不过期（传 null）
}): SessionInboundMessage;

export function consumePendingInbound(
  toSessionId: string,
  loopIteration: number,
): SessionInboundMessage[]; // 按优先级排序：cancel > pause > clarification > user_input

export function expireOverdueInbound(): number; // watcher 周期调用
```

**消费协议关键约束**：

- 必须用单事务原子标记为 `consumed`，避免 LLM 循环并发消费同一消息
- `cancel_signal` 优先级最高，必须先返回（即使队列里有 100 条 user_input）
- 消息消费后必须有 audit log（包含 message_id / consumed_at）

#### 4.1.4 工作量

1 天（schema + store 模块 + 单元测试）

---

### 改造 2：`sessions.substate` 字段 + 状态机模块（新增）

#### 4.2.1 Migration

```ts
// 在 db.ts 现有 ensureColumn 调用之后加入
ensureColumn('sessions', 'substate', 'TEXT DEFAULT NULL');
ensureColumn('sessions', 'substate_updated_at', 'TEXT DEFAULT NULL');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_substate
    ON sessions(substate) WHERE substate IS NOT NULL
`);
```

同时补 D18 缺失字段（与 L1.3 改造一并完成）：

```ts
ensureColumn('sessions', 'structural_depth', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sessions', 'execution_depth', 'INTEGER NOT NULL DEFAULT 0');
```

#### 4.2.2 substate 取值常量模块

新建 `services/agent-gateway/src/handoff/substates.ts`：

```ts
export const SUBSTATES_PM1 = {
  IDLE: 'idle',
  DRAFTING_SPEC: 'drafting_spec',
  SPEC_READY: 'spec_ready',
  CLARIFYING: 'clarifying', // 等待 inbound clarification_answer
  DRAFTING_PLAN: 'drafting_plan',
  PLAN_READY: 'plan_ready',
  DRAFTING_TASKS: 'drafting_tasks',
  TASKS_READY: 'tasks_ready',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export const SUBSTATES_PM2 = {
  IDLE: 'idle',
  CONSTITUTION_CHECK: 'constitution_check',
  ARCHITECTURE_REVIEW: 'architecture_review',
  DISPATCHING: 'dispatching',
  AWAITING_EG: 'awaiting_eg',
  REVIEWING: 'reviewing',
  ESCALATING: 'escalating',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export const SUBSTATES_EXEC = {
  IDLE: 'idle',
  IMPLEMENTING: 'implementing',
  TESTING: 'testing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type Pm1Substate = (typeof SUBSTATES_PM1)[keyof typeof SUBSTATES_PM1];
export type Pm2Substate = (typeof SUBSTATES_PM2)[keyof typeof SUBSTATES_PM2];
export type ExecSubstate = (typeof SUBSTATES_EXEC)[keyof typeof SUBSTATES_EXEC];
```

#### 4.2.3 substate 更新工具

新建 `services/agent-gateway/src/handoff/substate-store.ts`：

```ts
export function updateSubstate(input: {
  sessionId: string;
  substate: string;
  publishEvent?: boolean; // 默认 true
}): void {
  // 用事务原子更新 + 发 team-events 通知前端 + 写 audit log
  // 关键不变量 I2：DB 更新与事件推送在同一事务内（避免不一致）
}

export function getSubstate(sessionId: string): string | null;
```

#### 4.2.4 工作量

2 天（migration + 常量模块 + store + 单元测试）

---

### 改造 3：c 层引入"等待 inbound"循环（核心改造）

#### 4.3.1 改造目标

修改 `services/agent-gateway/src/handoff/artifact-chain.ts::runArtifactChain`，让它从"线性 6 步"变为"可阻塞状态机"。

#### 4.3.2 新流程伪代码

```ts
async function runArtifactChain(input: ArtifactChainInput) {
  // ─── Step 1: 生成 spec ──
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.DRAFTING_SPEC });
  const specContent = await callLlmWithRetry(...);
  const specArtifactId = createArtifact({...});
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.SPEC_READY });

  // ─── Step 2: 阻塞等澄清（如有）──
  const clarifications = parseClarifications(specContent);
  if (clarifications.length > 0) {
    await updateSubstate({ sessionId, substate: SUBSTATES_PM1.CLARIFYING });

    // 推送 escalation_request 让 b 通知用户
    postInbound({
      toSessionId: receptionSessionId,
      fromRoleLayer: 'pm1',
      messageType: 'escalation_request',
      payload: {
        clarifications,
        specArtifactId,
        questionType: 'needs_clarification',
      },
    });

    // 阻塞等待用户答案
    const answers = await waitForClarificationAnswers({
      sessionId,
      questionIds: clarifications.map((c) => c.id),
      timeoutMs: 24 * 60 * 60 * 1000,  // 24h
      signal: input.signal,             // cancel 时退出
    });

    // 把答案注入到下一步的 LLM context
    input.clarificationContext = formatClarificationContext(answers);

    // 检查是否被 cancel
    if (input.signal.aborted) {
      await updateSubstate({ sessionId, substate: SUBSTATES_PM1.CANCELLED });
      return;
    }
  }

  // ─── Step 3: 生成 plan（注入 constitution + 澄清答案）──
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.DRAFTING_PLAN });
  // ... (同现状，但 user message 多 clarificationContext)
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.PLAN_READY });

  // ─── Step 4: 生成 tasks ──
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.DRAFTING_TASKS });
  // ...
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.TASKS_READY });

  // ─── Step 5: 写 handoff result ──
  writeHandoffResult(...);
  await updateSubstate({ sessionId, substate: SUBSTATES_PM1.COMPLETED });
}
```

#### 4.3.3 `waitForClarificationAnswers` 实现

```ts
async function waitForClarificationAnswers(input: {
  sessionId: string;
  questionIds: string[];
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<Record<string, string>> {
  const collected: Record<string, string> = {};
  const deadline = Date.now() + input.timeoutMs;

  while (Object.keys(collected).length < input.questionIds.length) {
    if (input.signal.aborted) throw new AbortError('cancelled');
    if (Date.now() > deadline) throw new Error('clarification timeout');

    const messages = consumePendingInbound(input.sessionId, /* loopIteration */ ...);
    for (const msg of messages) {
      if (msg.messageType === 'cancel_signal') throw new AbortError('cancelled');
      if (msg.messageType === 'clarification_answer') {
        const { questionId, answer } = msg.payload as ClarificationAnswerPayload;
        if (input.questionIds.includes(questionId)) {
          collected[questionId] = answer;
        }
      }
    }

    // 简单轮询（2s 间隔）
    // L3 优化：可换为 EventEmitter 通知 + 2s 兜底轮询
    await sleep(2000);
  }

  return collected;
}
```

#### 4.3.4 关键不变量

- **I1 c session 不重启**：整个流程在同一 LLM session 内完成，messages_json 单调追加，sessionId 不变
- **I3 inbound 消费幂等**：consumed 状态单向，不会回到 pending
- **I5 cancel 级联**：signal.aborted 立即退出循环

#### 4.3.5 前端配合改造

`apps/web/src/pages/team/runtime/`：

- 监听 WS 推送的 `escalation_request` 事件
- 显示澄清问题界面，让用户输入答案
- 调用新增的 API `POST /team/sessions/:id/inbound` 写回 inbound

新增路由 `services/agent-gateway/src/routes/team-handoffs.ts`：

```ts
app.post('/team/sessions/:sessionId/clarification-answers', async (req, reply) => {
  const { sessionId } = req.params;
  const { answers } = req.body;  // [{ questionId, answer }]

  // 找到 reception session（向上找 parent 直到 role_layer='reception'）
  const targetSession = findPm1SessionByReceptionAndQuestionIds(...);

  // 写 inbound
  for (const { questionId, answer } of answers) {
    postInbound({
      toSessionId: targetSession.id,
      fromRoleLayer: 'reception',
      messageType: 'clarification_answer',
      payload: { questionId, answer, answeredBy: 'user', answeredAt: Date.now() },
    });
  }

  return { ok: true };
});
```

#### 4.3.6 工作量

5 天（核心循环改造 + 前端 UI + 端到端集成 + 单元测试）

---

### 改造 4：`handoff_records` 补字段（新增）

#### 4.4.1 Migration

```ts
ensureColumn('handoff_records', 'idempotency_key', 'TEXT DEFAULT NULL');
ensureColumn('handoff_records', 'paused_at', 'TEXT DEFAULT NULL');
ensureColumn('handoff_records', 'paused_by_user_id', 'TEXT DEFAULT NULL');
ensureColumn('handoff_records', 'pause_reason', 'TEXT DEFAULT NULL');

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_handoff_records_idempotency
    ON handoff_records(idempotency_key) WHERE idempotency_key IS NOT NULL
`);
```

#### 4.4.2 与现有代码对接

- `createHandoff`：加 optional `idempotencyKey` 参数
- `pauseHandoff`：写 `paused_at` / `paused_by_user_id` / `pause_reason`

#### 4.4.3 工作量

0.5 天

---

## 5. 测试策略

### 5.1 单元测试（必做）

- `session-inbound-store.test.ts`：store CRUD + 优先级排序 + TTL 过期
- `substate-store.test.ts`：状态转移 + 事件原子性
- `artifact-chain.test.ts`：含澄清回路的端到端 + cancel 退出

### 5.2 chaos test（必做）

- **场景 1**：c 等澄清时进程崩溃 → watcher 重启后能从 substate=clarifying 恢复
- **场景 2**：1000 条 inbound 同时写入同一 session → 消费顺序与延迟正确
- **场景 3**：用户回答后 5s 内 c session 推进
- **场景 4**：cancel 信号广播 → 5s 内所有子 session 停止

### 5.3 不变量验证

| ID  | 不变量                    | 测试断言                                                        |
| --- | ------------------------- | --------------------------------------------------------------- |
| I1  | c session 不重启          | sessions.id 全程不变 / messages_json 单调追加 / created_at 不变 |
| I2  | substate 推送原子性       | DB 查询与事件订阅最终一致                                       |
| I3  | inbound 消费幂等          | 同 message_id 只能 consumed 一次                                |
| I5  | cancel 级联完整性         | 整个 session 树的 handoff_records 都进入 cancelled 状态         |
| I6  | pause 不浪费已付 LLM 成本 | 当前轮 LLM 调用完成后才冻结                                     |

### 5.4 灰度发布

- Phase 1：内部 dogfooding（feature flag 默认关闭，开发组手动开启）
- Phase 2：种子用户灰度（5 个 team workspace）
- Phase 3：全量启用

---

## 6. 工作量与排期

| 阶段       | 任务                                | 工作量      |
| ---------- | ----------------------------------- | ----------- |
| **改造 1** | session_inbound_messages 表 + store | 1 天        |
| **改造 2** | substate 字段 + store               | 2 天        |
| **改造 3** | c 层等待循环 + 前端 UI              | 5 天        |
| **改造 4** | handoff_records 补字段              | 0.5 天      |
| 单元测试   | 各模块测试覆盖                      | 2 天        |
| chaos test | 5 个场景验证                        | 3 天        |
| 灰度发布   | 3 阶段 rollout + 监控               | 内嵌        |
| **总计**   |                                     | **13.5 天** |

**关键路径**：改造 1 → 改造 2 → 改造 3。改造 4 可与改造 3 并行。

**人员配置**：1 名后端 + 0.5 名前端

---

## 7. 风险与缓解

| 风险                                  | 严重度 | 缓解                                                          |
| ------------------------------------- | ------ | ------------------------------------------------------------- |
| c 等澄清超过 24h（用户离开）          | 中     | inbound TTL = 24h；超时后 c 标记 'failed' 并写 audit log      |
| 用户答案与问题对不上（questionId 错） | 中     | parseClarifications 必须生成 stable id（基于内容 hash）       |
| c session 长时间挂起（占资源）        | 低     | 现有 LLM session 本就是空闲态，inbound 轮询 2s 一次开销可忽略 |
| 灰度期间老路径仍跑                    | 低     | feature flag 控制，新代码完全旁路                             |
| substate 状态不一致                   | 高     | 用事务原子更新 + 单元测试覆盖所有转移                         |
| 前端同时打开多个 team session         | 中     | inbound 写入时显式指定 sessionId，不依赖前端 active 状态      |

---

## 8. 与现有决策的关系

| 决策   | 关系                                                 |
| ------ | ---------------------------------------------------- |
| L1.3   | 本 RFC 是 L1.3 详细设计的具体实施计划                |
| L1.4   | 本 RFC 落地 escape hatch #1（escalation 反向通道）   |
| L1.6   | 本 RFC 不涉及延迟监控（独立 RFC）                    |
| L1.8   | 本 RFC 顺便补 substate / structural_depth 字段       |
| D18    | 顺便实施（structural_depth + execution_depth）       |
| D29    | 不变（escalation 仍由 d 触发，本 RFC 只管 c 层澄清） |
| D33    | 兼容（cancel 信号通过 inbound 传递）                 |
| D42    | 兼容（pause/resume 信号通过 inbound 传递）           |
| 老路径 | 零影响（feature flag 关闭时不进入新代码）            |

---

## 9. 替代方案（已否决）

### 9.1 方案 B：c 重启 session

每次澄清重新启动 c session，从 spec_v2 开始重新生成。

**否决理由**：

- 7 层注入栈每次重新加载（5s 延迟 + 完全破坏 prompt cache）
- 用户感受多次"重新开始"
- 与 L1.3 G2 目标冲突

### 9.2 方案 C：把澄清放到前端处理

c 一次输出所有可能的歧义，前端让用户全部回答完再触发新一轮 c。

**否决理由**：

- 用户必须一次回答所有问题（体验差）
- 部分问题答案影响后续问题（依赖关系丢失）
- spec/plan/tasks 失去渐进精炼的语义

### 9.3 方案 D：用 LLM tool calling 实现等待

让 c 调用 `tools.waitForClarification(questions)` 工具，由工具实现轮询。

**否决理由**：

- 工具调用本身是同步的，无法跨 LLM 调用边界等待
- 工具结果需要写回 LLM context，仍需要本 RFC 的 inbound 机制

---

## 10. 决策点（需团队 review 后拍板）

### 10.1 设计决策

- **D-RFC-1**：substate 推送是用同事务 outbox 还是简单 EventEmitter？
  - **推荐**：MVP 用 EventEmitter（简单，订阅者容忍丢事件 + 轮询 fallback）
- **D-RFC-2**：inbound TTL 默认值？
  - **推荐**：24h；cancel/pause 不过期
- **D-RFC-3**：c LLM 循环唤醒机制？
  - **推荐**：定时轮询 2s + 未来可加 EventEmitter 优化（不阻塞 MVP）
- **D-RFC-4**：questionId 生成策略？
  - **推荐**：基于 [NEEDS CLARIFICATION:xxx] 内容的 SHA-256 前 8 字符（稳定）
- **D-RFC-5**：是否同时实施 d 层 review？
  - **推荐**：不（独立 RFC，避免本 RFC 范围爆炸）

### 10.2 实施细节（L3 范畴，但需要 review 期间记录）

- 心跳间隔（30s）、claim 超时（60s）继承现有 watcher
- 轮询间隔（2s）、TTL（24h）等具体数值留给 L3 微调

---

## 11. 后续工作

本 RFC 完成后启动：

1. **RFC d 层 review 完整实施**（spec review + quality review + escalation_round 推进）
2. **RFC L1.6 延迟监控接入**（telemetry + 4 个延迟指标）
3. **RFC architecture review check 点**（d.2 实施）

---

## 12. 当前状态

- ✅ 问题陈述完整
- ✅ 改造范围明确（4 项）
- ✅ 工作量估算（13.5 天）
- ✅ 测试策略与不变量
- ⚠️ 5 项设计决策待团队 review（§10.1）
- 📅 review 通过后即可启动实施

**下一步**：

1. 团队 review §10.1 的 5 项设计决策
2. 决策通过后创建 `.agentdocs/workflow/260516-rfc-l1-3-implementation.md` 实施方案
3. 按改造 1 → 2 → 3 + 4（并行）的顺序进行
