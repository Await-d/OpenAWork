# Phase E 实施方案：Workflow 模板栈 + Role Adapter 矩阵

## Task Overview

基于 Phase A-D 已完成的基础（constitution + SOUL + handoff + 产物链 + 结构化派发 + 双重 review），实施 Phase E：把"硬编码五层流程"抽象成可定制的模板栈与适配矩阵。**这是最后一个 Phase**。

**前置依赖**：
- Phase A ✅（constitution + SOUL + 7 层注入栈）
- Phase B ✅（handoff + watcher + scheduler + 五层 session 树）
- Phase C ✅（c 层产物链 spec/plan/tasks）
- Phase D ✅（d 层结构化派发 + 双重 review + toolset 门控）

## Complexity Assessment

- Atomic steps: 12 → +2
- Parallel streams: 4（后端模板/后端adapter/前端编辑器/内容包）→ +2
- Modules/systems: 4（gateway, web, packages, DB）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: +6
- **Chosen mode**: Full orchestration
- **Routing rationale**: Phase E 是"可定制化"的最终 Phase，涉及模板系统 + adapter 矩阵 + 5 个内置 workflow 包 + 前端编辑器

## Current Analysis

### Phase E 精确范围（v3.11 锁定）

**做**：
1. 后端：`workflow_templates.metadata_json.teamWorkflow` 完整 schema（Zod + TypeScript）
2. 后端：模板分发机制（overrides + core 两层，运行时按优先级解析）
3. 后端：`TeamRoleAdapter` 接口定义 + 5 个内置 adapter（reception/pm1/pm2/executor/reviewer）
4. 后端：模板驱动的 handoff 流程（替代 Phase B-D 的硬编码 runner 逻辑）
5. 后端：workflow 包 CRUD API（`GET/POST/PUT/DELETE /team/workflows`）
6. 前端：模板编辑器（让用户自定义 step / promptTemplate / handoffs）
7. 前端：workflow 包选择器（创建 session 时选择 workflow 包）
8. 前端：adapter 配置面板（右侧设置 Tab 中配置各层 adapter）
9. 内容：quick-ask workflow 包（只走 a→b）
10. 内容：research-team workflow 包（a→b→c→e/f/g，跳过 d）
11. 内容：build-team workflow 包（完整五层 a→b→c→d→e/f/g）
12. 内容：review-team + spike-team workflow 包

**不做**：
- presets / extensions 两层（等社区生态成熟再加）
- 完整 marketplace（先支持私有团队复用）
- hermes 的 cron / curator / kanban

### 依赖分析（DAG）

```
Stream 1 (后端模板系统)：
  T-01 teamWorkflow schema 定义
  T-01 完成后 → T-02 模板分发机制（overrides + core）
  T-02 完成后 → T-04 模板驱动 handoff 流程
  T-02 完成后 → T-05 workflow CRUD API

Stream 2 (后端 adapter)：
  T-01 完成后 → T-03 TeamRoleAdapter 接口 + 5 个内置 adapter

Stream 3 (前端)：
  T-05 完成后 → T-06 模板编辑器
  T-05 完成后 → T-07 workflow 包选择器
  T-03 完成后 → T-08 adapter 配置面板

Stream 4 (内容，无依赖)：
  T-09 quick-ask 包
  T-10 research-team 包
  T-11 build-team 包
  T-12 review-team + spike-team 包
```

## Solution Design

### 技术方案

1. **teamWorkflow schema**：Zod schema 定义 workflow 的 steps / handoffs / gates / bindings
2. **模板分发**：运行时按 `overrides → core` 优先级查找模板；overrides 存 DB（用户自定义），core 为内置包
3. **TeamRoleAdapter**：接口定义 `resolve(role, ctx) → { agentImplKey, provider, promptTransform, contextBuilder }`；5 个内置实现
4. **模板驱动 handoff**：watcher claim handoff 后，读取当前 workflow 模板的 step 定义 → 按 step.handoffs 决定下一步 → 替代硬编码 pm1-runner / pm2-runner
5. **workflow CRUD API**：Fastify 路由，存入 `workflow_templates` 表的 `metadata_json`
6. **模板编辑器**：前端可视化编辑 workflow steps（拖拽排序 / 编辑 promptTemplate / 配置 handoffs）
7. **workflow 包选择器**：创建 session 时选择预置包或自定义 workflow
8. **5 个内置包**：JSON 配置文件，定义不同的 step 组合

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模板驱动替代硬编码可能破坏现有流程 | feature flag 保护，先并行跑模板驱动 + 硬编码，验证一致后切换 |
| 模板编辑器复杂度高 | MVP 先做 JSON 编辑器 + 预览，可视化拖拽延后 |
| 5 个内置包的 step 定义可能不够灵活 | 允许用户 fork 内置包后自定义 |

## Implementation Plan

### Phase 1: 后端模板系统（Stream 1）
- [x] T-01: teamWorkflow schema 定义（Zod + TypeScript 接口）
- [x] T-02: 模板分发机制（overrides + core 两层，运行时优先级解析）
- [x] T-04: 模板驱动 handoff 流程（替代硬编码 runner，feature flag 保护）
- [x] T-05: workflow CRUD API（GET/POST/PUT/DELETE /team/workflows）

### Phase 2: 后端 adapter（Stream 2，依赖 T-01）
- [x] T-03: TeamRoleAdapter 接口 + 5 个内置 adapter

### Phase 3: 前端（Stream 3，依赖 T-03/T-05）
- [x] T-06: 模板编辑器（JSON 编辑 + 预览 + step 配置）
- [x] T-07: workflow 包选择器（创建 session 时选择）
- [x] T-08: adapter 配置面板（右侧设置 Tab）

### Phase 4: 内容（Stream 4，无依赖，可最早并行）
- [x] T-09: quick-ask workflow 包（只走 a→b）
- [x] T-10: research-team workflow 包（a→b→c→e/f/g）
- [x] T-11: build-team workflow 包（完整五层）
- [x] T-12: review-team + spike-team workflow 包

## Parallel Execution Plan

**Wave 1（无依赖，立即并行）**：
- T-01（schema 定义）
- T-09 + T-10 + T-11 + T-12（内容包）

**Wave 2（依赖 T-01）**：
- T-02（模板分发）+ T-03（adapter）

**Wave 3（依赖 T-02）**：
- T-04（模板驱动 handoff）+ T-05（CRUD API）

**Wave 4（依赖 T-03/T-05）**：
- T-06 + T-07 + T-08（前端三件套，并行）

## 验收标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过（新增测试覆盖 T-01/T-02/T-03/T-04）
- [ ] teamWorkflow schema 能正确校验 5 个内置包
- [ ] 模板分发：overrides 优先于 core
- [ ] TeamRoleAdapter：5 个内置 adapter 能正确 resolve
- [ ] 模板驱动 handoff：feature flag 开启后，workflow 按模板定义流转
- [ ] workflow CRUD API：能创建/读取/更新/删除自定义 workflow
- [ ] 前端模板编辑器：能编辑 step 配置并保存
- [ ] 前端 workflow 选择器：创建 session 时能选择不同 workflow 包
- [ ] 5 个内置包全部可用且流程正确

## Notes

- 估时：4-6 周（Phase E 是最后一个 Phase，完成后团队架构全部落地）
- T-04 是核心复杂点——需要把 pm1-runner / pm2-runner 的硬编码逻辑抽象为模板驱动
- feature flag 保护：模板驱动与硬编码并行跑，验证一致后再切换
- 完成 Phase E 后，整个五层架构从"硬编码"升级为"可定制"
- Memory sync: pending
