# L1.3 流式 Handoff 协议实施设计稿（v1.2）

> ⚠️ **复查发现的现状（2026-05-16）**：
>
> 本设计稿初稿（v1.0）假设 v3.10 原子 handoff 尚未实施。**实际上 Phase A/B/C/D/E 均已完成实施**：
>
> - Phase A：constitution / agent_personas / 7 层注入栈 / memory / ForceApply（260515-team-phase-a 已完成）
> - Phase B：sessions 5 字段扩展 + handoff_records 表 + Watcher + InProcessScheduler（260515-team-phase-b 已完成）
> - Phase C：c 层产物链 spec/plan/tasks + Constitution Check + [NEEDS CLARIFICATION] 推送（260515-team-phase-c 已完成）
> - Phase D / Phase E：见 `.agentdocs/workflow/done/260516-team-phase-{d,e}-实施方案.md`
>
> **关键事实**（来自 `services/agent-gateway/src/handoff/artifact-chain.ts` 行 22 注释）："[NEEDS CLARIFICATION] 推送后不等待回复（Phase D 加阻塞门禁）"——即**当前 Phase C 实现仍是单次原子 c session**：c 输出含 NEEDS CLARIFICATION 的 spec → 通过 team-events 推送给 b → 但 c session 不等回答直接继续做 plan/tasks。这正是本设计稿要解决的核心问题。
>
> 因此 v1.1 把本设计稿**重新定位为"对现有 Phase B/C/D 实施的增量改造方案"**，而不是从零设计。增量差异分析见 §0.A。
>
> ---

> 用途：把 L1 基线决策中的 **L1.3 流式 handoff + 子状态机 + 双向消息通道** 展开为完整可实施的协议设计。本文档面向实施者，覆盖 SQL、状态机、消息时序、并发约束、错误处理、迁移路径与测试清单。
>
> 关联文档：
>
> - L1 基线：`team-architecture-l1-baseline.md`（L1.3 概述）
> - 思想分析：`team-architecture-spec-kit-borrowing-discussion.md`（v3.10 ⑥ Handoff Protocol，原"原子 handoff"设计已被本文档替代）
> - Phase A 决策：`team-architecture-phase-a-decisions.md`（Phase A 已完成实施）
> - **Phase B 实施记录**：`.agentdocs/workflow/done/260515-team-phase-b-实施方案.md`（已完成）
> - **Phase C 实施记录**：`.agentdocs/workflow/done/260515-team-phase-c-实施方案.md`（已完成）
> - **Phase D 实施记录**：`.agentdocs/workflow/done/260516-team-phase-d-实施方案.md`（已完成）
>
> 创建时间：2026-05-16（v1.0 → v1.1 复查修订）
> 当前状态：**v1.2 已完成后端闭环（2026-05-24）**
> 实施时机：**Phase F 增量改造已落地**；剩余工作仅限更大范围运行验证与 UI/运维观察。

---

## 0.B 实施收口记录（2026-05-24）

L1.3 后端闭环已完成，v1.1 中列出的 4 项增量改造均已落地：

| 改造项                                  | 当前状态        | 主要落点                                                                                                                                                     |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_inbound_messages` 反向消息通道 | ✅ 已落地       | `services/agent-gateway/src/handoff/store/inbound-store.ts`、`services/agent-gateway/src/routes/team-inbound.ts`                                             |
| `sessions.substate` 子状态机            | ✅ 已落地       | `services/agent-gateway/src/handoff/store/substate-store.ts`、`artifact-chain.ts`、各层 runner                                                               |
| c 层等待 inbound 澄清循环               | ✅ 已落地并加固 | `services/agent-gateway/src/handoff/runner/artifact-chain.ts` 支持 answer / timeout fallback / cancel / pause→resume                                         |
| `handoff_records` 幂等与暂停字段        | ✅ 已落地       | `services/agent-gateway/src/handoff/store/handoff-store.ts` 映射 `idempotency_key`、`paused_at`、`paused_by_user_id`、`pause_reason` 并提供 pause/resume API |

本次收口同时完成：

- 将 `POST /team/sessions/:sessionId/inbound-messages` 从超大 `routes/team.ts` 拆到 `routes/team-inbound.ts`，保持认证、归属校验、幂等、用户消息持久化、异步 b 层编排与 audit 行为。
- 新 inbound 消息发布 `session.inbound.submitted` 事件；幂等重放不重复发布，事件 payload 只含安全字段和短文本预览，不携带原始 payload。
- `createTeamSession()` 为团队 session 补齐 `defaultProvider` / `defaultModel` / `dialogueMode` 默认元数据；显式 metadata 优先。
- 旧 `/team/workspaces/:id/threads` 兼容入口也固化 `teamDefinition.memberSlots` 快照，并返回实际入库 metadata。

验证记录：

- ✅ LSP diagnostics：本次改动的 TypeScript 文件均无诊断。
- ✅ L1.3 聚焦回归：`team-inbound-routes`、`team-workspace-roster-routes`、`team-handoffs-routes`、`inbound-store`、`handoff-store`、`team-session-create`、`artifact-chain`、`team-b-c-integration`、`team-events-bus` 共 80 个用例通过。
- ✅ `pnpm --filter @openAwork/agent-gateway build` 通过。
- ✅ `pnpm typecheck` 通过。
- ⚠️ `pnpm --filter @openAwork/agent-gateway test` 的 verification 阶段仍被 `verify-task-tool-no-permission.ts` 阻塞：`delegated child task should still complete automatically without approval`。该失败位于 task 工具默认免审批验证链，与 L1.3 Team/handoff 改动文件无交集，需独立排查。

---

## 0.A 与现有实现的差异分析（v1.1 新增）

### 0.A.1 现有 schema 与本稿假设的对照

`services/agent-gateway/src/db.ts` 当前 schema（节选自 line 1032+）：

| 本稿假设字段名                                                     | 现有实际字段名                      | 差异类型           | 处理                                                |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------ | --------------------------------------------------- |
| `sessions.parent_session_id`                                       | `sessions.team_parent_session_id`   | 命名不同           | **保持现有命名**，本稿改用 `team_parent_session_id` |
| `handoff_records.source_session_id`                                | `from_session_id`                   | 命名不同           | **保持现有命名**，本稿改用 `from_session_id`        |
| `handoff_records.target_session_id`                                | `to_session_id`                     | 命名不同           | 同上                                                |
| `handoff_records.source_layer` / `target_layer`                    | `from_role_layer` / `to_role_layer` | 命名不同           | 同上                                                |
| 时间戳 INTEGER ms epoch                                            | TEXT (ISO datetime)                 | 类型不同           | **保持现有类型 TEXT**（Phase B 已确定）             |
| `handoff_records.idempotency_key`                                  | 已存在并已映射                      | ✅ 已完成          | `createHandoff(idempotencyKey)` 复用既有记录        |
| `handoff_records.claim_token`                                      | 已存在                              | **现有有，本稿无** | 本稿采纳（这是真实防双 claim 机制）                 |
| `sessions.last_heartbeat`                                          | 已存在（TEXT 类型）                 | 已实现             | 不动                                                |
| `sessions.substate` / `substate_updated_at`                        | 已存在并已写入                      | ✅ 已完成          | `substate-store.ts` + runner 全链路写入             |
| `session_inbound_messages` 表                                      | 已存在并已接入                      | ✅ 已完成          | `inbound-store.ts` + `team-inbound.ts`              |
| `sessions.structural_depth` / `execution_depth`                    | 看 D18 落地状态                     | 待确认             | 与 D18 对齐                                         |
| `handoff_records.paused_at` / `paused_by_user_id` / `pause_reason` | 已存在并已映射                      | ✅ 已完成          | `pauseHandoff` / `resumeHandoff`                    |

### 0.A.2 真正需要的增量改造（4 项）

把 v1.0 的"全量重写"修正为以下 4 项增量改造：

**改造 1：`session_inbound_messages` 表（新增）**

这是反向消息通道的载体。现有 Phase C 用 team-events WS 单向推送给前端，没有反向通道让 c 等待用户回答。

```sql
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
);

CREATE INDEX IF NOT EXISTS idx_session_inbound_to_pending
  ON session_inbound_messages(to_session_id, state, created_at)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_session_inbound_cancel
  ON session_inbound_messages(to_session_id, message_type)
  WHERE message_type = 'cancel_signal' AND state = 'pending';
```

**改造 2：`sessions.substate` 字段（新增）**

把现在分散在前端状态机的 `spec_draft → clarifying → plan_ready → tasks_ready` 提升到 DB 字段，让上游（b）可以查询而不必订阅 WS。

```ts
// 用 ensureColumn 与 Phase A/B/C 一致
ensureColumn('sessions', 'substate', 'TEXT DEFAULT NULL');
ensureColumn('sessions', 'substate_updated_at', 'TEXT DEFAULT NULL');
```

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_substate
  ON sessions(substate) WHERE substate IS NOT NULL;
```

**改造 3：c 层引入"等待 inbound"循环（核心改造）**

修改 `services/agent-gateway/src/handoff/artifact-chain.ts`：

```ts
// 现状（Phase C，artifact-chain.ts 行 22 注释）：
//   "[NEEDS CLARIFICATION] 推送后不等待回复（Phase D 加阻塞门禁）"
// 实际行为：c 输出含 NEEDS CLARIFICATION 的 spec → 推送 → 直接做 plan

// 改造后：
//   1. 若有 NEEDS CLARIFICATION → c 进入"等待 inbound"循环
//   2. 写入 sessions.substate='clarifying'
//   3. 推送 escalation_request 到 session_inbound_messages（target=reception session）
//   4. 通过定时轮询（或 EventEmitter 通知）等 clarification_answer
//   5. 收到答案 → 注入 c 的 LLM context → 回到 spec_ready 或前进到 plan
```

**改造 4：handoff_records 补字段**

```ts
ensureColumn('handoff_records', 'idempotency_key', 'TEXT DEFAULT NULL');
ensureColumn('handoff_records', 'paused_at', 'TEXT DEFAULT NULL');
ensureColumn('handoff_records', 'paused_by_user_id', 'TEXT DEFAULT NULL');
ensureColumn('handoff_records', 'pause_reason', 'TEXT DEFAULT NULL');
```

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_handoff_records_idempotency
  ON handoff_records(idempotency_key) WHERE idempotency_key IS NOT NULL;
```

### 0.A.3 v1.0 设计稿中需要重写或废弃的章节

| v1.0 章节                                       | v1.1 处理                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| §1.1 handoff_records SQL Schema（CREATE TABLE） | **重写**：基于现有 schema 列出"补充字段"而不是"全表 CREATE"                            |
| §1.2 sessions.substate 新增                     | **保留**：是真正的新增字段（改造 2）                                                   |
| §1.3 session_inbound_messages 表                | **保留 + 命名调整**：字段名按现有惯例（to_session_id 等）                              |
| §2 端到端时序                                   | **保留 + 标注**：注明这是改造后行为，对比 Phase C 当前行为                             |
| §3 cancel/pause 级联                            | **保留 + 与现有对齐**：Phase B 已实现 cancel_requested/paused，本稿补 inbound 信号机制 |
| §4 Scheduler 对接                               | **保留**：D40 已实现，本稿是补充使用方式                                               |
| §5 Watcher 设计                                 | **缩减**：Phase B 已实现 Watcher，本稿仅说明"Watcher 需要新增哪些处理"                 |
| §6 不变量与测试                                 | **保留**：所有 7 条不变量都对增量改造同样适用                                          |
| §7 迁移路径                                     | **重写**：从"Phase B 上线方案"改为"Phase F 增量改造方案"                               |

### 0.A.4 工作量评估（v1.1 修订）

| 任务                                 | v1.0 估算 | v1.1 修订   | 备注                   |
| ------------------------------------ | --------- | ----------- | ---------------------- |
| 改造 1：session_inbound_messages 表  | 2 天      | 1 天        | 已有 schema 模式可参考 |
| 改造 2：substate 字段 + 上游查询 API | 3 天      | 2 天        | ensureColumn 已熟练    |
| 改造 3：c 层等待 inbound 循环        | 5 天      | 5 天        | 这是核心难点           |
| 改造 4：handoff_records 补字段       | 1 天      | 0.5 天      |                        |
| 测试 + chaos test                    | 5 天      | 5 天        | 不变                   |
| **总计**                             | 16 天     | **13.5 天** |                        |

> **关键判断**：本协议**不应该作为 Phase F 的全部内容**，而是 Phase D 阻塞门禁的真实实现。Phase D 实施方案中已经预留了"Phase D 加阻塞门禁"的位置（artifact-chain.ts 行 22）。本设计稿等于回填 Phase D 那一句注释背后的协议设计。

### 0.A.5 v1.0 vs 现有实现的字段命名对照表（重要！）

读后续章节时**必须按以下对照阅读**，否则字段名会与代码对不上：

| v1.0 用名（本稿后续章节）        | 现有代码实际字段名                |
| -------------------------------- | --------------------------------- |
| `parent_session_id`              | `team_parent_session_id`          |
| `source_session_id`              | `from_session_id`                 |
| `target_session_id`              | `to_session_id`                   |
| `source_layer`                   | `from_role_layer`                 |
| `target_layer`                   | `to_role_layer`                   |
| `created_at`（INTEGER ms epoch） | `created_at`（TEXT ISO datetime） |
| `claimed_at`（INTEGER ms epoch） | `claimed_at`（TEXT ISO datetime） |

> **v2.0 待办**：把 v1.0 后续章节按上表统一改名（避免阅读混淆）。v1.1 暂以本对照表作为修正。

---

---

## 0. TL;DR

本协议解决 v3.10 原子 handoff 的 4 个核心缺陷：

| v3.10 原子 handoff                               | L1.3 流式 handoff                           |
| ------------------------------------------------ | ------------------------------------------- |
| c 必须一次性输出 spec/plan/tasks 才返回          | c 每完成子产物就推送事件                    |
| 澄清往返要重启 c session（重新加载 7 层 prompt） | c session 全程不重启，澄清通过反向消息通道  |
| b 在 c 跑的 10-30s 内完全黑盒                    | b 通过 substate 字段任意时刻知道 c 在哪一步 |
| 无法在 spec/plan 之间暂停                        | 每个子状态边界都是天然暂停点                |

**协议三件套**：

1. `handoff_records` 表（已存在概念）：保留作为初始派发协议
2. `sessions.substate` 字段（新增）：上游可见的子状态机
3. `session_inbound_messages` 表（新增）：反向消息通道，c 不重启即可接收新输入

**关键不变量**：

- I1：c session 在 spec/clarify/plan/tasks 全程**保持单一 session 不重启**
- I2：substate 变更与事件推送**在同一事务内完成**（避免上游永远等不到事件）
- I3：inbound message 消费**幂等**（同 message_id 多次消费不产生副作用）
- I4：跨层调用必须经过本协议或 L1.4 的 3 个 escape hatch 之一

---

## 1. 协议三件套详细设计

### 1.1 第一件：`handoff_records` 表（保留作为派发协议）

#### 1.1.1 SQL Schema

```sql
CREATE TABLE IF NOT EXISTS handoff_records (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  source_layer TEXT NOT NULL,                  -- 'reception' / 'pm1' / 'pm2'
  target_layer TEXT NOT NULL,                  -- 'pm1' / 'pm2' / 'execution'

  -- 主状态机（与 v3.10 兼容，加 'cancelled'）
  state TEXT NOT NULL DEFAULT 'pending',
    -- 取值：'pending' / 'claimed' / 'running' / 'completed' / 'failed' / 'cancelled'

  -- 派发载荷（创建时写入，不可变）
  payload_json TEXT NOT NULL,

  -- 终态结果（仅在 state IN ('completed','failed','cancelled') 时写入）
  result_json TEXT,
  error_text TEXT,

  -- 时间戳（统一用 INTEGER ms epoch，便于跨进程比较）
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER,

  -- 控制标志
  cancel_requested INTEGER NOT NULL DEFAULT 0,    -- 0=否 1=是
  cancel_reason TEXT,
  paused INTEGER NOT NULL DEFAULT 0,              -- D42 一键暂停集成
  paused_at INTEGER,

  -- 失败恢复（D29 escalation）
  escalation_round INTEGER NOT NULL DEFAULT 0,

  -- 崩溃恢复（D51 心跳兜底）
  last_heartbeat INTEGER,
  crash_retry_count INTEGER NOT NULL DEFAULT 0,

  -- 幂等性（D40 BackgroundTaskScheduler）
  idempotency_key TEXT
);

-- 索引：watcher 高频查询 pending state
CREATE INDEX IF NOT EXISTS idx_handoff_state_pending
  ON handoff_records(state, created_at)
  WHERE state = 'pending';

-- 索引：按 source 反查（b 列出某 reception session 下的所有派发）
CREATE INDEX IF NOT EXISTS idx_handoff_source
  ON handoff_records(source_session_id, created_at);

-- 索引：cancel 信号传播（找所有 cancel_requested 的活跃 handoff）
CREATE INDEX IF NOT EXISTS idx_handoff_cancel_requested
  ON handoff_records(cancel_requested)
  WHERE cancel_requested = 1 AND state IN ('claimed', 'running');

-- 唯一约束：幂等性
CREATE UNIQUE INDEX IF NOT EXISTS idx_handoff_idempotency
  ON handoff_records(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

#### 1.1.2 主状态机

```
            create()
                │
                ▼
            pending ─────cancel before claim───► cancelled
                │                                   ▲
            claim()                                 │
                │                                   │
                ▼                                   │
            claimed ◄───────cancel during─────┐    │
                │                              │   │
        watcher 创建 target_session            │   │
        target session 启动                    │   │
                │                              │   │
                ▼                              │   │
            running ──────cancel during──────►─┤   │
                │                              │   │
        target session 完成                     │   │
                │                              │   │
        ┌───────┼───────┐                      │   │
        ▼       ▼       ▼                      │   │
    completed failed   cancelled ◄──────────────┘   │
                                                    │
        ↑                                           │
        └──── 发现 cancel_requested=1 时 ─────────┘
              （由 target session 主动检查）
```

**状态转移规则**（必须由原子 SQL 完成，不允许应用层判断）：

```sql
-- pending → claimed（watcher 抢占，必须用 WHERE state='pending' 防双 claim）
UPDATE handoff_records
SET state = 'claimed', claimed_at = :now, last_heartbeat = :now
WHERE id = :id AND state = 'pending';
-- 检查 changes() = 1，否则说明被其他 watcher 抢先

-- claimed → running（target session 启动后回写）
UPDATE handoff_records
SET state = 'running', last_heartbeat = :now
WHERE id = :id AND state = 'claimed';

-- running → completed（target session 正常结束）
UPDATE handoff_records
SET state = 'completed', completed_at = :now, result_json = :result
WHERE id = :id AND state = 'running';

-- running → failed
UPDATE handoff_records
SET state = 'failed', completed_at = :now, error_text = :error
WHERE id = :id AND state = 'running';

-- ANY → cancelled（仅当 cancel_requested=1 时由 target session 主动触发）
UPDATE handoff_records
SET state = 'cancelled', completed_at = :now
WHERE id = :id AND cancel_requested = 1 AND state IN ('pending', 'claimed', 'running');
```

#### 1.1.3 payload_json 标准结构

```ts
interface HandoffPayload {
  // 来自 hermes-agent delegate_task
  goal: string; // 这次派发要达成什么
  context: string; // 关键上下文（不是全量历史）
  toolsets: string[]; // 允许使用的工具集
  role: string; // 'planner' / 'researcher' / 'executor' / 'reviewer'

  // 来自 spec-kit 的产物链引用
  artifactRefs: {
    constitution?: string; // team_workspaces.constitution_md 内容（注入时快照）
    spec?: string; // spec.md artifact id（引用）
    plan?: string; // plan.md artifact id（引用）
    tasks?: string; // tasks.md artifact id（引用）
    parentArtifact?: string;
  };
  taskMarkers?: {
    parallel?: boolean; // [P]
    userStory?: string; // [US1]
    needsClarification?: string[]; // [NEEDS CLARIFICATION] 列表
  };

  // OpenAWork 特有
  timeoutMs?: number;
  successCriteria?: string[];

  // L1.3 新增：substate 期望（可选）
  expectedSubstates?: string[]; // 比如 c 层期望经历 ['drafting_spec','spec_ready','clarifying','plan_ready','tasks_ready']
  // 用于上游 progress 估算
}
```

#### 1.1.4 result_json 标准结构

```ts
interface HandoffResult {
  // 必需字段
  status: 'success' | 'partial' | 'failed';
  summary: string; // 一句话总结，给上游展示

  // 产物引用（替代旧的"全量产物嵌入"）
  artifacts?: {
    spec?: string; // artifact id
    plan?: string;
    tasks?: string;
    review?: string;
    [key: string]: string | undefined;
  };

  // 失败/部分成功时的细节
  errorDetails?: {
    code: string;
    message: string;
    retryable: boolean;
    violatedConstraints?: string[]; // D29 B2 结构化反馈：违反的具体原则
    suggestion?: string; // D29 B2：修改建议
  };

  // 提议项（D43 4 项默认边界）
  proposedMemoryEntries?: string[]; // e/f/g 提议写入项目记忆的条目
  reviewNotes?: string[]; // g 评审建议（不直接改代码）

  // 调试与审计
  llmCallsCount?: number;
  durationMs?: number;
}
```

---

### 1.2 第二件：`sessions.substate` 字段（新增子状态机）

#### 1.2.1 SQL Migration

基于现有 sessions 表（`db.ts` line 200-210）：

```sql
-- 现有 sessions 表字段已知：
--   id / user_id / messages_json / state_status / metadata_json
--   title / created_at / updated_at

-- L1.3 新增字段
ALTER TABLE sessions ADD COLUMN substate TEXT;
ALTER TABLE sessions ADD COLUMN substate_updated_at INTEGER;

-- L1.8 整合（v3.10 D13/D18/D42 也要的字段）
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN role_layer TEXT;              -- 'reception' / 'pm1' / 'pm2' / 'execution'
ALTER TABLE sessions ADD COLUMN intent_state TEXT;            -- 'ask' / 'plan' / 'implement' / 'investigate'
ALTER TABLE sessions ADD COLUMN handoff_state TEXT;           -- 'pending' / 'running' / 'completed' / 'failed' / null
ALTER TABLE sessions ADD COLUMN structural_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN execution_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN paused_at INTEGER;

-- 索引
CREATE INDEX IF NOT EXISTS idx_sessions_substate
  ON sessions(substate)
  WHERE substate IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_parent
  ON sessions(parent_session_id);

CREATE INDEX IF NOT EXISTS idx_sessions_paused
  ON sessions(paused)
  WHERE paused = 1;

CREATE INDEX IF NOT EXISTS idx_sessions_role_layer
  ON sessions(role_layer)
  WHERE role_layer IS NOT NULL;
```

> **兼容性注意**：现有 sessions 的 `created_at` / `updated_at` 是 TEXT（datetime），新字段 `substate_updated_at` / `paused_at` 用 INTEGER（ms epoch）。两者**不要混用**。新协议产生的字段都用 INTEGER（便于跨进程比较和原子操作）。

#### 1.2.2 substate 取值规约

每层有自己的子状态机。**全局禁止**任何代码硬编码 substate 字符串，必须通过常量模块导出：

```ts
// services/agent-gateway/src/handoff/substates.ts
export const SUBSTATES_C = {
  // 初始（接收 handoff 后）
  IDLE: 'idle',

  // spec 阶段
  DRAFTING_SPEC: 'drafting_spec',
  SPEC_READY: 'spec_ready',

  // clarify 阶段（双向往返，可多次循环）
  CLARIFYING: 'clarifying', // 等待 inbound clarification_answer

  // plan 阶段
  DRAFTING_PLAN: 'drafting_plan',
  PLAN_READY: 'plan_ready',

  // tasks 阶段
  DRAFTING_TASKS: 'drafting_tasks',
  TASKS_READY: 'tasks_ready',

  // 终态
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const SUBSTATES_D = {
  IDLE: 'idle',
  CONSTITUTION_CHECK: 'constitution_check',
  ARCHITECTURE_REVIEW: 'architecture_review',
  DISPATCHING: 'dispatching',
  AWAITING_EG: 'awaiting_eg', // 等 e/f/g 回写
  REVIEWING: 'reviewing', // 双重 review 进行中
  ESCALATING: 'escalating', // 触发 D29 escalation
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const SUBSTATES_E = {
  IDLE: 'idle',
  IMPLEMENTING: 'implementing',
  TESTING: 'testing', // e 自己的单元测试
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

// f / g 类似（略）
```

#### 1.2.3 substate 转移规则

每次 substate 变更必须满足以下三条之一：

1. **正向推进**：从规约定义的"上一步"到"下一步"（如 DRAFTING_SPEC → SPEC_READY）
2. **澄清回路**：在 SPEC_READY 状态可进入 CLARIFYING，回路结束后回 SPEC_READY 或前进到 DRAFTING_PLAN
3. **终态**：任意状态都可进入 COMPLETED / FAILED / CANCELLED（cancellation 由 cancel_requested 触发）

**禁止跳跃推进**：不允许 DRAFTING_SPEC 直接跳到 PLAN_READY。这会导致下游产物缺失。

#### 1.2.4 substate 更新原子性（关键不变量 I2）

substate 变更必须**与事件推送在同一事务内完成**，否则会出现"DB 已更新但事件未推送"或"事件推送了但 DB 没更新"的不一致状态。

```ts
// 错误做法（会导致不一致）：
db.exec('UPDATE sessions SET substate = ? WHERE id = ?', [newState, sessionId]);
eventBus.emit('substate.changed', { sessionId, newState });
// ↑ 如果 emit 之前进程崩溃，DB 已更新但订阅者永远收不到

// 正确做法：用事务 + 事件队列
db.transaction(() => {
  db.exec('UPDATE sessions SET substate = ?, substate_updated_at = ? WHERE id = ?', [
    newState,
    Date.now(),
    sessionId,
  ]);
  db.exec(
    `INSERT INTO substate_events (session_id, substate, created_at)
           VALUES (?, ?, ?)`,
    [sessionId, newState, Date.now()],
  );
});
// 事件由独立的 dispatcher 从 substate_events 表读取并 emit，保证 at-least-once 投递
```

> **简化路径**：MVP 可以先不做 outbox 模式，但必须明确文档化"substate 推送可能丢失"的边界，并要求订阅者**容忍丢事件**（因为可以 fallback 到轮询 `sessions.substate` 字段）。

---

### 1.3 第三件：`session_inbound_messages` 表（反向消息通道）

#### 1.3.1 SQL Schema

```sql
CREATE TABLE IF NOT EXISTS session_inbound_messages (
  id TEXT PRIMARY KEY,
  target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- 来源（用于审计 + 路由判断）
  source_layer TEXT NOT NULL,
    -- 取值：'reception'（b 转发用户输入）/ 'pm1' / 'pm2' / 'system'（系统信号）

  -- 消息类型（决定 target session 怎么处理）
  message_type TEXT NOT NULL,
    -- 取值：
    --   'clarification_answer'  - 用户对 [NEEDS CLARIFICATION] 的回答
    --   'user_input'            - 用户中途追加的要求
    --   'cancel_signal'         - 取消（cascade 到子 session）
    --   'pause_signal'          - 暂停（cascade）
    --   'resume_signal'         - 恢复（cascade）
    --   'escalation_request'    - 反向通知（target=b，source=任意）
    --   'progress_report'       - 进度上报（target=b）

  -- 载荷（JSON，结构由 message_type 决定）
  payload_json TEXT NOT NULL,

  -- 消费状态
  state TEXT NOT NULL DEFAULT 'pending',
    -- 取值：'pending' / 'consumed' / 'expired'

  created_at INTEGER NOT NULL,
  consumed_at INTEGER,

  -- TTL（避免过期消息阻塞）
  expires_at INTEGER,                  -- 默认 24h；'cancel_signal' 不过期

  -- 幂等性（防止重复消费）
  consumed_by_loop_iteration INTEGER   -- target session 的第几轮 LLM 循环消费
);

-- 索引：target session 的主查询路径
CREATE INDEX IF NOT EXISTS idx_inbound_target_pending
  ON session_inbound_messages(target_session_id, state, created_at)
  WHERE state = 'pending';

-- 索引：cancel 信号高优先级
CREATE INDEX IF NOT EXISTS idx_inbound_cancel
  ON session_inbound_messages(target_session_id, message_type)
  WHERE message_type = 'cancel_signal' AND state = 'pending';

-- 索引：TTL 清理
CREATE INDEX IF NOT EXISTS idx_inbound_expires
  ON session_inbound_messages(expires_at)
  WHERE state = 'pending';
```

#### 1.3.2 message_type 载荷规约

```ts
// 'clarification_answer'
interface ClarificationAnswerPayload {
  questionId: string; // 对应原 [NEEDS CLARIFICATION:xxx] 标记
  answer: string; // 用户回答
  answeredBy: 'user' | 'auto'; // 'auto' = 系统超时默认值
  answeredAt: number;
}

// 'user_input'
interface UserInputPayload {
  text: string;
  intent?: 'add_requirement' | 'clarify_existing' | 'change_priority';
  attachments?: string[]; // artifact id 列表
}

// 'cancel_signal'
interface CancelSignalPayload {
  reason: string;
  cascadeFrom: string; // 触发 cancel 的 session id（用于审计）
  preserveArtifacts: boolean; // 是否保留中间产物（默认 true）
}

// 'pause_signal' / 'resume_signal'
interface PauseSignalPayload {
  reason?: string;
  pausedBy: string; // user_id
  pausedAt: number;
}

// 'escalation_request'（仅 source≠'system'，target=reception session id）
interface EscalationRequestPayload {
  fromLayer: 'pm1' | 'pm2' | 'execution';
  fromSessionId: string;
  reason: 'constitution_violation' | 'review_failed_threshold' | 'crash_recovery_failed';
  escalationRound: number;
  context: string; // 给用户看的人话描述
  suggestedActions: Array<{
    label: string; // '修改 constitution' / '修改原始需求'
    action: 'edit_constitution' | 'edit_original_request';
  }>;
}

// 'progress_report'（target=reception session id）
interface ProgressReportPayload {
  fromSessionId: string;
  fromLayer: string;
  substate: string;
  completed?: number; // 如 "3/8 task 完成"
  total?: number;
  estimatedRemainingMs?: number;
}
```

#### 1.3.3 消费协议（关键不变量 I3：幂等）

target session 的 LLM 循环每轮调用前必须检查 inbound：

```ts
// services/agent-gateway/src/handoff/inbound-consumer.ts
async function consumePendingInbound(
  sessionId: string,
  loopIteration: number,
): Promise<InboundMessage[]> {
  // 1. 用事务 + 行锁（SELECT ... FOR UPDATE 的 sqlite 等价物）
  const messages = db.transaction(() => {
    const pending = db
      .prepare(
        `
      SELECT * FROM session_inbound_messages
      WHERE target_session_id = ?
        AND state = 'pending'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY
        CASE message_type
          WHEN 'cancel_signal' THEN 0     -- 高优先级
          WHEN 'pause_signal' THEN 1
          ELSE 2
        END,
        created_at ASC
    `,
      )
      .all(sessionId, Date.now()) as InboundMessage[];

    if (pending.length === 0) return [];

    // 2. 标记为 consumed（同事务内）
    const ids = pending.map((m) => m.id);
    db.prepare(
      `
      UPDATE session_inbound_messages
      SET state = 'consumed',
          consumed_at = ?,
          consumed_by_loop_iteration = ?
      WHERE id IN (${ids.map(() => '?').join(',')})
    `,
    ).run(Date.now(), loopIteration, ...ids);

    return pending;
  })();

  // 3. 返回供 LLM 循环处理（必须按顺序）
  return messages;
}
```

**幂等保证**：

- 同一 message 永远只被消费一次（state 转移 pending → consumed 是单向的）
- 即使 LLM 循环崩溃，消息已标记为 consumed，重启后不会重复处理
- **代价**：如果 LLM 处理失败，消息已经 consumed 但效果未生效——需要在 `result_json.errorDetails` 中记录"未能处理的 inbound"，由 d 层 review 决定是否重新派发

#### 1.3.4 优先级与排队

不同 message_type 有不同处理优先级：

| 优先级             | message_type                     | 行为                               |
| ------------------ | -------------------------------- | ---------------------------------- |
| **P0**（立即响应） | `cancel_signal`                  | LLM 循环立即退出，不再处理后续消息 |
| **P1**（高）       | `pause_signal` / `resume_signal` | 触发暂停状态切换                   |
| **P2**（中）       | `clarification_answer`           | 注入对话流，正常推进               |
| **P3**（低）       | `user_input`                     | 注入对话流，可能需要重新 plan      |

**P0 cancel 不能被并发消息抢占**：即使队列里有 100 条 user_input，cancel 也必须最先被 LLM 看到。

---

## 2. 端到端时序示例：c 层完整生命周期

以"实现 OAuth 登录"为例，走 c 层完整 spec/clarify/plan/tasks 流程：

### 2.1 启动阶段

```
T+0    用户在 a 输入"实现 GitHub OAuth 登录"
T+0    b.router 判断需要走 c → b.scheduler.schedule(intent='OAuth登录')
T+50ms b.scheduler 调用 createHandoff(b→c)：
       INSERT INTO handoff_records (state='pending', source_layer='reception', target_layer='pm1', payload_json={...})
T+100ms Watcher 轮询发现 pending：
       UPDATE handoff_records SET state='claimed' WHERE id=? AND state='pending'  -- 原子操作
       检查 changes()=1（防双 claim）
T+150ms Watcher 创建 c session：
       INSERT INTO sessions (id=c1, role_layer='pm1', parent_session_id=b1, substate='idle', structural_depth=1)
       UPDATE handoff_records SET target_session_id=c1, state='running'
T+200ms c session 启动 LLM 循环
```

### 2.2 spec 阶段

```
T+200ms c LLM 循环第 1 轮：
       检查 inbound（无 pending）→ 注入 system prompt（含 7 层栈）→ 调 LLM
T+5s   LLM 返回 spec 草稿（含 [NEEDS CLARIFICATION: 用 OAuth 1.0 还是 2.0]）
T+5s   c 写入 artifact spec_v1，UPDATE sessions SET substate='spec_ready' AND substate_updated_at=NOW
T+5s   c 推送 progress_report 给 b：
       INSERT INTO session_inbound_messages (target=b1, type='progress_report', payload={substate:'spec_ready'})
T+5.5s b 收到 progress_report → 更新 BackgroundTask[].currentStage='spec_ready'
       b 不主动通知 a（属于"信息性"，看 D32 推送优先级）
```

### 2.3 clarify 阶段（双向往返，c 不重启）

```
T+5s   c LLM 循环第 2 轮：
       检测到 spec 含 [NEEDS CLARIFICATION] → UPDATE sessions SET substate='clarifying'
T+5s   c 推送 escalation_request 给 b（注意：这是 L1.4 escape hatch）：
       INSERT INTO session_inbound_messages (
         target=b1,
         type='escalation_request',
         payload={
           fromLayer:'pm1',
           reason:'needs_clarification',
           context:'用 OAuth 1.0 还是 2.0？',
           suggestedActions:[{label:'回答 OAuth 2.0',action:'answer'}]
         }
       )
T+5s   c LLM 循环挂起（等待 inbound clarification_answer）

T+5.5s b 收到 escalation_request → 推送给 a："c 需要澄清：用 OAuth 1.0 还是 2.0？"
T+...  用户思考时间（人工）
T+30s  用户回答："2.0"
T+30s  b 收到用户输入 → 写入 c 的 inbound：
       INSERT INTO session_inbound_messages (
         target=c1,
         type='clarification_answer',
         payload={questionId:'q1', answer:'OAuth 2.0', answeredBy:'user'}
       )

T+30.5s c LLM 循环唤醒（监听 inbound 或定时轮询）：
       consumePendingInbound(c1, iteration=2) → 返回 [clarification_answer]
       注入 LLM 上下文："用户回答：OAuth 2.0"
       UPDATE sessions SET substate='spec_ready'  -- 回到 spec_ready，等待下一步推进
T+30.5s c LLM 决策："澄清完成，可以进入 plan 阶段"
       UPDATE sessions SET substate='drafting_plan'
```

**关键观察**：

- T+5s 到 T+30.5s 期间，c session **没有销毁也没有重启**
- 只通过 `session_inbound_messages` 注入新输入，LLM context 直接 append
- 7 层 system prompt 不需要重新加载（节省 ~5s 延迟）
- substate 全程对 b 可见

### 2.4 plan 阶段（无澄清直跑）

```
T+30.5s c LLM 循环第 3 轮：
       注入 spec 内容 + LLM 调用
T+15s  LLM 返回 plan
T+15s  c 写入 artifact plan_v1，UPDATE sessions SET substate='plan_ready'
T+15s  推送 progress_report
```

### 2.5 tasks 阶段

```
T+15s  c LLM 循环第 4 轮：
       注入 plan 内容 + LLM 调用
T+10s  LLM 返回 tasks（含 [P] 标记）
T+10s  c 写入 artifact tasks_v1，UPDATE sessions SET substate='tasks_ready'
```

### 2.6 完成阶段

```
T+10s  c LLM 循环第 5 轮：
       检测到 tasks_ready → 准备完成
       UPDATE sessions SET substate='completed', state_status='done'
       UPDATE handoff_records SET
         state='completed',
         result_json={status:'success', artifacts:{spec:'spec_v1',plan:'plan_v1',tasks:'tasks_v1'}, ...}
       该事务原子提交
T+10s  Watcher 检测到 handoff completed → 触发后续 d 层 handoff
```

### 2.7 总耗时分析

| 阶段         | 原子 handoff（v3.10）                | 流式 handoff（L1.3）                        |
| ------------ | ------------------------------------ | ------------------------------------------- |
| spec 草稿    | 5s                                   | 5s                                          |
| 澄清回路     | **+10s（重启 session 加载 prompt）** | +0s（不重启）                               |
| plan         | 15s                                  | 15s                                         |
| tasks        | 10s                                  | 10s                                         |
| **总计**     | 40s                                  | **30s**                                     |
| **延迟反馈** | 用户等 30s 才看到第一条进度          | 用户在 5s 看到 spec_ready，30s 看到澄清问题 |

---

## 3. 跨层 cancel/pause 级联

### 3.1 cancel 级联流程

用户在 b 处说"算了不要了"：

```
1. b 收到 cancel 意图 → b.scheduler.cancel(taskId, reason)

2. b.scheduler 找到根 handoff_record（b→c），递归遍历 session 树：
   WITH RECURSIVE descendants(id) AS (
     SELECT id FROM sessions WHERE id = :rootSessionId
     UNION ALL
     SELECT s.id FROM sessions s INNER JOIN descendants d ON s.parent_session_id = d.id
   )
   SELECT id FROM descendants;

3. 对每个 descendant session，执行：
   a) UPDATE handoff_records SET cancel_requested=1, cancel_reason=? WHERE target_session_id IN (...)
   b) INSERT INTO session_inbound_messages (target, type='cancel_signal', payload={...})
   该事务原子提交。

4. 各 target session 在下一轮 LLM 循环开始时：
   - consumePendingInbound 返回 cancel_signal（P0 优先级）
   - LLM 循环立即退出（不再处理后续 inbound）
   - UPDATE sessions SET substate='cancelled'
   - UPDATE handoff_records SET state='cancelled', completed_at=NOW
   - 清理临时资源（不回滚已写入 artifact）

5. b 推送通知 a："任务已取消"
   从 BackgroundTask[] 中移除该任务
```

**已完成产物的处理**：

- spec/plan/tasks 等 markdown：**保留**（用户可参考）
- e/f/g 已写入的代码 patch：**不自动回滚**（需用户手动 git revert）
- audit log：cancelled handoff 不删除

### 3.2 pause 级联流程

```
1. 用户在前端点"暂停全部" → b.scheduler.pauseAll(receptionSessionId)

2. b.scheduler 递归遍历 session 树（同 cancel 流程的 step 2）

3. 对每个 descendant session，执行：
   a) UPDATE sessions SET paused=1, paused_at=NOW
   b) UPDATE handoff_records SET paused=1, paused_at=NOW WHERE target_session_id IN (...)
   c) INSERT INTO session_inbound_messages (target, type='pause_signal')

4. 各 target session 在下一轮 LLM 循环开始时：
   - consumePendingInbound 返回 pause_signal
   - LLM 循环：当前轮处理完后冻结，不进入下一轮（不浪费已付成本，对应 D42 选项 A）
   - 不更新 substate（保留当前状态用于恢复）

5. Watcher 跳过 paused=1 的 handoff（不 claim，不推进）

6. 恢复时（resume_signal）反向操作即可
```

---

## 4. 与 BackgroundTaskScheduler 的接口对接

L1.9 已锁定 `BackgroundTaskScheduler` 接口。L1.3 协议是它的底层实现：

```ts
class InProcessScheduler implements BackgroundTaskScheduler {
  async schedule(input: ScheduleInput): Promise<ScheduledTask> {
    return db.transaction(() => {
      // 1. 创建 c session（substate='idle'）
      const cSessionId = randomUUID();
      db.prepare(
        `
        INSERT INTO sessions (id, user_id, role_layer, parent_session_id,
                              substate, substate_updated_at, structural_depth, ...)
        VALUES (?, ?, 'pm1', ?, 'idle', ?, ?, ...)
      `,
      ).run(cSessionId, userId, input.receptionSessionId, Date.now(), 1 /* ... */);

      // 2. 创建 handoff_record
      const handoffId = randomUUID();
      db.prepare(
        `
        INSERT INTO handoff_records (id, source_session_id, target_session_id,
                                     source_layer, target_layer, state,
                                     payload_json, idempotency_key, created_at)
        VALUES (?, ?, ?, 'reception', 'pm1', 'pending', ?, ?, ?)
      `,
      ).run(
        handoffId,
        input.receptionSessionId,
        cSessionId,
        JSON.stringify(input.payload),
        input.idempotencyKey ?? null,
        Date.now(),
      );

      return {
        taskId: handoffId,
        rootSessionId: cSessionId,
        rootHandoffId: handoffId,
        state: 'pending',
        createdAt: Date.now(),
      };
    })();
  }

  async cancel(taskId: string, reason: string): Promise<void> {
    // 实现 §3.1 cancel 级联流程
  }

  async pause(taskId: string, reason?: string): Promise<void> {
    // 实现 §3.2 pause 级联流程（单任务版）
  }

  async pauseAll(receptionSessionId: string): Promise<{ pausedCount: number }> {
    // 实现 §3.2 pause 级联流程（全任务版）
  }

  async getStatus(taskId: string): Promise<BackgroundTaskStatus> {
    // 联合查询 handoff_records + sessions（递归）+ session_inbound_messages
    // 返回 BackgroundTask 派生视图（详见 §5.5 v3.10 b 后台任务清单）
  }

  subscribe(taskId: string, listener: TaskProgressListener): Unsubscribe {
    // 进程内 EventEmitter；监听 substate.changed + handoff.state.changed 事件
  }
}
```

---

## 5. Watcher 设计

### 5.1 主轮询逻辑

```ts
// services/agent-gateway/src/handoff/watcher.ts
class HandoffWatcher {
  private readonly POLL_INTERVAL_MS = 1000;
  private readonly CLAIM_TIMEOUT_MS = 60_000; // 超时未完成自动 unclaim
  private readonly HEARTBEAT_INTERVAL_MS = 30_000; // D51 心跳

  async start(): Promise<void> {
    setInterval(() => this.tick(), this.POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    // 1. 回收僵尸 handoff（claimed 但心跳超时）
    await this.reclaimStale();

    // 2. 处理 pending handoff
    const pending = db
      .prepare(
        `
      SELECT * FROM handoff_records
      WHERE state = 'pending' AND paused = 0
      ORDER BY created_at ASC
      LIMIT 10
    `,
      )
      .all();

    for (const handoff of pending) {
      await this.claim(handoff);
    }

    // 3. 清理过期 inbound
    db.exec(
      `
      UPDATE session_inbound_messages
      SET state = 'expired'
      WHERE state = 'pending' AND expires_at < ?
    `,
      Date.now(),
    );
  }

  private async claim(handoff: HandoffRecord): Promise<void> {
    const claimed = db.transaction(() => {
      const result = db
        .prepare(
          `
        UPDATE handoff_records
        SET state = 'claimed', claimed_at = ?, last_heartbeat = ?
        WHERE id = ? AND state = 'pending'
      `,
        )
        .run(Date.now(), Date.now(), handoff.id);

      return (result.changes as number) === 1;
    })();

    if (!claimed) return; // 被其他 watcher 抢先

    // 启动 target session
    try {
      await this.startTargetSession(handoff);
    } catch (err) {
      db.prepare(
        `
        UPDATE handoff_records
        SET state = 'failed', error_text = ?, completed_at = ?
        WHERE id = ?
      `,
      ).run(String(err), Date.now(), handoff.id);
    }
  }

  private async reclaimStale(): Promise<void> {
    const cutoff = Date.now() - this.CLAIM_TIMEOUT_MS;
    db.prepare(
      `
      UPDATE handoff_records
      SET state = 'pending', claimed_at = NULL,
          crash_retry_count = crash_retry_count + 1
      WHERE state = 'claimed'
        AND last_heartbeat < ?
        AND crash_retry_count < 3
    `,
    ).run(cutoff);

    // crash_retry_count >= 3 时标记为 failed
    db.prepare(
      `
      UPDATE handoff_records
      SET state = 'failed',
          error_text = 'crash recovery exceeded 3 retries',
          completed_at = ?
      WHERE state = 'claimed'
        AND last_heartbeat < ?
        AND crash_retry_count >= 3
    `,
    ).run(Date.now(), cutoff);
  }
}
```

### 5.2 心跳机制（D51 集成）

target session 在 LLM 循环每轮结束时更新 heartbeat：

```ts
// 每轮 LLM 调用结束后
db.prepare(
  `
  UPDATE handoff_records
  SET last_heartbeat = ?
  WHERE target_session_id = ?
`,
).run(Date.now(), sessionId);
```

如果 LLM 调用本身耗时 > 60s，需要在调用前后**双侧更新 heartbeat**，避免被 watcher 误判为僵尸。

### 5.3 跨进程协调（升级路径）

MVP 假设单进程 watcher。如果未来扩展到多进程：

- claim 操作已经是原子 SQL（防双 claim）
- reclaim 也是原子（WHERE last_heartbeat < ?）
- 唯一需要新增的是：**多进程间的事件订阅**——MVP 用 EventEmitter，多进程版本需要换 Redis Pub/Sub 或 PostgreSQL LISTEN/NOTIFY

---

## 6. 关键不变量与测试清单

### 6.1 不变量（必须由测试覆盖）

**I1：c session 不重启**

- 测试场景：c 在 spec_ready 状态收到 clarification_answer 后回到 plan 阶段
- 断言：sessions.id 全程不变、messages_json 单调追加、created_at 不变

**I2：substate 与事件原子性**

- 测试场景：模拟 substate 更新过程中进程崩溃
- 断言：DB 状态与事件订阅者收到的事件最终一致（at-least-once 投递）

**I3：inbound 消费幂等**

- 测试场景：消费 inbound 后 LLM 循环失败重启
- 断言：同一 message_id 只被 consumed 一次（state 不会从 consumed 回到 pending）

**I4：跨层调用必须经协议**

- 测试场景：在代码中尝试直接调用其他层的内部方法
- 断言：lint 规则触发错误（设计期）+ 运行时 audit log 检测（防御期）

**I5：cancel 级联完整性**

- 测试场景：c 已派发 e/f/g 三个子任务，用户在 b 处取消
- 断言：所有 5 个 session（b、c、d、e、f、g）的 handoff_record 都进入 cancelled 状态

**I6：pause 不浪费已付成本**

- 测试场景：c 正在调 LLM 时收到 pause_signal
- 断言：当前轮 LLM 调用完成（不被中断），下一轮才冻结

**I7：watcher 不双 claim**

- 测试场景：模拟 2 个 watcher 同时轮询同一 pending handoff
- 断言：只有 1 个 watcher 成功 claim，另一个 changes()=0

### 6.2 性能基准

| 场景                                  | 目标延迟    |
| ------------------------------------- | ----------- |
| substate 变更 → 上游收到事件          | p95 < 500ms |
| inbound 写入 → target session 消费    | p95 < 2s    |
| cancel 信号广播 → 所有子 session 收到 | p95 < 5s    |
| watcher tick 完成一轮                 | p95 < 200ms |

### 6.3 chaos test 场景

实施 Phase B 上线前必做的测试：

1. **Watcher 崩溃**：随机 kill watcher 进程，验证 reclaimStale 能恢复僵尸 handoff
2. **DB 连接抖动**：模拟 DB 短暂不可用，验证 LLM 循环和 watcher 都能优雅重试
3. **inbound 风暴**：1000 条 inbound 同时写入同一 target session，验证消费顺序与延迟
4. **session 树 cancel**：8 层深的 session 树发起 cancel，验证全树原子取消
5. **重复 schedule**：同一 idempotency_key 的 schedule 调用 100 次，验证只创建 1 个 handoff

---

## 7. 与 v3.10 的迁移路径

### 7.1 数据迁移

```sql
-- Step 1: 加新字段（默认值兼容老数据）
ALTER TABLE sessions ADD COLUMN substate TEXT;
ALTER TABLE sessions ADD COLUMN substate_updated_at INTEGER;
-- ... 其他 L1.8 字段

-- Step 2: 创建新表
CREATE TABLE handoff_records (...);
CREATE TABLE session_inbound_messages (...);

-- Step 3: 老 session 不需要回填 substate（保持 NULL，被视为"非五层 session"）
```

### 7.2 代码迁移

1. **保留现有 `team-leader dispatch`**（v3.10 D24 要求"完全废弃"，但 L1.4 修订后允许保留作为非五层 session 的兜底路径）
2. **新增 `handoff` 模块**：实现本协议的所有逻辑
3. **新增 `b.scheduler`**：通过 `BackgroundTaskScheduler` 接口对外暴露
4. **修改 `interaction-agent rewrite`**：改造为通过 b.scheduler 触发 c session

### 7.3 灰度策略

- **Phase B 上线初期**：只有显式标记 `useStreamingHandoff: true` 的 team session 走新协议
- **观察 1-2 周**：收集 chaos test 数据，验证 7 个不变量
- **全量切换**：所有新 team session 默认走新协议
- **老 session 不迁移**：保留在原"原子 handoff"路径直到自然终结

---

## 8. 决策需团队确认（review 重点）

### 8.1 设计决策

- ⚠️ **D-L1.3-1**：substate 推送是用同事务 outbox 还是简单 EventEmitter？
  - 推荐：MVP 用 EventEmitter（简单，订阅者容忍丢事件 + 轮询 fallback），未来升级到 outbox
- ⚠️ **D-L1.3-2**：inbound TTL 默认值？
  - 推荐：24h；cancel_signal 不过期；pause_signal 不过期
- ⚠️ **D-L1.3-3**：c LLM 循环唤醒机制？
  - 选项 A：定时轮询 inbound（简单、有延迟）
  - 选项 B：进程内 EventEmitter 通知（实时但跨进程不工作）
  - 推荐：A+B 混合，B 失败时 A 兜底（轮询间隔 2s）
- ⚠️ **D-L1.3-4**：watcher claim 超时阈值？
  - 推荐：60s，但 e/f/g 实际写代码可能 > 60s——需要 target session 主动 heartbeat（每 30s）
- ⚠️ **D-L1.3-5**：是否要支持"batch consume inbound"？
  - 选项 A：每轮 LLM 循环只消费 1 条 inbound（顺序保证强）
  - 选项 B：每轮消费所有 pending（吞吐高，顺序需小心）
  - 推荐：B，但 cancel/pause 仍然 P0 优先

### 8.2 实施决策（L3 范畴，但需要 review 期间记录）

- 心跳间隔（30s）、claim 超时（60s）、TTL（24h）等具体数值留给 L3
- session_inbound_messages 表分区策略（按 created_at 月分区）留给运维实施

---

## 9. 当前状态

- ✅ 协议三件套设计完成（§1）
- ✅ 端到端时序示例完成（§2）
- ✅ cancel/pause 级联流程完成（§3）
- ✅ Scheduler 对接完成（§4）
- ✅ Watcher 设计完成（§5）
- ✅ 不变量与测试清单完成（§6）
- ✅ 迁移路径完成（§7）
- ⚠️ 5 项设计决策需团队 review（§8.1）

**review 通过后**：

1. 锁定 L1.3 协议
2. 进入 Phase B 工作量评估（本协议预计 2-3 周实施 + 1 周 chaos test）
3. 等待 Phase A 验证通过后启动 Phase B
