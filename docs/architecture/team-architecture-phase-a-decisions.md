# Team 架构 Phase A 决策（L2，v1.1 - 复查修订）

> ⚠️ **复查发现的现状（2026-05-16）**：
>
> 本文档初稿（v1.0）建议"Phase A 剥离 SOUL，只验证 constitution 编辑"，但**Phase A 实际已经完成实施**且包含了 SOUL。详见 `.agentdocs/workflow/done/260515-team-phase-a-实施方案.md` 与 `services/agent-gateway/src/team-phase-a-content/soul-defaults.ts`。
>
> **现状概要**：
>
> - ✅ constitution_md 字段 + 编辑 UI（已上线）
> - ✅ agent_personas 表 + 5 个内置 SOUL（已上线，非 v1.0 建议的"剥离"）
> - ✅ 7 层注入栈（已上线）
> - ✅ Memory 双存储 + 13 条威胁模式扫描（已上线）
> - ✅ ForceApply 24h ≤ 5 次限流（已上线）
>
> **本文档的真正价值变为**：
>
> 1. 沉淀 Phase A 已实施部分的设计依据
> 2. 标注 v1.0 中**与现实偏差**的部分（特别是 Phase-A.1 SOUL 剥离建议已被推翻）
> 3. 评估 Phase A 验证指标（v1.0 提的 4 个指标是否已收集？）
>
> ---

> 用途：Phase A 启动需要拍板的决策清单。Phase A 目标是**最小切口验证 constitution 编辑假设**——用户是否真的会编辑团队约束。
>
> 关联文档：
>
> - L1 基线：`team-architecture-l1-baseline.md`（v1.1）
> - 思想分析归档：`team-architecture-spec-kit-borrowing-discussion.md`
> - **Phase A 实施方案**：`.agentdocs/workflow/done/260515-team-phase-a-实施方案.md`（已完成）
> - Phase B 决策：（已实施，详见 `.agentdocs/workflow/done/260515-team-phase-b-实施方案.md`）
>
> 创建时间：2026-05-16（v1.0 → v1.1 复查修订）
> 当前状态：**v1.1 草稿，仅作 Phase A 复盘归档使用**

---

## 0. v1.1 修订说明

### 0.1 v1.0 的核心错误

v1.0 建议"Phase A 剥离 SOUL，只验证 constitution"，理由是"避免验证失败时无法定位原因"。

**这个建议本身有道理，但来得太晚**——Phase A 实际已实施时同时引入了 constitution + SOUL + 7 层注入栈。

### 0.2 v1.1 的处理

不再"重新设计 Phase A"，而是：

1. 把 v1.0 §1 的 6 项决策从"待拍板"改为"复盘对照表"
2. 把 v1.0 §3 工作量估算从"5 天预测"改为"实际工作量记录"
3. 把 v1.0 §5 验证指标从"上线后收集"改为"现状评估"

### 0.3 v1.0 文档的剩余价值

- §1 决策清单：作为 Phase A 决策考古资料
- §5 验证指标：仍然是"评估 Phase A 是否成功"的合理指标
- §6 不做清单：仍然是"避免 Phase A scope creep"的有用边界

---

---

## 0. Phase A 核心假设

Phase A 要验证的**唯一假设**：

> 用户是否会编辑"团队约束"这种长期人设？

如果验证不通过（< 30% 的活跃 team 会编辑 constitution），后续整个七件套就失去意义——⑦ Project Memory、② Workflow、③ Artifacts 都依赖用户主动维护长期约束。

**Phase A 只验证这一件事**。其它七件套相关功能（SOUL、Workflow 模板、Role Adapter、Handoff Protocol）全部下沉到 Phase B 及之后。

---

## 1. Phase A 决策清单（共 6 项）

### Phase-A.1 Phase A 是否引入 SOUL（角色级人格）

**当前 v3.12 D17 拍板**：是，Phase A 引入 5 个内置 SOUL（reception/pm1/pm2/executor/reviewer）。

**重新评估**：❌ **改为延后到 Phase B**。

**理由**：

- Phase A 的核心假设是"用户编辑 constitution"，引入 SOUL 会**混淆验证**——验证失败时不知道是 constitution 没用还是 SOUL 没用还是注入栈错了
- SOUL 的 5 个内置角色已经预设了五层架构（即 Phase B 的核心假设），Phase A 无法独立验证
- SOUL 没有用户编辑入口，对 Phase A 的核心假设没有直接帮助

**新决策**：

- Phase A **不引入** SOUL
- Phase A **不引入** 五层架构（保持现有 4 角色固定绑定）
- Phase A **只新增** constitution 字段 + 编辑 UI + 注入到现有 system prompt

**风险**：Phase A 验证通过后 Phase B 才能验证五层架构 + SOUL，会让 Phase B 工作量略大。**缓解**：Phase B 本身就是"五层骨架成型"阶段，把 SOUL 放在那里更合理。

---

### Phase-A.2 Constitution 字段存储位置

**当前 v3.12 D2 推荐**：数据库字段 `team_workspaces.constitution_md`。

**Phase A 决策**：✅ 保持。

**Migration**：

```sql
ALTER TABLE team_workspaces ADD COLUMN constitution_md TEXT NOT NULL DEFAULT '';
ALTER TABLE team_workspaces ADD COLUMN constitution_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_workspaces ADD COLUMN constitution_updated_at INTEGER;
ALTER TABLE team_workspaces ADD COLUMN constitution_updated_by TEXT;
```

**字符上限**：≤ 5000 字符（与 v3.12 D44 跨层共性约束一致）。

---

### Phase-A.3 Constitution 编辑 UI 形态

**Phase A 决策**：在 `/team` 页面新增"团队宪法"侧边 tab。

**最小可行设计**：

| 元素     | 实现                                                                |
| -------- | ------------------------------------------------------------------- |
| 入口     | TeamPage 侧边导航新增 "宪法" tab                                    |
| 编辑器   | Markdown 编辑器（复用现有 ArtifactsPage 编辑器组件）                |
| 模板     | 提供 3 个预置模板（开发团队 / 内容团队 / 研究团队），用户点击即填充 |
| 版本     | 用 `constitution_version` 自增，不做版本历史 UI（Phase A 简化）     |
| 字符计数 | 显示当前字符数 + 5000 上限提示                                      |
| 保存     | 显式"保存"按钮（不做自动保存）                                      |

**不做**：

- 不做协同编辑（Phase A 不需要）
- 不做版本对比（用 git diff 类型 UI 太重）
- 不做修订审批流（团队所有人可改）

---

### Phase-A.4 Constitution 注入到现有 system prompt 的位置

**Phase A 决策**：注入到现有 4 角色（planner/researcher/executor/reviewer）的 system prompt。

**注入策略**：

```
现有 system prompt 结构：
  AGENTS.md（仓库级）
  + 角色 prompt（agent-catalog.ts 中的固定文本）
  + 用户消息

Phase A 修改后：
  AGENTS.md（仓库级）
  + [NEW] team_workspaces.constitution_md（如果 session 关联到 team）
  + 角色 prompt
  + 用户消息
```

**实施细节**：

- 修改 `services/agent-gateway/src/routes/team.ts` 中的 system prompt 拼接逻辑
- 在 session metadata 中读取 `teamWorkspaceId`，从 `team_workspaces` 表读取 `constitution_md`
- 拼接到 system prompt 的固定位置（在 AGENTS.md 之后）
- 如果 constitution_md 为空，跳过注入

**不做**：

- 不引入 7 层完整注入栈（Phase B 才做）
- 不引入 frozen snapshot 机制（Phase B 才做）
- 不引入安全扫描（Phase B 跟 memory 一起做）

---

### Phase-A.5 Phase A 验证指标

**核心指标**（必须明确定义才能判断 Phase A 是否成功）：

| 指标                        | 目标                                                                       | 测量方法                                                      |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **constitution 编辑率**     | 启用 team 后 30 天内编辑过 constitution 的 team 占比 ≥ 30%                 | telemetry：`constitution_md` 长度 > 0 的 team_workspaces 数量 |
| **constitution 长度分布**   | p50 > 200 字符（说明用户认真填）                                           | `LENGTH(constitution_md)` 分布                                |
| **constitution 重新编辑率** | 编辑过的 team 中 7 天内再次编辑的占比 ≥ 20%                                | `constitution_version` > 1 的占比                             |
| **session 输出质量**        | 启用 constitution 的 team session vs 未启用的 session，用户满意度提升 ≥ 5% | 用户主动反馈 + 满意度调查（如果有埋点）                       |

**不达标处理**：

- 编辑率 < 30% → Phase B 不启动，重新审视"五层架构是否真的有用"
- 长度 p50 < 200 → 默认模板可能不好用，迭代模板而非推进
- 重新编辑率 < 20% → 用户写完一次就不管了，说明 constitution 是"伪需求"

**指标收集时长**：Phase A 上线后至少 4 周才能下结论，前 2 周数据可能受新功能曝光偏好干扰。

---

### Phase-A.6 Phase A 不做清单

**明确不做**（避免 scope creep）：

| 项目                         | 何时做    |
| ---------------------------- | --------- |
| 引入 b 接待层 / d PM2 层     | Phase B   |
| 引入 5 个 SOUL               | Phase B   |
| 引入 7 层注入栈              | Phase B   |
| 引入 handoff 协议            | Phase B   |
| 引入 BackgroundTaskScheduler | Phase B   |
| 引入 architecture.md         | Phase B/C |
| 引入 spec/plan/tasks 产物链  | Phase C   |
| 引入 dispatch_package        | Phase D   |
| 引入 workflow 模板栈         | Phase E   |
| 引入 role adapter 矩阵       | Phase E   |

**唯一例外**：如果 Phase A 中发现 constitution 注入引发 token 暴涨（新增 5000 字符 system prompt），可以**临时引入 prompt 长度监控**——但这是 telemetry 范畴，不是七件套。

---

## 2. Phase A 工作量估算

| 任务                               | 工作量   |
| ---------------------------------- | -------- |
| Migration（4 字段）                | 0.5 天   |
| 后端 API（GET/PUT constitution）   | 0.5 天   |
| 前端编辑 UI（Markdown 编辑器复用） | 1 天     |
| 3 个预置模板编写                   | 0.5 天   |
| system prompt 注入逻辑             | 1 天     |
| Telemetry 埋点                     | 0.5 天   |
| 测试 + 文档                        | 1 天     |
| **总计**                           | **5 天** |

**Phase A 应该是 1 周内完成的实验**，不是 1-2 周（v3.12 估算偏高，因为它包含了 5 个 SOUL）。

---

## 3. Phase A 完成标准（DoD）

Phase A 视为完成，必须满足：

- [ ] Migration 上线，所有 team_workspaces 都有 constitution_md 字段
- [ ] `/team` 页面"团队宪法" tab 上线，可编辑可保存
- [ ] 3 个预置模板可用
- [ ] 现有 4 角色的 system prompt 已注入 constitution
- [ ] Telemetry 已埋点（编辑率、长度、重新编辑率）
- [ ] 文档已更新（README + 用户引导）

**Phase A 不在 DoD 范围内的事**：

- Phase B 启动准备（在 Phase A 验证通过后再做）
- 五层架构相关的所有改造

---

## 4. Phase A 退出条件

Phase A 完成后 4-8 周收集数据，根据 §Phase-A.5 指标判断：

**继续路径（Phase B 启动）**：

- 所有 4 个核心指标达标
- 用户主动反馈支持继续做长期约束相关功能

**调整路径（Phase A 迭代）**：

- 编辑率达标但长度不达标 → 优化模板
- 长度达标但重新编辑率不达标 → 增加"提醒重新编辑"机制（如新成员加入时）

**停止路径（重新审视架构）**：

- 编辑率 < 15% → constitution 是伪需求，Phase B 暂停，重新设计架构

---

## 5. 与 v3.12 讨论稿的差异

| Phase A 决策            | v3.12 设计                      | 差异                              |
| ----------------------- | ------------------------------- | --------------------------------- |
| 不引入 SOUL             | v3.12 D17 引入 5 个内置 SOUL    | **缩小**：Phase A 聚焦单一假设    |
| 不引入五层架构          | v3.12 Phase A 已经触发 b/d 重构 | **缩小**：v3.12 把 Phase A/B 混合 |
| 注入位置只在现有 4 角色 | v3.12 注入到 7 层栈             | **简化**：Phase A 没有 7 层栈     |
| 工作量 5 天             | v3.12 估 1-2 周                 | **明确**：剥离 SOUL 后工作量减半  |
| 验证指标 4 个           | v3.12 没有明确指标              | **新增**：可量化的验证标准        |

---

## 6. 当前状态

- ⚠️ Phase A 决策草稿（待团队 review）
- ⚠️ 等待 L1 基线决策（特别是 L1.2/L1.3/L1.4/L1.6）锁定后再启动
- 📅 预计 Phase A 启动：L1 锁定后 1 周内
- 📅 预计 Phase A 完成：启动后 1 周（5 个工作日）
- 📅 预计 Phase A 验证：完成后 4-8 周
- 📅 预计 Phase B 启动：Phase A 验证通过后立即（如果通过）
