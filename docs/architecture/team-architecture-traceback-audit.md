# Team 架构追溯性验证报告（v1.0）

> 用途：基于 v1.1 复查后的疑点，逐项审计 L1 决策与现有代码的真实差距。本文档是**实施验证报告**，不是设计文档。
>
> 关联文档：
>
> - L1 基线（v1.1）：`team-architecture-l1-baseline.md`
> - L1.3 详细设计（v1.1）：`team-architecture-l1-3-streaming-handoff-spec.md`
> - Phase A 决策（v1.1）：`team-architecture-phase-a-decisions.md`
> - Phase B 实施记录：`.agentdocs/workflow/done/260515-team-phase-b-实施方案.md`
>
> 创建时间：2026-05-16
> 当前状态：**审计完成 ✅**

---

## TL;DR：8 项审计结果

| 决策                         | 审计结果                                          | 与 L1.1 假设的差距                                          |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| L1.1 五层架构                | ✅ **完整实施**                                   | 无差距                                                      |
| L1.2 d/b 拆分原则            | ✅ **意外符合**                                   | 实际比 L1 更简洁（dispatch 拆分用纯代码不用 LLM）           |
| L1.3 流式 handoff            | ❌ **未实施**（artifact-chain.ts 行 22 注释证实） | 需要 4 项增量改造                                           |
| L1.4 跨层禁止直连            | ⚠️ **部分实施**（feature flag 灰度）              | `team-leader dispatch` / `interaction-agent rewrite` 仍存在 |
| L1.5 项目记忆双存储          | ✅ **完整实施且优于设计**                         | 7 层注入栈 + cache breaker 实现完善                         |
| L1.6 延迟约束                | ❌ **未实施**                                     | 无 telemetry 监控                                           |
| L1.7 Handoff 存储位置        | ✅ **完整实施**                                   | claim_token 防双 claim 是教科书级实现                       |
| L1.8 Session 状态机          | ⚠️ **部分实施**                                   | 缺 `substate` / `structural_depth` / `execution_depth`      |
| L1.9 BackgroundTaskScheduler | ✅ **9 方法完整实施**                             | 接口比文档简化（去掉了 priority/scheduledAt 等扩展字段）    |

**核心结论**：

1. **不需要"重新设计"**：现有实施质量很高，绝大部分 L1 假设都已经满足或更优
2. **真正需要做的事**：L1.3 增量改造 + L1.6 telemetry + L1.8 三个缺失字段（约 15-20 天工作量）
3. **L1.4 不需要"完全废弃"**：现有 feature flag 策略实际比 v3.10 D24 更稳妥，建议正式承认这条路径

---

## 1. L1.1 五层架构 ✅

### 实施位置

- `services/agent-gateway/src/handoff/`
  - `pm1-runner.ts`：c 层（PM1）
  - `pm2-runner.ts`：d 层（PM2）
  - `watcher.ts`：跨层调度
  - `team-session-create.ts`：五层 session 创建
  - `role-adapter.ts`：角色适配器

### 验证结果

实际五层结构与 L1.1 完全一致：a (用户) → b (reception) → c (pm1) → d (pm2) → e/f/g (executor/reviewer)。

`role_layer` 字段取值（来自 `pm2-runner.ts` 行 159）：`'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer'`。

---

## 2. L1.2 d/b 拆分原则 ✅（意外符合）

### 实施位置

`services/agent-gateway/src/handoff/pm2-runner.ts`

### 验证结果

L1.2 担心 d 层是单 LLM 干所有事。实际 d 层（pm2-runner）的实现是：

| L1.2 假设                         | 实际实现                                                            | 评价                      |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| d.1 Constitution Check 用规则代码 | LLM 调用 + 严格 PASS/VIOLATION 输出格式约束                         | ⚠️ 是 LLM 但已结构化      |
| d.3 dispatch 拆分用 LLM           | **纯代码** `buildDispatchPackages`                                  | ✅ 比 L1.2 假设**更精简** |
| d.5 escalation 用规则代码         | `if (!checkResult.pass) { throw new Error(...) }` 触发 watcher 重试 | ✅ 完全是规则代码         |

**关键观察**：dispatch_package 拆分是基于 tasks.md 的 [P]/[US1] 标记的**纯文本解析**（`buildDispatchPackages` 函数），完全不需要 LLM。这比 L1.2 文档假设的更合理。

### 审计建议

- L1.2 文档的 d 层 5 子职责拆分**应修正为 4 项**：合并 d.3 dispatch 拆分到"规则代码"类别
- d.1 Constitution Check 仍需要 LLM（自然语言对齐判断）但已用结构化输出约束，不属于"自由 LLM 决策"

### b 层拆分情况

`services/agent-gateway/src/routes/team.ts` 中 `/team/interaction-agent/rewrite`：

- 实际实现：单一 LLM 调用做意图改写 + 推送到 c
- 与 L1.2 假设的 "b.router + b.companion + b.scheduler" 三组件**不一致**
- 但当前实现简单且有效，没有显示出"一个 LLM 干太多事"的问题

### 审计建议

L1.2 中 b 层拆分（router + companion + scheduler）是**前瞻性设计**，目前现状不需要拆，等真正出现"路由判断与陪聊冲突"时再做。

---

## 3. L1.3 流式 handoff ❌（未实施）

### 实施位置

`services/agent-gateway/src/handoff/artifact-chain.ts` 行 22 注释：

> "[NEEDS CLARIFICATION] 推送后不等待回复（Phase D 加阻塞门禁）"

### 验证结果

`runArtifactChain` 函数（行 207）的流程：

1. **Step 1**：生成 spec
2. **Step 2**：解析 [NEEDS CLARIFICATION] → 推送 WS 事件给前端 → **不阻塞**
3. **Step 3**：直接生成 plan（不等用户回答）
4. **Step 4**：Constitution Check 软警告 → 推送 → 不阻塞
5. **Step 5**：直接生成 tasks
6. **Step 6**：写 handoff result，完成

这正是 v1.0 提到的"原子 handoff"行为。但**注释里说"Phase D 加阻塞门禁"实际上 Phase D 也没加**——`pm2-runner.ts` 只做了 Constitution Check 硬门禁，**没有处理 clarifications 阻塞**。

### 验证 d 层 review 缺失

`pm2-runner.ts` 没有任何 e/f/g 完成后的 review 代码：

- T-09 (review_aggregator) 文件存在但 pm2-runner 没调用
- 没有等待 e/f/g 全部完成的逻辑
- 没有失败回 c 的 escalation_round 推进

### 审计结论

L1.3 增量改造**完全必要**。本设计稿 §0.A.2 列出的 4 项改造（13.5 天工作量）每一项都是真实缺口：

1. ✅ `session_inbound_messages` 表需要新增
2. ✅ `sessions.substate` 字段需要新增
3. ✅ c 层"等待 inbound"循环需要实现（artifact-chain.ts 改造）
4. ✅ handoff_records 4 个字段需要补全

---

## 4. L1.4 跨层禁止直连 ⚠️（部分实施）

### 实施位置

- `services/agent-gateway/src/handoff/feature-flags.ts`
- `services/agent-gateway/src/routes/team.ts` 行 1832（`/team/interaction-agent/rewrite`）
- `services/agent-gateway/src/routes/team.ts` 行 2089+（`team-leader` 任务派发）

### 验证结果

`isHandoffModeEnabled()` 通过 `OPENAWORK_TEAM_HANDOFF_MODE=1` 环境变量控制：

- **flag 启用**：handoff 协议激活，但 `interaction-agent rewrite` 和 `team-leader dispatch` **依然存在**
- **flag 关闭**（默认）：完全走老路径，handoff_records 表不会被写入

这意味着 v3.10 D24"完全废弃 team-leader dispatch"**没有实施**。实施者选择了更稳妥的灰度策略。

### 审计建议

**v3.12 L1.4 修订路径"默认禁止 + 3 个 escape hatch"实际上与现状吻合**：

- "默认禁止" = `OPENAWORK_TEAM_HANDOFF_MODE=1` 时优先走 handoff
- "feature flag 灰度" = 第 4 个未文档化的 escape hatch（用于迁移期）

**结论**：建议**正式接受 feature flag 作为合法的迁移期机制**，并在 L1.4 中明确：

1. Phase F 之前 feature flag 默认开启（灰度推进）
2. 所有新功能必须经 handoff，不能加到老路径
3. Phase F+ 时考虑彻底删除老路径

不需要"立即废弃 team-leader dispatch"。

---

## 5. L1.5 项目记忆双存储 ✅（优于设计）

### 实施位置

`services/agent-gateway/src/team-instruction-stack.ts`

### 验证结果

7 层注入栈实现**比文档更完善**：

```
1. AGENTS.md          (仓库根，去重处理避免与 stream.ts 双重注入)
2. architecture.md    (仓库根)
3. constitution_md    (DB: team_workspaces.constitution_md)
4. project-memory.md  (.agentdocs/project-memory.md，git 文件)
5. lessons-learned.md (.agentdocs/lessons-learned.md，git 文件)
6. user_memory_md     (DB: users.user_memory_md)
7. SOUL               (DB: agent_personas.soul_md)
+ cache-breaker tag   (ForceApply 触发 cache 失效)
```

**额外亮点**：

- 用 `<team-instruction layer="...">` 包装每层（便于 LLM 理解层级）
- 24K token 软上限警告（自动加 oversize-warning 段）
- ForceApply cache breaker 设计（与 D41 配合）

### 审计建议

L1.5 文档应**反向更新**，承认现有实现的优秀设计：

- AGENTS.md 去重策略（避免与 workspace context 双重注入）
- token 软上限 + 警告段
- cache-breaker tag 模式

---

## 6. L1.6 延迟约束 ❌（未实施）

### 实施位置

无（搜索 `services/agent-gateway/src/` 中无 latency / p95 / SLA 相关 telemetry）

### 验证结果

L1.6 提出的 4 个延迟硬约束（a→b 直答 < 3s / "已开始" < 2s / 后台推送 < 5s / 进度间隔 ≤ 60s）**目前没有任何监控**。

### 审计建议

这是真实缺口。建议作为独立任务实施：

1. 在 watcher 和 scheduler 添加 telemetry 钩子
2. 接入现有 telemetry 系统（如有）
3. 加入告警规则
4. 工作量预估：3-5 天

---

## 7. L1.7 Handoff 存储位置 ✅

### 实施位置

`services/agent-gateway/src/handoff/handoff-store.ts`

### 验证结果

`claimHandoff` 函数实现是**教科书级**：

```sql
-- 原子 UPDATE：state='pending' AND id=? 是单语句原子操作
UPDATE handoff_records
   SET state = 'claimed',
       claim_token = ?,
       claimed_at = datetime('now')
 WHERE id = ? AND state = 'pending'

-- 回读 + 双重检查：state == 'claimed' AND claim_token 匹配
```

防双 claim 的设计方式**比 L1 文档假设的更稳妥**——claim_token 是随机 UUID 而不是 timestamp，杜绝时间戳碰撞。

`reclaimAbandonedHandoffs` 通过 JOIN sessions.last_heartbeat 实现崩溃恢复，超过 maxRetry=3 直接 fail（不无限重试）。

### 审计建议

L1.7 文档应**承认 claim_token 字段**作为正式的防双 claim 机制（v1.0 文档没提到）。

---

## 8. L1.8 Session 状态机 ⚠️（部分实施）

### 实施位置

`services/agent-gateway/src/db.ts` 行 1036-1044

### 验证结果

| L1.8 字段                              | 实际状态                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| `team_parent_session_id`               | ✅ 存在（命名与 L1 文档假设的 `parent_session_id` 不同） |
| `role_layer`                           | ✅ 存在                                                  |
| `intent_state`                         | ✅ 存在                                                  |
| `handoff_state`                        | ✅ 存在                                                  |
| `last_heartbeat`                       | ✅ 存在（TEXT 类型）                                     |
| `substate` / `substate_updated_at`     | ❌ **缺失**                                              |
| `structural_depth` / `execution_depth` | ❌ **缺失**（D18 拍板但未落地）                          |
| `paused` / `paused_at` 等              | ❌ **sessions 表无**（仅 handoff_records 有 `paused`）   |

### 审计建议

L1.3 改造需要补全这些字段。补字段是 ALTER TABLE + ensureColumn 的简单操作（半天工作量）。

---

## 9. L1.9 BackgroundTaskScheduler ✅

### 实施位置

`services/agent-gateway/src/handoff/scheduler.ts`

### 验证结果

D40 锁定的 9 个方法**全部实现**：

- `schedule(input)` ✅
- `cancel(taskId)` ✅
- `pause(taskId)` ✅
- `resume(taskId)` ✅
- `pauseAll()` ✅
- `resumeAll()` ✅
- `listActive()` ✅
- `getStatus(taskId)` ✅
- `subscribe(listener)` ✅

### 关键差异（与 L1 文档假设）

| L1 文档假设的接口字段                   | 实际接口字段                                 | 差异     |
| --------------------------------------- | -------------------------------------------- | -------- |
| `priority` / `scheduledAt` / `deadline` | 不存在                                       | 接口简化 |
| `retryPolicy`                           | 不存在                                       | 简化     |
| `idempotencyKey`                        | 部分实现（`schedule` 检查 id 已存在则 noop） | 部分     |
| `parentTaskId` / `tags` / `metadata`    | 仅 `meta` 字段                               | 简化     |

实际接口更精简：

```ts
interface ScheduledTaskInput {
  id: string; // 唯一 id（兼具 idempotency_key 作用）
  meta?: Record<string, unknown>; // 透传元数据
  run: (signal: AbortSignal) => Promise<void>; // 实际任务体
}
```

### 审计建议

L1.9 文档应**反向更新**，承认实际接口的简化是合理决定：

- D40 拍板时讨论的扩展字段（priority/scheduledAt 等）属于 L3 实施细节，不应放在 L1 接口
- 现有简化版本即足够覆盖 9 个方法的全部用例
- 未来需要这些字段时可再扩展（接口稳定即可）

---

## 10. 综合建议：下一步动作

### 10.1 真正需要做的（按优先级）

**🔴 P0 - L1.3 流式 handoff 增量改造**

- 工作量：13.5 天
- 详细方案：见 `team-architecture-l1-3-streaming-handoff-spec.md` §0.A.2
- 触发条件：当用户报告"澄清不能等用户回答"问题增多时

**🟡 P1 - L1.8 补缺失字段**

- 工作量：0.5 天（ALTER TABLE）
- 字段：`substate` / `substate_updated_at` / `structural_depth` / `execution_depth`
- 与 L1.3 改造合并实施

**🟡 P2 - L1.6 延迟监控**

- 工作量：3-5 天
- 接入 telemetry + 加 4 个延迟指标
- 独立任务

### 10.2 文档需要反向更新的部分

**L1 基线文档（v1.1 → v1.2）**

- L1.2：把 d 层 5 子职责拆分修订为 4 项（合并 d.3 到规则代码）
- L1.4：正式接受 feature flag 作为合法迁移机制（不要求"完全废弃"）
- L1.5：补充 AGENTS.md 去重 / token 软上限 / cache-breaker 三条额外亮点
- L1.7：补充 claim_token 字段作为正式防双 claim 机制
- L1.9：简化接口字段（去掉 priority/scheduledAt 等假设）

**L1.3 详细设计文档（v1.1 → v1.2）**

- §0.A.1 字段命名对照表加 `claim_token`（实际有 / 文档无）
- §1.1 SQL Schema 完整反映现有 `handoff_records` 真实结构
- §1.3 SQL Schema 用 ensureColumn + 列出实际命名约定（to_session_id 等）

### 10.3 Phase A 决策文档

承认 Phase A 实际范围比 v1.0 推荐的更广（包含 SOUL），并更新为复盘归档。

### 10.4 决策结论

**不需要做的事**：

- ❌ 重新设计五层架构（已经很好）
- ❌ 重写 BackgroundTaskScheduler（9 方法都对）
- ❌ "完全废弃" team-leader dispatch（feature flag 灰度更稳）
- ❌ 重做 7 层注入栈（实际比设计稿更完善）

**需要做的事**：

- ✅ 实施 L1.3 增量改造（4 项）
- ✅ 补全 L1.8 字段
- ✅ 加 L1.6 telemetry
- ✅ 反向更新 L1 文档（承认实际优秀设计）

---

## 11. 元教训

### 11.1 v3.12 复查的真正价值

复查发现 v3.10 → 实际实施有 3 类偏差：

**类型 A：实际实现优于设计**（4 项）

- L1.5 双存储 + 7 层注入栈
- L1.7 claim_token 防双 claim
- L1.9 接口精简（去掉过度设计的字段）
- L1.2 dispatch 拆分用纯代码

**类型 B：实际实现简化了设计**（2 项）

- L1.4 用 feature flag 灰度而非完全废弃
- L1.2 b 层不拆（前瞻性设计未落地）

**类型 C：实际实现遗漏了设计**（3 项）

- L1.3 流式 handoff（artifact-chain.ts 行 22 自己承认）
- L1.6 延迟监控（无）
- L1.8 substate / structural_depth 等字段

### 11.2 文档的正确角色

L1 文档**不是设计指令**，而是：

1. **追溯性诊断工具**：识别真实差距
2. **决策的记忆载体**：保留"为什么这么做"
3. **下游 Phase 的锚点**：为 Phase F+ 提供边界

应该**反向更新**承认实际实施的优秀设计，而不是要求实施反向适配文档。

### 11.3 后续审计机制

建议每个 Phase 完成后做一次类似审计：

- 输入：Phase 实施代码 + 对应的 L1/L2 决策文档
- 输出：A/B/C 三类偏差清单
- 处理：A 反向更新文档 / B 评估是否合理 / C 列入 backlog
