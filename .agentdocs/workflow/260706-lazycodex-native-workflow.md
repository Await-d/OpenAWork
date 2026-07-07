# LazyCodex/OmO 原生化接入工作流

## Complexity Assessment
- 5+ atomic steps：+2
- 涉及多个独立并行流（协议、网关、skills、Web UI、团队编排、文档/QA）：+2
- 涉及 3+ 模块/系统（`shared`、`web-client`、`agent-gateway`、`skills`、`apps/web`、team runtime）：+1
- 结果需要持久化给后续执行与复核：+1
- 总分：6
- 选择模式：Full orchestration
- 理由：这是跨协议、运行时、UI 和团队编排的架构级接入，必须先固定计划、边界和验收证据，再分波次执行。

## 背景

用户已确认采用“OpenAWork 原生化移植 LazyCodex/OmO 工作流”的路线。前置调研结论：

- LazyCodex 官网与仓库显示，它是 Codex agent harness 分发包，强调 project memory、planning、parallel agents、skills、hooks、routing、verified completion。
- `lazycodex-ai` npm 包本身只是命令代理：`install` 转发到 `npx --package oh-my-openagent omo install --platform=codex`。
- OpenAWork 已经有同类基础：`/ulw-loop`、`/ulw-verify`、`/start-work`、Boulder、Prometheus、skills、team runtime、run events、artifacts、Web 对话运行时。
- 因此本工作流采用“借鉴语义、原生实现”的路线，不把 LazyCodex CLI 当作运行时依赖。

## 关键决策

1. **不直接集成 `lazycodex-ai` 运行时**
   - 原因：它是安装器/分发入口，不是稳定业务 SDK。
   - OpenAWork 不应修改用户 `~/.codex/config.toml`、Codex 插件缓存或本机 Codex hook 状态。

2. **OpenAWork 自己持有事实层**
   - 会话状态、任务图、run events、artifacts、skill selection、权限和审计继续由 OpenAWork 网关/DB 管理。
   - LazyCodex/OmO 的 DoneClaim、AdversarialVerify、Manual QA Gate 被映射成 OpenAWork 事件和证据包。

3. **计划目录采用当前产品真相源优先**
   - 当前 `/start-work` 查找 `.agentdocs/workflow`。
   - `.omo/plans/lazycodex-native-workflow.md` 保留为 OmO/LazyCodex 兼容影子计划。
   - 后续实现若要统一到 `.omo/plans`，必须先做迁移和兼容测试。

4. **skills 先迁移高价值子集**
   - 首批建议：`review-work`、`programming`、`frontend`、`visual-qa`、`lsp`、`ast-grep`、`rules`。
   - 每个 skill 必须改写为 OpenAWork 真实工具、权限、MCP 和 UI 能力，不照搬 Codex 专属工具调用。

## Scope IN

- 计划发现与目录兼容。
- LazyCodex 原生运行状态协议。
- ULW 验证闭环事件化和证据包。
- OpenAWork skill registry 中的 LazyCodex 高价值技能子集。
- `/start-work` 的 DoneClaim / reviewer gate 语义。
- Web 聊天页运行模式、计划进度、证据入口、子 Agent 状态展示。
- Team runtime 中的 explorer/librarian/planner/executor/reviewer/QA executor 角色映射。
- 文档、迁移说明和全链路 smoke。

## Scope OUT

- 不把 `lazycodex-ai` 加为产品运行时依赖。
- 不写 Codex 用户目录或插件配置。
- 不引入 LazyCodex 遥测。
- 不绕过 `@openAwork/web-client` 访问网关。
- 不编辑 `.evidence/`。
- 不把 assistant 文本里的 `<promise>` 当作唯一完成依据。

## 依赖矩阵

| 任务 | 依赖 | 阻塞 | 可并行 |
| --- | --- | --- | --- |
| T1 计划目录兼容 | 无 | T2/T3/T4/T8 | 无 |
| T2 运行状态协议 | T1 | T4/T5/T8 | T3 |
| T3 ULW 证据闭环 | T1 | T5/T6/T8 | T2 |
| T4 skills 子集 | T2 | T7/T8 | T5 |
| T5 reviewer gate | T2/T3 | T7/T8 | T4 |
| T6 Web 运行态 UI | T3 | T7/T8 | T4 |
| T7 团队角色映射 | T4/T5/T6 | T8 | 无 |
| T8 文档和 smoke | T1-T7 | Final | 无 |

## TODOs

- [x] T1. 统一计划发现与目录兼容
  - 目标：让 `/start-work lazycodex-native-workflow` 能稳定发现本工作流，并清理 `.sisyphus/plans` 的误导提示。
  - 参考：`services/agent-gateway/src/routes/commands.ts:1651`、`services/agent-gateway/src/session/boulder-state.ts:15`、`services/agent-gateway/src/tools/command-templates.ts:82`。
  - 验收：测试覆盖请求名精确/模糊命中；不存在的 plan 有明确回退；文档说明 `.omo/plans` 当前为兼容影子。
  - QA：执行 `/start-work lazycodex-native-workflow`，保存状态卡和任务同步输出到 `.omo/evidence/lazycodex-native-workflow/task-1-command-plan-discovery.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-1-command-plan-discovery.txt`；已覆盖计划目录扫描、模板提示和 slug/路径匹配。完整 authenticated `/start-work` 表面 smoke 留到 T8 统一执行。

- [x] T2. 定义 LazyCodex 原生运行状态协议
  - 目标：在 shared/web-client/gateway 之间定义运行模式、计划执行、证据状态、ULW 验证状态。
  - 参考：`packages/shared/src/index.ts:827`、`services/agent-gateway/src/routes/commands.ts:605`、`services/agent-gateway/src/routes/command-loop-runtime.ts:36`、`packages/web-client/src/session/sessions.ts:262`。
  - 验收：shared 导出稳定类型；web-client 有 typed helper；旧 session 无 metadata 时返回空状态而不是异常。
  - QA：保存协议 route/helper 测试输出到 `.omo/evidence/lazycodex-native-workflow/task-2-runtime-protocol.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-2-runtime-protocol.txt`；shared/web-client/gateway 类型检查通过，旧 session 空状态和 ULW pending 状态已覆盖。

- [x] T3. 把 ULW 验证闭环事件化并落证据包
  - 目标：把 `DONE -> 等待验证 -> VERIFIED` 映射为 run events、artifacts 和 task graph 状态。
  - 参考：`services/agent-gateway/src/routes/command-loop-runtime.ts:620`、`services/agent-gateway/src/routes/command-loop-runtime.ts:929`、`services/agent-gateway/src/routes/commands.ts:605`。
  - 验收：`/ulw-loop` 到 `/ulw-verify --pass/--fail` 均产生可恢复事件；失败验证不会静默完成任务。
  - QA：用测试会话模拟 pass/fail 两条路径，证据写入 `.omo/evidence/lazycodex-native-workflow/task-3-ulw-evidence.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-3-ulw-evidence.txt`；pending/pass/fail 证据写入 artifacts 和 session_run_events，失败路径保持 failed task_update。

- [x] T4. 原生化高价值 LazyCodex skills 子集
  - 目标：接入 `review-work`、`programming`、`frontend`、`visual-qa`、`lsp`、`ast-grep`、`rules` 的 OpenAWork manifest/prompt。
  - 参考：`packages/skills/src/builtins.ts:8`、`services/agent-gateway/src/skill/skill-selection.ts:1`、`services/agent-gateway/src/routes/stream-system-prompts.ts:513`。
  - 验收：技能可安装、启用、选择、注入；禁用技能不出现在 effective set；不引用 Codex-only 工具。
  - QA：skill selection 和 pinned prompt 测试输出写入 `.omo/evidence/lazycodex-native-workflow/task-4-skills.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-4-skills.txt`；7 个高价值技能进入内置清单，selection/prompt 回归通过。

- [x] T5. 网关 start-work 执行器对齐 DoneClaim / reviewer gate
  - 目标：start-work 子任务必须有 executor DoneClaim 和独立 verifier verdict，不能 worker 自报即完成。
  - 参考：`services/agent-gateway/src/routes/commands.ts:1360`、`services/agent-gateway/src/routes/start-work-subtasks.ts`、`apps/web/src/pages/chat-page/panels/sub-agent-run-list.tsx:134`。
  - 验收：confirmed 是唯一通过 verdict；needs-fix/false-positive/needs-human-review 均阻止 checkbox 完成。
  - QA：模拟 confirmed 与 needs-fix 两条路径，证据写入 `.omo/evidence/lazycodex-native-workflow/task-5-reviewer-gate.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-5-reviewer-gate.txt`；DoneClaim 不完成任务，confirmed 才完成，needs-fix 保持阻塞。

- [x] T6. Web 对话运行模式与证据 UI
  - 目标：在 ChatPage 展示运行模式选择、计划进度、ULW 验证状态和证据包入口。
  - 参考：`apps/web/src/pages/chat-page/conversation/composer/composer-slash-items.ts:24`、`apps/web/src/components/conversation-runtime/views/todo-bar.tsx:1`、`apps/web/src/pages/chat-page/panels/sub-agent-run-list.tsx:134`。
  - 验收：普通/规划/执行/ULW 模式可见；loading/empty/error 完整；375px 不溢出；网关请求走 web-client。
  - QA：组件测试、snapshot loader 测试、Web typecheck 通过；Playwright 截图保存到 `.omo/evidence/lazycodex-native-workflow/task-6-visual/screenshots/`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-6-web-ui.txt`；ChatPage 展示 WorkflowRuntimeState 摘要、ULW 验证状态、证据数量与 reviewer gate 汇总，375px 自动换行不溢出。

- [x] T7. 团队/多 Agent 编排角色映射
  - 目标：把 explorer、librarian、planner、executor、reviewer、QA executor 映射到 OpenAWork team runtime。
  - 参考：`services/agent-gateway/src/agent/agent-catalog.ts`、`services/agent-gateway/src/team/team-instruction-stack.ts`、`services/agent-gateway/src/handoff/runner/`、`apps/web/src/pages/team/`。
  - 验收：执行器和 reviewer 分离；角色能力来自 OpenAWork toolset/skill selection；reviewer 缺失时不静默通过。
  - QA：测试团队 workflow 输出写入 `.omo/evidence/lazycodex-native-workflow/task-7-team-roles.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-7-team-roles.txt`；LazyCodex 常用角色别名解析到 OpenAWork 内置 agent，team role_layer 映射补齐 explorer/librarian/planner/executor/reviewer/qa-executor，未知角色不猜测。

- [x] T8. 文档、迁移说明与全链路 smoke
  - 目标：补齐用户文档、开发者 ADR、迁移说明和 smoke 脚本。
  - 参考：`docs/chat/chat-runtime-ssot.md`、`docs/architecture/`、`.agentdocs/index.md`、`.omo/plans/lazycodex-native-workflow.md`。
  - 验收：文档清楚说明“借鉴/原生化/不直接依赖”；smoke 覆盖普通会话、规划模式、start-work、ULW 验证和证据查看。
  - QA：全链路 smoke 输出写入 `.omo/evidence/lazycodex-native-workflow/task-8-docs-smoke.txt`。
  - 证据：`.omo/evidence/lazycodex-native-workflow/task-8-docs-smoke.txt`；新增 `docs/chat/lazycodex-native-workflow.md`，SSOT 与 `.agentdocs/index.md` 已记录不依赖 `lazycodex-ai` / 不引入 Codex `agent_type` 的边界，相关测试与 typecheck 通过。

## Final Verification

- [x] F1. Plan compliance audit：核对 T1-T8 与 Scope IN/OUT。证据：`.omo/evidence/lazycodex-native-workflow/f1-plan-compliance.md`。
- [x] F2. Code quality review：检查类型边界、文件体积、导入规则、无 `any`/TS suppressions。证据：`.omo/evidence/lazycodex-native-workflow/f2-code-quality.md`。
- [x] F3. Real manual QA：启动网关 + Web，真实走普通会话、规划模式、start-work、ULW 验证、证据查看。证据：`.omo/evidence/lazycodex-native-workflow/f3-manual-qa/README.md`。
- [x] F4. Scope fidelity：确认未引入 `lazycodex-ai` 运行时依赖、未写 Codex 用户配置、未绕过 web-client。证据：`.omo/evidence/lazycodex-native-workflow/f4-scope-fidelity.md`。

## Success Criteria

- `/start-work lazycodex-native-workflow` 能找到这份 `.agentdocs/workflow` 计划。
- OpenAWork 对话系统有原生运行状态读模型。
- ULW 完成必须经过验证状态和证据包。
- LazyCodex 高价值技能子集进入 OpenAWork skill registry。
- Web 聊天页能展示计划进度、子 Agent、验证状态和证据入口。
- 团队编排能表达 explorer/librarian/planner/executor/reviewer/QA executor 职责边界。
- 相关测试、类型检查和真实表面 QA 证据齐备。
