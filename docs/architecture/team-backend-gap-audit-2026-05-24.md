# Team 后端差距审计（2026-05-24）

> 用途：基于 `docs/architecture/team-*.md` 与 `services/agent-gateway/src/` 实际代码交叉核对后，给出当前 Team 后端能力的真实完成度清单。
>
> 结论优先级：
>
> - `未完成`：功能主闭环缺失，必须继续做
> - `半完成`：能力存在，但未达到架构文档目标
> - `已完成但文档过时`：代码已落地，不应继续按旧文档算作缺口

---

## 1. 总结

当前 Team 后端**真正还没做完**的核心项只有 2 个：

1. `d.2 architecture review` 仍是软 lint，没有形成正式 review 闭环
2. `L1.6` 延迟监控只落了内存窗口和部分埋点，没有形成完整 telemetry / 告警闭环

另外有 2 个收尾项：

1. `pause/resume` 只有内部 store / scheduler 能力，未见完整对外 REST 控制面
2. `sessions` 级暂停字段与部分架构文档口径不一致，目前主要落在 `handoff_records`

以下能力已经落地，不应再按旧文档继续算作未完成：

- `L1.3` 流式 handoff
- `L1.8` 中的 `substate / structural_depth / execution_depth`
- `d.4` spec/quality review 基本闭环

---

## 2. 未完成

### 2.1 d.2 architecture review 正式闭环

**现状**

- `pm2-runner.ts` 已进入 `architecture_review` 子状态
- 当前实现只是对 plan 做规则匹配，发现问题后仅 `console.warn`
- 不阻断、不写正式 `review_result`、不参与失败分流

**代码证据**

- `services/agent-gateway/src/handoff/runner/pm2-runner.ts`
  - `setD(SUBSTATES_D.ARCHITECTURE_REVIEW)`：进入架构评审态
  - `runArchitectureLint(...)`：执行轻量关键词 lint
  - `architectureLintPassed: true`：结果被硬编码写成通过

**影响**

- 架构规范对 d 层只是“提示”，不是“守门”
- 与文档里“规则代码 + LLM 兜底”的目标不一致

**建议任务**

1. 定义正式 `architectureReviewResult` 结构
2. 区分 `warning` 与 `blocking violation`
3. 将 review 结果写入 `handoff_records.result_json` 或独立 artifact
4. 接入 watcher 的失败分流逻辑
5. 如需 LLM 兜底，限定为规则无法覆盖时才触发

**建议优先级**

- `P0`

---

### 2.2 L1.6 延迟监控完整接入

**现状**

- `latency-monitor.ts` 已实现内存滑动窗口
- 目前只确认到 `a_to_b_ack` 有真实埋点
- 未发现 `a_to_b_direct`、`substate_push`、`progress_interval` 的完整采样闭环
- 未接外部 telemetry / 告警系统

**代码证据**

- `services/agent-gateway/src/handoff/bus/latency-monitor.ts`
- `services/agent-gateway/src/routes/team-inbound.ts` 中 `recordLatency('a_to_b_ack', ...)`

**影响**

- 文档定义了 4 个体验指标，但当前只能部分观测
- 超阈值只能 `console.warn`，没有统一告警与持久化指标

**建议任务**

1. 为 `a_to_b_direct` 增加实际采样点
2. 在 substate 事件发送链路补 `substate_push` 采样
3. 在进度事件或 substate 连续变化中补 `progress_interval` 采样
4. 将指标导出到现有 telemetry 通道
5. 对 p95 超阈值接告警

**建议优先级**

- `P0`

---

## 3. 半完成

### 3.1 pause / resume 只有内部能力，控制面不完整

**现状**

- `handoff-store.ts` 已有 `pauseHandoff()` / `resumeHandoff()`
- `scheduler.ts` 已有 `pauseAll()` / `resumeAll()`
- 但 `team-handoffs.ts` 当前明确暴露的写端点只有 `cancel`
- 没看到对应的 `POST /pause`、`POST /resume`、`POST /pause-all`、`POST /resume-all`

**代码证据**

- `services/agent-gateway/src/handoff/store/handoff-store.ts`
- `services/agent-gateway/src/handoff/runner/scheduler.ts`
- `services/agent-gateway/src/routes/team-handoffs.ts`

**影响**

- 后端内部支持暂停/恢复，但前端或外部控制面未完全对齐
- 如果 UI 需要“一键暂停/恢复”，当前 REST 面可能不够

**建议任务**

1. 明确 pause/resume 的对外 API 设计
2. 提供单任务 pause/resume
3. 提供 team 级 pauseAll/resumeAll
4. 接入 audit log 与权限校验

**建议优先级**

- `P1`

---

### 3.2 sessions 级暂停字段与文档口径不一致

**现状**

- `handoff_records` 已有 `paused_at / paused_by_user_id / pause_reason`
- 但没有看到 `sessions.paused / paused_at / paused_by_user_id / pause_reason` 的 schema 补齐
- 部分架构文档曾要求 `sessions` 与 `handoff_records` 双表镜像

**代码证据**

- `services/agent-gateway/src/infra/db.ts`

**影响**

- 如果前端或调度逻辑要从 `sessions` 直接读暂停态，当前数据模型可能不够一致
- 文档与实现会继续分叉

**建议任务**

1. 先决定是否真的需要 `sessions` 级镜像
2. 如果需要，补 migration 与索引
3. 如果不需要，更新架构文档，明确“暂停态以 handoff_records 为准”

**建议优先级**

- `P1`

---

## 4. 已完成但旧文档容易误判

### 4.1 L1.3 流式 handoff 已完成

**已落地内容**

- `session_inbound_messages` 表
- `team-inbound` 路由
- `substate` store
- c 层等待澄清循环
- cancel / pause / resume inbound 信号处理

**代码证据**

- `services/agent-gateway/src/infra/db.ts`
- `services/agent-gateway/src/routes/team-inbound.ts`
- `services/agent-gateway/src/handoff/store/inbound-store.ts`
- `services/agent-gateway/src/handoff/store/substate-store.ts`
- `services/agent-gateway/src/handoff/runner/artifact-chain.ts`

---

### 4.2 L1.8 的 substate / depth 字段已完成

**已落地内容**

- `sessions.substate`
- `sessions.substate_updated_at`
- `sessions.structural_depth`
- `sessions.execution_depth`

**代码证据**

- `services/agent-gateway/src/infra/db.ts`
- `services/agent-gateway/src/handoff/bus/team-session-create.ts`

---

### 4.3 d.4 spec/quality review 已有闭环

**已落地内容**

- watcher 在 e/f/g 子 handoff 全部完成后触发 review
- `review-aggregator.ts` 并行执行 spec review 与 quality review
- 支持 `pass / redispatch / return-to-c / escalate-to-user`

**代码证据**

- `services/agent-gateway/src/handoff/runner/watcher.ts`
- `services/agent-gateway/src/handoff/workflow/review-aggregator.ts`

**说明**

- 这项不应再按“完全未实施”计算
- 但它依赖 LLM 配置；无 LLM 配置时会降级成 summary 模式

---

## 5. 建议排期

### P0

1. 完成 `d.2 architecture review` 正式闭环
2. 完成 `L1.6` 四项延迟指标全埋点 + telemetry 接入

### P1

1. 为 pause/resume 补完整 REST 控制面
2. 决策并收口 `sessions` 暂停字段方案

### P2

1. 统一更新 `docs/architecture/team-*.md`，去掉对 `L1.3` / `L1.8` / `d.4` 的旧结论
2. 追加一份“代码为准”的状态页，减少后续误判

---

## 6. 一句话结论

当前 Team 后端主链路已经能跑，真正需要补的是：

- `架构评审要从软提示升级为正式守门`
- `延迟监控要从内存统计升级为完整观测`
- `暂停/恢复控制面与数据模型还需要收口`
