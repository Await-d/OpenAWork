# Phase D 实施方案：d 层结构化派发 + 双重 review ★ 双思想桥接成型 ★

## Task Overview

基于 Phase A（constitution + SOUL）、Phase B（session 状态机 + handoff）、Phase C（c 层产物链）已完成的基础，实施 Phase D：让 d（PM2 🎯主管）成为完整的"双思想桥接节点"——上承 c 的产物链，下启 e/f/g 的并行执行。

**前置依赖**：
- Phase A ✅（constitution + SOUL + 7 层注入栈）
- Phase B ✅（handoff + watcher + scheduler + 五层 session 树）
- Phase C ✅（c 层产物链 spec/plan/tasks + Constitution Check 软警告 + pm1-runner）

**关联文档**：
- `docs/team-architecture-spec-kit-borrowing-discussion.md` v3.11 §6.4
- `docs/team-interaction-flow-v3.11.md` §4（e/f/g 生命周期）
- `docs/team-page-layout-draft.md`

## Complexity Assessment

- Atomic steps: 12 → +2
- Parallel streams: 4（后端派发/后端review/前端/内容）→ +2
- Modules/systems: 4（gateway, web, packages, DB）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: +6
- **Chosen mode**: Full orchestration
- **Routing rationale**: Phase D 是"双思想桥接成型"的核心 Phase，涉及 dispatch_package 标准结构 + 多路并行派发 + 双重 review + toolset 门控

## Current Analysis

### Phase D 精确范围（v3.11 锁定）

**做**：
1. 后端：`dispatch_package` 标准结构定义（goal/context/toolsets/role + artifactRefs + taskMarkers）
2. 后端：d 层 pm2-runner（解析 c 的 tasks.md → 拆 dispatch_packages → 多路并行 handoff 给 e/f/g）
3. 后端：Constitution Check 硬门禁（D29 B3：派发前强制对齐 constitution，字面违反退回 c）
4. 后端：D28 有限并行编排（e/f 并行，g 等两者完成）
5. 后端：D46 动态编制（e 最少 2 并行，上限用户可配，f/g 固定）
6. 后端：收集 e/f/g 回写结果 → 自动触发双重 review（spec review + quality review）
7. 后端：review_report.md 作为 d 完成的 handoff result
8. 后端：D29 B3 失败分流（实现型→重派 e/f/g；规划型→退回 c；escalation_round ≥ 2→升级用户）
9. 后端：toolset 门控基础实现（D43 能力类别表注入到各层 session）
10. 前端：dispatch_package 可视化（右侧面板任务详情中展示派发包内容）
11. 前端：review_report 展示（底部抽屉 d 层 Tab 中渲染 review 结果）
12. 前端：失败重派/退回 c 的状态流转展示

**不做**（Phase E 范围）：
- kanban 长任务板
- 完整 spec-kit `analyze` 命令
- 跨 team workflow 复用
- Workflow 模板栈 + Role Adapter 矩阵

### 依赖分析（DAG）

```
Stream 1 (后端核心派发)：
  T-01 dispatch_package 类型定义
  T-01 完成后 → T-02 pm2-runner（解析 tasks → 拆包 → 多路 handoff）
  T-02 完成后 → T-03 Constitution Check 硬门禁
  T-02 完成后 → T-04 D28 有限并行编排 + D46 动态编制

Stream 2 (后端 review)：
  T-04 完成后 → T-05 收集 e/f/g 结果 + 触发双重 review
  T-05 完成后 → T-06 review_report 生成 + handoff result 写入
  T-05 完成后 → T-07 D29 B3 失败分流逻辑

Stream 3 (后端门控)：
  T-02 完成后 → T-08 toolset 门控基础实现

Stream 4 (前端，依赖后端)：
  T-02 完成后 → T-09 dispatch_package 可视化
  T-06 完成后 → T-10 review_report 展示
  T-07 完成后 → T-11 失败重派/退回状态流转展示
```

## Solution Design

### 技术方案

1. **dispatch_package**：TypeScript 接口定义，存入 handoff_records.payload_json
2. **pm2-runner**：类似 pm1-runner，watcher claim pm2 层 handoff 后触发；解析 c 的 tasks.md（从 result_json 读取）→ 按 [P] 标记拆分 → 为每个 task 创建 handoff（target=executor/tester/reviewer）
3. **Constitution Check 硬门禁**：pm2-runner 派发前调 LM 做 plan vs constitution 对齐检查；字面违反→退回 c（escalation_round++）
4. **有限并行**：pm2-runner 创建 handoff 时设置 depends_on 字段（g 依赖 e+f 全部完成）
5. **动态编制**：根据 tasks.md 中 [P] 标记数量决定 spawn 几个 e（最少 2，上限从 team 设置读取）
6. **双重 review**：所有 e/f/g handoff 完成后，pm2-runner 触发 review 阶段（调 LM 做 spec review + quality review）
7. **失败分流**：review 失败时按 D29 B3 规则分流（实现型重派 / 规划型退回 c / escalation ≥ 2 升级用户）
8. **toolset 门控**：在 handoff payload 中声明该层可用的 toolset 列表，executor 层只能调用白名单内的工具

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| pm2-runner 解析 tasks.md 格式不稳定 | 用正则 + Zod 校验，不合格重试 1 次 |
| 双重 review 耗时过长（2 次 LM 调用） | 可并行跑 spec review + quality review |
| 失败分流判断不准 | D29 B3 启发式规则 + escalation_round 硬兜底 |
| 动态编制 e 数量过多导致资源竞争 | D50 全局并发上限 + 用户可配上限 |

## Implementation Plan

### Phase 1: 后端核心派发（Stream 1）
- [x] T-01: dispatch_package 类型定义（TypeScript 接口 + Zod schema）
- [x] T-02: pm2-runner（解析 tasks.md → 拆 dispatch_packages → 多路 handoff）
- [x] T-03: Constitution Check 硬门禁（派发前强制对齐，字面违反退回 c）
- [x] T-04: D28 有限并行编排 + D46 动态编制（e/f 并行，g 等两者；e 数量动态）

### Phase 2: 后端 review（Stream 2，依赖 T-04）
- [x] T-05: 收集 e/f/g 回写结果 + 触发双重 review（spec review + quality review）
- [x] T-06: review_report.md 生成 + 作为 d 完成的 handoff result 写入
- [x] T-07: D29 B3 失败分流（实现型重派 / 规划型退回 c / escalation ≥ 2 升级用户）

### Phase 3: 后端门控（Stream 3，依赖 T-02）
- [x] T-08: toolset 门控基础实现（handoff payload 声明可用 toolset + executor 层校验）

### Phase 4: 前端（Stream 4，依赖后端）
- [x] T-09: dispatch_package 可视化（右侧面板任务详情）
- [x] T-10: review_report 展示（底部抽屉 d 层 Tab）
- [x] T-11: 失败重派/退回 c 的状态流转展示

## Parallel Execution Plan

**Wave 1（无依赖，立即）**：
- T-01（dispatch_package 类型定义）

**Wave 2（依赖 T-01）**：
- T-02（pm2-runner 核心逻辑）

**Wave 3（依赖 T-02，可并行）**：
- T-03（Constitution Check）+ T-04（并行编排+动态编制）+ T-08（toolset 门控）+ T-09（前端可视化）

**Wave 4（依赖 T-04）**：
- T-05（收集结果+触发 review）

**Wave 5（依赖 T-05，可并行）**：
- T-06（review_report）+ T-07（失败分流）+ T-10（前端 review 展示）

**Wave 6（依赖 T-07）**：
- T-11（前端失败状态流转）

## 验收标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过（新增测试覆盖 T-02/T-03/T-05/T-07）
- [ ] d 层能正确解析 c 的 tasks.md 并拆分为 dispatch_packages
- [ ] Constitution Check 硬门禁能检测冲突并退回 c
- [ ] e/f 并行执行，g 等两者完成后才启动
- [ ] 动态编制：e 数量根据 [P] 标记动态决定（最少 2）
- [ ] 双重 review 能检测实现质量并生成 review_report
- [ ] 失败分流正确：实现型重派 / 规划型退回 c / escalation ≥ 2 升级用户
- [ ] toolset 门控：executor 层只能调用白名单内工具
- [ ] 前端能展示 dispatch_package 内容和 review_report

## Notes

- 估时：3-4 周
- T-02 是核心复杂点——需要设计 tasks.md 解析 + [P] 标记推导并行 + 动态 e 数量
- T-05/T-06/T-07 是 review 闭环——需要设计"所有 e/f/g 完成后才触发"的聚合逻辑
- Constitution Check 在 Phase D 是硬阻断（D9 reconcile：d 层=硬），与 Phase C 的软警告不同
- Memory sync: pending
