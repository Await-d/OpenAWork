# .agentdocs/workflow/260415-team-page-收口方案.md

## Task Overview
- 目标：为 Team 页面收口生成可执行方案，明确 `/team` 的稳定化路径、阶段边界、测试护栏与迁移决策。
- 范围：`apps/web` Team 入口与 runtime 视图、`packages/web-client` Team client、`services/agent-gateway` Team routes、对应测试。
- 非目标：本次不直接改业务代码，不提前切换 `/team` 到 `team-runtime-shell`。

## Current Analysis
- 当前 `/team` 实际挂载的是 `TeamPage -> MainWorkspace`，不是仓库中更完整的 `team-runtime-shell`。
- `team-runtime-reference-data.tsx` 同时承担 live/mock fallback、workspace/snapshot 聚合与部分 UI 反馈，责任过重。
- 页面观感“不完整”并非单点问题，而是 auth gating、fallback、reference shell 与未路由完整 shell 并存造成的复合结果。
- 现有后端与 shared client 已有较多 Team API 能力，但 Web 层测试主要覆盖参考壳与标签切换，缺少 route/fallback/negative-path 护栏。

## Solution Design
1. 先锁定当前 `/team` 的对外行为契约，不改变现有 route target。
2. 先补 Web/client/gateway 护栏测试，再拆 auth/data 边界，避免结构调整时失去行为锚点。
3. 将 `team-runtime-shell` 视为迁移候选而非当前清理主战场；只有在 normalized view-model 与 parity 成立后才考虑切换。
4. 使用 Full Orchestration：先产出 workflow + runtime master plan，后续可直接按阶段派发子任务执行。

## Complexity Assessment
- Atomic steps: 5+ → +2
- Parallel streams: 是（契约/测试、gateway+client、frontend data、shell 评估可并行）→ +2
- Modules/systems/services: 3+（apps/web、packages/web-client、services/agent-gateway）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是（需写入 `.agentdocs` 供后续执行）→ +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一个跨前端、client、gateway 与测试的多阶段收口任务，且需要保留可审阅、可续跑的执行文档，适合先建立 full orchestration 计划骨架。

## Dependency DAG
- T-01/T-03 可并行；二者完成后进入 T-02。
- T-02 完成后，T-04/T-05/T-06/T-07 可并行补齐测试护栏。
- T-08/T-09 依赖 T-02 与测试护栏范围确认；T-10 依赖 T-08/T-09。
- T-11 依赖 T-10；T-12 依赖 T-11；T-13 依赖 T-12 的 parity 结果。
- T-14/T-15 作为最终收口，依赖所有实现与测试阶段完成。

## Implementation Plan

### Phase 0: 契约冻结与边界确认
- [x] T-01 ✅: 盘点 `/team` 当前对外契约（auth、loading、empty、error、live/mock 提示、route 行为）
- [x] T-02 ✅: 产出 auth × data × UI 行为矩阵，并标记“允许变化 / 禁止变化”
- [x] T-03 ✅: 确认迁移边界：当前 route 优先、shell 仅作候选、禁止同阶段改 route target 与 provider contract

### Phase 1: 测试护栏
- [x] T-04 ✅: 补 `TeamPage` 路由、自动跳转、空态与错误态测试
- [x] T-05 ✅: 补 `use-team-collaboration` 的无 token、失败与选中回退测试
- [x] T-06 ✅: 补 `use-team-runtime-projection` 的 workspace/session fallback 与空态测试
- [x] T-07 ✅: 补 gateway `/team` 负路径、隔离性与 workspace/runtime 过滤测试

### Phase 2: 数据与状态边界收敛
- [x] T-08 ✅: 将 auth gating 提升为 pre-mount boundary，阻断未授权入口挂载 Team 页面数据层
- [x] T-09 ✅: 拆分 live resolver 与 mock fallback，并统一 provider 输出契约
- [x] T-10 ✅: 稳定 workspace/session selection fallback、error surface 与 busy/feedback 语义

### Phase 3: UI 壳层收口
- [x] T-11 ✅: 让 `MainWorkspace` 消费规范化 view-model，收缩 reference-only 分支
- [x] T-12 ✅: 将 `team-runtime-shell` 改为 adapter/影子消费者，并执行 parity 对齐
- [x] T-13 ✅: 根据 parity 结果决定是否切换 `/team` 路由目标；若不达标则保留现入口并归档切换前置条件

### Phase 4: 验收与归档
- [x] T-14 ✅: 执行 web/client/gateway smoke + 关键 E2E 场景，确认 route/auth/fallback 无行为漂移
- [x] T-15 ✅: 更新文档、同步 memory、归档 workflow，并清理 runtime 产物

## Notes
- 关键文件簇：`TeamPage.tsx`、`team-runtime-reference-data.tsx`、`use-team-collaboration.ts`、`use-team-runtime-projection.ts`、`team-runtime-shell.tsx`、`packages/web-client/src/team.ts`、`services/agent-gateway/src/routes/team.ts`。
- 关键测试缺口：Web route/fallback、hook fallback、gateway negative-path/isolation。
- T-04 已完成：在 `apps/web/src/App.test.tsx` 补了未授权拦截、首个 workspace 自动跳转、空 workspace 保持当前路由、workspace 详情失败横幅四个用例；验证命令：`pnpm --filter @openAwork/web exec vitest run src/App.test.tsx`。
- T-05 已完成：新增 `apps/web/src/pages/team/use-team-collaboration.test.tsx`，覆盖无 token 空读模型、shared detail 失败降级、selected shared session 失效回退；验证命令：`pnpm --filter @openAwork/web exec vitest run src/pages/team/use-team-collaboration.test.tsx`。
- T-06 已完成：新增 `apps/web/src/pages/team/runtime/use-team-runtime-projection.test.tsx`，覆盖 workspace filter、workspace key 回退、shared session 选中回退、空态投影；组合验证命令：`pnpm --filter @openAwork/web exec vitest run src/App.test.tsx src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/use-team-runtime-projection.test.tsx`。
- T-07 已完成：在 `services/agent-gateway/src/__tests__/team-collaboration.test.ts` 补了 workspace runtime 404、workspace runtime 跨工作区过滤、aggregated runtime 无关 share 过滤，并把旧 happy-path mock 对齐到当前 `/team/runtime` 合约；验证命令：`pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/team-collaboration.test.ts`。
- Wave 1 已完成：组合验证命令 `pnpm --filter @openAwork/web exec vitest run src/App.test.tsx src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/use-team-runtime-projection.test.tsx && pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/team-collaboration.test.ts` 通过。
- T-08 已确认达成：当前 `ProtectedRoute` 已在 TeamPage 挂载前完成 hydrate/token gate，且 T-04 已自动化证明未授权访问 `/team` 时不会挂载 TeamPage、不会触发 Team 请求；因此该任务以“验证完成、无需额外改码”收口。
- T-09 已完成：`team-runtime-reference-data.tsx` 中的 `liveValue` 不再在内部直接返回 mock，而是只负责 authenticated live 组装；mock fallback 改为 hook 末端统一决议，live/mock contract 分流点更清晰。验证命令：`pnpm --filter @openAwork/web exec vitest run src/pages/TeamPage.test.tsx src/pages/TeamPage.interaction.test.tsx src/App.test.tsx src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/use-team-runtime-projection.test.tsx`。
- T-10 已完成：新增 `apps/web/src/pages/team/runtime/team-runtime-reference-data.test.tsx`，锁定 `workspaceSnapshotLoading`/`workspaceSnapshotError` 必须进入最终 `loading`/`error` surface；`team-runtime-reference-data.tsx` 已接入这两个字段，相关 Web 回归 30 个用例通过。
- T-11 已完成：新增 `apps/web/src/pages/team/runtime/team-runtime-shell-primitives.tsx`，把 `ChromeBadge / CompactMetricPill / RailEmptyState` 从 `team-runtime-shell-frame.tsx` 提为共享壳原语；`MainWorkspace.tsx` 改用共享 metric pill 并移除“详细统计数据加载中…”的纯占位展开分支。验证命令：`pnpm --filter @openAwork/web exec vitest run src/pages/TeamPage.test.tsx src/pages/TeamPage.interaction.test.tsx src/App.test.tsx src/pages/team/runtime/team-runtime-reference-data.test.tsx src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/use-team-runtime-projection.test.tsx`。
- T-12 已完成：新增 `build-team-runtime-shell-view-model.ts`，让 `team-runtime-shell.tsx` 通过独立 adapter 层向 `TeamRuntimeShellFrame` 供数；同时补了 `build-team-runtime-shell-view-model.test.ts` 锁定 frame-level view-model 契约。验证命令：`pnpm --filter @openAwork/web exec vitest run src/pages/team/runtime/build-team-runtime-shell-view-model.test.ts src/pages/TeamPage.test.tsx src/pages/TeamPage.interaction.test.tsx src/App.test.tsx src/pages/team/runtime/team-runtime-reference-data.test.tsx src/pages/team/use-team-collaboration.test.tsx src/pages/team/runtime/use-team-runtime-projection.test.tsx`。
- T-13 决议：**暂不切换 `/team` 路由目标**。理由是 parity gap 仍集中在 workspace selection、detail rail、footer/status 与 action semantics；当前最安全的策略是保留 `/team -> TeamPage -> MainWorkspace` 作为唯一真入口，继续把 `team-runtime-shell` 维持为 shadow consumer。
- T-14 已完成：浏览器 smoke 验证未授权访问 `/team` 仍落到登录页；`pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/team-collaboration.test.ts` 通过；`pnpm typecheck` 全仓库通过。额外修复了与本任务无关但阻塞验收的 `WorkspaceTreeNode` 未导出问题。
- Memory sync: completed

## Verification Summary
- Web 测试：`src/pages/TeamPage.test.tsx`、`src/pages/TeamPage.interaction.test.tsx`、`src/App.test.tsx`、`src/pages/team/runtime/team-runtime-reference-data.test.tsx`、`src/pages/team/use-team-collaboration.test.tsx`、`src/pages/team/runtime/use-team-runtime-projection.test.tsx`、`src/pages/team/runtime/build-team-runtime-shell-view-model.test.ts`
- Gateway 测试：`services/agent-gateway/src/__tests__/team-collaboration.test.ts`
- 浏览器 smoke：访问 `http://127.0.0.1:5173/team`，未授权状态仍正确落到登录页
- 类型检查：`pnpm typecheck` 通过

## Wave 0 Deliverables

### T-01：`/team` 当前对外契约
- `/team` 与 `/team/:teamWorkspaceId` 都注册在 `ProtectedRoute` 下；未水合时先显示全屏 loader，水合完成且无 `accessToken` 时立刻重定向到 `/`，因此 `TeamPage` 不会在 auth 通过前挂载。
- `onboarding` 与 `telemetry consent` 是全局覆盖层，不是路由门禁；它们可以盖在页面上方，但不会让 `/team` 绕过认证。
- 浏览器实测：未登录访问 `http://127.0.0.1:5173/team` 时实际落到登录页，且没有发出 Team 数据请求。
- Team 页面顶部会显式展示模式/反馈横幅：`已接入真实 Team Runtime` / `参考 Mock 模式`、`正在同步团队运行数据…`、错误消息、反馈消息。

### T-02：auth × data × UI 行为矩阵
| Auth 状态 | 数据状态 | 当前 UI 行为 | 请求行为 | 变更策略 |
|---|---|---|---|---|
| 未水合 | 不适用 | 全屏 loader（准备工作台） | 不挂载 TeamPage，不发 Team 请求 | 禁止变化 |
| 已水合但无 token | 不适用 | 从 `/team` 重定向到 `/` 登录页 | 不挂载 TeamPage，不发 Team 请求 | 禁止变化 |
| 已认证，无 `teamWorkspaceId`，且有 workspace | 先留在当前路由，再自动跳到首个 `/team/:id` | 先拉 workspace 列表，再导航 | 允许优化时序，不改最终结果 |
| 已认证，无 `teamWorkspaceId`，且无 workspace | 仍可进入 Team 外壳，但 `activeWorkspace=null`，管理型操作关闭 | 可拉 workspace 列表；无 snapshot | 允许优化空态文案，不改“不可管理”语义 |
| 已认证，`hasAuth=true`，workspace/snapshot 加载中 | 顶部显示“正在同步团队运行数据…” | 会拉 workspace；snapshot 仅在 token+workspaceId 时拉取 | 禁止移除加载反馈 |
| 已认证，workspaceError 或 collaboration.error | 顶部显示错误消息 | live 仍成立；错误进入横幅 | 允许统一错误源，不允许静默吞错 |
| 已认证，live 成立但 snapshot/session 为空 | `activeMode='live'`，但 workspaceGroups 可退回参考组装数据 | 先用 snapshot，再用 collaboration，最后退到参考 groups | 允许收缩 fallback 逻辑，不允许把 blocked-entry 伪装成该态 |

### T-03：迁移边界决议
- **Route boundary**：当前 `/team -> TeamPage -> MainWorkspace` 是唯一真入口；`team-runtime-shell` 在 parity 前不接管路由。
- **Auth boundary**：auth gate 必须位于 Team data provider 之前；blocked entry 必须短路，不能通过 mock/live fallback 伪装成正常数据。
- **Provider boundary**：可以重构 `team-runtime-reference-data.tsx` 内部实现，但对外输出 contract 先保持稳定，再做消费者迁移。
- **Shell boundary**：`team-runtime-shell` 只能作为 adapter/影子消费者接入规范化 view-model；是否切路由必须依赖 parity 结果，而不是依赖“更完整 UI 已存在”。
- **禁止项**：同一阶段同时变更 route target 与 provider contract；在 Wave 1 测试护栏完成前改动 route/provider/shell 结构；让未授权入口落到 mock/empty 数据而不是显式 auth gate。
