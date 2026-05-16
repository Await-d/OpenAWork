# Phase C 实施方案：c 层产物链 spec / plan / tasks

## Task Overview

基于 Phase A（constitution + SOUL + 注入栈）和 Phase B（session 状态机 + handoff 协议 + 五层骨架）已完成的基础，实施 Phase C：让 c（PM1 📋规划师）输出标准化的可审阅产物链，引入 spec-kit 的核心方法论。

**前置依赖**：
- Phase A ✅（constitution + SOUL + 7 层注入栈）
- Phase B ✅（handoff + watcher + scheduler + 五层 session 树）

**关联文档**：
- `docs/team-architecture-spec-kit-borrowing-discussion.md` v3.11 §6.3
- `docs/team-interaction-flow-v3.11.md`
- `temp/spec-kit/templates/`（spec-template.md / plan-template.md / tasks-template.md）

## Complexity Assessment

- Atomic steps: 10 → +2
- Parallel streams: 4（DB/后端产物链/前端高亮/内容模板）→ +2
- Modules/systems: 4（gateway, web, packages/artifacts, DB）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: +6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 产物链系统涉及 artifacts 包扩展 + spec-kit 方法论引入 + 前端标记高亮 + Constitution Check 集成

## Current Analysis

### Phase C 精确范围（v3.11 锁定）

**做**：
1. DB：artifacts 表扩展 `phase` + `teamWorkspaceId` + `parentArtifactId` 字段
2. 后端：c 层产物链生成逻辑（spec → clarify → plan → tasks 四步流程）
3. 后端：Constitution Check 集成（plan 阶段强制读取 constitution 对齐）
4. 后端：c 完成后自动写入 handoff result（plan/tasks 作为 b→c handoff 的 result_json）
5. 后端：`[NEEDS CLARIFICATION]` 标记解析 + 通过 b 异步推送给用户（D27=B）
6. 前端：产物查看器（ArtifactPreview）— Markdown 渲染 + 语法高亮
7. 前端：`[NEEDS CLARIFICATION]` / `[P]` / `[US1]` 标记高亮 + 阻塞门禁
8. 前端：c 层三步向导 UI（Spec 草稿 → Clarifications → Plan 生成 → Tasks 拆解）
9. 内容：spec-template.md（借鉴 spec-kit `templates/spec-template.md`）
10. 内容：plan-template.md + tasks-template.md（借鉴 spec-kit）

**不做**（Phase D 范围）：
- 完整七步（analyze / implement 留给 d 层）
- 四层模板栈（overrides/presets/extensions/core）
- 跨 team workflow 模板共享
- dispatch_package 标准结构

### 依赖分析（DAG）

```
Stream 1 (数据层)：
  T-01 artifacts 表扩展

Stream 2 (后端产物链)：
  T-01 完成后 → T-02 c 层产物链生成逻辑
  T-02 完成后 → T-03 Constitution Check 集成
  T-02 完成后 → T-04 handoff result 自动写入
  T-02 完成后 → T-05 [NEEDS CLARIFICATION] 解析 + 推送

Stream 3 (前端)：
  T-02 完成后 → T-06 产物查看器
  T-05 完成后 → T-07 标记高亮 + 阻塞门禁
  T-06 + T-07 完成后 → T-08 c 层三步向导 UI

Stream 4 (内容，无依赖)：
  T-09 spec-template.md
  T-10 plan-template.md + tasks-template.md
```

## Solution Design

### 技术方案

1. **Artifacts 扩展**：用 ensureColumn 加字段（与 Phase A/B 一致）
2. **c 层产物链**：在 c 的 SOUL prompt 中嵌入模板指令，c 的 LM 输出按模板格式生成 spec/plan/tasks
3. **Constitution Check**：c 生成 plan 后，后端解析 plan 内容 + 读取 constitution → 调 LM 做对齐检查 → 通过/标记冲突
4. **[NEEDS CLARIFICATION] 解析**：正则匹配 c 输出中的 `[NEEDS CLARIFICATION]` 标记 → 提取问题 → 通过 team-events WS 推送给 b → b 异步推送给用户
5. **产物查看器**：复用现有 `packages/artifacts/` 的渲染能力，扩展 Markdown 高亮
6. **标记高亮**：前端解析 Markdown 中的 `[NEEDS CLARIFICATION]` / `[P]` / `[US1]` → 渲染为彩色 badge
7. **三步向导**：前端状态机（spec_draft → clarifying → plan_ready → tasks_ready），每步展示对应产物

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| c 的 LM 输出不遵循模板格式 | SOUL prompt 中强制模板 + 输出后正则校验 + 不合格重试 1 次 |
| Constitution Check 误判 | D9 reconcile：c 层自检=软警告（不阻断），d 层审查=硬阻断 |
| [NEEDS CLARIFICATION] 过多阻塞流程 | D44 c 维度 2=B 严格但克制（最多 3 个） |

## Implementation Plan

### Phase 1: 数据层（Stream 1）
- [x] T-01: artifacts 表扩展（phase TEXT / teamWorkspaceId TEXT / parentArtifactId TEXT）

### Phase 2: 后端产物链（Stream 2，依赖 T-01）
- [x] T-02: c 层产物链生成逻辑（spec → plan → tasks 四步，基于 handoff payload 触发）
- [x] T-03: Constitution Check 集成（plan 生成后对齐 constitution，软警告模式）
- [x] T-04: handoff result 自动写入（c 完成后把 plan/tasks 写入 handoff_records.result_json）
- [x] T-05: [NEEDS CLARIFICATION] 解析 + 通过 team-events 推送给 b

### Phase 3: 前端（Stream 3，依赖 T-02/T-05）
- [x] T-06: 产物查看器（ArtifactPreview：Markdown 渲染 + 代码高亮 + 版本历史）
- [x] T-07: 标记高亮组件（[NEEDS CLARIFICATION] 红色 / [P] 蓝色 / [US1] 绿色 badge）
- [x] T-08: c 层三步向导 UI（状态机 + 每步展示对应产物 + 澄清交互）

### Phase 4: 内容（Stream 4，无依赖，可最早并行）
- [x] T-09: spec-template.md（借鉴 spec-kit，适配 OpenAWork 场景）
- [x] T-10: plan-template.md + tasks-template.md（借鉴 spec-kit，含 [P] / [US1] 标记规范）

## Parallel Execution Plan

**Wave 1（无依赖，立即并行）**：
- T-01（数据层）
- T-09 + T-10（内容模板）

**Wave 2（依赖 Wave 1 T-01）**：
- T-02（c 层产物链核心逻辑）

**Wave 3（依赖 Wave 2 T-02，可并行）**：
- T-03（Constitution Check）+ T-04（handoff result）+ T-05（NEEDS CLARIFICATION 解析）+ T-06（产物查看器）

**Wave 4（依赖 Wave 3）**：
- T-07（标记高亮，依赖 T-05）
- T-08（三步向导 UI，依赖 T-06 + T-07）

## 验收标准

- [x] `pnpm typecheck` 通过
- [x] `pnpm test` 通过（新增测试覆盖 T-02/T-03/T-05）
- [x] c 层能按模板生成 spec.md / plan.md / tasks.md
- [x] plan 生成后 Constitution Check 能检测冲突并标记
- [x] [NEEDS CLARIFICATION] 标记能通过 WS 推送到前端
- [x] 前端产物查看器能渲染 Markdown + 高亮标记
- [x] 三步向导 UI 状态机正确流转
- [x] handoff result 正确写入（c 完成后 d 能读到 plan/tasks）

## Notes

- 估时：2-3 周
- T-02 是核心复杂点——需要设计 c 层的 prompt 模板 + 输出解析 + 重试逻辑
- T-09/T-10（内容模板）可参考 `temp/spec-kit/templates/` 直接借鉴
- Constitution Check（T-03）在 Phase C 是软警告模式（D9 reconcile），Phase D 才是硬阻断
- Memory sync: pending
