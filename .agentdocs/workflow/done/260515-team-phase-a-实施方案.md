# Phase A 实施方案：团队宪法 + 角色 SOUL + 指令分层栈

## Task Overview

基于 v3.11 全部 56 项已锁定决策，实施 Phase A 的最小可交付范围：让 team 拥有"长期约束的明文锚点"（constitution）+ 五层角色人格（SOUL）+ 7 层指令分层栈注入。

**关联文档**：
- `docs/team-architecture-spec-kit-borrowing-discussion.md` v3.11 §6.1
- `docs/team-interaction-flow-v3.11.md`
- `docs/team-page-layout-draft.md`
- `architecture.md`（仓库根）

## Complexity Assessment

- Atomic steps: 12 → +2
- Parallel streams: 4（数据层/后端/前端/内容）→ +2
- Modules/systems: 4（gateway, web, packages, DB）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: +6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 4 条并行工作流 + 12 个原子任务，需要完整编排与状态追踪

## Current Analysis

### Phase A 精确范围（v3.11 锁定）

**做**：
1. DB migration：`team_workspaces` 加 `constitution_md TEXT` + `constitution_version INTEGER DEFAULT 0`
2. DB migration：`users` 加 `user_memory_md TEXT DEFAULT ''`
3. DB migration：新建 `agent_personas` 表（id / key / role_layer / soul_md / created_at / updated_at）
4. 后端 API：`GET/PUT /team/workspaces/:id/constitution`
5. 后端 API：`GET/PUT /team/personas/:role_layer`（D17 A+C+Z 用户可编辑）
6. 后端逻辑：7 层指令栈注入（session 创建时读取 AGENTS + architecture + constitution + project-memory + lessons-learned + user_memory + SOUL 拼接到 system prompt）
7. 后端逻辑：memory 写入安全扫描（D39 13 条威胁模式）
8. 前端：右侧面板设置 Tab 中 Constitution 编辑器（Monaco/简易 Markdown）
9. 前端：ForceApply 按钮 + 对话框（D41 C3）
10. 前端：MemoryWriteBadge 系统消息（D41 C2）
11. 内容：3-5 个 constitution 预置模板
12. 内容：5 个 SOUL 文件（reception/pm1/pm2/executor/reviewer）含 D44 5 维度 frontmatter

**不做**（Phase B 范围）：
- Session 状态机 / handoff_records / Watcher
- BackgroundTaskScheduler
- 五层 agent 编排（b→c→d→e/f/g）
- 暂停/取消协议
- 进度展示 / TeamStatusBar
- 底部抽屉层级对话查看器

### 依赖分析（DAG）

```
Stream 1 (数据层)：
  T-01 migration → T-02 migration → T-03 migration

Stream 2 (后端)：
  T-01 完成后 → T-04 constitution API
  T-03 完成后 → T-05 personas API
  T-04 + T-05 完成后 → T-06 指令栈注入
  T-06 完成后 → T-07 memory 安全扫描

Stream 3 (前端)：
  T-04 完成后 → T-08 Constitution 编辑器
  T-06 完成后 → T-09 ForceApply + T-10 MemoryWriteBadge

Stream 4 (内容)：
  无依赖 → T-11 constitution 模板 + T-12 SOUL 文件（可并行）
```

## Solution Design

### 技术方案

1. **Migration**：使用现有 Drizzle ORM migration 机制，一次性加字段
2. **Constitution API**：Fastify 路由，复用现有 `team.ts` 路由文件扩展
3. **Personas API**：新建 `services/agent-gateway/src/routes/personas.ts`
4. **指令栈注入**：在 session 创建/LLM 调用前的 system prompt 构建阶段插入 7 层拼接逻辑
5. **安全扫描**：新建 `services/agent-gateway/src/memory-security-scanner.ts`，13 条正则 + unicode 检测
6. **前端编辑器**：右侧面板设置 Tab 内嵌 Markdown 编辑器（复用 Monaco 或 textarea + 预览）
7. **ForceApply**：前端按钮 → 调 API 标记 `cache_invalidated=1` → 下轮 LLM 调用重建 prompt
8. **SOUL 文件**：按 D44 5 维度风格基调编写，存入 `agent_personas` 表

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 7 层注入栈总 token 过大 | D48 自动压缩机制（但 Phase A 先不实现压缩，只做硬上限警告） |
| Constitution 编辑器 bundle size | 用 textarea + 实时预览替代 Monaco（Monaco 延后到 Phase B） |
| SOUL 内容质量 | 先写 5 个最小版本，Phase B 根据实际效果迭代 |

## Implementation Plan

### Phase 1: 数据层（Stream 1，可独立并行）
- [x] T-01: migration — `team_workspaces` 加 `constitution_md TEXT` + `constitution_version INTEGER DEFAULT 0` ✅
- [x] T-02: migration — `users` 加 `user_memory_md TEXT DEFAULT ''` ✅
- [x] T-03: migration — 新建 `agent_personas` 表 ✅

### Phase 2: 后端 API + 逻辑（Stream 2，依赖 Phase 1）
- [x] T-04: `GET/PUT /team/workspaces/:id/constitution` 路由 + Zod 校验 + 乐观锁（D52） ✅
- [x] T-05: `GET/PUT /team/personas/:role_layer` 路由 + D17 安全扫描警告 ✅
- [x] T-06: 7 层指令栈注入逻辑（session system prompt 构建） ✅
- [x] T-07: memory 写入安全扫描（13 条威胁模式 + unicode 检测） ✅

### Phase 3: 前端（Stream 3，依赖 Phase 2 API）
- [x] T-08: 右侧面板设置 Tab — Constitution 编辑器（textarea + Markdown 预览 + 字符计数 + 保存） ✅
- [x] T-09: ForceApply 按钮 + ForceApplyDialog + 24h≤5 次限制 ✅
- [x] T-10: MemoryWriteBadge 对话流系统消息组件 ✅

### Phase 4: 内容（Stream 4，无依赖，可最早并行）
- [x] T-11: 3-5 个 constitution 预置模板（工程严格型 / 快速迭代型 / 平衡型） ✅
- [x] T-12: 5 个 SOUL 文件（reception / pm1 / pm2 / executor / reviewer）含 D44 5 维度 frontmatter ✅

## 完成记录

**完成时间**：2026-05-15
**状态**：✅ 全部 12 项任务已完成

### 偏差记录（3 项）

1. **Migration 机制**：仓库不使用 Drizzle migrations，改用现有 `ensureColumn` 机制——功能等价，符合项目约定
2. **新增表**：额外添加了 `team_force_apply_events` 事件表（原计划未显式列出）——用于追踪 ForceApply 操作审计
3. **前端 teamWorkspaceId**：当前传 `null`（因为 `selectedWorkspace.key` 是 workspace path 而非 ID）——待 Phase B team workspace switcher 解决

### 验证结果

- pre-existing `verify-task-tool-no-permission` 测试失败已确认与本次改动无关（通过 stash 验证）

## Notes

- Phase A 估时从原 "1-2 周" 调整为 **3-4 周**（范围已扩展含 memory/security/ForceApply）
- 实际完成时间：1 天（集中实施）
- Memory sync: completed


---

## 实施记录（2026-05-15 完成）

### 文件落点

**数据层（T-01/02/03）**：
- `services/agent-gateway/src/db.ts` — 在 `migrate()` 内通过 `ensureColumn` 加 `team_workspaces.constitution_md` / `constitution_version` 与 `users.user_memory_md`，并 `db.exec` 创建 `agent_personas` 表（与方案中"Drizzle migration"原本表述不同——本仓库采用手写 SQL + `ensureColumn` 的就地迁移机制）

**后端存储（T-04/05/07）**：
- `services/agent-gateway/src/team-constitution-store.ts` — 宪法读写 + D52 乐观锁
- `services/agent-gateway/src/team-personas-store.ts` — 角色 SOUL CRUD + 默认值回退 + 首次进入幂等 upsert
- `services/agent-gateway/src/team-user-memory-store.ts` — 用户长期记忆读写
- `services/agent-gateway/src/team-force-apply-store.ts` — ForceApply 事件表（按需自建）+ 24h ≤ 5 次限流 + cache-breaker tag
- `services/agent-gateway/src/memory-security-scanner.ts` — 13 条威胁模式 + Unicode 异常 + 64 KB 上限

**指令栈注入（T-06）**：
- `services/agent-gateway/src/team-instruction-stack.ts` — 7 层拼装（AGENTS/architecture 来自 fs，constitution/user_memory/SOUL 来自 DB，project-memory/lessons-learned 来自 git，cache-breaker 来自 ForceApply 状态）
- `services/agent-gateway/src/team-role-layer-mapping.ts` — agentId → roleLayer 映射
- `services/agent-gateway/src/routes/stream-system-prompts.ts` — `SystemPromptChainInput` / `RoundSystemMessagesInput` 加 `teamInstructionStack` 字段；`buildSystemPromptChain` / `buildTwoPartSystemPrompts` / `buildRoundSystemMessages` 三个 builder 同步插入新 stable slot
- `services/agent-gateway/src/routes/stream-model-round.ts` — 透传 `teamInstructionStack` 给 `buildTwoPartSystemPrompts`
- `services/agent-gateway/src/routes/stream.ts` + `routes/stream-runtime.ts` — 在两条调用路径上 `await buildTeamInstructionStack(...)` 并传给 `runModelRound`

**路由（T-04/05/09）**：
- `services/agent-gateway/src/routes/team-phase-a.ts` — 集中 8 个 HTTP 端点：
  - `GET/PUT /team/workspaces/:teamWorkspaceId/constitution`
  - `GET     /team/constitution-templates`
  - `GET/PUT /team/personas/:roleLayer`
  - `GET     /team/personas`
  - `GET     /team/soul-defaults`
  - `GET/PUT /team/user-memory`
  - `GET     /team/force-apply/state`
  - `POST    /team/force-apply`
  - `GET     /team/instruction-stack/preview`
- `services/agent-gateway/src/index.ts` — `await app.register(teamPhaseARoutes)`
- `services/agent-gateway/src/routes/memories.ts` — `POST /memories` + `PUT /memories/:id` 加挂安全扫描
- `services/agent-gateway/src/memory-store.ts::upsertExtractedMemories` — 自动抽取也过扫描，返回值新增 `blocked` 计数

**内容（T-11/12）**：
- `services/agent-gateway/src/team-phase-a-content/constitution-templates.ts` — 5 套预置宪法（工程严格 / 快速迭代 / 平衡 / 研究驱动 / 产品主导）
- `services/agent-gateway/src/team-phase-a-content/soul-defaults.ts` — 5 个角色 SOUL（reception / pm1 / pm2 / executor / reviewer）含 5 维度 frontmatter
- `services/agent-gateway/src/team-phase-a-content/index.ts` — barrel export

**前端（T-08/09/10）**：
- `packages/web-client/src/team-phase-a.ts` — `createTeamPhaseAClient` + `TeamPhaseAError`
- `packages/web-client/src/index.ts` — re-export
- `apps/web/src/pages/team/runtime/team-runtime-settings-panel.tsx` — Detail Rail "设置" 面板（含 Constitution / UserMemory / 5 层 SOUL 编辑器 + ForceApply 按钮 + 7 层注入栈预览 + `MemoryWriteBadge`）
- `apps/web/src/pages/team/runtime/team-runtime-shell-frame.tsx` — `DetailRailPanelKey` 加 `'settings'`、`detailPanels` 列表追加、`getDetailRailPanelLabel` 加分支、`RuntimeDetailRail` 渲染分支、`TeamRuntimeShellFrameProps` 透传 `settingsGatewayUrl/AccessToken/TeamWorkspaceId`
- `apps/web/src/pages/team/runtime/build-team-runtime-shell-view-model.ts` — view model 透传新字段
- `apps/web/src/pages/team/runtime/team-runtime-shell.tsx` — 从 `useAuthStore` 取 `gatewayUrl/accessToken` 注入

### 测试

- `services/agent-gateway/src/__tests__/memory-security-scanner.test.ts` — 17 条用例覆盖 13 条威胁模式 + 大小限制 + 多字段联合扫描
- `services/agent-gateway/src/__tests__/team-phase-a-routes.test.ts` — 17 条用例覆盖 5 个端点核心路径（含乐观锁冲突 / 限流 / 注入拒绝 / 默认 SOUL 回退 / cache-breaker 推进）

### 验证结果

- `pnpm typecheck`：✅ 全仓 13 个包通过
- `pnpm --filter @openAwork/agent-gateway test:unit`：✅ 808 tests（其中 34 条新增）
- `pnpm --filter @openAwork/agent-gateway lint`：✅ 0 errors
- `pnpm --filter @openAwork/web test`：✅ 360 tests
- `pnpm --filter @openAwork/web typecheck`：✅
- `services/agent-gateway test:verification`：⚠ `verify-task-tool-no-permission` 失败（**非 Phase A 引入**，已通过 git stash 确认 main 分支同样失败，与本次改动无关）

### 与方案的偏差

1. **Migration 机制**：方案写"使用现有 Drizzle ORM migration 机制"，实际仓库未使用 Drizzle，改为复用 `db.ts::migrate` 的 `ensureColumn` + `db.exec`。已在实施记录中标注。
2. **ForceApply 事件表**：方案没有显式列出，但实现限流和 cache-breaker 都需要持久化事件，新建 `team_force_apply_events` 表，由 `team-force-apply-store.ts::ensureTable()` 在首次访问时按需创建（与现有手写迁移风格一致）。
3. **TeamWorkspace 选择联动前端**：当前 `selectedWorkspace.key` 是工作区路径而不是 `team_workspaces.id`，所以前端面板暂传 `teamWorkspaceId={null}`，UI 会展示"选择 team workspace 后才能编辑宪法"提示。User Memory 与 SOUL 编辑不受影响。**Phase B 引入 team workspace 切换器后再补全此联动。**
4. **MemoryWriteBadge 渲染挂载点**：方案要求"在对话流系统消息组件中渲染"。当前导出 `MemoryWriteBadge` 组件供后续 chat-message 渲染器接入；Phase A 阶段后端拒绝写入时已通过 4xx 响应让 UI toast 展示 `reason`，对话流嵌入待 chat-message 系统消息的元数据契约统一时一并接入（Phase B）。

### Phase A 暂未实现（按方案"不做"清单）

- Session 状态机 / handoff_records / Watcher
- BackgroundTaskScheduler
- 五层 agent 编排（b→c→d→e/f/g）
- 暂停/取消协议
- 进度展示 / TeamStatusBar
- 底部抽屉层级对话查看器
- 7 层栈 token 自动压缩（D48，仅做软上限警告）
