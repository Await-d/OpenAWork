# LazyCodex / OmO 原生工作流接入说明

## 边界

OpenAWork 借鉴 LazyCodex / OmO 新版的工作流语义，但不把 `lazycodex-ai` 当作运行时依赖，也不写入 Codex 用户配置。落地方式是把关键概念映射到 OpenAWork 已有原生能力：

- 计划发现：`.agentdocs/workflow/`、`.omo/plans/`、legacy `.sisyphus/plans/`
- 运行状态：`WorkflowRuntimeState`
- 事件：`session_run_events`
- 证据：OpenAWork artifacts
- skills：`@openAwork/skills` 内置 prompt skills
- reviewer gate：`SessionTask.metadata.startWorkGate`
- 团队角色：OpenAWork agent catalog aliases + team `role_layer`

## 运行状态协议

共享类型位于 `packages/shared/src/index.ts`：

- `WorkflowRuntimeState.mode`: `normal | planning | execution | ulw`
- `WorkflowRuntimeState.activePlan`: 当前计划标题、路径、进度、worktree
- `WorkflowRuntimeState.activeLoop`: ULW/Ralph 循环、验证状态、任务与完成承诺
- `WorkflowRuntimeState.evidence`: artifact 引用与证据状态

Gateway 在 session public response 中返回 `workflowRuntime`。Web 端通过 `@openAwork/web-client` 读取，不直接访问网关端点。

## 对话页展示

`apps/web/src/pages/chat-page/panels/WorkflowRuntimeStatusStrip.tsx` 在聊天顶部展示：

- 计划进度
- ULW / Ralph 循环验证状态
- 证据 artifact 数量或生成中状态
- start-work reviewer gate 汇总

普通会话没有 active workflow 且没有 reviewer gate 时不渲染状态条，避免干扰常规聊天。375px 宽度下状态 chip 自动换行。

## ULW 证据闭环

`/ulw-verify --pending/--pass/--fail` 会写入 artifacts，并发布 durable runtime events：

- `task_update`
- `audit_ref`

Web recovery 依赖 gateway read model 与 durable events，不解析 assistant 自然语言来判断验证状态。

## start-work reviewer gate

start-work 子任务使用 `metadata.startWorkGate` 表示执行声明与审查结果：

- `completionBlocked`
- `executorClaimStatus`
- `verifierVerdict`

执行器 DoneClaim 只记录声明，不完成任务。只有 `verifierVerdict = confirmed` 会完成 running task；`needs-fix` 等结果保持阻塞或运行态。

## 团队角色映射

LazyCodex / OmO 常用角色名通过 OpenAWork 原生 agent catalog aliases 解析：

| LazyCodex 习惯名          | OpenAWork agent   |
| ------------------------- | ----------------- |
| `explorer`                | `explore`         |
| `librarian`               | `librarian`       |
| `planner`                 | `plan`            |
| `executor`                | `hephaestus`      |
| `reviewer`                | `momus`           |
| `lazycodex-gate-reviewer` | `momus`           |
| `qa-executor`             | `sisyphus-junior` |

Team runtime 的 `role_layer` 映射：

| 输入                                                       | role_layer |
| ---------------------------------------------------------- | ---------- |
| `explore` / `explorer` / `librarian` / `scout` / `zeus`    | `pm2`      |
| `plan` / `planner` / `prometheus`                          | `pm1`      |
| `hephaestus` / `sisyphus-junior` / `qa-executor`           | `executor` |
| `momus` / `atlas` / `reviewer` / `lazycodex-gate-reviewer` | `reviewer` |

未知角色返回 `null`，不会猜测 SOUL 层级，也不会静默通过 reviewer 缺失。

## Smoke 步骤

1. 启动 gateway 与 Web。
2. 创建普通聊天会话，确认没有 active workflow 时对话顶部不显示工作流状态条。
3. 执行 `/start-work lazycodex-native-workflow`，确认计划可按 stem/title/path 匹配。
4. 在 start-work 子任务中记录 executor DoneClaim，确认 task 未完成且 UI 展示 reviewer gate 待审。
5. 记录 verifier `needs-fix`，确认任务仍不完成；记录 `confirmed` 后确认任务完成。
6. 执行 `/ulw-verify --pending`，确认 artifacts 写入并能在 session events 中看到 `audit_ref`。
7. 执行 `/ulw-verify --pass` 或 `--fail`，确认证据状态更新。
8. 打开聊天页，确认状态条显示 mode、plan progress、ULW 验证状态、证据数量。
9. 派发 `explorer/reviewer/qa-executor` 风格角色，确认解析到 OpenAWork 内置 agent 与 team `role_layer`。

## 回归命令

```bash
pnpm --filter @openAwork/shared typecheck
pnpm --filter @openAwork/web-client typecheck
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/web typecheck
pnpm --filter @openAwork/skills typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/routes/commands-workflow-plan-matching.test.ts src/__tests__/session/ulw-verification-evidence.test.ts src/__tests__/routes/start-work-verification-gate.test.ts src/__tests__/team/team-role-layer-mapping.test.ts src/__tests__/tools/task-agent-resolution-lazycodex-aliases.test.ts
pnpm --filter @openAwork/web-client exec vitest run src/session/workflow-runtime.test.ts src/session/sessions.test.ts
pnpm --filter @openAwork/web exec vitest run src/pages/chat-page/panels/WorkflowRuntimeStatusStrip.test.tsx src/pages/chat-page/conversation/snapshot/use-session-snapshot-loader.test.tsx
pnpm --filter @openAwork/skills exec vitest run src/builtins.test.ts
```
