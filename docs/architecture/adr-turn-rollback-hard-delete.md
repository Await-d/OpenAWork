# ADR：团队回合回退（Turn Rollback）按回合硬删团队记录

- **状态**：已接受（经产品负责人书面确认的例外）
- **日期**：2026-09-18
- **相关计划**：`.omo/plans/team-turn-rollback.md`
- **相关实现**：`services/agent-gateway/src/session/session-turn-rollback.ts`、`session/session-turn-rollback-task-graph.ts`、`team/team-audit-store.ts`

## 背景

team 对话中，用户回退上一条消息（消息 hover 的「重试 / 编辑重试」）时，异常与状态信息未被清除。根因是系统只实现了「删消息」，**没有「回退一个回合」的语义**；而所有团队可观测面（过程时间线、错误诊断简报、团队动态、内联失败诊断卡与权限卡）从多张表与多个全局 store 派生，二者之间没有任何失效机制。

更根本的阻断：团队侧的表**全部没有回合维度**（`handoff_records` / `team_usage_records` / `team_tool_call_records` / `team_audit_logs` / `team_converge_results` / `team_messages` 均无 `client_request_id`），因此「精确抹除某个回合的团队记录」在当时**无法表达**。

## 决策

1. 先为上述团队表补齐回合维度（`client_request_id`），并让全部写入链路把**发起回合**的键透传下去（子层 handoff / 子会话通过父 handoff 继承）。
2. 回退某条消息时，**按回合硬删**该回合的团队记录，**包括 `team_audit_logs` 与用量指标**。
3. 同时置终态：该回合的 `permission_requests` → `rejected`、`question_requests` → `dismissed`（**保留行**，不删除）。
4. 连带取消子树内所有 running 子会话 / handoff，并向同账号其它客户端广播失效事件。

## 为什么这是一个需要显式记录的例外

本仓库既有规范与实现明确宣称了一条相反的不变量：

- `docs/architecture/team-architecture-l1-3-streaming-handoff-spec.md`：「audit log：cancelled handoff 不删除」
- `docs/architecture/team-architecture-spec-kit-borrowing-discussion.md`：「**审计可见**：cancelled handoff 不删除，留作 audit log」
- `docs/architecture/team-backend-gap-audit-2026-05-24.md` §0.36：「`team_audit_logs` 是只增的治理审计汇聚点」
- `services/agent-gateway/src/team/team-audit-store.ts` 模块头注释曾写「只增表」（已同步为含例外表述）

「取消 handoff 不删审计」这条不变量**依然成立**（cancel 路径不删任何审计行）。本 ADR 记录的是**新增的第二个动词**：**回合回退**会按回合删除审计行。二者不冲突，但读者若不被告知，会据此判定实现违规。

**风险已知情**：删除不可逆；会破坏审计链的可追溯性；用量指标与实际消耗脱钩。产品负责人在被明确告知上述后果后仍选择该方案（先否决了「只作废+隐藏」，也否决了「session 级 / 时间窗近似」的退路，选择先补维度以换取精确性）。

## 安全网：权威作废痕迹

作为接受不可逆删除的前提，回退**必须**留下一条权威痕迹：

- 删除前把 receipt（`cutoffMessageId` / `cutoffTimeMs` / `tombstoneAtMs` / 被删消息数 / 失效的 `clientRequestId` 集合 / 受影响会话集合）以 info 级别落日志；
- 删除提交后写入一条 `action: 'turn_rollback'` 的审计行，其 **`client_request_id` 恒为 NULL**。按回合删除的谓词是 `client_request_id = ?`，SQL 中 `NULL = <bind>` 恒为 UNKNOWN，因此该行**语义上不可能被回退自身的删除命中**；被作废回合的标识改由 `summary` / `detail` 携带。

若这条痕迹缺失，不可逆删除即成为**无痕操作**——这正是评审阶段被判定为阻断的缺陷之一。

## 边界（明确不做的事）

- 不删除「不可归因的历史」：`client_request_id` 为 `NULL` 或 `''` 的行（迁移前的存量数据、以及本就没有回合上下文的写入，如工作区消息、手工 converge、斜杠命令创建的任务）**永不**被回合回退删除。
- 不删除其它会话 / 其它回合的数据；删除谓词同时受 `session_id`（且已按 `user_id` 限定）与 `client_request_id` 约束。
- 不动传输层状态（`useTeamEventsConnectionStore`）——清它等于 UI 谎报连接健康。
- 不清 `snapshotError` / `providersError`（会话级，非回合级）。
- **`services/agent-gateway-dotnet` 不在支持范围**：.NET 网关的回退语义不予镜像实现（产品负责人决定「.NET 版本不需要管理」）。使用 .NET 网关时团队回退不具备本 ADR 描述的语义。

## 后果

- 正面：回退语义与用户心智一致（「这一回合从未发生」），且服务端与前端有一致的失效口径；多端一致。
- 负面：审计与用量数据可被用户按回合删除，治理视图会出现缺口；任务图节点的清理因文件 API 为异步、SQLite 事务为同步，**无法与 DB 删除共享原子性**，失败时只能告警（残留可由 `turn_rollback` 审计行的 `detail` 人工修复）。
- 待跟踪：`team_usage_records` 补齐保留裁剪；子树的递归遍历需要上限（超限应显式失败而非部分删除）。

## 附：新增的「关闭失败派发」（dismiss）语义（2026-09-21）

本 ADR 正文的三条不变量（「取消 handoff 不删审计」「只增表有保留裁剪」「回退按回合硬删」）**均未被本次改动触碰**。登记于此的原因与上方那条例外相同：本文档是「取消 / 审计保留」语义的权威落点，新增动词若不登记，读者会据规范判定实现违规。

**新增动词**：`dismiss`（用户主动「关闭失败项」），把一条**不可自动恢复**的 `failed` handoff 收敛为 `cancelled`。

- 入口：`POST /team/handoffs/:handoffId/dismiss`（`services/agent-gateway/src/routes/team-handoffs.ts`）→ `dismissFailedHandoff`（`services/agent-gateway/src/handoff/store/handoff-store.ts`）。
- 判定：**唯一事实来源**是 `isDismissableFailedHandoff`（同文件）；运行时投影把同一判定以 `dismissableFailure` 下发给前端，避免前后端各存一份规则而静默漂移。规则：
  1. 仅 `state = 'failed'`；
  2. **仍可重试的失败不可关闭**——`isRecoverableFailedHandoff` 判定「原因层面可恢复」**且**失败重试预算 `failed_retry_count` 未达 `MAX_FAILED_HANDOFF_RETRY_COUNT`（3）时才拒绝关闭（它们归补救重试 `services/agent-gateway/src/team/team-runtime-remediation-policy.ts` 所有，用户提前关闭会抢走重试机会）；**预算耗尽后即视为「无自动恢复路径」，转为可关闭**；
  3. `executor` / `reviewer` 层级**仅在 PM2 已无法裁决时**（其父会话上不存在 `state = 'running'` 的 pm2 派发；判定口径与 `handoff/runner/watcher.ts` 的评审裁决门一致）才可关闭，否则一律拒绝；
  4. 其余层级（典型：pm1 的 `planning-generation-failed: …；需要用户介入`）只要不可恢复即可关闭。
- 状态转移：`failed → cancelled`，由带守卫的原子 UPDATE 完成（`WHERE id = ? AND user_id = ? AND state = 'failed'`），并以 `changes > 0` 判定是否真正命中——并发下（已被 `retryFailedHandoff` 翻回 `pending`、或重复关闭）返回 false，调用方不得据此发布 `handoff.cancelled` 事件。
- **审计保留不变量仍然成立**：dismiss **不删除任何行**。`failure_reason` 与 `completed_at` 原样保留，另写入一条 `logHandoffControl({ action: 'cancel', reason: 'user-dismissed-failure' })` 审计行并广播 `handoff.cancelled` 事件。因此「cancelled handoff 不删除，留作 audit log」依旧为真。
- **为什么需要它**：`capability/planning-failure.ts` 曾给**所有** `PlanningFailure` 强制追加 `；需要用户介入`，命中 `UNRECOVERABLE_FAILED_HANDOFF_REASON_SUBSTRINGS` 使 `retryFailedHandoff` 恒拒绝；`watcher.ts` 又把 `planning-generation-failed:` 前缀显式排除出 PM1→PM2 降级链，且 `cancelHandoff` 明确拒绝 `failed`。这条终态原本**没有任何用户出口**，失败诊断会永久挂在错误简报上。dismiss 补上该出口。

  后续（2026-09-21）已把该尾注改为**按处置分级**：`PlanningFailure(reason, 'recoverable')` 用于瞬时失败（模型输出形状畸形、未交付完整正文），不追加尾注因而可重试；默认为 `'requires-user'`，仍会产生 `requires-user` 终态（grill 轮次耗尽、自动规划返工上限、调查证据不足、规划校验失败等）——**dismiss 是这些终态的唯一用户出口**。

- **失败重试预算**：`handoff_records.failed_retry_count` + `MAX_FAILED_HANDOFF_RETRY_COUNT = 3`。它**刻意独立于 `retry_count`**（后者由 `nextPlanningRound` 与 PM1 自动规划返工上限消费，不能挪用）。存在意义：给「原因层面可恢复、但实际注定失败」的派发一个有界终点——否则 `retryFailedHandoff` 会无限把它重置为 `pending`，持续消耗额度且永不收敛（此前 `heartbeat-timeout-max-retry-exceeded` 因不递增 `retry_count` 而无限空转，现已归入不可恢复前缀）。预算耗尽 ⇒ 不可重试 ⇒ 可关闭，保证任何终态失败都仍有用户出口。
- 与「回合回退」的区别：回退是**按回合硬删**（正文记录的例外）；dismiss 是**单条终态收敛，永不删除**。二者不冲突。

## 一致性要求

任何后续修改「取消 / 回退 / 审计保留」语义的改动，必须先更新本 ADR，再更新上述三篇规范，避免规范与实现再次背离。

已登记的语义变更：

1. 回合回退按回合硬删审计行（2026-09-18，正文与其「为什么这是一个需要显式记录的例外」）。
2. 新增 `dismiss` 动词，把不可自动恢复的失败派发收敛为 `cancelled`，**不删除任何行**（2026-09-21，见上节「附」）。
