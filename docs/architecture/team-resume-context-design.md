# Team Resume Context 设计

## 背景

团队会话支持暂停 / 恢复后，执行流可以通过 `resume_signal` 继续，但模型本身不会稳定记住暂停前尚未自动完成的任务。长时间暂停、进程重启、运行协程超时退出后，仅依赖聊天历史会导致重复派发、漏做任务或向上级用户暴露内部调度细节。

## 分层职责

### Gateway / Team Runtime

负责确定事实，不依赖模型推断：

- 从 `sessions` 读取会话树、`paused`、`state_status`、`role_layer`、`substate`。
- 从 `handoff_records` 读取未完成、暂停、失败、待处理的 handoff。
- 从任务图投影读取未完成任务。
- 从 `artifacts` 读取已生成的 `spec / plan / tasks` 等产物。
- 生成内部 `TeamResumeContext` 和 system-level 恢复提示。

这一层是恢复事实源，不把内部恢复包写成普通用户消息。

### Scheduler / Stream Runtime

负责恢复执行：

- 原执行流仍活着时，`resume_signal` 让它在下个 round 边界继续。
- 原执行流已经不存在时，`resume-all` 触发后台续跑兜底。
- 续跑请求使用 `team-resume:` clientRequestId 前缀做可观测命名，但是否注入恢复上下文只看服务端内部登记，不信任客户端传入的前缀。

### PM2 管控层

负责基于恢复事实重新调度：

- 判断继续、重试、改派或回退 PM1。
- 避免重复派发已完成任务。
- 对失败任务做管控决策，而不是自己从历史消息里猜事实。

### 上级用户 / Reception 可见面

只展示摘要，不展示内部恢复包：

- 可见：“团队会话已恢复，系统将继续 3 个未完成任务。”
- 不可见：handoff id、checkpoint JSON、内部工具恢复指令、executor/reviewer 详细过程。

## MVP 实现

本阶段不新增表，优先复用既有事实源：

- 新增 `services/agent-gateway/src/team/team-resume-context.ts`。
- `POST /team/sessions/:sessionId/resume-all` 恢复后，如没有活跃流，触发一次后台恢复续跑。
- `stream.ts` 和 `stream-runtime.ts` 仅在服务端登记过的内部恢复请求中注入 system-level 恢复上下文；普通客户端即使伪造 `team-resume:` 前缀也不会触发内部恢复包。
- 恢复上下文只进入动态 system tail，不作为 user message 持久化。

## 后续演进

如果需要更强的精确恢复，可新增持久化 checkpoint 表：

```sql
team_task_checkpoints(
  id,
  user_id,
  team_workspace_id,
  root_session_id,
  session_id,
  handoff_id,
  task_id,
  role_layer,
  status,
  title,
  checkpoint_json,
  artifact_refs_json,
  created_at,
  updated_at
)
```

届时 `TeamResumeContext` 可从 checkpoint 表读取主事实，当前多源拼装逻辑退化为兼容旧数据的 fallback。
