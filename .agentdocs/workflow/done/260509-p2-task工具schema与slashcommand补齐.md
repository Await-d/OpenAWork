# 260509 — P2 task 工具 schema 与 slashcommand 补齐

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 2。

## Task Overview

两件小事打包：

1. **T-DELEGATE**：`delegate_task` / `task` 工具 schema 与 OpenCode 上游对齐：`resume → session_id` 字段重命名，新增 `command` 参数。来源 oh-my-opencode `14f450b`。
2. **T-DEADCODE**：新增 `/remove-deadcode` slash command，借助 LSP diagnostics 做 LSP 校验过的死代码删除。来源 oh-my-opencode `212baa6`。

## Current Analysis

### T-DELEGATE

OpenAWork 现状（`services/agent-gateway/src/task-tools.ts`）：

```ts
// 大致结构
{
  description: '...',
  args: {
    description: ...,
    prompt: ...,
    subagent_type: ...,
    category: ...,
    load_skills: ...,
    resume?: string,           // ← 旧字段
    run_in_background?: bool,
  }
}
```

oh-my-opencode 改动：
- `resume` → `session_id`（语义更准确，并对齐 OpenCode 原生 Task 工具）
- 新增 `command?: string`：用于"从 slash command 模板启动 task"，相当于"先把 command template 渲染成 prompt 再 dispatch"

### T-DEADCODE

oh-my-opencode 的 `/remove-deadcode` slash command 流程：

1. 获取当前 workspace 所有 LSP diagnostics
2. 过滤 `unused-import` / `unused-variable` / `no-unused-vars` / TS6133 / TS6196 等死代码诊断
3. 把诊断列表整理成 prompt，让 sub-agent 按 LSP 提示精确删除
4. agent 删除后再次拉 diagnostics 校验，没遗留才返回成功

OpenAWork 当前位置：
- `services/agent-gateway/src/lsp-tools.ts` / `lsp/` 目录
- `services/agent-gateway/src/command-templates.ts` slash command 注册
- `services/agent-gateway/src/start-work.ts` / `default-workflow-templates.ts`

## Solution Design

### T-DELEGATE 改动

#### S-D1: 字段重命名

```ts
args: {
  // ...
  session_id: tool.schema.string().optional()
    .describe('继续已有子会话的 ID（替代旧 resume 字段）'),
  // 临时保留旧字段的 deprecation 路径
}
```

兼容策略：

```ts
const sessionId = args.session_id ?? args.resume;
if (args.resume && !args.session_id) {
  log.warn('[delegate_task] resume 字段已废弃，请改用 session_id');
}
```

`tool-aliases.ts` 同步登记。

#### S-D2: 新增 command 参数

```ts
command: tool.schema.string().optional()
  .describe('Slash command 名称（如 /init-deep）。若指定，将用 command template 渲染 prompt 后 dispatch'),
```

执行时：

```ts
let renderedPrompt = args.prompt;
if (args.command) {
  const template = await resolveCommandTemplate(args.command);
  if (!template) throw new Error(`未知 command: ${args.command}`);
  renderedPrompt = renderTemplate(template, { userPrompt: args.prompt, ...args });
}
```

#### S-D3: 文档与测试

- 更新 `task-tools` 的描述与示例
- 测试旧 `resume` 仍能用，且 deprecation log 出现一次
- 测试 `command` 渲染路径

### T-DEADCODE 改动

#### S-DC1: slash command 模板

新增 `services/agent-gateway/src/commands/remove-deadcode.template.ts`：

```ts
export const REMOVE_DEADCODE_TEMPLATE = {
  name: 'remove-deadcode',
  description: '删除 LSP 诊断标记的死代码（unused import / variable / function）',
  systemAddon: '...',
  buildPrompt(ctx) {
    const diagnostics = await collectDeadCodeDiagnostics(ctx.workspaceRoot);
    return [
      '请仅根据下面 LSP 诊断列表精确删除死代码。',
      '禁止改写其他逻辑、禁止重命名、禁止合并 import。',
      '删除后必须重新跑 lsp_diagnostics 验证清空。',
      '',
      diagnosticsToYaml(diagnostics),
    ].join('\n');
  },
};
```

#### S-DC2: collectDeadCodeDiagnostics

复用 `lsp-tools.ts` 的 diagnostics 收集，过滤白名单：

```ts
const DEADCODE_CODES = new Set([
  'no-unused-vars',          // ESLint
  'unused-imports/no-unused-imports',
  'unused-variable',         // 通用
  '6133',                    // TS6133 declared but never read
  '6196',                    // TS6196 declared but never used
  '6198',                    // TS6198 destructured never used
  'F401',                    // pyflakes / ruff unused import
  'F841',                    // pyflakes unused var
]);
```

#### S-DC3: 注册到命令系统

`command-templates.ts` / `commands/registry.ts` 加入 `/remove-deadcode`，并在 `apps/web` 的 slash command 列表里显示。

#### S-DC4: 测试

- mock LSP diagnostics 返回若干死代码
- 执行 slash command 渲染后的 prompt 必须仅包含死代码诊断
- 删除后再次 diagnostics 必须为空（用 stub LSP 模拟）

## Complexity Assessment

- 原子步骤：4（D1/D2 + DC1/DC2/DC3） → 0
- 并行流：T-DELEGATE 与 T-DEADCODE 互不依赖 → +1
- 模块：`task-tools`、`command-templates`、`lsp-tools` → +1
- 单步 >5 min：DEADCODE 需要 e2e 跑 LSP → +1
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：4 → Full orchestration**
- **Routing rationale**：两件小事但跨工具与命令注册，一份 workflow 维护更清晰

## Implementation Plan

### Phase 1: T-DELEGATE schema 对齐 ✅
盘点发现 `services/agent-gateway/src/task-tools.ts` 已有 `session_id` / `task_id` / `command` 字段（前两者已被 `tool-sandbox.ts:2962` 实际消费 — 即 `resume → session_id` 重命名早就完成）。**真实差距**：
1. `command` 字段未消费，且 OpenAWork 的 slash command 模型与 oh-my-opencode 不同（见 Notes）
2. 缺 schema 单元测试

实施：
- [x] T-DELEG-01: 给 `command` 字段加详细 JSDoc + `.describe` 明确为 reserved no-op，避免误导 LLM 预期 side effect
- [x] T-DELEG-02: `__tests__/task-tools-schema.test.ts` 15 项覆盖 session_id 接受 / 旧 `resume` 静默 strip / `command` 占位 / XOR 约束 / 必填字段
- [x] T-DELEG-03: 不写 README — 改动小且 schema 注释自我描述

### Phase 2: T-DEADCODE slash command — 推迟
- [ ] T-DEAD-01..04 — 推迟到下一批：跨 LSP 集成 + slash command 注册 + web UI 列表 + e2e fixture，工程量较大且与本批 schema 改动正交

### Phase 3: 验收 ✅
- [x] T-V-01: typecheck 通过
- [x] T-V-02: 全量 49 文件 / 436 测试 全过（+15 项 task-schema 单元）

## Verification Commands

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/task-tools-schema.test.ts \
  src/__tests__/remove-deadcode-command.test.ts
```

## Risks & Rollback

- **deprecation 噪声**：`resume` 兼容层应仅每个会话 warn 一次，不要刷屏
- **DEADCODE 误删**：白名单严格只匹配上述码，agent prompt 强约束"不许重写、只许删除整行/整 import"，并强制删后重新 diagnostics 校验
- **大型项目 diagnostics 太多**：模板加 `--scope <path>` 参数，让用户限定目录

## Notes

### `command` 字段在 OpenAWork 不可直接对齐
oh-my-opencode 的 slash command 是"prompt 模板渲染器"：`task(command="/init-deep", prompt="...")` 等于"用 init-deep 模板把 prompt 渲染后再 dispatch"。OpenAWork 的 slash command 是**离散的 server-side action**（`compact_session` / `init_deep` / `start_ralph_loop` / `start_ulw_loop` / `cancel_ralph_loop` / `compact_session` 等，见 `services/agent-gateway/src/routes/command-descriptors.ts`），不存在"模板字符串"概念。直接消费 command 字段会触发不属于子任务委派语义的副作用。

因此本批保留字段+注释为 reserved，不引入运行时分支。**当 OpenAWork 后续引入 prompt-template 子系统**（例如用户可注册"/foo → 一段 markdown 模板"），再把 task tool 的 command 字段接到那个新系统上，做法应该是：
1. 引入 `services/agent-gateway/src/prompt-templates/` 注册器
2. `tool-sandbox.ts` task 分支：`if (parsed.data.command) renderedPrompt = await renderPromptTemplate(command, prompt)`
3. command-descriptors 区分"action kind" vs "prompt template kind"

### 后续
- T-DEADCODE 推迟到独立工作流（涉及 LSP 集成 + UI 列表 + e2e fixture，与本批 schema 修改不重叠）
- `/remove-deadcode` 出来后可以加进默认推荐的 power user 命令清单
