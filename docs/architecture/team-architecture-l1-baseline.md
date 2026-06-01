# Team 架构 L1 基线决策（v1.3）

> ⚠️ **复查发现的现状（2026-05-16 → 2026-06-01 追平）**：
>
> 本文档初稿（v1.0）是基于 v3.10 讨论稿"还没实施"的假设写的，但**实际上 Phase A/B/C/D/E 均已完成实施**（见 `.agentdocs/workflow/done/260515-team-phase-{a,b,c}-实施方案.md` 和 `260516-team-phase-{d,e}-实施方案.md`）。
>
> **追溯性审计已完成**（见 `team-architecture-traceback-audit.md` v2.0），9 项 L1 决策的真实状态（**2026-06-01 以真实代码复核**）：
>
> - ✅ **9 项全部已落地**：L1.1 / L1.2 / L1.3 / L1.4 / L1.5 / L1.6 / L1.7 / L1.8 / L1.9
> - ✅ **L1.3 已完成后端闭环**：反向消息通道、substate、c 层等待澄清（`artifact-chain.ts` 的 `waitForClarificationAnswers` 阻塞循环）、handoff 幂等/暂停字段均已落地
> - ✅ **L1.4 老路径已退役 + 静态护栏已补**：`isHandoffModeEnabled` / `OPENAWORK_TEAM_HANDOFF_MODE` / `team-leader` / `interaction-agent` 在真实 `src/` 下零匹配；新增自定义 ESLint 规则 `team-architecture/no-cross-layer-runner-import` 锁死回归（含动态 `import()`）。
> - ✅ **L1.6 延迟监控已实施**：`handoff/bus/latency-monitor.ts` 四指标 + incident + telemetry。
> - ✅ **L1.8 字段已补齐**：`sessions.substate` / `substate_updated_at` / `paused` 系列已落库。
>
> **剩余待办（非关键路径）**：
>
> - 🟡 L4 运营调参（~8 项）：需上线后看真实数据，属有意延后。
> - 🟡 知识图谱后端持久化：当前前端派生图模型，图数据库后端为"后续评估"。
>
> ---

> 用途：本文档是 OpenAWork 团队架构的**最高优先级决策清单**。所有 L1 决策必须现在锁定，因为它们决定整个系统的"形状"，错了会导致后续全推倒重来。
>
> 关联文档：
>
> - 思想分析归档：`team-architecture-spec-kit-borrowing-discussion.md`（v3.12，讨论历史）
> - **追溯性审计报告**（关键 ⭐）：`team-architecture-traceback-audit.md`
> - Phase A 决策：`team-architecture-phase-a-decisions.md`（已完成实施）
> - **L1.3 流式 handoff 详细设计**：`team-architecture-l1-3-streaming-handoff-spec.md`（v1.1，含与现有实现的差异分析）
> - 延后决策：`team-architecture-deferred-decisions.md`（L3/L4，实施/运营时拍板）
> - **Phase A-E 实施记录**（已完成）：`.agentdocs/workflow/done/260515-team-phase-{a,b,c}-实施方案.md` 和 `260516-team-phase-{d,e}-实施方案.md`
>
> 创建时间：2026-05-16（v1.0 → v1.1 复查修订 + 追溯审计 → v1.3 按真实代码追平）
> 当前状态：**v1.3，9 项 L1 决策全部落地；仅剩 L4 运营调参与知识图谱后端持久化**

---

## 0. 设计哲学

L1 决策遵循三条原则：

1. **能用代码替代 LLM 决策的就用代码**：if/else 可以判定的事情绝不交给 LLM
2. **能默认禁止再开 escape hatch 的就别全允许**：先收紧再放开比反过来容易得多
3. **能延后到实施时再定的就不在 L1 定**：L1 只放真正决定"形状"的事

---

## 1. L1 决策清单（共 9 项）

每项决策都需要满足以下三个条件之一才能进 L1：

- 决定数据模型的根本结构（删表/重命名表的代价不可接受）
- 决定模块间通信协议的形态（破坏性升级影响所有调用方）
- 决定关键性能/可靠性约束（违反会导致用户体验崩塌）

### L1.1 五层架构是否成立 ★ 决定一切

**决策**：引入 b（接待）和 d（PM2）层，形成 a/b/c/d/e-g 五层架构。

**已知前置**：当前 OpenAWork 是 4 角色（planner/researcher/executor/reviewer）固定绑定，没有 b 也没有 d。

**为什么必须现在拍板**：

- 决定 `use-team-runtime-role-bindings.ts` 是 4 角色还是 5+ 角色
- 决定 `services/agent-gateway/src/routes/team.ts` 中 `interaction-agent rewrite` 与 `team-leader dispatch` 是重构成新层还是保留
- 决定数据模型是否要新增 reception session 概念

**拍板**：✅ **引入 b 和 d 层**。理由：

- b 解决"用户不被阻塞 + 多任务并行"的真实痛点
- d 是双源思想的化学反应点（spec-kit Constitution Check + hermes delegate_task）
- 没有这两层，五层架构不成立，七件套大部分失去意义

**风险与缓解**：

- 风险：每层一个 LLM = 长链路高延迟。**缓解见 L1.2 拆分原则**
- 风险：现有 4 角色需要迁移到新架构。**缓解：Phase A 不动 4 角色，Phase B 才迁移**

**触发的连锁修改**：见 v3.12 讨论稿 D11+D12 部分。

---

### L1.2 d 层与 b 层的内部拆分原则 ★ 防止过度依赖 LLM

**决策**：b 层和 d 层均拆为"规则代码 + 多 LLM agent"混合架构，不允许"一个 LLM 干所有事"。

> 📊 **审计结论（v1.1 反向更新，2026-05-16）**：基于追溯审计结果（`team-architecture-traceback-audit.md` §2），现有 d 层（`pm2-runner.ts`）实际实施**意外符合本拆分原则**——`buildDispatchPackages` 是纯代码（基于 [P]/[US1] 标记的文本解析），不需要 LLM。下表已根据现状修正：d.3 改为"纯代码"。

**问题动机**：当前讨论稿把 d 层奉为桥接节点，但同时让 d 一个 LLM 承担 5 件事（Constitution Check + architecture review + dispatch 拆分 + 双重 review + escalation 决策）。这是过度依赖 LLM 的反模式——能用 if/else 判断的事情不应该交给 LLM。

#### L1.2.1 d 层拆分（v1.1 修订）

```
当前讨论稿设计：d 层 = 1 个 LLM 干 5 件事
       ↓
L1 决策：d 层 = 规则代码 + LLM agent 混合
       ↓
实际实施（pm2-runner.ts）：5 子职责中 3 项已是规则代码
```

具体拆分：

| 子职责                      | 实现                                                    | 输入                             | 输出                                      | 实施状态  |
| --------------------------- | ------------------------------------------------------- | -------------------------------- | ----------------------------------------- | --------- |
| **d.1 Constitution Check**  | LLM 调用 + PASS/VIOLATION 输出格式约束                  | plan.md + constitution.md        | check_result（pass/fail + 违反条款列表）  | ✅ 已实施 |
| **d.2 architecture review** | 规则代码（lint 工具）+ LLM 兜底                         | 实际代码 patch + architecture.md | review_result（pass/fail + 违反规则列表） | ❌ 未实施 |
| **d.3 dispatch 拆分**       | **纯代码**（解析 tasks.md 的 [P]/[US1] 标记）           | tasks.md                         | dispatch_packages 列表                    | ✅ 已实施 |
| **d.4 spec/quality review** | LLM（综合判断）                                         | e/f/g 产物 + spec/plan           | review_report                             | ❌ 未实施 |
| **d.5 escalation 决策**     | 规则代码（throw Error → watcher reclaim → retry_count） | handoff_records.escalation_round | 'retry' / 'rebuild' / 'escalate_user'     | ✅ 已实施 |

**强制约束**：d.2、d.3、d.5 **不允许**用 LLM 实现核心逻辑。d.1 因需要自然语言对齐判断必须用 LLM，但通过结构化输出格式（`PASS` / `VIOLATION: xxx`）约束 LLM 行为，不属于"自由 LLM 决策"。LLM 只能作为兜底（规则无法覆盖的边缘情况）。

#### L1.2.2 b 层拆分

```
当前讨论稿设计：b 层 = 1 个 LLM 同时陪聊 + 路由 + 调度 + 推送
       ↓
L1 决策：b 层 = router + companion + scheduler 三个独立组件
```

| 组件            | 实现                                | 职责                                     |
| --------------- | ----------------------------------- | ---------------------------------------- |
| **b.router**    | 规则代码 + 轻量 LLM 兜底            | 意图识别（直答/走 c/紧急直派）+ 路由决策 |
| **b.companion** | 独立 LLM（陪聊 agent）              | 与用户的同步对话、闲聊、查询、推送格式化 |
| **b.scheduler** | 纯代码（`BackgroundTaskScheduler`） | 创建/查询/取消/订阅后台任务              |

**强制约束**：

- b.router 决策必须可被 audit log 解释（"为什么走 c 而不是直答"）
- b.companion 不持有 scheduler 状态（避免双 truth）
- b.scheduler 不调 LLM（纯调度逻辑）

#### L1.2.3 实施约束

- **类型层强制**：b 和 d 层的 SOUL（角色级人格）必须按子组件分别声明
- **审计要求**：每次"规则判断"和"LLM 兜底"都要写 audit log，标记 `decision_source: 'rule' | 'llm'`
- **演化机制**：发现规则覆盖不足 → 扩规则；发现 LLM 兜底过频 → 提取新规则；不允许"反向迁移"（LLM 替代已有规则）

---

### L1.2A 可见固定团队成员不是新的运行层 ★ 防止 roleLayer 爆炸

**决策**：默认固定团队的人物（前端开发者、后端开发者、DevOps、SRE、安全评审、发布经理等）建模为 **visible member slots / specialist personas**，不新增 `roleLayer`。

**边界定义**：

| 概念               | 用途              | 示例                                                   | 是否进入 handoff/capability 矩阵 |
| ------------------ | ----------------- | ------------------------------------------------------ | -------------------------------- |
| `roleLayer`        | 运行时协议边界    | `reception` / `pm1` / `pm2` / `executor` / `reviewer`  | 是                               |
| `memberSlot.layer` | 可见人物归属层    | `executor` 层的 DevOps 工程师                          | 否，映射到现有 roleLayer         |
| `specialty`        | 人物专长/派发偏好 | `frontend` / `backend` / `devops` / `sre` / `security` | 否                               |
| `personaKey`       | 同层 SOUL 变体    | `executor:devops` / `reviewer:security`                | 否                               |

**默认固定团队矩阵**：

| 运行层    | 默认人物                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| reception | 接待官 / 需求澄清官                                                                                                 |
| pm1       | 产品规划师、任务拆解师                                                                                              |
| pm2       | 技术负责人、调度派发官、发布经理                                                                                    |
| executor  | 前端开发者、后端开发者、数据工程师、工作流工程师、集成工程师、测试验证工程师、文档工程师、DevOps 工程师、平台工程师 |
| reviewer  | 代码评审员、安全评审员、SRE / 运维评审员、可观测性评审员、质量评审员                                                |

**为什么不新增运行层**：

- 新增 `devops` / `sre` / `security` 等 `roleLayer` 会连带修改 capability matrix、handoff 拓扑、substate 白名单、persona seed、UI 过滤、测试与审计，属于结构性破坏。
- 这些成员的差异主要是专业上下文与工具偏好，不是独立通信协议。
- 真正需要独立层的标准是：需要独立 inbound / substate / artifact phase / handoff lifecycle。当前 DevOps/SRE/Security/Release 均不满足这个门槛。

**派发原则**：

- `taskProfile.kind` 决定终端层：实现/修复/重构/文档/验证 → `executor`；评审 → `reviewer`。
- `taskProfile.surface` 与任务内容选择同层内的 `specialty` 成员。
- `release/security/sre/observability` 默认作为 PM2/reviewer 门禁成员；当任务是“实现部署脚本 / 补日志 / 加告警”时，可作为 executor 层专长执行。

**持久化原则**：

- 工作区/模板可保存默认 roster；创建 session 时必须写入 `sessions.metadata_json.teamDefinition.version=2` 的不可变快照。
- 历史 session 不受默认团队后续编辑影响。
- UI 展示必须按运行层分组，但卡片展示具体人物、specialty、agent 绑定和 toolsets。

---

### L1.3 跨层通信协议形态 ★ 决定核心通信机制

**决策**：跨层通信采用**流式 handoff + 子状态机 + 双向消息通道**，而非原子 handoff。

> 📖 **完整实施设计**：见 `team-architecture-l1-3-streaming-handoff-spec.md`（含 SQL、状态机、时序、不变量、测试清单、迁移路径）。本节仅给出概要。

**问题动机**：v3.12 讨论稿设计的 ⑥ Handoff Protocol 是单次原子调用：

- c 必须一次性输出所有产物（spec + plan + tasks）才能返回
- 澄清要往返时 c 必须重启 session（重新加载 7 层 system prompt）
- b 在 c 跑的 10-30s 期间是黑盒，看不到内部进度
- 无法在 spec/plan/tasks 之间暂停（违反 D30"关键节点暂停"）

#### L1.3.1 协议三件套

**第一件：handoff 仍然是初始派发的协议**

```sql
-- 与 v3.12 讨论稿一致，handoff_records 表保留
CREATE TABLE handoff_records (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  target_session_id TEXT,
  source_layer TEXT NOT NULL,
  target_layer TEXT NOT NULL,
  state TEXT NOT NULL,                -- 'pending' / 'claimed' / 'running' / 'completed' / 'failed' / 'cancelled'
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_text TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER,
  -- D29 / D42 字段保留
  escalation_round INTEGER DEFAULT 0,
  paused INTEGER DEFAULT 0,
  paused_at INTEGER,
  cancel_requested INTEGER DEFAULT 0,
  cancel_reason TEXT
);
```

**第二件（新）：sessions 表加 substate 字段**

```sql
-- 子状态字段：让上游知道下游在干什么
ALTER TABLE sessions ADD COLUMN substate TEXT;
ALTER TABLE sessions ADD COLUMN substate_updated_at INTEGER;
CREATE INDEX idx_sessions_substate ON sessions(substate) WHERE substate IS NOT NULL;
```

substate 取值由各层定义：

| 层    | substate 取值                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| c     | 'drafting_spec' / 'spec_ready' / 'clarifying' / 'drafting_plan' / 'plan_ready' / 'drafting_tasks' / 'tasks_ready' / 'completed' |
| d     | 'constitution_check' / 'architecture_review' / 'dispatching' / 'awaiting_eg' / 'reviewing' / 'escalating' / 'completed'         |
| e/f/g | 自定义                                                                                                                          |

**第三件（新）：session_inbound_messages 表**

```sql
-- 反向通道：让 b 在 c session 不重启的前提下注入新输入
CREATE TABLE session_inbound_messages (
  id TEXT PRIMARY KEY,
  target_session_id TEXT NOT NULL,
  source_layer TEXT NOT NULL,         -- 'reception' / 'pm1' / 'pm2'（上游推送）
  message_type TEXT NOT NULL,         -- 'clarification_answer' / 'user_input' / 'cancel_signal' / 'pause_signal' / 'resume_signal'
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,                -- 'pending' / 'consumed' / 'expired'
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_inbound_target_state ON session_inbound_messages(target_session_id, state);
```

#### L1.3.2 协议流程

```
b 启动 c session：
  1. 创建 handoff_record（state=pending）
  2. Watcher claim → 创建 c session（substate=null）
  3. c 开始第一轮 LLM 循环

c 推进过程（每个子步骤）：
  1. c 完成 spec 草稿 → UPDATE sessions SET substate='spec_ready' WHERE id=c.id
  2. c 通过 b 的 subscribe channel 推送 'spec_ready' 事件
  3. c 检查 session_inbound_messages（pending）
     - 如果有 cancel_signal → 退出循环
     - 如果有 pause_signal → 冻结状态等 resume
     - 如果有 user_input/clarification_answer → 注入对话流
  4. c 进入下一子步骤

c 触发澄清（不重启）：
  1. c 发现 [NEEDS CLARIFICATION] → UPDATE sessions SET substate='clarifying'
  2. c 推送 'clarification_needed' 事件给 b（含问题列表）
  3. c 等待 session_inbound_messages 中出现 clarification_answer
  4. b 收到事件 → 推送给 a → 用户回答 → b INSERT INTO session_inbound_messages
  5. c 在下一轮 LLM 循环中读取 → 继续推进（同一 session 不重启）

c 完成：
  1. UPDATE sessions SET substate='completed'
  2. UPDATE handoff_records SET state='completed', result_json=...
```

#### L1.3.3 与 spec-kit 七步的对应

```
spec-kit 七步：constitution → specify → clarify → plan → tasks → analyze → implement

OpenAWork 落地：
  constitution = team_workspaces.constitution_md（注入栈，不算一步）
  specify       = c.substate='drafting_spec' → 'spec_ready'
  clarify       = c.substate='clarifying'（双向往返，不重启）
  plan          = c.substate='drafting_plan' → 'plan_ready'
  tasks         = c.substate='drafting_tasks' → 'tasks_ready'
  analyze       = d 层（不在 c 内）
  implement     = e/f/g 层（不在 c 内）
```

每一步对外都显式可见、可暂停、可取消。

#### L1.3.4 实施约束

- **session 不重启原则**：clarify 往返期间 c session 必须保持活跃，不允许销毁后重建
- **inbound 消费必须幂等**：同一 message_id 被消费多次不能产生副作用
- **substate 推送必须及时**：substate 变更与事件推送必须在同一事务内（避免上游永远等不到事件）
- **跨进程订阅延后**：MVP 用进程内 EventEmitter（D40），跨进程订阅升级路径预留但不实施

---

### L1.4 跨层调用是否允许直连 ★ architecture 纯度

**决策**：默认禁止跨层直连，但明确 4 个 escape hatch（其中 #4 为迁移期专用）。

> 📊 **审计结论（v1.1 反向更新，2026-05-16）**：基于追溯审计（`team-architecture-traceback-audit.md` §4），现有实施采用了 `OPENAWORK_TEAM_HANDOFF_MODE=1` feature flag 灰度策略，**没有完全废弃 `team-leader dispatch` / `interaction-agent rewrite`**。这与 v3.10 D24"完全废弃"决策不符，但实际是**更稳妥的工程选择**。v1.1 正式接受 feature flag 作为合法的迁移期机制。

**问题动机**：v3.12 讨论稿 D24 拍板"无 escape hatch 完全禁止"，但这与两个真实需求冲突：

1. D29 的"d 升级用户"路径——d 必须跨过 c 直接通知 b，本身就违反 D24
2. **现有代码迁移期**——突然废弃老路径会导致大量回归，团队选择 feature flag 灰度更稳妥

#### L1.4.1 默认禁止规则

a → b → c → d → e/f/g 单向链式调用，**严格禁止**：

- e 直接调 c（跨过 d）
- d 直接调 a（跨过 b）
- c 直接调 e（跨过 d）

#### L1.4.2 四个 escape hatch（v1.1 新增 #4）

| Escape Hatch                       | 方向       | 协议                                                                          | 限制                                                                                                         |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **#1 escalation 反向通道**         | 任意层 → b | 通过 `session_inbound_messages` (message_type='escalation_request')           | 只能传结构化 escalation 事件，不能传业务数据；必须经 audit log；必须在 handoff_records.escalation_round 留痕 |
| **#2 进度上报通道**                | 任意层 → b | 通过 EventEmitter 推送 progress event                                         | 只能传 substate 变更 + 进度数字（如 "3/8 task 完成"）；不携带业务上下文                                      |
| **#3 cancel/pause 信号广播**       | b → 任意层 | 通过 `session_inbound_messages` (message_type='cancel_signal'/'pause_signal') | 只能携带控制信号；由各层主动检查（pull 模式）；级联生效（父→子）                                             |
| **#4 迁移期 feature flag**（新增） | 老路径     | `OPENAWORK_TEAM_HANDOFF_MODE` 环境变量；`isHandoffModeEnabled()` 控制         | **临时**机制；新功能不允许走老路径；只能修 bug 不能加功能；Phase F+ 评估彻底删除时机 ⟶ **2026-06-01 复核：老路径已退役，flag/老路由在真实 `src/` 下零匹配，escape hatch #4 已退场** |

#### L1.4.3 实施约束

- **类型层强制**：跨层调用必须走受控通道；`handoff/runner/` 下任一层 runner **禁止跨层直接 import 另一层 runner**，由自定义 ESLint 规则 **`team-architecture/no-cross-layer-runner-import`** 静态强制（`scripts/eslint-rules/no-cross-layer-runner-import.mjs`，覆盖静态 `import` 与动态 `import()`；受控编排器 `watcher` / `pm1-runner` 分发器 / `scheduler` 白名单豁免；配套 RuleTester 自测，接入 `pnpm run lint:rules`）。✅ 已落地（2026-06-01）
- **审计强制**：所有 escape hatch 调用必须写 audit log，标明 hatch_type（`reception-orchestrator.ts::logRouteDecision` 等已落地）
- **演化机制**：发现新的需要反向通信的场景 → 扩展 escape hatch 类型（最多 5 个），不允许"绕过 L1.4"；新增白名单编排器需走架构 review

#### L1.4.4 feature flag 退出策略（v1.1 新增）

`OPENAWORK_TEAM_HANDOFF_MODE` 是**临时机制**，必须有退出计划：

| 阶段     | flag 状态            | 行为                                         | 触发条件                               |
| -------- | -------------------- | -------------------------------------------- | -------------------------------------- |
| 当前     | 默认关闭，可手动开启 | 老路径完全跑，handoff 协议 opt-in 验证       | 已实施                                 |
| Phase F  | 默认开启，可手动关闭 | 优先 handoff 路径，老路径降级为 fallback     | L1.3 流式 handoff 改造完成 + 稳定 4 周 |
| Phase G+ | 老路径删除           | flag 字段保留但不再读取；老路由返回 410 Gone | Phase F 默认开启 ≥ 12 周无回归         |

**禁止**：把 flag 设计为"永久存在"。如果某场景必须保留老路径，必须升级为正式的 escape hatch（#5+）走 RFC 流程。

---

### L1.5 项目记忆双存储归属 ★ 数据模型起点

**决策**：保持 v3.12 D34 + D55 修正后的双存储归属。

**已锁定**：

| 字段                   | 存储位置        | 范围                     | 写入方                                          |
| ---------------------- | --------------- | ------------------------ | ----------------------------------------------- |
| `users.user_memory_md` | DB 字段         | 用户级（跨 team）        | b 主写、c/d 可写                                |
| `project-memory.md`    | 仓库根 git 文件 | 仓库级（所有 team 共享） | c/d 主写、e/f/g 通过 proposedMemoryEntries 提议 |
| `lessons-learned.md`   | 仓库根 git 文件 | 仓库级（学习闭环）       | d 提议 + 用户确认                               |

**为什么是 L1**：决定了 7 层注入栈的存储底座，错了会导致 prompt builder 完全重写。

**实施约束**：

- 仓库级 git 文件由 git 版本控制，不进数据库
- DB 字段（user_memory_md）字符上限交给 L3（实施时定）
- 注入顺序固定：AGENTS → architecture → constitution → project-memory → lessons-learned → user_memory → SOUL

> 📊 **审计补充亮点（v1.1 反向更新）**：现有 `team-instruction-stack.ts` 实施**比设计更完善**，3 个额外亮点：
>
> 1. **AGENTS.md 去重处理**：第 1 层 AGENTS.md 由 `routes/stream.ts::buildWorkspaceContext` 注入到 stable 段，本模块**不再重复注入**，避免 token 翻倍 + prompt cache prefix 抖动
> 2. **24K token 软上限警告**：当总 token 估算超过 24,000 时自动加 `oversize-warning` 段，让模型主动声明上下文受限
> 3. **ForceApply cache breaker tag**：用户改任意一层后通过 `getForceApplyCacheTag` 推进 cache breaker tag，强制下一轮重新拼装；与 D41 配合实现"不破坏 prefix cache 但用户能强制刷新"
>
> 这些细节应该作为 L1.5 的**正式约束**保留，而不是被当作实施细节遗漏。

---

### L1.6 用户感知延迟约束 ★ 用户体验底线

**决策**：用户感知延迟必须满足以下硬约束。

**为什么是 L1**：成本不算钱，但延迟会算"用户耐心"。完整链路 6 次 LLM 调用即使免费也会因延迟劝退用户，必须在协议层就设计延迟对策。

#### L1.6.1 延迟硬约束

| 场景                 | 约束     | 兜底策略                                     |
| -------------------- | -------- | -------------------------------------------- |
| a→b 直答路径         | p95 < 3s | 超过 3s 自动降级为"已收到，正在思考"         |
| a→b "已开始处理"确认 | p95 < 2s | 这是同步路径，必须在 2s 内返回               |
| 后台任务推送通知     | p95 < 5s | substate 变更后 5s 内必须推送                |
| 进度推送间隔         | ≤ 60s    | 超过 60s 没有任何更新自动推送"仍在运行中..." |
| 完整任务总耗时       | 不限     | 但每步必须有进度反馈                         |

#### L1.6.2 延迟可见性

- 前端必须显示"当前正在做什么"（基于 substate）
- 不允许出现"无任何反馈的等待"
- 用户主动询问时（"那个怎么样了"）b 必须在 2s 内回应（即使是"还在 c 阶段，正在做 plan"）

#### L1.6.3 实施约束

- 延迟监控必须接入 telemetry（与现有埋点系统对齐）
- 超过 p95 约束 → 触发告警 + 写入 audit log
- 演化机制：约束本身可调整，但调整必须有数据支撑（看真实分布）

---

### L1.7 Handoff Protocol 数据存储位置

**决策**：使用独立 `handoff_records` 表（不复用 metadata 字段）。

**为什么是 L1**：决定核心通信机制的数据底座。

**已锁定**（v3.12 D14）：见 L1.3.1。

> 📊 **审计补充：claim_token 防双 claim（v1.1 反向更新）**
>
> 现有 `handoff-store.ts::claimHandoff` 使用 `claim_token` 字段实现防双 claim，是**教科书级**实现：
>
> ```sql
> -- 原子 UPDATE：state='pending' AND id=? 是单语句原子操作
> UPDATE handoff_records
>    SET state = 'claimed',
>        claim_token = ?,         -- 随机 UUID
>        claimed_at = datetime('now')
>  WHERE id = ? AND state = 'pending'
>
> -- 回读 + 双重检查：state == 'claimed' AND claim_token 匹配
> ```
>
> **claim_token 是正式机制**（不是 L3 实施细节）。多 watcher 场景下用 UUID 而非时间戳避免碰撞，单语句 SQL 保证原子性。本字段必须保留在 schema 中。

---

### L1.8 Session 状态机扩展位置

**决策**：扩展现有 `sessions` 表（不新建 `session_layers` 表）。

**为什么是 L1**：决定核心数据模型形态。

**字段清单**（v3.12 D13 + L1.3 整合）：

```sql
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN role_layer TEXT;          -- 'reception' / 'pm1' / 'pm2' / 'execution'
ALTER TABLE sessions ADD COLUMN intent_state TEXT;        -- 'ask' / 'plan' / 'implement' / 'investigate'
ALTER TABLE sessions ADD COLUMN substate TEXT;            -- L1.3 新增，子状态机
ALTER TABLE sessions ADD COLUMN substate_updated_at INTEGER;
ALTER TABLE sessions ADD COLUMN handoff_state TEXT;       -- 'pending' / 'running' / 'completed' / 'failed' / null
ALTER TABLE sessions ADD COLUMN structural_depth INTEGER NOT NULL DEFAULT 0;  -- D18 结构深度
ALTER TABLE sessions ADD COLUMN execution_depth INTEGER NOT NULL DEFAULT 0;   -- D18 执行深度
ALTER TABLE sessions ADD COLUMN paused INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN paused_at INTEGER;

CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_sessions_substate ON sessions(substate) WHERE substate IS NOT NULL;
CREATE INDEX idx_sessions_paused ON sessions(paused) WHERE paused = 1;
```

---

### L1.9 BackgroundTaskScheduler 抽象接口

**决策**：保持 v3.12 D40 拍板的接口形态。

**为什么是 L1**：决定 b 层的下游接口形态，错了会导致 b.scheduler 重写。

**已锁定**（v3.12 D40）：

```ts
interface BackgroundTaskScheduler {
  schedule(input: ScheduleInput): Promise<ScheduledTask>;
  getStatus(taskId: string): Promise<BackgroundTaskStatus>;
  cancel(taskId: string, reason: string): Promise<void>;
  listActive(receptionSessionId: string): Promise<BackgroundTask[]>;
  subscribe(taskId: string, listener: TaskProgressListener): Unsubscribe;
  pause(taskId: string, reason?: string): Promise<void>;
  resume(taskId: string): Promise<{ resumed: true; staleWarning?: boolean }>;
  pauseAll(receptionSessionId: string, reason?: string): Promise<{ pausedCount: number }>;
  resumeAll(receptionSessionId: string): Promise<{ resumedCount: number; staleCount: number }>;
}
```

**实施约束**（v3.12 不变）：

- MVP 实现 `InProcessScheduler`（直接转 `createHandoff`）
- 接口字段先扩展不限定最小集（priority / scheduledAt / deadline / retryPolicy / idempotencyKey 等）
- scheduler 接口外**不能**直接调 createHandoff（与 L1.4 同源约束）

> 📊 **审计反向更新（v1.1，2026-05-16）**：现有 `scheduler.ts::InProcessScheduler` 实施**比上面接口更精简**，9 个方法都对应但签名不同：
>
> ```ts
> // 实际签名（建议作为 L1 正式接口）
> interface BackgroundTaskScheduler {
>   schedule(input: ScheduledTaskInput): ScheduledTaskSnapshot; // 同步返回
>   cancel(taskId: string): boolean;
>   pause(taskId: string): boolean;
>   resume(taskId: string): boolean;
>   pauseAll(): number;
>   resumeAll(): number;
>   listActive(): ScheduledTaskSnapshot[];
>   getStatus(taskId: string): ScheduledTaskSnapshot | null;
>   subscribe(listener: SchedulerListener): () => void;
> }
>
> interface ScheduledTaskInput {
>   id: string; // 唯一 id（兼具 idempotency key 作用）
>   meta?: Record<string, unknown>; // 透传元数据
>   run: (signal: AbortSignal) => Promise<void>; // 实际任务体
> }
> ```
>
> **简化合理性**：
>
> 1. `priority` / `scheduledAt` / `deadline` / `retryPolicy` 等扩展字段属于 L3 实施细节，没有真实使用场景就不应该放在 L1 接口
> 2. `id` 兼具 `idempotency_key` 作用——同 id 再次 schedule 返回 noop，覆盖了 D40 idempotency 需求
> 3. 同步返回（`ScheduledTaskSnapshot`）比 `Promise<ScheduledTask>` 简单，因为入队是 in-process 操作
> 4. 9 个方法本身完整覆盖 D40 锁定的能力
>
> **L1.9 决策修订**：以现有接口为正式 L1 接口。未来需要扩展字段时通过 RFC 流程加入，不预先在文档假设。

---

## 2. L1 决策与 L2/L3/L4 的关系

```
L1（本文档，9 项）
  │
  │ 决定数据模型 + 通信协议 + 延迟约束
  ▼
L2（每个 Phase 启动时拍板，~15 项）
  │
  │ 决定该 Phase 的功能范围 + 实现细节
  ▼
L3（落地具体功能时定，~25 项）
  │
  │ 决定具体阈值 / 默认值 / UI 细节
  ▼
L4（上线后根据数据调整，~8 项）
```

**示例**：

- L1.6 定"延迟硬约束 p95 < 3s"
- L2 定"Phase A 是否引入 SOUL 注入栈"（影响 b.router 复杂度）
- L3 定"b.router 的关键词列表具体内容"
- L4 定"路由规则是否需要根据真实分布调整"

---

## 3. 与 v3.12 讨论稿的对应

| L1 决策                      | v3.12 对应决策           | 关系                                                    |
| ---------------------------- | ------------------------ | ------------------------------------------------------- |
| L1.1 五层架构                | D11+D12                  | 保持                                                    |
| L1.2 d/b 拆分原则            | 部分对应 D43（工具门控） | **新增**：v3.12 没有"规则代码 vs LLM"拆分原则           |
| L1.3 流式 handoff + 子状态机 | 替代部分 D14             | **修改**：v3.12 是原子 handoff，L1.3 升级为流式         |
| L1.4 跨层调用 + escape hatch | D24（修订）              | **修改**：v3.12 是"完全禁止"，L1.4 加 3 个 escape hatch |
| L1.5 项目记忆双存储          | D34 + D55                | 保持                                                    |
| L1.6 延迟硬约束              | 无对应                   | **新增**：v3.12 没有延迟约束                            |
| L1.7 Handoff 存储位置        | D14                      | 保持                                                    |
| L1.8 Session 状态机扩展      | D13 + D18 + D42          | 保持（字段整合）                                        |
| L1.9 BackgroundTaskScheduler | D40                      | 保持                                                    |

**v3.12 中其他 47 项决策**全部下沉到 L2/L3/L4，详见：

- Phase A 决策：`team-architecture-phase-a-decisions.md`
- 延后决策：`team-architecture-deferred-decisions.md`

---

## 4. L1 决策审批流程

L1 决策修改成本极高（影响数据模型、通信协议），必须满足：

1. **修改提议**：以 RFC 形式提出（标题：`[RFC L1.X] 修改建议`）
2. **影响评估**：必须列出所有受影响的 L2/L3/L4 决策
3. **迁移方案**：必须提供旧→新的迁移路径
4. **团队共识**：至少 2 名核心维护者 +1 即可通过

L2/L3/L4 修改不需要这套流程，按各自规则处理。

---

## 5. 当前状态（v1.1 修订）

### 5.1 实施现状对照

| L1 决策                      | v3.10/v3.11 决策 | 实施状态            | 实施位置                                                                                                                                                                           |
| ---------------------------- | ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1.1 五层架构                | D11+D12          | ✅ **已实施**       | Phase B 落地 + 260518 五层链路打通                                                                                                                                                 |
| L1.2 d/b 拆分原则            | （新增）         | ✅ **已实施**       | `reception-router.ts`（b.router）+ `reception-orchestrator.ts`（b.companion）+ `scheduler.ts`（b.scheduler）；`pm2-runner.ts`（d.1/d.2/d.3/d.5）                                   |
| L1.3 流式 handoff            | （修改 D14）     | ✅ **已实施并收口** | `session_inbound_messages` 表 + `team-inbound.ts` + `substate` 字段 + `inbound-store.ts` + `artifact-chain.ts` answer/timeout/cancel/pause 等待闭环                                |
| L1.4 跨层调用 + escape hatch | （修订 D24）     | ✅ **已实施**       | `team-events-bus.ts` escape hatch 事件 + `routes/team.ts` audit log + `reception-orchestrator.ts` route decision log                                                               |
| L1.5 项目记忆双存储          | D34 + D55        | ✅ **已实施**       | Phase A 落地（260515-team-phase-a）                                                                                                                                                |
| L1.6 延迟硬约束              | （新增）         | ✅ **已实施**       | `latency-monitor.ts` 滑动窗口 + inbound 端点采样                                                                                                                                   |
| L1.7 Handoff 存储位置        | D14              | ✅ **已实施**       | `handoff_records` 表 + `handoff-store.ts` claim_token 防双 claim                                                                                                                   |
| L1.8 Session 状态机扩展      | D13 + D18 + D42  | ✅ **已实施**       | sessions 全部字段已加（team_parent_session_id / role_layer / handoff_state / substate / substate_updated_at / intent_state / structural_depth / execution_depth / last_heartbeat） |
| L1.9 BackgroundTaskScheduler | D40              | ✅ **已实施**       | `InProcessScheduler` 9 方法全覆盖                                                                                                                                                  |

### 5.2 团队 review 项目（v1.3 复核：均已追平）

> v1.1 列出的待办在 2026-06-01 复核中已全部完成。下方保留原清单并标注真实状态。

**A. 验证已实施部分是否符合 L1 假设**（追溯性检查）

- [x] 检查现有 `team-leader dispatch` 是否完全废弃（D24 = L1.4 要求）—— ✅ 已退役，`team-leader` / `interaction-agent` / `isHandoffModeEnabled` 在真实 `src/` 下零匹配
- [x] 检查现有 watcher 是否正确处理双 claim（claim_token）—— ✅ `handoff-store.ts::claimHandoff` 原子 UPDATE + claim_token 回读双检，`handoff-store` 测试覆盖
- [x] 检查 BackgroundTaskScheduler 的 9 个方法是否完整实现 —— ✅ `InProcessScheduler` 9 方法全覆盖

**B. 4 项需要新增/改造（均已完成）**

- [x] **L1.2 d/b 拆分原则**：d 层 `pm2-runner` 的 dispatch 拆分是纯代码、Constitution/architecture review 用结构化 LLM、escalation 用规则代码；b 层已拆 `reception-router`（规则+LLM 兜底）+ `reception-orchestrator`（编排）+ `scheduler`
- [x] **L1.3 流式 handoff 增量改造**：后端闭环已完成（`artifact-chain.ts` 的 `waitForClarificationAnswers` 阻塞循环 + substate 全程写入），详见 `team-architecture-l1-3-streaming-handoff-spec.md` §0.B
- [x] **L1.4 escape hatch 协议 + 静态护栏**：`team-events-bus.ts` escape hatch 事件 + `routes` audit log；**新增自定义 ESLint 规则 `team-architecture/no-cross-layer-runner-import`**（`scripts/eslint-rules/`，覆盖静态 + 动态 import，含 RuleTester 自测，接入 `pnpm run lint:rules`）
- [x] **L1.6 延迟约束**：`handoff/bus/latency-monitor.ts` 四指标 + incident + telemetry

**C. 已实施部分的 follow-up（已处置）**

- [x] 字段命名不一致：已统一以现有 `team_parent_session_id` 等现有命名为准（见 L1.3 spec §0.A.5 对照表）
- [x] 时间戳类型不一致：已确定新增字段保持现有 TEXT ISO datetime
- [x] L1.8 缺失字段：`substate` / `substate_updated_at` / `paused` 系列已落库（`infra/db.ts` ensureColumn）

### 5.3 下一步动作（v1.3 复核：核心已完成）

1. ✅ **追溯性 review**：见 `team-architecture-traceback-audit.md` v2.0 §0。
2. ✅ **L1.2 落地评估**：d 层无需重写，dispatch 拆分本就是纯代码（优于假设）。
3. ✅ **L1.3 运行观察与 verification 排查**：`verify-task-tool-no-permission.ts` 2026-06-01 实跑通过（standalone + 完整 `test:task-tool` 链均 EXIT=0），原"阻塞"为已消失的测试隔离 flaky。
4. ✅ **L1.4 lint 规则添加**：已落地 `scripts/eslint-rules/no-cross-layer-runner-import.mjs`（放在仓库根 `scripts/` 而非最初设想的 `services/agent-gateway/src/eslint-rules/`，便于 flat config 以 inline plugin 接入）。
5. ✅ **L1.6 telemetry 接入**：`latency-monitor.ts` 四指标已接 telemetry 通道。
6. ✅ **Phase A 决策文档校准**：见 `team-architecture-phase-a-decisions.md` v1.1 复盘归档（承认实际已引入 SOUL）。

**剩余（非关键路径）**：L4 运营调参（~8 项，上线后数据驱动）；知识图谱后端持久化（前端派生图模型已可用，后端为后续评估）。
