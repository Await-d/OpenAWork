# 260723-team-lifecycle-hard-contract-tools

## Task Overview

将 Team 五层 handoff 的**执行完成 / 评审完成**从“自然语言约定 + runner 事后推断”升级为**强制 Builtin Instruction 硬契约**，从结构上消除：

1. Executor/Reviewer 因上下文压缩/长对话忘记返回格式
2. Quality Review 只能吃 free text 导致主观来回验收
3. 返工反馈模糊、无法按 checklist item 精确 redispatch
4. return-to-c / redispatch 因协议缺失进入无效循环

**本轮只出详细实施方案，不改代码。** 用户批准后才进入实现。

## Current Analysis

### 现状（已有能力）

| 能力 | 状态 | 路径 |
|---|---|---|
| Builtin Instruction 注册表 + 双门禁 | ✅ 已有 | `handoff/capability/builtin-instructions.ts` |
| 层能力矩阵 `allowedBuiltinInstructions` | ✅ 已有 | `layer-capabilities.ts` |
| executor: `submit_patch` / `mark_completed` | ⚠️ 弱 | `builtin-instructions-impl.ts` — mark 只改 substate，无结构化 result |
| reviewer: `submit_review` | ⚠️ 弱 | 只有 title/content markdown，无 checklist items |
| dispatch_package 输入契约 | ✅ 已有 | `dispatch-package.ts` |
| planning-validation 结构门禁 | ✅ 已有 | `planning-validation.ts` |
| result_json 写入 | ⚠️ runner 事后 | `pm1-runner.ts` collectExecutionCompletionEvidence |
| quality review 双 LLM | ⚠️ free text | `review-aggregator.ts` |
| 断路器 globalEscalationRound / retry_count / stability | ✅ 近期已补 | `team-failure-policy.ts` + reconciler |

### 根因（与“全工具化”的关系）

不是“没有工具”，而是：

> **完成态没有硬契约。** 工具可选，runner 用 end_turn + 最后一条文本 + artifact 存在性推断完成。

因此正确方向不是“每层所有动作都工具化”，而是：

> **每个层级的输入/输出边界做成固定工具 + runner 门禁。**

### 不在本方案范围

- 不推翻 5 层架构 / watcher / scheduler
- 不把 PM1 artifact chain、PM2 constitution/dispatch 编排改成 LLM 自由工具流
- 不在本阶段做完整 acceptance.yaml 自动执行引擎（可后续）
- 不替换已完成的 prompt/断路器止血改动（它们仍作为兜底）

## Solution Design

### 设计原则

```
LLM 负责怎么做
工具负责交什么
runner 负责何时算完成
```

### 目标协议（最小闭环）

```text
PM2 dispatch_package
  → Executor load/work
  → Executor submit_execution_result  (硬)
  → (optional) Reviewer submit_review_report (硬)
  → PM2 quality review 优先消费结构化结果
  → disposition 按 failedItems / protocol 分流
```

### 核心新增/升级

#### 1. `submit_execution_result`（executor 必调）

Zod schema 草案：

```ts
z.object({
  taskId: z.string().min(1),
  status: z.enum(['completed', 'blocked', 'failed']),
  changedFiles: z.array(z.string()).default([]),
  checklist: z.array(z.object({
    id: z.string().min(1),          // AC-xxx / SC-xxx / task marker
    status: z.enum(['pass', 'fail', 'blocked']),
    evidence: z.string().min(1).max(2000),
  })).min(1),
  summary: z.string().min(1).max(4000),
  verification: z.array(z.string()).default([]),
  blockedReason: z.string().max(2000).optional(),
})
```

Handler 行为：
1. 校验 taskId 与当前 handoff payload.taskMarkers.taskId 一致
2. 校验 changedFiles ⊆ ownedPaths（有 ownedPaths 时）
3. status=completed 时：checklist 不得有 fail；且至少有一次文件写入证据（现有 collect evidence 逻辑复用）
4. 写入 `artifacts`（phase=`implementation`）+ 更新 handoff `result_json`：
   ```json
   {
     "protocol": "submit_execution_result",
     "taskId": "...",
     "status": "completed",
     "changedFiles": [],
     "checklist": [],
     "summary": "...",
     "verification": [],
     "submittedAt": "ISO"
   }
   ```
5. setSubstate completed；**不**直接 completeHandoff（仍由 watcher 兜底，保持现架构）

#### 2. `submit_review_report`（reviewer 必调，升级现有 submit_review）

两种落地二选一（推荐 B）：
- A. 保留 `submit_review` markdown，另加新工具
- **B. 扩展 `submit_review` schema 为结构化 + markdown 兼容字段**（减少工具膨胀）

推荐 schema：

```ts
z.object({
  taskId: z.string().min(1),
  verdict: z.enum(['pass', 'fail']),
  items: z.array(z.object({
    id: z.string().min(1),
    status: z.enum(['pass', 'fail']),
    reason: z.string().max(2000).optional(),
    fileRefs: z.array(z.string()).optional(),
  })).min(1),
  overallReason: z.string().max(2000).optional(),
  // 兼容旧 markdown 展示
  title: z.string().max(200).optional(),
  content: z.string().max(64000).optional(),
})
```

#### 3. Runner 完成门禁（`runExecutionLayer`）

`collectExecutionCompletionEvidence` 升级为：

```text
if role=executor:
  require result_json.protocol == 'submit_execution_result'
  else → execution-protocol-failure

if role=reviewer:
  require result_json.protocol == 'submit_review_report' (or upgraded submit_review)
  else → execution-protocol-failure
```

可选兼容期（建议 1 个 release）：
- 有旧 artifact+summary 但无 protocol → warning + 仍允许，但 quality review 标记 `protocolDegraded=true`
- 下一 release 改为硬失败

#### 4. Quality Review 消费结构化结果

`buildReviewReadiness` / `runReviewAggregation`：

1. 解析 child result_json.checklist / items
2. **机器判定优先**：
   - 任一 checklist fail → overallVerdict 倾向 implementation-failure
   - 缺 protocol → execution-protocol-failure
3. LLM Spec/Quality Review 仅在：
   - 结构化全部 pass，但仍需语义抽检
   - 或 checklist 无法覆盖的主观项
4. disposition reason 带 `failedItems: string[]`

#### 5. 返工精确化

redispatch payload：

```json
{
  "reviewStructuredFeedback": "...",
  "failedItems": ["AC-002"],
  "previousChecklist": [...]
}
```

Executor prompt/context 注入：只修 failedItems，已 pass 的不要动。

稳定性检查升级：
- 优先比较 failedItems 集合 Jaccard
- 文本 overlap 作 fallback

#### 6. 与现有 mark_completed 关系

| 工具 | 定位 |
|---|---|
| `submit_execution_result` / `submit_review_report` | **唯一合法完成提交** |
| `mark_completed` | 降级为“可选 UI 信号”或最终 **deprecate**（实现阶段二选一，推荐：保留但若无 submit 则 runner 仍判失败） |
| `submit_patch` | 保留为过程产物，不再单独构成完成证据 |

### 架构契合

完全落在现有：
- Builtin Instruction 体系
- layer-capabilities 白名单
- handoff result_json
- review disposition / failure policy
- watcher complete 兜底

不改变：
- 5 层角色拓扑
- watcher claim/start 循环
- PM1/PM2 runner 主编排权

### 分阶段交付

**Phase A（本方案实施范围）— 硬完成契约**
- submit_execution_result
- submit_review 结构化升级
- runner 门禁
- review-aggregator 优先消费结构化
- 测试

**Phase B（后续，不在本批必做）**
- `load_task` / `load_acceptance_checklist`
- PM1 AC 编号强制导出
- 自动验证钩子（test/lint/file_exists）

**Phase C（更后）**
- PM2 分流工具化（return_to_c / escalate 已部分存在）
- 完整 acceptance 可执行引擎

## Complexity Assessment

| Signal | Score |
|--------|-------|
| Atomic steps: 8（schema/注册/门禁/聚合/反馈/测试/文档/兼容） | +2 |
| Parallel streams: 协议/实现/测试可并行 | +2 |
| Modules/systems: 5+（builtin-impl, layer-caps, pm1-runner, review-aggregator, reconciler, tests） | +1 |
| Long step (>5 min): 是 | +1 |
| Persisted review artifacts: 是（workflow + tests） | +1 |
| OpenCode available: 否 | 0 |
| **Total score** | **7** |
| **Chosen mode** | **Full orchestration** |
| **Routing rationale** | 跨 handoff 协议、多模块、需持久化方案与分阶段实施；先方案后代码，完整编排更合适。 |

## Implementation Plan

### Phase 0: 方案确认（当前）
- [ ] T-00: 用户批准本实施方案（含兼容策略与 schema）

### Phase 1: 契约与能力矩阵
- [ ] T-01: 定义 `submit_execution_result` / 升级 `submit_review` Zod schema 与 result_json 类型
- [ ] T-02: 更新 `layer-capabilities.ts` allowedBuiltinInstructions
- [ ] T-03: 在 `builtin-instructions-impl.ts` 注册/升级 handler（含 ownedPaths/taskId 校验）

### Phase 2: Runner 完成门禁
- [ ] T-04: 升级 `collectExecutionCompletionEvidence` / `runExecutionLayer` 要求 protocol submit
- [ ] T-05: 兼容策略实现（degraded vs hard fail 开关，默认 soft→下一版 hard）

### Phase 3: Review 聚合与返工
- [ ] T-06: `review-aggregator` 优先解析 checklist/items，机器判定 + LLM 兜底
- [ ] T-07: reconciler/pm2-runner 注入 failedItems 精确反馈；稳定性检查优先 item 集合

### Phase 4: Prompt 与工具可见性
- [ ] T-08: executor/reviewer 完成协议改为“必须调用 submit_* 工具”，弱化纯文本完成
- [ ] T-09: apply-team-layer-tools / tool-sandbox 确认新指令放行

### Phase 5: 测试与验证
- [ ] T-10: 单元测试：schema 校验、handler 写 result_json、ownedPaths 拒绝
- [ ] T-11: 集成测试：无 submit → protocol-failure；checklist fail → redispatch 带 failedItems
- [ ] T-12: 回归：team-failure-policy / review-readiness / quality-review reconciler

### Phase 6: 文档与收口
- [ ] T-13: 更新 agentdocs memory / 相关注释；明确 Phase B 边界
- [ ] T-14: 全量相关 vitest + typecheck

## Notes

### 兼容策略建议（需用户拍板）

**推荐：两阶段开关**

```ts
OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL=soft|hard
// soft（默认）：缺 protocol 记 protocolDegraded，仍可进 review
// hard：缺 protocol 直接 execution-protocol-failure
```

### 潜在风险

1. 模型不调用新工具 → soft 期靠 prompt + 门禁提示；hard 期强制失败
2. checklist id 与 spec AC 对不齐 → Phase B 用 load_acceptance_checklist 解决；Phase A 允许 taskId 级 items
3. ownedPaths 过严误杀 → 无 ownedPaths 时跳过路径校验
4. 与现有 submit_patch 双写 → 明确 patch=过程，result=完成

### 验证策略

- 单元：schema / handler / evidence gate
- 集成：假 LLM + sqlite memory handoff 全链路
- 手工：跑一个 executor 任务，确认无 submit 时 soft/hard 行为符合预期

### 批准后执行方式

Full orchestration：
- runtime: `.agentdocs/runtime/260723-team-lifecycle-hard-contract-tools/`
- 实现按 T-01→T-14 顺序，可并行 T-01/T-02 与测试骨架
- 每阶段 ≤3 文件批改 + 测试

## Memory Sync

- 待实现完成后写入：完成硬契约优先于 prompt 约定；Builtin Instruction 是完成边界而非可选能力。
