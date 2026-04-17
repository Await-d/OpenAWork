# .agentdocs 索引

## Active Workflows
- [260416-team-创建流程设计分析](workflow/260416-team-创建流程设计分析.md) — Team 会话创建流、团队选择、agent 来源与模板复用设计分析
- [260416-team-创建实施方案](workflow/260416-team-创建实施方案.md) — Team 会话创建向导、DTO/API、template metadata 与测试落地计划

## Done Workflows
- [260417-net10-settings-第二批只读迁移](workflow/done/260417-net10-settings-第二批只读迁移.md) — 已完成 `/settings/mcp-status`、`/settings/upstream-retry`、`/settings/compaction`、`/settings/file-patterns` 第二批只读迁移
- [260417-net10-settings-首批只读迁移](workflow/done/260417-net10-settings-首批只读迁移.md) — 已完成最小 JWT 鉴权基础与 `/settings/model-prices`、`/settings/workers` 首批只读迁移
- [260417-net10-网关框架搭建实施方案](workflow/done/260417-net10-网关框架搭建实施方案.md) — .NET 10 gateway 骨架开发已完成：EF Core/MediatR、SQLite+PostgreSQL migrations、树结构工作流日志、SSE/WS/HostedService skeleton、sidecar publish/smoke
- [260415-team-page-收口方案](workflow/done/260415-team-page-收口方案.md) — Team 页面收口、契约稳定化、shell adapter 与验收闭环

## Architecture Decisions
- [2026-04-17] .NET 10 网关骨架阶段固定采用 EF Core + MediatR；默认 SQLite，provider 扩展通过独立 migrations 与基础设施注册实现；树结构工作流日志需兼容现有 `WorkflowLogger` / `request_workflow_logs.workflow_json` 语义，并保留桌面 sidecar 运行约束。
- [2026-04-17] .NET 10 gateway skeleton 实现位置固定为 `services/agent-gateway-dotnet/`；Host 提供 `/health`、`/stream/sse`、`/stream/ws` skeleton，SQLite 默认走平台数据目录 fallback，sidecar 交付通过 `publish-sidecar.sh` / `smoke-sidecar.sh` 验证。
- [2026-04-15] Team 页收口先以当前 `/team -> TeamPage -> MainWorkspace` 为唯一真入口；`team-runtime-shell` 在未证明 parity 前只作为迁移目标，不直接接管路由。
- [2026-04-15] `team-runtime-shell` 对 `TeamRuntimeShellFrame` 的供数改为独立 adapter（`build-team-runtime-shell-view-model.ts`），后续 parity 对齐先收口 view-model，再考虑路由切换。

## Coding Conventions
- Team 相关改造先固定行为矩阵（auth × data × UI），再补自动化护栏，最后做结构收口。
- Team Runtime 壳层的只读展示原语统一放在 `team-runtime-shell-primitives.tsx`，避免 `MainWorkspace` 和 richer shell 重复维护 badge / metric / empty-state chrome。
- 当前 `/team` 路由的运行态提示统一收口在 `TopTeamHeader` 与 `FooterBar`；不要再在 `TeamPage` 主内容区重复渲染独立状态横幅。
- Team 页面会话切换必须以 `TeamPage` 的 `selectedTeamId -> selectedTeam` 为单一真相来源，再向 Header/MainWorkspace/各 Tab 下发；禁止右侧内容区各自维持独立 team 选中态。

## Known Pitfalls
- `/team` “像没做完”常由 auth gating 与 live/mock fallback 叠加触发，不等于后端 `/team` 路由未实现。
- `workspaceSnapshotLoading` / `workspaceSnapshotError` 若未汇入 `team-runtime-reference-data.tsx` 的最终 `loading` / `error` surface，会造成 UI 状态与真实数据边界脱节。
- `apps/desktop` 会直接引用 `apps/web` 的源码；Web 内部类型（如 `WorkspaceTreeNode`）未导出会同时阻塞 `web` 与 `desktop` typecheck。
- 若左侧会话切换后右侧“看起来没变”，优先检查右侧 tab 是否只读 provider 全局派生数据而未消费 `selectedTeam`，以及切换时是否缺少本地 UI 状态重置（输入框、展开项、筛选器、回复状态等）。
- 当前 Team 页只能安全做到“会话感知摘要 + 局部状态重置”；若要让 `TasksTab / MessagesTab` 真正按会话过滤内容，需要先给 `TeamTaskRecord / TeamMessageRecord` 增加稳定的 session 维度，而不是继续在 UI 层猜测归属。

## Global Important Memory
- `.agentdocs/runtime/` 已在仓库 `.gitignore` 中忽略，可安全存放本次 orchestration 的临时执行产物。
