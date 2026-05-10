# 260509 — Skill 工作区选择集与 AI 推荐 Spec

> 让用户在「chat 页面的工作区（即 `metadata.workingDirectory`）」维度可控地选择启用哪些 skill，会话级可临时覆盖；并提供 AI 一键根据项目特征推荐勾选集，避免无关 skill 进入上下文造成噪声与 token 浪费。

## 1. 背景与现状

- skill 安装表：`installed_skills(skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)`，user 级隔离，`enabled` 是全局开关。
- BUILTIN_SKILLS：`packages/skills/src/builtins.ts` 中的 prompt-based 内置技能（`web-search`、`git-master`、`frontend-ui-ux`、`agent-browser`、`dev-browser`、`file-read`、`clipboard-read`），不入库。
- 本地发现：`services/agent-gateway/src/local-skills.ts` 扫描 workspace 下 `skill.yaml`，安装后落入 `installed_skills`，`source_id='local-workspace'`。
- 暴露给模型路径：
  - `services/agent-gateway/src/skill-tools.ts` 的 `skill` 工具按需注入 `descriptionForModel`。
  - `services/agent-gateway/src/task-agent-resolution.ts` 在子会话委派时，把 `load_skills` 中匹配 BUILTIN 的 skill 直接拼进 system prompt。
  - `services/agent-gateway/src/routes/capabilities.ts` 把 enabled installed_skills 的 manifest 输出给客户端做能力描述。
- chat 页面「工作区」= `session.metadata.workingDirectory`（一个目录路径），与 `team_workspaces` 表无关。

**问题**：所有已安装/本地 skill 一旦 `enabled=1`，对所有会话都可见；不同方向的 skill 同时进入工具列表与子会话委派，污染上下文，token 浪费且让模型判断变难。

## 2. 决策摘要（已与用户确认）

1. **作用域**：workspace + session 覆盖。workspace 维度持久化默认值，单会话可临时覆盖。
2. **过滤层级**：三段全做 —— skill 工具描述/执行收敛、选中 skill 可选 pinned 自动注入 system prompt、子会话委派受限。
3. **AI 推荐形态**：一键扫描 workspace 自动推荐（含 reason、pinned 建议、score）。
4. **默认策略**：BUILTIN 始终可用、不参与过滤；只过滤已安装/本地 skill。
5. **Pinned 注入时机**：仅会话首轮注入快照；中途修改 pinned 列表通过 toast 提示「下次新建会话生效」+ 可选「立即应用到当前会话」。
6. **迁移策略**：不做 backfill。`chat_workspace_skill_selections` 中无该 `(user, workspace_path)` 行时，运行时退化为「读 `installed_skills.enabled=1`」作为结果；用户保存过一次后才以选择集为准。

## 3. 数据模型

新增三张表，均落到 `services/agent-gateway/src/db.ts` 的 `migrate()` 中（保持幂等增量）：

```sql
CREATE TABLE chat_workspace_skill_selections (
  user_id        TEXT NOT NULL,
  workspace_path TEXT NOT NULL,          -- normalized abs path 或 '__default__'
  skill_id       TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  pinned         INTEGER NOT NULL DEFAULT 0,
  reason         TEXT,                   -- AI 推荐时的理由，UI 展示
  source         TEXT NOT NULL,          -- 'manual' | 'ai-recommend' | 'imported'
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, workspace_path, skill_id)
);
CREATE INDEX idx_cwss_user_path ON chat_workspace_skill_selections(user_id, workspace_path);

CREATE TABLE chat_session_skill_overrides (
  session_id TEXT NOT NULL,
  skill_id   TEXT NOT NULL,
  enabled    INTEGER NOT NULL,
  pinned     INTEGER,                    -- 可空：null 表示不覆盖 pinned
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, skill_id)
);

CREATE TABLE chat_workspace_skill_recommendations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  workspace_path  TEXT NOT NULL,
  signal_digest   TEXT NOT NULL,         -- 项目信号 + 候选 skill 集合 hash
  model_id        TEXT,
  result_json     TEXT NOT NULL,         -- {recommendations:[{skill_id,pinned,reason,score}], rejected:[{skill_id,reason}]}
  applied         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_cwsr_user_path_created ON chat_workspace_skill_recommendations(user_id, workspace_path, created_at DESC);
```

### Workspace path 规范化

- `normalizeWorkspacePath(raw)`：`path.resolve(raw)` → 去尾 `/` → 校验在 `WORKSPACE_ROOTS` 内（复用 `validateWorkspacePath`），越界拒绝。
- 会话 `metadata.workingDirectory` 为空时，scope key 退化为字符串 `'__default__'`，作为「全局默认」选择集。

## 4. 选择集解析

新增 `services/agent-gateway/src/skill-selection.ts`：

```ts
export type SkillOrigin =
  | 'workspace'           // 来自 chat_workspace_skill_selections 显式记录
  | 'workspace-fallback'  // 选择集为空时退化到 installed_skills.enabled
  | 'session-override'    // 被 session 覆盖
  | 'builtin';            // BUILTIN_SKILLS 永远可用

export interface EffectiveSkill {
  skillId: string;
  enabled: boolean;
  pinned: boolean;
  origin: SkillOrigin;
  reason?: string;
}

export function resolveEffectiveSkills(opts: {
  userId: string;
  workspacePath: string | null; // 调用方传 normalize 后的路径，null → '__default__'
  sessionId: string | null;
}): EffectiveSkill[];
```

解析顺序（必须严格按此顺序，测试覆盖）：

1. 取 `chat_workspace_skill_selections WHERE user_id = ? AND workspace_path = ?` 作为 base。
2. base 为空时，回退尝试 `workspace_path = '__default__'`；仍为空 → 走 fallback：`installed_skills WHERE user_id = ? AND enabled = 1` 全量映射为 `{enabled:true, pinned:false, origin:'workspace-fallback'}`。
3. 应用 `chat_session_skill_overrides(session_id)`：对应 `skill_id` 行覆盖 `enabled`，`pinned` 仅当非 null 时覆盖；origin 改为 `'session-override'`。
4. 追加 `BUILTIN_SKILLS`：`{enabled:true, pinned:false, origin:'builtin'}`，pinned 不允许通过选择集对 BUILTIN 设置（强约束：UI 不显示 pin 控件，写库前在路由层校验 reject）。

`installed_skills.enabled = 0` 的 skill **永远** 不会出现在结果中（user 级硬下线优先级最高，即便选择集里 enabled=1 也被拦在 SQL 层）。

## 5. 过滤注入点

### 5.1 skill 工具描述与执行（`skill-tools.ts`）

- `createSkillTool(sessionId, userId, opts?)` 增加可选 `effective?: EffectiveSkill[]`；调用方在工具组装阶段传入。
- `description` 动态拼接：
  ```
  Load an installed or built-in skill … Available skills:
  - <name> — <一行 description>
  - <name> — <一行 description>
  …
  ```
  仅列出 `enabled === true` 的 installed/local + 全部 BUILTIN。未在选择集中的 installed/local skill 不出现。
- `execute` 入口加越权拦截：参数 `name` 解析后若命中 installed/local 但不在 effective 集合 → `throw new Error('Skill not allowed in current workspace/session: ' + name)`；BUILTIN 不受限。
- `tool-definitions.ts` 中 `__tool-definitions__` 静态实例描述退化为通用文案（不依赖 effective），仅用于 schema 注册路径。

### 5.2 Pinned 自动注入 system prompt

新增 `services/agent-gateway/src/pinned-skills-prompt.ts`：

```ts
export function buildPinnedSkillsPromptSection(effective: EffectiveSkill[]): string | null;
```

- 仅取 `pinned && enabled && origin !== 'builtin'`。
- 拼成 `<skill_content name="…">…</skill_content>` 序列，与 `task-agent-resolution.injectBuiltinSkillInstructions` 风格一致。
- token 守门：估算（粗略 char/4）超过 `MAX_PINNED_SKILL_TOKENS = 6000` 时按 `score desc` 截断；附 `<!-- truncated N skills -->` 注释 + console.warn 一行。

注入位置：`services/agent-gateway/src/routes/stream.ts`（会话首次构建 system prompt 的路径）。**仅首轮注入**：
- 在写入 V2 storage 的 `SystemMessage` 时把 pinned section 一起持久化为初始系统消息内容的一部分，后续 replay/继续对话直接复用。
- 用户中途改 pinned → toast「下次新建会话生效」+「立即应用到当前会话」按钮（v1 实现：按钮触发往当前 session 追加一条 `system note` 形式的消息，提示模型新增/移除的 skill；v0 可只给提示文案，不做立即生效）。

### 5.3 子会话委派受限（`task-agent-resolution.ts`）

- `resolveDelegatedAgent(userId, input)` 内部解析 effective（用父 session 的 workspace path）。
- 过滤 `requestedSkills`：BUILTIN 直通，其它 skill 必须 `enabled === true` 才保留；被丢弃的 skill 名收集到返回值新字段 `droppedSkills: string[]`。
- 调用方（`routes/commands.ts` 等任务委派路径）在 `droppedSkills.length > 0` 时写一行 audit log（不阻断执行），方便观测。

### 5.4 capabilities 输出（`routes/capabilities.ts`）

- `installed_skills` 的 manifest 列表按当前 effective 过滤后再返回；BUILTIN 不变。
- 若调用方未提供 `workspacePath`/`sessionId`（例如纯 user 级 capabilities 探询），按「fallback：installed enabled」语义返回，与现状一致。

## 6. AI 一键推荐

新增 `services/agent-gateway/src/routes/skill-recommend.ts`：

### 6.1 `POST /api/skills/recommend`

请求体：
```json
{
  "workspacePath": "/abs/path",        // 必填，normalize+校验
  "sessionId": "…",                    // 可选，仅用于挑默认 model
  "force": false                        // 默认 false，true 时跳过 24h 缓存
}
```

后端流程：
1. 采样 workspace 信号（控制总字节 ≤ 8KB）：
   - `README.md` / `README.en.md`（前 4KB）
   - `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / `*.csproj` 头部（各 1.5KB 上限，最多 3 个）
   - 顶层目录列表（深度 2，最多 200 项，仅名字）
   - `.agentdocs/index.md`（前 2KB，存在则取）
   - 通过 `local-skills.discoverLocalSkills` 列出 workspace 内 `skill.yaml` id 列表
2. 构造候选集：
   - `installed_skills(user)` 中 `enabled = 1` 的全部 skill
   - 不主动联网拉 registry（保持决定式信号）
3. 计算 `signalDigest = sha1(stable-stringify({signals, candidateIds}))`。
4. 缓存查询：`chat_workspace_skill_recommendations` 24h 内同 digest 且 `force = false` → 直接返回 `{ fromCache: true, … }`。
5. LLM 调用：
   - 复用 user 默认 chat model resolver（与 image-generation 风格一致）。
   - JSON-mode；prompt 大致：
     ```
     你是一个 skill 选型助手。
     给定项目特征与可选 skill 清单，输出 JSON：
     {
       "recommendations": [
         { "skill_id": "...", "pinned": true|false, "reason": "...", "score": 0-100 }
       ],
       "rejected": [ { "skill_id": "...", "reason": "..." } ]
     }
     规则：
     - pinned=true 仅给「该项目主线必用」的 1-3 个 skill；其它 pinned=false 但 enabled=true。
     - 不在候选清单的 skill_id 一律不要输出。
     - 理由必须基于具体项目信号，不要泛化。
     - reason 控制在 80 个字符内。
     ```
   - 超时 60s。
6. 失败回退：本地启发式 —— 用 manifest `capabilities`/`tags` × 项目语言/框架词表（package.json 关键依赖、文件后缀分布）做规则匹配，输出 score；保证 UX 不卡死。
7. 落库 `chat_workspace_skill_recommendations(applied = 0)` 并返回：
   ```json
   {
     "recommendationId": "…",
     "recommendations": [...],
     "rejected": [...],
     "signalDigest": "…",
     "fromCache": false,
     "fellBackToHeuristic": false
   }
   ```

### 6.2 `POST /api/skills/recommend/:id/apply`

请求体：
```json
{
  "overrides": {
    "<skill_id>": { "enabled": true, "pinned": false }
  }
}
```

行为：
- 校验 `id` 属于当前 user。
- 把推荐结果合并 `overrides` 后，全量替换该 `(user, workspace_path)` 的 `chat_workspace_skill_selections` 行（`source = 'ai-recommend'`，`reason` 取 LLM 给的）。
- `applied = 1`、返回更新后的选择集。

### 6.3 `GET /api/skills/recommend/latest?workspacePath=...`

返回最近一次 `applied = 1` 与最近一次 `applied = 0` 各一条（如果存在），用于 UI 展示「上次推荐」与「待审阅推荐」。

## 7. CRUD 路由

`services/agent-gateway/src/routes/skill-selection.ts`：

- `GET  /api/skills/selection?workspacePath=...&sessionId=...`
  返回当前 effective + workspace 默认 + session override 三段，方便 UI 区分展示。
- `PUT  /api/skills/selection`
  body: `{ workspacePath, items: [{ skillId, enabled, pinned, reason? }] }`
  全量替换该 `(user, workspace_path)` 行，`source = 'manual'`，`reason` 为可选。
- `PATCH /api/skills/selection/session/:sessionId`
  body: `{ items: [{ skillId, enabled, pinned? }] }`，写 `chat_session_skill_overrides`。
- `DELETE /api/skills/selection/session/:sessionId`
  清空该 session 的 overrides（恢复 workspace 默认）。

权限校验：所有路由强制 `user_id = request.user.sub`；`workspacePath` 必须通过 `validateWorkspacePath`。

## 8. 前端 UX

- **入口 chip**（`apps/web/src/pages/ChatPage.tsx` 输入框上方）：
  ```
  Skills: 5 (workspace默认) [▾]
  ```
  下拉显示：当前 effective 列表、来源（workspace/session-override/builtin）、快速 toggle、「打开管理面板」、「恢复 workspace 默认」。
- **管理面板**（路由 `/settings/skills?workspacePath=...`，也支持抽屉形式从 chip 打开）：
  - 顶部按钮：`AI 推荐` `重置` `导入/导出 JSON`。
  - 三组：**Pinned**（可拖拽排序，反映优先级）/ **Enabled** / **Disabled**。
  - **Built-in**：只读组，标签 `Always available`，无 pin 控件。
  - 每行：name、version、source、capabilities tag、`reason` hover。
- **AI 推荐抽屉**：左 = 当前选择集，右 = 推荐结果，中间 diff 标记（新增/移除/pin 变化）。用户可逐项反勾选后「应用」。
- **改 pinned 的 toast**：`pinned 列表已更新，下次新建会话生效` + `立即应用到当前会话` 按钮。

## 9. 边界与风险

- **删除 skill**：`installed_skills` 删除时需要级联清理 `chat_workspace_skill_selections.skill_id` 与 `chat_session_skill_overrides.skill_id`（`routes/skills.ts` 的 uninstall 路径补两条 DELETE）。
- **本地 skill 路径变化**：`local-skills.ts` 的 skill 是按 `manifest.id` 入 `installed_skills` 的，路径变了仍是同一 id，选择集自然兼容。
- **多 workspace 同 manifest.id**：当前架构 `installed_skills` 主键是 `(skill_id, user_id)`，无法在不同 workspace 装同 id 的不同版本。本 spec 不解决此场景，记入 future work。
- **token 占用**：pinned 默认上限 6k tokens；管理面板里展示「估算 token 占用」条，阻止用户无意识把 10 个 skill 全 pin。**实现细节**：`chat_workspace_skill_selections` 增 `priority INTEGER NOT NULL DEFAULT 0` 列（`ensureColumn` 增量迁移）；PUT/apply 写入时按 items 数组顺序作为 priority；resolver 按 `ORDER BY priority ASC, skill_id ASC` 返回；前端 Pinned 组支持 HTML5 drag-drop 拖拽，复用现有 PUT 完成持久化。
- **空选择集回退**：fallback 路径与现状等价，灰度风险小；但如果用户**主动**把所有 skill 都禁用，结果列表会真的为空（仅 BUILTIN 可用），这是预期行为，UI 需要明确空状态文案。**实现细节**：通过 `chat_workspace_skill_configured(user_id, workspace_path, configured_at)` marker 表区分「从未配置」（→ 走 installed_skills.enabled fallback）与「显式空集」（→ 仅 BUILTIN）。PUT `/skills/selection` 与 AI 推荐 apply 路径都会 upsert marker。
- **AI 推荐结果污染**：推荐写库前对每条做 `skill_id` 在候选集中校验；不在候选的直接丢弃，避免幻觉 id 写库。
- **prompt cache**：仅首轮注入策略最大化复用 cache；中途改 pinned 选「立即应用」时会击穿，UI 上明确提示。

## 10. 测试策略

新增/扩展（按 PR 拆分）：

- `services/agent-gateway/src/__tests__/skill-selection.test.ts`
  - workspace path 缺失 → `__default__`
  - 选择集为空 → fallback 到 installed enabled
  - session override 优先级
  - BUILTIN 始终 enabled
  - `installed_skills.enabled=0` 的 skill 即便选择集 enabled=1 仍被排除
- `services/agent-gateway/src/__tests__/skill-tools-effective.test.ts`
  - 未在选择集时 description 不含
  - execute 越权 reject
  - BUILTIN 始终通过
- `services/agent-gateway/src/__tests__/pinned-skills-prompt.test.ts`
  - 超 token 上限按 score 截断
  - 不破坏 `<skill_content>` 闭合
  - BUILTIN 不被注入
- `services/agent-gateway/src/__tests__/task-agent-resolution-skill-filter.test.ts`
  - `load_skills = [git-master, my-business, foreign]` → 保留前两个、`droppedSkills = ['foreign']`
- `services/agent-gateway/src/__tests__/skill-recommend.test.ts`
  - LLM 返回非候选 skill_id 被丢弃
  - 同 digest 24h 内 `fromCache=true`
  - LLM 失败回退到启发式产出非空结果
- `services/agent-gateway/src/__tests__/skill-selection-routes.test.ts`
  - PUT 全量替换语义
  - PATCH session override + DELETE 恢复
  - 跨 user/越界路径拒绝
- 前端 Vitest：管理面板基础渲染、AI 推荐 diff、chip 下拉切换 override。

## 11. PR 拆分

每个 PR 独立可上线、独立可回滚：

1. **PR1 — 选择集基础**
   - DB schema 三张表 + `skill-selection.ts` + CRUD 路由 + 前端管理面板（手动 only，无 AI）
   - 旧 `installed_skills.enabled` 路径继续工作（fallback）
2. **PR2 — 工具/委派/capabilities 收敛**
   - `skill-tools.ts` description/execute 收敛
   - `task-agent-resolution.ts` `load_skills` 过滤 + `droppedSkills`
   - `routes/capabilities.ts` 输出按 effective 过滤
3. **PR3 — Pinned 注入**
   - `pinned-skills-prompt.ts` + `routes/stream.ts` 首轮注入
   - V2 storage 持久化首轮 system prompt
   - token 守门
4. **PR4 — AI 推荐**
   - `routes/skill-recommend.ts` 三个端点
   - 启发式回退
   - 前端推荐 diff 抽屉
5. **PR5 — 会话 chip 与 override**
   - 输入框上方 chip
   - session override UI + 「立即应用到当前会话」按钮（v1 行为）

## 12. 验证命令模板

每个 PR 完工后至少跑：

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/skill-selection.test.ts \
  src/__tests__/skill-tools-effective.test.ts \
  src/__tests__/pinned-skills-prompt.test.ts \
  src/__tests__/task-agent-resolution-skill-filter.test.ts \
  src/__tests__/skill-recommend.test.ts \
  src/__tests__/skill-selection-routes.test.ts
pnpm --filter @openAwork/web exec tsc --noEmit
```

前端面板/抽屉的 Vitest 路径在对应 PR 中明确补充。

## 13. Future Work（不在本 spec 范围）

- 同 manifest.id 多 workspace 多版本支持（需要重构 installed_skills 主键）。
- 团队 workspace（`team_workspaces`）共享选择集与 owner 权限。
- skill 推荐结果对话式优化（多轮 AI 协商）。
- 推荐基于「最近会话使用频次」反馈学习。
