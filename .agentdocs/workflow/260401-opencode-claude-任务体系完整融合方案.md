# OpenCode 与 Claude Code 任务体系完整融合方案

## Task Overview

基于本地源码本体对 `temp/opencode/packages/opencode/src/**` 与 `temp/claude-code-sourcemap/restored-src/src/**` 做严格对比，设计一套新的统一任务体系。目标不是做名字映射，而是完成“核心域模型 + 运行时层 + 平台适配层”的完整融合方案，明确哪些能力进入核心，哪些能力降级为扩展，哪些旧语义必须舍弃为核心定义。

## Current Analysis

### 1. OpenCode 现状

- 核心是 **session-driven workflow**：`task` 负责创建/恢复子 session 并委派 subagent 执行。
- `question` 通过 pending Question 服务形成 ask/reply/reject/list 闭环。
- `todowrite` 将待办持久化到 `session_id` 维度，不是任务实体生命周期。
- `plan_exit` 存在且可注册，`plan_enter` 仅存在源码中但未活跃注册。
- 规划工作流主要靠 prompt 中的阶段规范 + plan agent，不是完整显式任务域。

### 2. Claude Code 现状

- 核心是 **task-entity + runtime-lifecycle**：`Agent` 负责委派执行；`TaskCreate/Get/List/Update` 维护任务实体；`TaskOutput/TaskStop` 管理后台任务生命周期。
- `AskUserQuestion` 是 richer 的一等交互工具；`EnterPlanMode/ExitPlanMode` 是一等规划边界工具。
- 任务实体以文件形式存储；后台输出采用输出文件 + 轮询 + 通知 + eviction 的显式 runtime。

### 3. 关键结构性差异

- **OpenCode 的 `task` 是动作**，Claude 的 `TaskCreate/...` 是实体管理。
- **OpenCode 的 `todowrite` 是会话待办**，Claude 的 `TaskUpdate` 是任务对象更新。
- **OpenCode 计划能力偏 agent 策略**，Claude 计划能力偏系统显式能力。
- **Claude 有完整后台任务 runtime**，OpenCode 当前没有对等的一等工具面。

### 4. 真等价与伪等价

#### 真等价

- OpenCode `task` ↔ Claude `Agent`
- OpenCode `question` ↔ Claude `AskUserQuestion`（仅限交互闭环语义，不含 richer preview/annotations）
- OpenCode `plan_exit` ↔ Claude `ExitPlanMode`（仅限“退出规划态并请求确认”）
- OpenCode `todowrite` ↔ Claude `TodoWrite`（仅限 checklist 能力）

#### 伪等价

- OpenCode `task` ≠ Claude `TaskCreate/Get/List/Update`
- OpenCode `todowrite` ≠ Claude `TaskUpdate`
- OpenCode `plan` agent ≠ Claude `EnterPlanMode/ExitPlanMode` 完整体系
- OpenCode 当前 runtime ≠ Claude `TaskOutput/TaskStop + framework + diskOutput`

## Solution Design

### 总体原则

这次融合不应以工具名为中心，而应以**统一域模型**为中心。新的系统要让：

1. OpenCode 的 session 驱动委派能力被保留；
2. Claude 的任务实体与后台任务生命周期被提升为正式能力；
3. 两边都无法无损对齐的部分保留在扩展层；
4. 所有旧工具都通过 adapter 接入，而不是继续作为核心定义。

### 融合优先原则（本轮调整）

根据最新决策，**后续实施不再以旧版本兼容为目标**。这意味着：

1. OpenCode 与 Claude Code 旧 surface 仅作为**语义来源与反例来源**，不再作为必须保留的外部合同；
2. 新系统应直接定义 **fusion-native** 的任务、运行时、交互与计划接口，而不是先做兼容层再慢慢收敛；
3. 只有在能直接降低迁移成本且不污染核心模型时，才允许保留极薄的 import / migration adapter；
4. 旧工具名、旧状态词、旧 API 形状、旧输出文件布局，都不再是实施阶段的优先约束。

因此，下文中凡属“兼容映射”内容，都应理解为**分析用参考映射**，不是下一阶段实现必须保留的产品行为。

### 一、统一后的主域对象

#### 1. Task Entity（核心）

任务实体是系统的第一主语义，至少包含：

- `id`
- `kind`
- `subject`
- `description`
- `status`
- `ownership`（`principalKind / principalId / scope`）
- `createdBy`
- `assignedBy`
- `executor`
- `parentTaskId`
- `blockedBy`
- `blocks`
- `revision`
- `idempotencyKey`
- `causationId`
- `metadata`
- `createdAt`
- `updatedAt`

#### 2. TaskRun（核心）

表示任务的一次执行，不等于任务本身：

- `runId`
- `taskId?`
- `mode`（sync / async / background / remote / worktree）
- `presentationMode`（foreground / background）
- `executorType`（subagent / shell / remote / teammate）
- `sessionRef`
- `status`
- `deliveryState`（pending_delivery / delivered / suppressed）
- `outputRef`
- `outputOffset`
- `revision`
- `idempotencyKey`
- `causationId`
- `startedAt`
- `finishedAt`

#### Task Entity 与 TaskRun 的关系（核心不变量）

- `Task Entity` 表示工作项 / 计划项 / 协作项，不直接等同后台执行记录。
- `TaskRun` 表示一次具体执行；一个 `Task Entity` 可以对应 `0..N` 个 `TaskRun`。
- `TaskRun` 允许独立存在并延迟绑定 `Task Entity`；这类运行必须标记为 `ephemeral` 或 `synthetic`，并具备可追溯的来源。
- Claude Code 的 `TaskCreate/Get/List/Update` 更接近 `Task Entity`；`TaskOutput/TaskStop` 操作的是 `TaskRun`。
- OpenCode 的 `task` / 子代理执行默认先落到 child session，再由兼容层映射为 `TaskRun`；`task_id` 在兼容期应视为 `sessionRef` 的主键，而不是新的 `Task Entity.id`。
- 允许存在“未先建正式待办就启动执行”的临时运行，但必须具备可追溯的 synthetic / ephemeral task 标识，禁止产生无归属的 `TaskRun`。
- 创建 / 续跑 / 停止 / 重放都必须遵守幂等约束：同一 `idempotencyKey` 不得生成重复 run，不得重复发出 started / terminated 事件。

#### 3. Interaction（核心）

统一用户交互阻塞点：

- `interactionId`
- `taskId?`
- `runId`
- `type`（question / permission / approval / rejection / clarification）
- `toolCallRef`
- `channel`（local / mailbox / leader-relay / api）
- `payload`
- `feedback`
- `approvalId`
- `approver`
- `decision`
- `planVersion`
- `planHash`
- `causationId`
- `status`
- `answeredAt`

#### 4. PlanTransition（核心）

规划状态切换必须脱离 prompt 隐式约束：

- `enterPlanning`
- `requestPlanApproval`
- `approvePlan`
- `rejectPlan`
- `exitPlanning`

并且必须绑定以下上下文，而不能只记录“进入/退出计划态”动作：

- `planRef`（计划文件 / 计划产物锚点）
- `prePlanMode`（退出计划态后要恢复的模式快照）
- `permissionSnapshot`（计划前权限模式）
- `approvalChannel`（本地问题 / 邮箱 / leader relay）
- `allowedPrompts`（计划审批阶段允许的高层语义范围）
- `approvalId`
- `planVersion`
- `planHash`

#### 5. SessionChecklist（扩展）

保留会话待办，但明确它不是任务实体生命周期：

- `sessionId`
- `items[]`

#### 6. SessionContext（边界对象，非主域中心）

新的系统不应退回“以 Session 为主域对象”，但也不能抹掉 Session 作为执行边界的事实。需要保留一个显式边界对象承载：

- `sessionId`
- `parentSessionId`
- `rootSessionId`
- `status`（idle / busy / retry / paused）
- `currentRunId`
- `planRef`
- `clientSurface`
- `revision`

这样才能无损接住 OpenCode 的 child session / continue / abort / SSE status 语义，以及 Claude Code 的主会话后台化语义。

#### 7. EventEnvelope（核心运行合同）

所有可重放事件都必须通过统一事件信封表达，至少包含：

- `eventId`
- `aggregateType`
- `aggregateId`
- `seq`
- `version`
- `causationId`
- `timestamp`
- `payload`

统一体系不必复制某一侧的事件存储实现，但必须冻结最小 replay contract，否则恢复、去重、审计与跨端同步都会漂移。

### 二、通用核心能力（必须保留）

#### A. 任务实体生命周期

- `createTask`
- `getTask`
- `listTasks`
- `updateTask`

并且要带以下合同：

- `expectedRevision`
- `conflictPolicy`
- `idempotencyKey`

保留 Claude 的任务实体思想，但不把 Claude 文件存储当成核心要求。

#### B. 委派执行原语

- `startTaskRun`
- `resumeTaskRun`
- `cancelTaskRun`

并且要带以下合同：

- `idempotencyKey`
- `expectedRunRevision`
- `bindTaskPolicy`（bind-immediately / bind-later / ephemeral-only）

保留 OpenCode `task` 的 create/resume child session 语义，也保留 Claude `Agent` 的执行原语地位，但两者都降级为对 `TaskRun` 的入口。

#### C. 用户交互闭环

- `ask`
- `reply`
- `reject`
- `listPendingInteractions`

保留 OpenCode 的 ask/reply/reject/list 闭环，吸收 Claude richer question schema 的方向，但不要求 OpenCode 原样具备 preview/annotations 才算核心成立。

#### D. 显式规划边界

- `enterPlanning`
- `requestPlanApproval`
- `exitPlanning`

保留 Claude 的显式 plan mode 能力定义，同时允许 OpenCode 通过 plan agent + plan_exit 映射接入。

#### E. 后台运行最小控制面

- `readRunOutput`
- `stopRun`
- `observeRunStatus`

保留 Claude 对后台执行的显式能力边界，但只进入“最小控制面”，不把其 runtime 细节直接绑死到核心。

#### F. Session 驱动调度与队列

- `enqueueRunPart`
- `drainQueuedParts`
- `resumeFromSyntheticMessage`
- `lockSessionRun`
- `releaseSessionRun`

OpenCode 的 `SubtaskPart / CompactionPart / synthetic user message` 续跑语义不能被简单抹平成“一次工具调用”，必须由核心运行编排显式表达。

#### G. 运行交付与外部观察面

- `markRunDelivered`
- `appendRunOutputDelta`
- `advanceOutputCursor`
- `emitRunLifecycleEvent`

最小控制面不仅是 read / stop / status，还必须定义 delivered / notified、终态 bookend、非终态告警以及可回收条件。

其中 `readRunOutput` / `observeRunStatus` 必须绑定**单调 cursor 契约**（offset 或事件序号）；禁止使用“无游标全量重读”作为统一合同。

#### H. 并发、中断与前后台切换

- `promoteRunToBackground`
- `resumeForegroundFromBackground`
- `interruptRun`
- `cascadeCancelSiblings`

需要显式定义 foreground/background 转换、同一轮多工具并发、中断级联与 shell / agent 特例，否则融合后会出现“能跑但 stop 与并发语义不一致”的假统一。

取消状态机必须至少支持：

- `running -> cancel_requested -> cancelled`
- `running -> cancel_requested -> failed`
- 重复 cancel 幂等
- stop 后终态事件只发一次

### 三、扩展层能力（必须保留，但不能进入核心）

#### 1. OpenCode 扩展

- `todowrite` 的 session-level checklist
- prompt 内嵌五阶段 planning workflow
- in-memory pending Question + bus 事件实现
- plan agent 作为策略实现
- `revert / unrevert` 的会话级回滚能力
- `subscribeAll + heartbeat` 的 SSE 事件总线
- 工具可见性受 client / flag 条件注册控制
- 子代理标题命名与 sibling 导航等 UI 兼容约束

#### 2. Claude 扩展

- 文件型 task 存储与 lock/high-water-mark 机制
- `diskOutput` 输出文件实现
- `framework.ts` 的 polling / eviction / notification 细节
- teammate / mailbox / remote / worktree 执行增强能力
- swarm / teammate 权限转发与 leader 审批 relay
- stall watchdog 这类非终态通知策略
- remote sidecar 恢复、archive 与稳定 idle 判定
- transcript symlink、安全输出打开、`/clear` 下的输出目录边界

### 四、参考映射层（仅用于语义分析，不作为实施目标）

本节只回答“旧体系里的语义来源于哪里、迁移时应该如何理解”，**不意味着新系统需要继续暴露这些接口名或保留这些交互形状**。

#### OpenCode 兼容映射

- `task` → `startTaskRun` / `resumeTaskRun`
- `task_id` → `sessionRef`
- `question` → `ask`
- `permission.ask` → `Interaction(permission)`
- `todowrite` → `SessionChecklist.write`
- `plan_exit` → `requestPlanApproval` / `exitPlanning`
- `SubtaskPart / CompactionPart` → queued run parts
- `session.status / abort / event stream` → `SessionContext` + run lifecycle events

#### Claude 兼容映射

- `Agent` → `startTaskRun`
- `TaskCreate/Get/List/Update` → Task Entity lifecycle
- `TaskOutput/TaskStop` → run control surface + delivery lifecycle
- `AskUserQuestion` → `ask`
- `EnterPlanMode/ExitPlanMode` → PlanTransition
- `notified / outputOffset / eviction` → delivery + cursor + GC contract
- `swarm permission relay` → approval channel extension

实施阶段的默认策略是：

- **先定义 fusion-native API / tool / event / state**；
- 再按需编写一次性 migration importer 或窄适配器；
- 不为旧版本保留长期双轨运行面。

### 五、必须舍弃的旧中心定义

以下概念必须明确舍弃为“新系统核心定义”：

1. `task` 作为域中心
2. `todowrite` 作为任务生命周期更新
3. prompt workflow 作为系统真相
4. Claude 文件存储实现作为核心标准
5. “同名即同义”的概念合并方式

### 六、推荐的演进顺序

#### 阶段 1：冻结统一语义模型

- 定义 Task / TaskRun / Interaction / PlanTransition / SessionChecklist / SessionContext
- 定义 Task、TaskRun、SessionContext 三者的主键与关联关系（`taskId / runId / sessionId`）
- 明确 `Task Entity -> TaskRun` 的 `1:N` 关系与 synthetic task 规则
- 为旧体系建立“语义来源表”，仅用于校验 coverage，不作为接口兼容目标
- 标记哪些旧语义进入 fusion-native 核心，哪些直接舍弃

#### 阶段 2：直接定义 fusion-native 接口与状态机

- 先做 Task Entity lifecycle 契约
- 再做 TaskRun lifecycle 契约
- 再做 Interaction / PlanTransition 契约
- 同步补齐 Permission / Question 双阻塞源、toolCallRef、approvalChannel
- 直接冻结 fusion-native 的 API / tool / event / storage contract

#### 阶段 3：按 fusion-native 合同落运行时

- 将 Claude 的后台任务控制面抽象成通用 runtime contract
- Plan 统一成显式状态机，直接按新合同实现，不再优先保留旧 plan surface
- 同步纳入 `deliveryState / outputOffset / bookend event / stop side effects`
- 把 OpenCode 的 `SubtaskPart / CompactionPart / synthetic resume` 归入统一运行编排

#### 阶段 4：旧数据导入与迁移辅助（如需要）

- 仅在确实需要消费旧数据或旧运行记录时，编写 importer / translator
- 不承诺长期保留旧 tool surface / 旧 API / 旧状态词
- migration 目标是“导入到新模型”，不是“让旧模型长期继续可跑”

#### 阶段 5：高级能力后置

- teammate / remote / worktree
- richer question preview / annotations
- file-backed task storage optimization
- advanced polling / eviction / notification 策略

### 七、本轮复核后必须补入的约束

#### 1. 任务域与执行域要明确分层

- Claude Code 事实上存在“任务清单 / 协作项”与“后台执行 / 输出控制”两套任务语义。
- 本方案继续以 `Task Entity + TaskRun` 收敛，但必须在文档中明确：前者承载 owner / blockedBy / blocks / lifecycle，后者承载 run status / output / delivery / foreground-background / stop。
- 不能再用单一 `status` 或单一 `Task` 名词同时覆盖这两层。

#### 2. Session 仍然是执行边界，不是应被抹掉的历史实现

- OpenCode 的 child session、`task_id` 续跑、CLI `continue/fork/session/attach`、`session.status / abort / event stream` 都依赖 session 作为执行边界。
- Claude Code 的 main session 背景化同样说明“会话”不是纯 UI 概念。
- 因此新的统一体系应当是“Task 为主域、Session 为边界、Run 为执行体”，而不是只剩 Task/Run 两层。

#### 3. Interaction 不能只覆盖 Question

- OpenCode 明确存在 `Permission` pending / approve / reject / corrected feedback；拒绝后是否继续 loop 还受 `continue_loop_on_deny` 等策略影响。
- Claude Code 则把 plan approval、leader relay、mailbox 审批、结构化澄清问题都放在同一交互面上。
- 所以 Interaction 必须统一承载 `question + permission + approval + clarification`，并保留 tool call 绑定与反馈字段。

#### 4. 运行控制不只是 read / stop / status

- Claude Code 的 `notified / outputOffset / eviction / bookend SDK events / 非终态告警` 表明“输出读取”与“任务已交付/可回收”存在显式生命周期副作用。
- OpenCode 的 busy/idle/retry、abort、串行 runner 表明“会话级运行锁”同样是硬边界。
- 因此运行控制必须显式补齐 delivery、cursor、GC、busy lock、foreground/background 切换与中断级联规则。

#### 5. 计划态必须带资源锚点与权限快照

- OpenCode 的 plan 不是抽象 mode，而是带 `plan file path + 严格只读提醒 + 批准后切 build agent` 的组合能力。
- Claude Code 的 plan mode 还带 `prePlanMode + permission snapshot + allowedPrompts + leader approval channel`。
- 所以 PlanTransition 必须绑定计划文件/产物位置与权限恢复信息，否则实现阶段一定回退成 prompt 约定。

#### 6. 可观测性、回放与删除/恢复一致性要前置写进方案

- 至少要保证：`TaskRun`、`Interaction`、`SessionContext`、输出游标、外部终态事件、toolCallRef 能串起来回放一轮执行。
- 删除 / 回滚 / 恢复时必须联动 pending interactions、child sessions、run events 与输出游标，不能只删任务表或只删消息表。
- capability/visible-tools 与 runtime sandbox 也必须双层 gating，避免“UI 已禁用、运行时还能调用”的后门。

#### 7. 幂等、修订版本与冲突策略不能后补

- 统一合同必须从第一轮就冻结 `idempotencyKey / revision / causationId / expectedRevision / conflictPolicy`。
- 否则 Task CRUD、TaskRun start/stop/replay、claim/update、plan approval 都会各自发明冲突处理策略。

#### 8. 审批对象必须可验证，不能只记录“有人批准了”

- Approval 必须至少绑定 `approvalId / approver / decision / planVersion 或 planHash / channel`。
- 否则旧审批、重复审批或跨计划审批会被误用到新的执行上下文。

### 八、最小不可缺合同

以下合同必须在进入任何 adapter / runtime 编码前冻结，否则后续实现一定发生语义分叉：

#### A. TaskEntity 最小合同

- `id`
- `kind`
- `status`
- `ownership`
- `revision`
- `idempotencyKey`
- `causationId`

#### B. TaskRun 最小合同

- `runId`
- `taskId?`
- `sessionRef`
- `status`
- `deliveryState`
- `outputOffset`
- `revision`
- `idempotencyKey`
- `causationId`

#### C. Interaction 最小合同

- `interactionId`
- `runId`
- `type`
- `toolCallRef`
- `channel`
- `approvalId?`
- `decision?`
- `feedback?`
- `planVersion?`
- `planHash?`

#### D. PlanTransition 最小合同

- `planRef`
- `prePlanMode`
- `permissionSnapshot`
- `approvalChannel`
- `approvalId`
- `planVersion 或 planHash`

#### E. Event / Replay 最小合同

- `eventId`
- `aggregateType`
- `aggregateId`
- `seq`
- `version`
- `causationId`

#### F. 最小状态机不变量

- `Task Entity` 与 `TaskRun` 禁止 1:1 强绑定
- 重复 `start / cancel / approve / replay` 必须幂等
- 输出读取必须使用单调 cursor
- `started / terminated` bookend 只允许各出现一次
- 同一审批不得跨 `planVersion / planHash` 复用

### 九、语义覆盖与迁移收口清单

#### A. OpenCode 语义覆盖

- 新系统必须覆盖 child session / continue / abort / status 这些执行边界语义
- 新系统必须覆盖 `SubtaskPart / CompactionPart / synthetic resume` 代表的队列化运行语义
- 新系统必须覆盖 `Question + Permission` 双阻塞源及其 feedback / reject side effects
- 新系统必须覆盖 plan 文件锚点、只读约束、审批后进入执行态这组 planning 语义

#### B. Claude Code 语义覆盖

- 新系统必须覆盖 `Task Entity` 与 `TaskRun` 分层、cursor / delivered / terminal GC 这些运行语义
- 新系统必须覆盖 foreground ↔ background 切换、stop 的 bookend event 与非终态告警语义
- 新系统必须覆盖结构化澄清问题、approval channel、prePlanMode / permission snapshot 这些交互与计划语义
- remote / teammate / swarm 的审批 relay 与 sidecar / restore / archive 语义可按阶段后置，但不得污染核心合同

#### C. 通用治理验收

- `taskId / runId / sessionId` 的 ownership / scope 校验完整
- 删除、回滚、恢复、替换注册都不会产生重复 started / terminated 事件
- run events、output cursor、interaction tool binding 能支持最小回放与排障
- capability gating 与 sandbox gating 双层一致，避免 profile/client 条件下的假可用

#### D. 迁移收口验收（仅在需要导入旧数据时启用）

- 旧 status 到新 status 有显式导入映射表
- replay / transcript / event 的导入判据明确（哪些能直接吸收，哪些需要转换）
- importer 失败回滚策略明确（task/run/interaction/event 各自如何回退）
- 至少覆盖 10 个迁移场景：create / resume / retry / cancel / approve / replay / replace-register / foreground→background / 跨端恢复 / 重复提交

### 十、风险与防腐原则

#### 风险 1：把动作当实体

如果继续让 OpenCode `task` 代表任务本身，会导致 task lifecycle 与 run lifecycle 混淆。

#### 风险 2：把 checklist 当任务域

如果让 `todowrite` 升级成任务对象更新，会把 session todo 与 task entity 腐蚀成同一概念。

#### 风险 3：把具体 runtime 写死进核心

如果直接把 Claude 的 `diskOutput`、polling、eviction 等机制写成核心契约，会让 OpenCode 侧被迫伪造一个它当前没有的 runtime。

#### 风险 4：把 planning 继续藏在 prompt 里

如果不把 planning transition 提升成正式能力，未来不同 agent / UI / API 客户端会继续出现行为漂移。

#### 风险 5：忽略 Session 作为执行边界

如果只保留 `Task Entity + TaskRun` 两层，而不保留 Session 作为 continue / abort / child-session / CLI attach 的边界对象，会让 OpenCode 路线无法无损迁移。

#### 风险 6：忽略 delivered / notified / output cursor

如果把输出读取、终态通知与任务回收都当成纯实现细节，融合后会出现重复通知、无法 GC、stop 后外部观察面不闭环等问题。

#### 风险 7：只建模 Question，不建模 Permission / approval relay

如果 Interaction 只覆盖问答而忽略权限、计划审批、leader relay，就会在 swarm / plan mode / 写操作授权场景中出现执行挂死或越权。

#### 风险 8：没有迁移验收矩阵

如果缺少 OpenCode CLI/SSE/child-session 与 Claude output/stop/plan/relay 的语义覆盖清单，方案会停留在抽象正确但实现期频繁返工的状态。

#### 风险 9：缺少 idempotency / revision / causation 基础字段

如果这些字段在第一轮没有冻结，后续每个 adapter 都会长出自己的一套去重与冲突处理，最终无法统一 replay 与恢复语义。

#### 风险 10：审批对象无法绑定到具体计划版本

如果 approval 只有“已批准”而没有 `approvalId + planVersion/hash + approver`，后续一定会出现旧审批套用到新计划的错误。

#### 风险 11：为了兼容旧版本而把旧 surface 带进核心

如果为了“看起来兼容”继续把旧 tool name、旧状态词、旧 API 形状、旧输出布局留在新核心里，最终会把融合方案重新拖回双轨系统。

#### 防腐原则

采用：**语义先对齐，接口后适配，运行时再增强**。

这意味着：

- 先统一域对象
- 再统一动作接口
- 最后才统一运行时体验

并且必须补充三条底线：

- `taskId / runId / sessionId` 分层建模，禁止主键混用
- `Question / Permission / Approval` 统一为 Interaction，但保留各自 side effects
- `delivery / cursor / bookend / replay` 在第一轮就冻结最小契约，禁止拖到“后面再补”
- 旧系统只作为语义来源，不作为长期兼容目标

绝不允许反过来用 UI、工具名或存储格式决定核心模型。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: yes（OpenCode 本体 / Claude 本体 / 架构融合收敛）→ +2
- Modules/systems/services: 3+（OpenCode task/session/question、Claude task/runtime/plan、.agentdocs 方案沉淀）→ +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 该任务是架构级方案设计，涉及两个独立源码体系与一套新的统一域模型，必须把分析、取舍与演进顺序持久化给后续实施者审阅，因此应走完整编排文档模式。

## Implementation Plan

### Phase 1: 语义冻结
- [x] T-01 ✅：校正比较范围，仅保留 OpenCode 与 Claude Code 本体
- [x] T-02 ✅：提取两侧任务体系的核心语义与结构差异
- [x] T-03 ✅：验证真等价与伪等价边界

### Phase 2: 融合建模
- [x] T-04 ✅：定义 Task Entity / TaskRun / Interaction / PlanTransition / SessionChecklist
- [x] T-05 ✅：划分核心层 / 扩展层 / 兼容层
- [x] T-06 ✅：明确保留项、扩展项与必须舍弃的旧中心定义

### Phase 3: 演进方案
- [x] T-07 ✅：给出阶段化演进顺序
- [x] T-08 ✅：给出风险清单与防腐原则
- [x] T-09 ✅：补充运行时不变量、兼容验收与迁移约束
- [x] T-10 ✅：按“融合优先、兼容后置/可选”重写实施顺序与验收口径
- [x] T-11 ✅：将 fusion-native 实施方案拆为具体实现任务 DAG

## Fusion-native 实施 DAG

### 实施入口与范围

本轮 DAG 直接面向当前仓库真实落点展开，优先顺序如下：

1. `packages/shared/src/index.ts` —— 冻结跨层共享合同
2. `packages/agent-core/src/task-system/*` —— 重建 fusion-native 任务域与调度核心
3. `services/agent-gateway/src/task-*.ts` / `background-task-tools.ts` / `question-tools.ts` / `plan-mode-tools.ts` —— 接入网关工具面
4. `services/agent-gateway/src/session-*.ts` / `routes/stream*.ts` / `session-run-events.ts` —— 接入运行时、事件与回放
5. `services/agent-gateway/src/routes/*` / `tool-definitions.ts` / `routes/capabilities.ts` —— 暴露 fusion-native surface
6. importer / translator 仅在需要导入旧数据时进入最后阶段

### 依赖 DAG（展开版）

```text
D-01 共享合同冻结
  ├─ D-02 agent-core 任务域重构
  ├─ D-03 gateway schema/tool contract 冻结
  └─ D-04 事件与 cursor 合同冻结

D-02 + D-03 + D-04
  ├─ D-05 TaskRun runtime state / background control
  ├─ D-06 Interaction / Permission / Approval 统一化
  └─ D-07 PlanTransition / planRef / approval flow 统一化

D-05 + D-06 + D-07
  ├─ D-08 Task Entity / TaskRun 投影与 start-work 接线
  ├─ D-09 stream / replay / bookend / output cursor 接线
  └─ D-10 fusion-native tools / capabilities / visibility surface

D-08 + D-09 + D-10
  ├─ D-11 ATDD / verification / replay matrix
  └─ D-12 importer / translator（可选，只有需要旧数据迁移时才执行）
```

### DAG 任务清单

| ID | 阶段 | 目标文件/目录 | 核心交付物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| D-01 | 合同冻结 | `packages/shared/src/index.ts` | `TaskEntity / TaskRun / Interaction / PlanTransition / SessionContext / EventEnvelope` 的 fusion-native 类型与基础 ID/Revision/Cursor 合同 | 无 | shared 导出稳定、字段与文档一致、无旧 surface 术语泄漏 |
| D-02 | agent-core 域重构 | `packages/agent-core/src/task-system/types.ts`, `store.ts`, `scheduler.ts`, `index.ts` | 从当前 `AgentTaskGraph` 演进到可表达 `Task 0..N Run`、`ownership`、`revision`、`idempotencyKey` 的核心任务域 | D-01 | task-system 类型与存储可表达新模型，不再把 `sessionId` 当唯一主轴 |
| D-03 | gateway contract 冻结 | `services/agent-gateway/src/task-crud-tools.ts`, `background-task-tools.ts`, `tool-result-contract.ts`, `types/` | fusion-native 的 task/run/input-output schema，与旧 `task_*` 兼容逻辑脱钩 | D-01 | gateway 合同以新字段和新状态词为准，不再反向受旧 surface 约束 |
| D-04 | 事件/游标合同 | `services/agent-gateway/src/session-run-events.ts`, `session-message-store.ts`, `request-workflow-log-store.ts` | `EventEnvelope`、单调 cursor、bookend 事件与 replay 边界 | D-01 | 事件可重放、cursor 单调、started/terminated 不重复 |
| D-05 | 运行时控制面 | `services/agent-gateway/src/session-runtime-state.ts`, `session-runtime-thread-store.ts`, `session-runtime-reconciler.ts`, `background-task-tools.ts` | TaskRun runtime registry、busy lock、foreground/background、cancel state machine | D-02, D-03, D-04 | stop/read/status/background 语义按新合同稳定运行 |
| D-06 | 交互统一化 | `services/agent-gateway/src/question-tools.ts`, `routes/questions.ts`, `routes/permissions.ts`, `session-question-events.ts`, `session-permission-events.ts` | `Question / Permission / Approval` 统一收口到 Interaction 模型 | D-02, D-03 | pending/reply/reject/feedback/approval channel 行为统一 |
| D-07 | 计划态统一化 | `services/agent-gateway/src/plan-mode-tools.ts`, `routes/stream-system-prompts.ts`, `session-workspace-metadata.ts` | 带 `planRef / prePlanMode / permissionSnapshot / approvalId` 的 fusion-native PlanTransition | D-02, D-03, D-06 | planning 不再依赖旧 surface，审批与恢复链闭环 |
| D-08 | Task 投影与编排接线 | `services/agent-gateway/src/task-tools.ts`, `task-parent-auto-resume.ts`, `routes/session-task-projection.ts`, `routes/start-work-subtasks.ts`, `task-result-extraction.ts` | 用 fusion-native Task/Run/Interaction 模型重建任务投影与父子编排 | D-05, D-06, D-07 | start-work、父子任务、run 结果抽取都基于新模型 |
| D-09 | stream/replay 接线 | `services/agent-gateway/src/routes/stream.ts`, `stream-runtime.ts`, `stream-protocol.ts`, `stream-model-round.ts` | stream 只消费新事件与新状态机，不再夹带旧兼容判定 | D-05, D-06, D-07 | 流式事件、恢复链、bookend、output cursor 全部按新合同工作 |
| D-10 | 对外 surface 收口 | `services/agent-gateway/src/tool-definitions.ts`, `routes/tools.ts`, `routes/capabilities.ts`, `session-tool-visibility.ts` | 对模型可见的 fusion-native tool/capability surface | D-08, D-09 | “展示可用 = 运行可用”，不再以旧名字映射为主线 |
| D-11 | 验证矩阵 | `services/agent-gateway/src/verification/`, `src/__tests__/`, 必要时 `packages/agent-core/src/__tests__/` | 覆盖 create/resume/retry/cancel/approve/replay/foreground→background/跨端恢复/重复提交 的验收矩阵 | D-08, D-09, D-10 | ATDD + verification 脚本可证明新合同闭环 |
| D-12 | 旧数据导入（可选） | 新增 importer/translator 模块（按需要选址在 `services/agent-gateway/src/`） | 只负责把旧任务图 / 旧 run 记录 / 旧 transcript 导入新模型 | D-11 | importer 失败可回滚；未开启时不影响 fusion-native 主链 |

### 推荐实施波次

#### Wave 1：合同与事件先行（必须一次完成）

- D-01
- D-02
- D-03
- D-04

目标：冻结类型、状态机、事件和 cursor，禁止后续边写边改合同。

#### Wave 2：运行时与交互闭环（核心闭环）

- D-05
- D-06
- D-07

目标：让 TaskRun、Interaction、PlanTransition 成为真正可运行的 fusion-native 主链。

#### Wave 3：任务投影与流式主链（产品可用）

- D-08
- D-09
- D-10

目标：让 gateway 主链、任务投影、工具面、capabilities 与 stream 全部切到新模型。

#### Wave 4：验证与迁移收尾

- D-11
- D-12（仅在需要导入旧数据时执行）

目标：先拿到可证明的新系统，再决定是否做旧数据导入，而不是反过来。

### 第一执行入口（下一步直接开工点）

如果下一轮直接进入实施，顺序固定为：

1. 先修改 `packages/shared/src/index.ts`
2. 再修改 `packages/agent-core/src/task-system/types.ts`
3. 然后收口 `services/agent-gateway/src/task-crud-tools.ts` 与 `background-task-tools.ts`
4. 最后进入 `session-run-events.ts` / `session-runtime-state.ts` / `routes/stream-runtime.ts`

这样做的原因是：**先冻结合同，再改运行，再改投影与流**，可以把返工成本降到最低。

## Notes

- Memory sync: completed
- 该方案故意不把任何一侧的存储形态写入核心模型，避免过早锁死实现。
- 若后续进入实施，应先出“统一类型定义草案”，再进入 gateway/runtime/UI 接线。
- 本轮复核后，方案已显式补入：Session 作为执行边界、Task 与 TaskRun 的 `1:N` 关系、Permission/Question 双阻塞源、delivery/cursor/bookend、以及 OpenCode/Claude Code 两侧的兼容验收清单。
- 最新决策已明确：后续实现采用 **fusion-native first**，不再以旧版本接口兼容为目标；旧体系只保留为语义来源与迁移输入。
- `T-11` 已展开为可执行 DAG；下一步不再需要继续抽象讨论，应直接进入 `D-01` 合同冻结实施。
