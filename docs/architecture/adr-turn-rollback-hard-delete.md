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

## 一致性要求

任何后续修改「取消 / 回退 / 审计保留」语义的改动，必须先更新本 ADR，再更新上述三篇规范，避免规范与实现再次背离。
