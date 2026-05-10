# 260509 — P3 session warping 设计评估（仅调研，不实施）

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 3。

## Task Overview

调研 opencode `22a4a9df8` (#25768) + `3c4b4d5fa` (#26190) 引入的 **session warping** 能力（把会话连同未提交的文件改动 warp 到另一个 workspace），评估对 OpenAWork 的可行性、收益、与 .NET 双轨迁移的冲突，**只产出 ADR / 评估文档，不直接实现**。

## Background

### 什么是 session warping

opencode 的实现里：

- 用户在一个 workspace 跑会话 A，做了一堆未 commit 的修改
- 用户决定继续这个会话但希望换到另一个 workspace（已存在或新建）
- "Warp" 操作把会话的：
  - 完整消息历史
  - 当前 workspace 的脏文件 diff（仅未 commit 部分）
  - 关键 metadata（agent、模型、工具偏好）
  
  一并搬过去
- 落地需要 `EventSequenceTable` 增 `owner_id` 字段，使 sync 层在跨实例 replay 时识别"这是 warp 来的会话"，避免 idempotency 冲突

### 价值

- 多 workspace 用户体验：不必把改动手动 stash/复制
- 团队协作：把一个调研会话从某个分支 workspace 转交到另一个上下文继续
- 长会话治理：会话历史可继承，避免重新铺垫上下文

### 风险

- OpenAWork 的会话/workspace 模型是 1:1 强绑定，warp 需要打破
- `.NET 10` Wave 2 当前正在迁 sessions / event_log / runtime_threads，warping 直接影响 schema
- 文件 diff 的"原 workspace"可能已不存在，需定义错误恢复

## Current Analysis

### OpenAWork 相关位置

- `services/agent-gateway/src/session-workspace-resolution.ts`
- `services/agent-gateway/src/session-workspace-metadata.ts`
- `services/agent-gateway/src/session-shared-access.ts`
- `services/agent-gateway/src/workspace-config.ts`
- 后端 `.NET` event_sequences 表（参考 `260419-net10-wave2-event-log-溯源层迁移`）

### opencode 改动统计（参考用）

```
migration/20260504145000_add_sync_owner/migration.sql   +1
control-plane/workspace.ts                              ±281
server/routes/control/workspace.ts                      ±74
server/routes/instance/httpapi/handlers/workspace.ts    ±15
server/routes/instance/sync.ts                          +47
sync/event.sql.ts                                       +1
sync/index.ts                                           ±34
test/control-plane/workspace.test.ts                    ±506
sdk/js/src/v2/gen/types.gen.ts                          ±631
```

工程量大，且核心是 sync owner_id 字段。

## Solution Design

### 输出物

不写代码。**只产出**：

1. `.agentdocs/workflow/done/260509-session-warping-ADR.md`：
   - 是否要做？
   - 阶段化路线（最小→完整）
   - 与 .NET Wave 2 的依赖与排期建议
2. 在 `index.md` 的 `Architecture Decisions` 段记录决议

### 评估维度

| 维度 | 评估问题 |
|---|---|
| 用户需求强度 | 现有用户反馈中是否出现过"想跨 workspace 继续会话"？ |
| 替代方案 | "复制会话 + 手动 stash/apply diff" 是否够用？ |
| 数据模型成本 | event_sequences 加 owner_id 对 .NET 迁移的额外切片量级 |
| Sync 复杂度 | 跨 workspace replay 是否会与现有 idempotency 冲突 |
| UI 成本 | 桌面 / Web 都要加 "warp 到…" 入口与目标 workspace 选择 |
| 错误恢复 | 原 workspace 不存在 / target workspace 有冲突文件 时的策略 |
| 安全 | 跨 workspace 的文件 diff 是否需要二次权限确认 |

### 调研步骤

1. 通读 opencode `22a4a9df8` / `3c4b4d5fa` 全 diff（约 1500 行非生成代码）
2. 列出 OpenAWork 当前会话 schema 中阻碍 warping 的字段
3. 对照 `.NET` Wave 2 已计划切片，标出 owner_id 等字段插队成本
4. 给 1 / 2 / 3 三档实施粒度的工程估时
5. 给最终建议：实施 / 部分实施 / 暂不做 + 理由

## Complexity Assessment

- 原子步骤：5（评估流程） → +2
- 并行流：单人调研 → 0
- 模块：仅文档 → 0
- 单步 >5 min：是（通读 1500 行 diff） → +1
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：4 → Full orchestration**（调研类，需要 ADR 持久化）
- **Routing rationale**：调研类任务收益依赖结论质量，必须持久化便于后续决策回看

## Implementation Plan

### Phase 1: 阅读 ✅
- [x] T-WARP-01: 通读 opencode warping 相关 diff 清单（见 ADR "核心改动"），关键是 `EventSequenceTable.owner_id`
- [x] T-WARP-02: OpenAWork 关键文件扫过 — `session-workspace-resolution.ts`（弱绑定）、`db.ts:850` event_sequences 无 owner_id、`session-shared-access.ts` 不涉及跨 workspace

### Phase 2: 对照 ✅
- [x] T-WARP-03: OpenAWork 的 session↔workspace 是**弱绑定**（`metadata_json.workingDirectory` + 父 session 继承链），切换在 schema 层零成本
- [x] T-WARP-04: `.NET` Wave 2 event_log/sequences 已完成（`260419-net10-wave2-event-log-溯源层迁移` T-01..T-06 全部 ✅），阶段 2 加 `owner_id` 需独立 migration，建议排到 Wave 3+

### Phase 3: 写 ADR ✅
- [x] T-WARP-05: 三档粒度工程估时（0: 2–3 天 / 1: 5–7 天 / 2: 2 周+）
- [x] T-WARP-06: **结论：阶段 0 轻量切换 workingDirectory 推荐，但不在本批实施**；阶段 1/2 暂不列入路线图
- [x] T-WARP-07: ADR 归档到 `.agentdocs/workflow/done/260509-session-warping-ADR.md`，index.md 登记

## Verification

ADR 完整性 checklist：

- [x] 用户场景描述 3 个（多 workspace 继续、scout 结论转移、长会话治理）
- [x] schema 改动列表（TS `event_sequences` 现状 + `.NET` `EventSequenceRecord` 现状，均无 `owner_id`）
- [x] 三档工程估时（0: 2–3 天 / 1: 5–7 天 / 2: 2 周+）
- [x] 与 .NET Wave 2/Wave 3 的兼容路径
- [x] 明确结论："阶段 0 推荐，但不在本批落实施；阶段 1/2 推迟"
- [x] 与 P1-SCOUT / P2-DELEGATE / P2-WEBSEARCH / Wave 2 的依赖说明

## Risks

- **过度乐观**：opencode 的 1500 行变更不要被低估，OpenAWork 还涉及 web/桌面 UI
- **决策延后成本**：如果决定做，越晚做与 .NET 迁移冲突越多
- **决策做了但用户不用**：先验证用户需求再投入

## Notes

- 本工作流不写产线代码
- 完成后无论决议如何，archive 到 `done/`
- 若决议为"实施"，再单独建 P1 工作流（不在本批次）
