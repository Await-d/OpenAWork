# 261009-tool-sandbox 拆分方案

## Task Overview

把 `services/agent-gateway/src/tools/tool-sandbox.ts`(**7540 行**,超 AGENTS.md 1500 行硬上限
**5.0 倍**)拆分为「薄门面 + 按域 handler 模块 + 派发器」,使每个文件回到硬上限之内。

- **约束**:零行为变更(纯结构搬迁);公共导出面**完全不变**;不新增依赖、不改协议。
- **不做**:不重写权限阶梯逻辑、不改工具语义、不升级 Fastify/插件体系。
- **本文档定位**:方案阶段。**Gate 0 未拍板前不写任何代码。**

> 参考同类先例:`.agentdocs/workflow/260921-ChatPage组装层瘦身方案.md`(整块抽取 + wrapper 手法,
> 7347→3973 行,零行为变更,门禁全绿)。

## Current Analysis(2026-10-09 实测,一手核实)

### 体积构成

| 区间 | 内容 | 行数 |
| --- | --- | --- |
| 1–349 | import 头部 | ~349 |
| 350–498 | 输入归一 / 校验输出格式化(`normalizeWorkspaceManagedRawInput` 等) | ~149 |
| 499–643 | `isPermissionSafeSiblingTool`(导出)+ `TOOL_WHITELIST`(导出) | ~145 |
| 644–1574 | 子会话 / 任务引用 / 钩子辅助(含导出 `terminateChildSession`、`readTaskParentToolReference`、`clearTaskParentToolReference`、`reconcileResumedTaskChildSession`、`syncParentTaskToolResult`) | ~930 |
| **1575–5220** | **`executeGatewayManagedToolImpl`(巨型 if 派发链)** | **~3646** |
| 5224–6087 | `buildTaskUpdateEvent`(导出)+ 后台子任务生命周期(`runChildTaskSessionInBackground`、`finalizeChildTaskRun*` 等) | ~864 |
| 6088–6316 | 会话 / 团队上下文判定 + 待处理权限辅助 | ~229 |
| 6317–6350 | `recordBlockedToolCallsForPendingRequest`(导出) | ~34 |
| 6351–6730 | 待处理 question / permission 原语 + **权限阶梯**(`ensurePermissionForTool`、`gatePermissionDecision`、`runPermissionEvaluateHook`) | ~380 |
| 6731–7371 | `SandboxConfig` + `ToolSandbox` 类(`execute` / `executeToolCall` 及后置钩子) | ~641 |
| 7372–7540 | `createDefaultSandbox`(导出,纯注册样板) | ~168 |

### 核心病灶:`executeGatewayManagedToolImpl` 单函数 ~3646 行

- 函数自 `:1575` 起,体内是 **64 个 `request.toolName ===` 分支**(实测 `grep -c` = 64),
  线性顺序判定;内部还夹一个 **~680 行**的 `isTaskToolName(...)` 子代理委派块(`:4009–4691`)。
- 分支命中即为 `return`;各分支工具名互斥,**理论上可改为查表**,但存在三处**顺序/别名敏感**:
  1. `isTaskToolName(request.toolName)`(`:4009`)是**谓词匹配**(覆盖 `task*` 多名),位置必须在
     `enter_plan_mode`/`exit_plan_mode`(`:3868/:3923`)之后、`background_*`(`:4692`)之前;
  2. 字面名与定义名混用:`'bash'`、`'edit'`、`'multi_edit'`、`'mcp_call'`、`'mcp_list_tools'`、
     `'batch'`、`'skill'`、`'question'`、`'background_output'`、`'background_cancel'`、
     `'interactive_bash'`、`'run_bash_in_background'`、`'bash_output'`、`'bash_kill'`;
  3. flat MCP 别名(`mcp_<server>_<tool>`)在 `:1721`/`:2883` 附近由字面名承接。
- **前置改写**:`executeToolCall`(`:6797`)在任何派发**之前**先把 legacy `workspace_*` 重写为规范名;
  该顺序不得改变。

### 公共契约面(必须原样保留)

消费方 import(实测 33 个生产文件 + 24 个沙箱专项测试):

| 导出符号 | 主要消费方 |
| --- | --- |
| `createDefaultSandbox` | 全部 verification 脚本 + 绝大多数 sandbox 测试 |
| `TOOL_WHITELIST` | `tool-contract-parity.test.ts`、`allow-by-default-guard.test.ts`、`gui-computer-use.test.ts` |
| `terminateChildSession` | `session/stop-child-sessions.ts`、`routes/sessions.ts` |
| `CHILD_SESSION_TERMINAL_REASON_KEY` | `session/child-session-terminal-guard.ts`、`stop-child-sessions.ts` |
| `reconcileResumedTaskChildSession` | `session/session-runtime-reconciler.ts` |
| `syncParentTaskToolResult` / `readTaskParentToolReference` / `clearTaskParentToolReference` | 任务层 |
| `recordBlockedToolCallsForPendingRequest` | 权限暂停批收集 |
| `buildTaskUpdateEvent` | 任务事件 |
| `ToolSandbox`(类)/ `SandboxConfig` / `CreateDefaultSandboxOptions` | 门面与测试 |
| `SandboxExecutionContext` / `BatchProgressCallback` / `ChildSessionTerminalReason` / `ChildSessionTimeoutSource`(类型) | `routes/stream.ts` 等 |
| `isPermissionSafeSiblingTool` | 权限派生 |

> 结论:**保持 `tools/tool-sandbox.ts` 路径与上述导出名不变**(门面 re-export),消费方零改动。

### 回归网(现成护栏)

- `src/__tests__/tools/tool-sandbox-*.test.ts` 共 **23 个**专项测试(mcp/权限阶梯/工具调用/批量/
  read_tool_output/desktop/plugin/admin 各族)。
- 另有 `tool-contract-parity.test.ts`、`tool-sandbox-allow-by-default-guard.test.ts` 作为**契约不变量**守卫。
- 全量:`bun run --filter @openAwork/agent-gateway test`。

## Solution Design

### 主策略:门面 + 按域 handler + 派发器(三段式)

1. **门面不变**:`tools/tool-sandbox.ts` 保留全部公共导出(有实现者留实现,搬迁者 re-export),
   `ToolSandbox` 类与 `createDefaultSandbox` 的对外签名、行为、注册顺序**逐字不变**。
2. **handler 按工具域下沉**:把 `executeGatewayManagedToolImpl` 的各分支体搬进
   `tools/sandbox/handlers/*.ts`,每个模块导出 `handleXxxTool(ctx): Promise<ToolCallResult | null>`。
3. **派发器独立**:新增 `tools/sandbox/dispatch.ts`,把 64 分支改为「有序表 + 谓词钩子」,
   **显式保序**(见下 §顺序契约)。

> **先搬家、后注册表**:第一轮逐个把分支体搬出,主文件原位保留
> `if (name === X) return handleXxxTool(ctx)`,**派发顺序零变化**、可逐 PR 审查;
> 待体量下降、测试全绿后,再(可选)把 if 链替换为查表派发器。

### 目标模块布局(新建 `services/agent-gateway/src/tools/sandbox/`)

```
tools/
├── tool-sandbox.ts                  # 门面:公共导出 + ToolSandbox 类 + createDefaultSandbox(~900-1200)
└── sandbox/
    ├── dispatch.ts                  # 有序派发表 + 谓词(isTaskToolName)保序(~250)
    ├── context.ts                   # SandboxHandlerContext 类型 + 结果构造函数(~150)
    ├── whitelist.ts                 # TOOL_WHITELIST + isPermissionSafeSiblingTool + 输入归一(~300)
    ├── session-context.ts           # getSessionOwnerUserId/Metadata/RoleContext、团队判定、planMode(~350)
    ├── permission-ladder.ts         # findApproved/Pending、gate/ensure、evaluate hook(~600)
    ├── pending-interaction.ts       # question 原语 + recordBlockedToolCallsForPendingRequest(~250)
    ├── child-session.ts             # terminalReason/timeout/terminateChildSession(~330)
    ├── task-reference.ts            # parent tool ref、reconcile、syncParentTaskToolResult、事件(~400)
    ├── task-background.ts           # 后台子任务生命周期 + finalize(~830)
    └── handlers/
        ├── todo.ts                  # todo_write/read、subTodo write/read(~130)
        ├── mcp.ts                   # mcp_list_tools、mcp_call、flat mcp、skill_mcp、mcp_manage(~260)
        ├── desktop.ts               # desktop_automation/control、computer_use(~205)
        ├── session.ts               # session_*、model_search、tool_search、read_tool_output(~600)
        ├── task-graph.ts            # task_create/get/list/update(~75)
        ├── media.ts                 # look_at/generate_image/convert_media/extract_*/generate_audio(~235)
        ├── delegation.ts            # call_omo_agent + isTaskToolName 块(~960)
        ├── admin.ts                 # memory/skill/plugin/schedule/agent/team_workspace_manage(~240)
        ├── workspace.ts             # workspace_review_*/create_directory(~100)
        ├── edit.ts                  # edit/multi_edit/write/apply_patch/ast_grep_replace/lsp_rename(~250)
        ├── batch.ts                 # batch(~210)
        ├── interactive.ts           # skill/question/enter_plan_mode/exit_plan_mode(~240)
        ├── background.ts            # background_output/background_cancel(~300)
        └── bash.ts                  # bash/interactive_bash/run_bash/…output/…kill(~165)
```

预计:**所有新文件 ≤1000 行**,`tool-sandbox.ts` 门面 ≤1200 行(达标)。

### 顺序契约(必须显式保留,否则静默回归)

派发采用「**有序数组**」而非无序 Map,顺序严格等于现 if 链:

```
plugin-tool → todo → mcp → desktop → session → task-graph → model/tool-search →
read_tool_output → mcp_call/manage → admin → workspace → edit → batch → skill/question →
plan-mode → [isTaskToolName 谓词] → background → bash → (尾部后置处理)
```

- 谓词 `isTaskToolName` 注册为**有序表中的一个谓词项**,位置与今日一致。
- flat MCP 别名在 `mcp` 模块内按当前语义匹配,`mcp_list_tools`/`mcp_call` 字面名保持。
- `workspace_*` 前置重写仍在 `executeToolCall` 内、派发**之前**,顺序不变。

## Complexity Assessment

- Atomic steps:约 25 个文件搬迁/新增 + 派发器 + 门面收口 → **+2**
- Parallel streams:handler 模块**可并行起草**,但最终接线都改同一热点文件(串行)→ **+1**
- Modules/systems/services:tools + permission + session + task + routes 依赖面 → **+1**
- Long step (>5 min):delegation(960 行)搬迁 + 全量回归 → **+1**
- Persisted review artifacts:方案与分期记录需归档 → **+1**
- OpenCode available (Mode A):是 → **−1**
- **Total score**:**+5**
- **Chosen mode**:**Full orchestration**(workflow doc + runtime dir + master_plan;一阶段一 PR)
- **Routing rationale**:跨 5 个子域、单一热点文件串行接线、最高风险块(delegation)需专门验证门,
> 30 个原子步骤统一由分期 PR 收口;Full orchestration 的分阶段/并行起草收益可覆盖其 workflow 成本。

## Gate 0 待拍板(未拍板前不进入实施)

| 编号 | 决策项 | 方案建议 |
| --- | --- | --- |
| D-1 | 是否先建 tripwire(P0) | **必须**。现状无「派发覆盖率」护栏,搬迁漏分支会静默通过。**推荐:是** |
| D-2 | 是否接受「先搬家、后注册表」中间态 | **接受**。P1/P2 保留原位 if 链,顺序零变化;P3 才收成查表。**推荐:接受** |
| D-3 | `delegation`(960 行)是否单列且最后 | **是**。它是最大且与 task 生命周期耦合最深的块。**推荐:是** |
| D-4 | 是否同步拆 `tool-definitions.ts`(2103 行) | **否**。另行立项,避免同轮双热点。**推荐:不在本轮** |
| D-5 | 门面目标行数 | ≤1200(硬上限 1500 内留余量)。**推荐:采纳** |

## Implementation Plan

> 状态:零实现。Gate 0 放行前不得开工。**一阶段一 PR、单一提交边界**。

### Phase 0:Tripwire(仅测试,必须先于一切改动)

- [x] T-01 `__tests__/tools/tool-sandbox-dispatch-coverage.test.ts`:枚举 `TOOL_WHITELIST` 中所有
  可派发工具名,断言「每个名字都能得到一个非空 handler 结果或命中显式外部/别名白名单」——
  搬迁漏一个分支即红。
- [x] T-02 顺序/别名护栏(并入 T-01 或独立):`isTaskToolName` 谓词的命中面、
  flat MCP 别名、`workspace_*` 前置重写——断言今日行为(锁住 §顺序契约)。
- [x] T-03 基线门禁:上述新增测试**在未改动 HEAD 上全绿**,且 23 个 sandbox 测试 + 全量绿。

### Phase 1:叶子辅助模块(先切一刀验证手法)

- [x] T-04 新建 `sandbox/whitelist.ts`、`sandbox/context.ts`、`sandbox/session-context.ts`;
  门面改为 re-export。
- [x] T-05 新建 `sandbox/permission-ladder.ts`、`sandbox/pending-interaction.ts`、`sandbox/child-session.ts`;
  门面 re-export。**偏差**:`pending-interaction` 并入 `permission-ladder.ts`(question 原语与权限阶梯共享 pending 表,拆开反而增多跨模块调用)。
- [x] T-06 新建 `sandbox/task-reference.ts`、`sandbox/task-background.ts`;门面 re-export。
- [x] T-07 **门禁**:typecheck + 23 sandbox 测试 + 全量 + lint 全绿;`tool-sandbox.ts` 行数下降记录。

### Phase 2:handler 批量抽取(每批 ≤3 族,批次独立 PR)

- [x] T-08 批一:`todo` / `desktop` / `media`。
- [x] T-09 批二:`session` / `task-graph` / `workspace`。
- [x] T-10 批三:`mcp` / `admin` / `edit`。
- [x] T-11 批四:`batch` / `interactive` / `background` / `bash`。
- [x] T-12 每批门禁:typecheck + 全量测试 + lint 全绿。

### Phase 3:派发器(可选,视 Phase 2 后行数决定)

- [ ] T-13 新建 `sandbox/dispatch.ts`(有序表 + 谓词项);`executeGatewayManagedToolImpl` 改为
  委派 `dispatchSandboxTool(ctx)`。**仅在 Phase 2 后单文件仍 >1500 时执行**。
  → **未触发**:Phase 2 结束后 `tool-sandbox.ts` = 1312 行(<1500),按条件不执行;若要让门面达到 D-5 的 ≤1200 才需要启动本阶段。
- [ ] T-14 门禁:T-01 覆盖率 + T-02 顺序 + 全量 + 桌面 E2E(工具执行路径)。(随 T-13 未触发)

### Phase 4:高风险块与收尾

- [x] T-15 `delegation`(call_omo_agent + `isTaskToolName` 块)单列 PR,最后执行。
- [x] T-16 运行 `bun run --filter @openAwork/agent-gateway typecheck`,清理搬迁产生的失效 import。
- [x] T-17 更新 `services/agent-gateway/AGENTS.md` 查找指引(新增 `tools/sandbox/` 说明);
  归档 workflow,补 `.agentdocs/index.md` 记忆。

## 风险与缓解

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | 派发**顺序/别名**回归(最易静默) | 有序表 + 谓词项 §顺序契约;P0 T-02 锁行为 |
| R2 | 循环依赖(`runtime/plugin-host.ts` ↔ `tool-sandbox.ts` 双向已存在) | 钩子调用(`dispatchToolExecuteBefore/After`)保持原位;新模块只做叶子导入 |
| R3 | 公共导出面漂移 | 门面 re-export,消费方 33 文件零改动;typecheck 门禁 |
| R4 | 同一热点文件多 PR 冲突 | 一阶段一 PR;严禁多人同改 `tool-sandbox.ts` |
| R5 | 搬迁中类型收敛诱发 `as any`/`@ts-ignore` | ctx 类型从真实签名派生(`Pick`/`Omit`);禁违禁模式 |
| R6 | `delegation` 960 行破坏 task 生命周期 | 单列 PR + 最后执行 + task 专项测试全绿 |
| R7 | `noUncheckedIndexedAccess` 下搬迁丢类型收窄 | 逐块搬迁,保留原收窄写法 |

## 验证策略

| 层 | 命令 |
| --- | --- |
| 类型 | `bun run --filter @openAwork/agent-gateway typecheck` |
| 单元(沙箱) | `bun run --filter @openAwork/agent-gateway test src/__tests__/tools/` |
| 单元(全量) | `bun run --filter @openAwork/agent-gateway test` |
| Lint / 格式 | `bun run lint` / `bun run format:check` |
| E2E(桌面) | `bun run test:e2e`(工具执行路径,仅作放行参考) |

> 每个 Phase 结束必须全绿方可进入下一 Phase;**禁止**带着红门禁推进。

## 明确不在范围

- ❌ 不改权限阶梯语义与顺序(gateway AGENTS.md 的 deny-first 不变量)。
- ❌ 不改任何工具的 schema / 描述 / 输出文案。
- ❌ 不动 `tool-definitions.ts`(2103 行)、`db.ts`(3242 行)、双网关——另行立项。
- ❌ 不引入新依赖、不改协议、不改 HTTP/WS/SSE。

## Notes

- 全文禁 `as any` / `@ts-ignore` / `@ts-expect-error`;ESM `.js` 扩展名;纯类型用 `import type`。
- 本仓**严禁 git 回滚**;每阶段单一提交,便于 PR 反向操作(需用户授权)。
- 手法与 ChatPage 瘦身一致:**整块抽取 + 原位 wrapper**,净收益 = 函数体 − ctx 装配。
- 投资估算:Large。P0 Short;P1 Medium;P2 Medium(分 4 批);P3 Medium(条件执行);P4 Large。
- 预期终局:`tool-sandbox.ts` ≤1200 行,新增 ~22 个模块各 ≤1000 行,公共契约零变化。

## 执行记录

### 2026-10-09 · T-05 第一步:`sandbox/child-session.ts`

**搬出内容(586 行,零行为变更)**

子会话生命周期域整块搬出,含类型与常量(单一来源在子模块,消除循环依赖):

- 类型:`TaskToolOutputStatus`、`ChildSessionTerminalReason`、`ChildSessionTimeoutSource`、`TaskParentToolReference`
- 常量:`CHILD_SESSION_TERMINAL_REASON_KEY`、`CHILD_SESSION_TIMEOUT_SOURCE_KEY`、
  `DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS`、`TASK_PARENT_TOOL_*_KEY`
- 函数:`loadTaskGraphForSession`、`readChildSessionTerminalReason`、`readChildSessionTimeoutSource`、
  `writeChildSessionTerminalReason`、`getTaskChildFirstResponseTimeoutMs`、
  `getTaskChildFirstResponseRetryMaxRetries`、`isChildSessionFirstResponseEvent`、
  `clearTimedOutChildSessionAttemptArtifacts`、`readTaskRequestedSkills`、
  `readTaskParentToolReference`、`clearTaskParentToolReference`、`mapTaskStatusToToolOutputStatus`、
  `buildTaskToolOutput`、`syncParentTaskToolResult`、`buildTaskUpdateEvent`、
  `settleChildTaskNotification`、`terminateChildSession`

**依赖方向**:`tool-sandbox.ts` → `sandbox/child-session.ts`(单向,无循环)。
门面保留再导出:`terminateChildSession`、`CHILD_SESSION_TERMINAL_REASON_KEY`、
`syncParentTaskToolResult`、`buildTaskUpdateEvent`、`readTaskParentToolReference`、
`clearTaskParentToolReference`、`ChildSessionTerminalReason`、`ChildSessionTimeoutSource`
——33 个生产消费方的 import 路径不变。

**行数**:`tool-sandbox.ts` 7540 → 7065(−475);`sandbox/child-session.ts` 586。

**门禁(全绿)**

| 层 | 结果 |
| --- | --- |
| `typecheck`(tsc -b --force) | Exited 0 |
| `eslint src/tools/tool-sandbox.ts src/tools/sandbox/` | 0 problem |
| `test:unit`(vitest run) | 616 passed / 1 skipped;4798 tests passed / 3 skipped |

**踩坑与结论**

- 搬迁时**禁止**用 sed 按「原始行号」连续删块:前一次删除会让后续行号漂移,导致误删。
  正确做法:一次性按原始行号区间过滤重建文件(见 `/tmp/apply-cs-move.cjs` 手法)。
- **禁止**并发编辑同一文件:并行 `replace_in_file` 与 `sed -i` 会产生读-改-写覆盖。
- 子模块若反向 `import ... from '../tool-sandbox.js'` 会形成运行时循环;把**常量与类型下沉到子模块**、
  门面改为 import + 再导出即可彻底打破。

### 2026-10-09 · Phase 1 收尾 + Phase 2 全量 handler 抽取(批一~批四 + delegation)

**结果**:`tool-sandbox.ts` 7540 → **1312 行**(−6228,−82.6%);新增 `sandbox/` 公共模块 8 个 + `sandbox/handlers/` 14 个(均 ≤1000 行,最大 `delegation.ts` 880)。

**交付清单(行数)**

| 类别 | 文件 |
| --- | --- |
| 公共模块 | whitelist 337 / context 268 / session-context 248 / permission-ladder 582 / child-session 542 / task-reference 159 / task-background 921 / create-default-sandbox 206 |
| handlers | todo 124 / desktop 245 / media 281 / session 478 / task-graph 107 / workspace 122 / mcp 235 / admin 289 / edit 287 / batch 225 / interactive 280 / background 345 / bash 211 / delegation 880 |

**契约保护(逐项核验)**

- 公共导出面:门面 re-export 全部既有导出,33 个生产消费方 import 路径零改动(typecheck 背书)。
- 派发:61 个 `handleXxxTool(handlerContext)` 调用点 ↔ 61 个 handler 导出,双向无孤儿;搬迁前后 63 项派发条件**顺序逐字一致**;`isTaskToolName` 谓词块仍在 `enter_plan_mode`/`exit_plan_mode` 之后、`background_*` 之前;`workspace_*` 前置重写仍在 `executeToolCall` 内、派发之前。
- 逐字校验:14/14 函数体等价(batch 的 `sandbox.execute(...)` → `ctx.executeNestedTool(...)`、call_omo_agent 的 `executeGatewayManagedTool(...)` → `ctx.executeGatewayManagedTool(...)` 为既定等价替换,闭包绑定同一实参),其余差异均为 prettier 归一。

**门禁(全绿)**

| 层 | 结果 |
| --- | --- |
| `typecheck`(tsc -b --force) | Exited 0 |
| `eslint src/tools/tool-sandbox.ts src/tools/sandbox/` | 0 problem |
| `prettier --check`(改动文件) | All matched files use Prettier code style |
| `vitest run src/__tests__/tools/` | 84 files passed / 685 tests passed |
| delegation 专项 `vitest run src/__tests__/task/ src/__tests__/session/` | 87 files:86 passed / 1 skipped;628 tests:625 passed / 3 skipped |

**踩坑与结论**

- handler 文件是从主文件复制的导入块:**src 级模块必须 `../../../<dir>/x.js`**(tools 同层 `../../`、sandbox 兄弟 `../`),层级写错会一次性产生上百个 TS2307。
- 搬迁后**必须**跑 `bunx organize-imports-cli <改动文件>` 清未使用导入:否则 lint 会累积上千个 `no-unused-vars`(本轮一次性清掉 1786 处,含上一会话留下的 3 个模块)。
- 本机 shell 自带 `OPENAWORK_DISABLE_MCP_FLAT_TOOLS=1` 等环境变量,会让个别无关测试单独变红;判定红门禁前先 `env -u <VAR>` 复跑。
- **Phase 3(派发器)未执行**:方案触发条件是「Phase 2 后单文件仍 >1500」,实测 1312 未触发。门面当前 1312 行略高于 Gate 0 D-5 的 ≤1200 目标(差 112 行)——残余内联块全搬也不够,若要达标需启动 Phase 3 把保序 if 链收成有序表(方案可选阶段)。