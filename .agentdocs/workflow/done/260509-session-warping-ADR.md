# ADR — OpenAWork Session Warping（与 opencode #25768 / #26190 的对照决策）

- 日期：2026-05-09
- 作者：P3-WARP 调研批
- 状态：**Deferred — 采用阶段 0 轻量替代**
- 关联：`260509-p3-session-warping评估.md`（本 ADR 的源工作流）

## 摘要

opencode #25768 / #26190 引入了 session warping：把一整个会话（消息历史 + 当前 workspace 未提交的文件 diff + agent/模型 metadata）"搬"到另一个 workspace。落地包含 ~1500 行非生成代码，核心是 sync 层的 `EventSequenceTable.owner_id` 字段，使跨 instance replay 时能识别"这是 warp 来的会话"以避免 idempotency 冲突。

**OpenAWork 当前不复刻这一能力**。理由：
1. OpenAWork 的 session↔workspace 是**弱绑定**（`metadata_json.workingDirectory` + 父 session 继承链），切换 workspace 不需要 schema 改动
2. OpenAWork 是**单 instance gateway**，没有 multi-instance sync，因此 `owner_id` 的核心价值（跨 instance idempotency）不适用
3. 没有明确用户反馈支撑这项投入
4. `.NET` Wave 2 的 `event_log / event_sequences` 迁移已稳定（`260419-net10-wave2-event-log-溯源层迁移` T-01..T-06 全部 ✅），在此之上再加 `owner_id` 会是一刀独立 migration 成本

**推荐方案**：落阶段 0 轻量"切换 workspace"（只改 metadata.workingDirectory、不搬 diff），工程量 2–3 天。阶段 1/2 待有明确用户需求后重启评估。

## 用户场景

### 场景 A — 多 workspace 继续同一调研
用户在 `~/projects/app-v1` 跑了一个"了解 Bun 打包行为"的调研会话，随后切到 `~/projects/app-v2` 想继续往下做。目前流程：新建会话，手动粘回上下文，或从 `/sessions` 打开旧会话但工具调用仍落在 app-v1 目录。

### 场景 B — 从调研分支 workspace 转交到主工作 workspace
Scout agent（P1-SCOUT）可能已在 `~/.cache/openawork/repos/...` 的克隆目录下做调研，结论要转到用户的真实 workspace 继续实施。这在 OpenAWork 里目前要靠复制结论的方式。

### 场景 C — 长会话治理：把一段对话历史"送"到新 workspace
用户想把一个快到 context 窗口的会话的摘要 + 关键工具调用"发射"到新 workspace 开工。但本场景用 `/handoff` slash command 已基本覆盖（生成结构化交接摘要 → 用户手动起新会话）。

## OpenAWork 现状盘点

### session↔workspace 绑定方式（弱）

- `@/home/await/project/OpenAWork/services/agent-gateway/src/session-workspace-resolution.ts:12-61`
- 未在表上建外键；`workingDirectory` 存在 `sessions.metadata_json` 里
- 父 session 没有直接 workspace → BFS 向上找父 session 继承

**意味着**：切换 session 的 workspace 在 schema 层是**零成本**，只需 `UPDATE sessions SET metadata_json = ?`。

### 事件溯源层（不支持跨 instance 幂等）

- SQLite `event_sequences`：`@/home/await/project/OpenAWork/services/agent-gateway/src/db.ts:850-853`
  ```sql
  CREATE TABLE IF NOT EXISTS event_sequences (
    aggregate_id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL DEFAULT 0
  )
  ```
- `.NET` 侧对齐：`@/home/await/project/OpenAWork/services/agent-gateway-dotnet/src/OpenAWork.Gateway.Persistence.EFCore/Entities/EventSequenceRecord.cs:1-8`
- 两边都**没有** `owner_id` 字段
- **OpenAWork 目前只有一个 gateway 进程承接 stream / replay**，没有 sync 层；opencode 之所以需要 `owner_id` 是因为他们支持 control-plane + 多 instance

### 未提交 diff 的暴露方式

- `workspaceReviewStatusTool` / `workspaceReviewDiffTool`（见 `tool-definitions.ts`）可以读出当前 workspace 的改动
- 没有现成的"把 diff apply 到另一个目录"流程；`apply_patch` 工具能 apply 单次 patch，但不覆盖跨 workspace 搬运语义

### 分享/权限层

- `@/home/await/project/OpenAWork/services/agent-gateway/src/session-shared-access.ts` 提供会话共享，但**是只读观察 + 访问控制**，不是 workspace 搬运

## 与 .NET Wave 2 的兼容路径

| 阶段 | `.NET` 额外工作 | 合入窗口 |
|---|---|---|
| 阶段 0（切换 workingDirectory） | 无（不改 schema） | 任意 |
| 阶段 1（+ diff 转移 via artifact） | 无 schema 改动；artifact 系统已存在 | 任意 |
| 阶段 2（完整 opencode parity） | `event_sequences` 加 `owner_id` + 新 sync 层（控制面、instance sync 路由） | 需排到 Wave 3+（依赖 Wave 2 full replay 稳定） |

## 工程粒度估时

### 阶段 0：切换 session workingDirectory（**推荐，2–3 天**）

改动：
1. 新 API `PATCH /sessions/:id/workspace`（需 auth + workspace 存在性校验）
2. 前端：会话设置面板加 "切换 workspace" 下拉 + 警告（当前 workspace 未提交改动将保留在原目录）
3. **不搬任何文件**；用户决定如何处理脏文件
4. 单元 + 集成测试：workspace 存在性、父 session 继承链不被破坏

**工程估时**：2–3 天
**风险**：低（不改 schema，可随时 rollback metadata_json）

### 阶段 1：工作区切换 + diff 发射到 artifact（**中等，5–7 天**）

增量：
- 切换前用 `workspaceReviewDiffTool` 抓出当前脏 diff，写入新 artifact（`type: 'workspace-diff'`）
- 在目标 workspace 启动时提示用户"是否 apply artifact X"
- 跨 workspace 文件路径重写（`src/foo` in A ≠ `src/foo` in B，必须保守地按相对路径对齐）
- 二次权限：apply 前走 permission 流程

**风险中等**：diff 与目标 workspace 冲突时的 UX、路径重写边界条件。

### 阶段 2：完整 opencode parity（**高成本，2 周+**）

增量：
- `event_sequences` 加 `owner_id` TEXT NOT NULL，需 `.NET` + SQLite 双端 migration + 回填
- 新 sync 层：控制面 + instance 同步协议（目前 OpenAWork 无此层）
- SDK types 跟着变（sdk/js/src/v2/gen/types.gen.ts 镜像 opencode 的 ~600 行）
- 桌面 + Web UI 双端 warp 入口
- 跨 instance 一致性测试（单进程里模拟有限；生产需要双实例）

**风险高**：sync 协议设计复杂，.NET 迁移才稳定，不建议在 Wave 3 前动。

## 决策

**采纳阶段 0**，但**不在本批落实施**。将阶段 0 作为独立 workflow 在下一批启动（若用户需求验证通过）；阶段 1/2 **暂不列入路线图**。

### 触发重新评估的信号

- GitHub / 内部反馈里出现 ≥ 3 例"想跨 workspace 继续会话"
- 已有用户自行用 metadata 直改来解决（出现非官方脚本）
- `.NET` Wave 3 准备引入 sync / multi-instance（届时 `owner_id` 的成本被摊薄）

### 与 P0–P2 工作流的依赖

- P1-SCOUT 的 `scout` agent 默认在 repos 缓存目录运行，其结论转移到 workspace 属于阶段 1 场景，可先用 `/handoff` 绕开
- P2-DELEGATE 的 `session_id` 支持让子会话"回到"同一个 workspace，不冲突
- P2-WEBSEARCH 与本 ADR 无交集
- `260419-net10-wave2-event-log-溯源层迁移` 已完成，阶段 2 的 `owner_id` 不会破坏既有迁移路径

## 未决问题（留给阶段 0 实施时解）

1. 切换 workspace 是否允许"空 session"（无消息）？还是必须已有至少一条消息？
2. 父 session 的 workspace 是否随同切换？（建议**不随**，让用户显式）
3. permission 系统如何识别"这个会话是新 workspace 的"？`workspaceId` 在父继承链上需要断点
4. artifact 系统里的旧 workspace 引用要不要重写？建议保留不动（历史即真实）

## 归档

本 ADR 归档到 `.agentdocs/workflow/done/`；源工作流 `260509-p3-session-warping评估.md` 在 `index.md` 里标记完成。
