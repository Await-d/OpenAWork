# OMO MCP 适配器集成工作流

## Complexity Assessment

- 5+ atomic steps：+2
- 涉及多个独立并行流（后端 MCP runtime、OMO adapter、sandbox/hook、Settings UI、Team 权限、QA）：+2
- 涉及 3+ 模块/系统（`agent-gateway`、`web-client`、`shared-ui`、`apps/web`、MCP client、Team runtime）：+1
- 单个阶段预计 >5 分钟：+1
- 结果需要持久化给后续执行与复核：+1
- 总分：7
- 选择模式：Full orchestration
- 理由：这是跨工具注入、MCP 管理、Hook 兼容、权限审计与团队会话授权的系统级集成，必须先固定主路径和验收边界，再分波次实施。

## 背景

用户已确认：OpenAWork 应继续采用“原生 MCP runtime 为主路径，OMO/Hook 作为适配输入源”的方向，而不是让 OMO/LazyCodex hook 直接成为最终工具注入与执行路径。

当前已落地并复查过的基础：

- 系统内置 MCP 包含 `websearch`、`grep_app`、`codegraph`、`git_bash`、`lsp`。
- `codegraph`、`git_bash`、`lsp` 是 OpenAWork 虚拟内置 MCP：声明为 stdio，但由 gateway runtime 直接桥接本地能力，不启动占位 command。
- `stream.ts` 与 `stream-runtime.ts` 会把 MCP catalog 转成 flat tool，例如 `mcp__codegraph__codegraph_search`。
- `tool-sandbox.ts` 对 `mcp__*` 动态放行，并统一回到 `callMcpToolForSession()`，再进入 remote MCP、virtual MCP 或后续 adapter。
- `tool.execute.before/after` hook 只适合做参数/结果扩展，不应绕过 MCP catalog、权限和审计。

本工作流要把 OMO/LazyCodex 风格的工具、hook 与能力声明映射到 OpenAWork 原生 MCP 管理体系里。

## 关键决策

1. **OpenAWork MCP runtime 是唯一主路径**
   - Agent 可见工具必须来自 MCP catalog 或 gateway tool registry。
   - 不允许 OMO hook 直接把工具塞进 LLM tool list 后绕过 runtime。

2. **OMO/Hook 作为 adapter 输入源**
   - OMO 风格 tool/hook/manifest 先解析成 OpenAWork typed manifest。
   - manifest 再映射成 MCP server entry、virtual MCP tool 或现有能力别名。

3. **已有原生能力不重复注册**
   - OMO codegraph → 复用 `codegraph`。
   - OMO lsp → 复用 `lsp`。
   - OMO git_bash → 复用 `git_bash`。
   - 只有 OpenAWork 尚无原生实现的 OMO 工具进入 `omo` virtual MCP。

4. **Hook 保留但边界收窄**
   - hook 可以修改 args、补 metadata、观察 output。
   - hook 不可以作为工具注册主路径。
   - hook 不可以绕过 `tool-sandbox`、permission、session visibility、audit log。

5. **设置页管理必须和 runtime 同源**
   - UI 状态来自 gateway MCP runtime，而不是前端硬编码。
   - `enabled`、`disabledTools`、status、retry/diagnose 必须影响下一轮 Agent 实际工具注入。

## Scope IN

- 抽象 `VirtualMcpProviderRegistry`，收敛 `codegraph`、`lsp`、`git_bash` 和新增 `omo` provider。
- 新增 OMO adapter manifest 解析层。
- 把 OMO 能力映射到 OpenAWork MCP catalog。
- 保留并约束 `tool.execute.before/after` hook。
- 让设置页管理内置、虚拟、OMO adapter MCP。
- 补齐 chat/team 两条 stream 注入路径的权限与白名单测试。
- 补齐文档、ADR、smoke 与视觉/手动 QA 证据。

## Scope OUT

- 不引入 `lazycodex-ai` 作为产品运行时依赖。
- 不写用户本机 Codex/OMO 配置目录。
- 不让 OMO hook 直接执行系统命令。
- 不把 `codegraph/lsp/git_bash` 复制成 `mcp__omo__codegraph_*` 等重复工具。
- 不绕过 `@openAwork/web-client` 访问 gateway。
- 不编辑 `.evidence/`。

## 依赖矩阵

| 任务 | 依赖 | 阻塞 | 可并行 |
| --- | --- | --- | --- |
| T1 固化虚拟 MCP provider registry | 无 | T2/T3/T4/T5 | T7 |
| T2 新增 OMO adapter manifest | T1 | T3/T4/T5 | T6 |
| T3 映射 OMO 能力到 MCP catalog | T1/T2 | T4/T5/T8 | T6 |
| T4 执行层与 hook 边界收口 | T1/T3 | T8/T9 | T5 |
| T5 Settings 管理面补齐 | T1/T3 | T8/T9 | T4/T6 |
| T6 Team/session 权限策略补齐 | T2 | T8/T9 | T5 |
| T7 文档 ADR 与用户说明 | 无 | T9 | T1-T6 |
| T8 测试矩阵补齐 | T3/T4/T5/T6 | T9 | 无 |
| T9 全链路 smoke 与归档 | T1-T8 | Final | 无 |

## TODOs

- [ ] T1. 抽象 Virtual MCP Provider Registry
  - 目标：把当前 `builtin-virtual-mcps.ts` 中的 switch 收敛为 provider registry，为 `omo` provider 留扩展点。
  - 参考：`services/agent-gateway/src/mcp/builtin-virtual-mcps.ts`、`services/agent-gateway/src/mcp/mcp-runtime.ts`、`services/agent-gateway/src/mcp/virtual-codegraph-mcp.ts`、`services/agent-gateway/src/mcp/virtual-lsp-mcp.ts`、`services/agent-gateway/src/mcp/virtual-git-bash-mcp.ts`。
  - 验收：`codegraph/lsp/git_bash` 行为不变；virtual provider 的 list/call/connected/retry 均由 registry 分发；用户 override 同 id remote MCP 时不走 virtual provider。
  - QA：运行 `mcp-runtime-retry.test.ts`、`builtin-mcps.test.ts`、`tool-sandbox-flat-mcp.test.ts`；保存输出到 `.omo/evidence/omo-mcp-adapter-integration/t1-virtual-provider-registry.txt`。
  - Commit：`feat(gateway): 抽象虚拟MCP提供者注册表`

- [ ] T2. 新增 OMO Adapter Manifest 解析层
  - 目标：新增 `services/agent-gateway/src/omo/`，解析 OMO 风格 tool/hook/capability 声明为 OpenAWork typed manifest。
  - 参考：`services/agent-gateway/src/runtime/plugin-host.ts`、`packages/skills/src/builtins.ts`、`services/agent-gateway/src/mcp/mcp-settings-schemas.ts`、`services/agent-gateway/src/tools/dynamic-tool-loader.ts`。
  - 验收：adapter 只输出 typed data，不执行工具、不改 prompt、不注册 hook；坏 manifest 返回 typed error，不影响 gateway 启动。
  - QA：新增 adapter 单元测试覆盖合法 manifest、未知字段、重复 id、非法 schema、已原生能力 alias；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t2-omo-manifest.txt`。
  - Commit：`feat(gateway): 新增OMO能力清单适配器`

- [ ] T3. 将 OMO 能力映射为 MCP Catalog
  - 目标：新增 `omo` virtual MCP provider，把 OpenAWork 尚未原生化的 OMO 工具暴露为 `mcp__omo__<tool>`；已有原生能力只做 alias，不重复注册。
  - 参考：`services/agent-gateway/src/mcp/mcp-flat-tool-defs.ts`、`services/agent-gateway/src/mcp/mcp-tool-naming.ts`、`services/agent-gateway/src/mcp/mcp-runtime.ts`、`services/agent-gateway/src/mcp/builtin-mcps.ts`。
  - 验收：`listMcpToolsForUser()` 能列出 `omo` server；flat 注入生成 `mcp__omo__*`；`codegraph/lsp/git_bash` 不被重复映射到 `omo`。
  - QA：测试覆盖 `omo` server list、flat name、disabledTools、alias 去重、adapter failure isolation；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t3-omo-mcp-catalog.txt`。
  - Commit：`feat(gateway): 将OMO能力映射为MCP目录`

- [ ] T4. 收口执行层与 Hook 边界
  - 目标：确保 OMO virtual MCP 与所有 flat MCP 一样走 `tool-sandbox -> callMcpToolForSession`；hook 只能 before/after 修改或观察，不能新增可执行工具。
  - 参考：`services/agent-gateway/src/tools/tool-sandbox.ts`、`services/agent-gateway/src/runtime/plugin-host.ts`、`services/agent-gateway/src/session/session-tool-visibility.ts`。
  - 验收：`mcp__omo__*` 经过 whitelist、session visibility、permission context、audit log；hook 抛错不阻断工具；hook 不能让未注册工具执行成功。
  - QA：新增 sandbox 测试覆盖 OMO flat tool、legacy `mcp_call`、hook args mutation、hook throw isolation、unregistered tool denial；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t4-sandbox-hook-boundary.txt`。
  - Commit：`feat(gateway): 收口OMO工具执行与Hook边界`

- [ ] T5. 完善 Settings MCP 管理面
  - 目标：设置页能管理 system builtin、virtual builtin、OMO adapter MCP，且显示/保存与 runtime 同源。
  - 参考：`services/agent-gateway/src/routes/settings.ts`、`services/agent-gateway/src/mcp/mcp-settings-schemas.ts`、`packages/web-client/src/infra/settings.ts`、`apps/web/src/pages/settings/connection/use-mcp-servers.ts`、`packages/shared-ui/src/mcp/MCPServerConfig.tsx`。
  - 验收：virtual/adapter MCP 禁止编辑假 command/url；允许启用/禁用和 disabledTools；retry/status 能反映真实 runtime；前端不直接 fetch gateway。
  - QA：web-client/settings route/shared-ui 单测 + settings 页手动截图；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t5-settings-mcp-management.txt` 与 `.../t5-visual/`。
  - Commit：`feat(web): 完善内置与OMO MCP管理界面`

- [ ] T6. 补齐 Team 与 Session MCP 授权策略
  - 目标：保留普通 chat 与 team session 的不同 MCP 白名单语义，并定义 OMO adapter server 的 system/user 来源规则。
  - 参考：`services/agent-gateway/src/routes/stream.ts`、`services/agent-gateway/src/routes/stream-runtime.ts`、`services/agent-gateway/src/handoff/capability/apply-team-layer-tools.ts`、`services/agent-gateway/src/handoff/capability/toolset-gate.ts`、`services/agent-gateway/src/session/session-tool-visibility.ts`。
  - 验收：`allowedServerIds: undefined` 表示普通会话不白名单过滤；`allowedServerIds: []` 表示 team 只保留 system builtin；用户插件来源 OMO MCP 不被 team 默认继承。
  - QA：新增 stream/team 权限测试覆盖 chat、team empty allowlist、team requested MCP、channel MCP disabled、clarify mode；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t6-team-session-mcp-policy.txt`。
  - Commit：`test(gateway): 补齐团队会话MCP授权策略`

- [ ] T7. 编写 MCP/OMO 架构 ADR 与用户说明
  - 目标：记录“原生 MCP runtime 主路径、OMO/Hook 作为输入源”的架构边界，避免后续回退到纯 hook 注入。
  - 参考：`docs/chat/lazycodex-native-workflow.md`、`docs/chat/chat-runtime-ssot.md`、`.agentdocs/index.md`。
  - 验收：文档说明系统内置 MCP、virtual MCP、OMO adapter、hook 边界、设置页管理语义、team 授权语义；`.agentdocs/index.md` 写入架构决策。
  - QA：文档链接检查和关键术语 grep；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t7-docs-adr.txt`。
  - Commit：`docs(gateway): 记录OMO MCP适配架构`

- [ ] T8. 补齐全链路测试矩阵
  - 目标：把 T1-T6 的关键行为整合成稳定回归集，防止后续改 stream/hook/settings 时断链。
  - 参考：`services/agent-gateway/src/__tests__/mcp/`、`services/agent-gateway/src/__tests__/tools/tool-sandbox-flat-mcp.test.ts`、`services/agent-gateway/src/__tests__/session/session-tool-visibility.test.ts`、`apps/web/src/pages/settings/`。
  - 验收：后端 MCP runtime、flat naming、sandbox、settings routes、session visibility、web-client、shared-ui 至少各有覆盖；测试名称清晰表达 Given/When/Then。
  - QA：运行目标测试 + `pnpm --filter @openAwork/agent-gateway exec tsc --noEmit` + 相关 web/shared-ui typecheck；证据写入 `.omo/evidence/omo-mcp-adapter-integration/t8-test-matrix.txt`。
  - Commit：`test(gateway): 补齐OMO MCP全链路回归`

- [ ] T9. 全链路 Smoke、视觉 QA 与归档
  - 目标：真实驱动设置页和 Agent 工具链路，确认用户可管理、Agent 可见、sandbox 可执行、team 权限不扩大。
  - 参考：`apps/web/src/pages/settings/SettingsPage.tsx`、`packages/shared-ui/src/mcp/`、`services/agent-gateway/src/routes/stream.ts`、`services/agent-gateway/src/routes/stream-runtime.ts`。
  - 验收：设置页可见 `codegraph/lsp/git_bash/omo`；禁用某 tool 后下一轮不注入；调用 `mcp__codegraph__codegraph_search` 或 `mcp__lsp__status` 成功；team executor 未绑定用户私有 MCP 时不可见。
  - QA：保存 Playwright 截图、gateway logs、测试输出到 `.omo/evidence/omo-mcp-adapter-integration/t9-smoke/`。
  - Commit：`chore(gateway): 收口OMO MCP集成验证`

## Final Verification

- [ ] F1. Plan compliance audit：核对 T1-T9 是否满足 Scope IN/OUT，特别是不引入 `lazycodex-ai` 运行时依赖、不写 Codex 用户目录、不绕过 sandbox。证据：`.omo/evidence/omo-mcp-adapter-integration/f1-plan-compliance.md`。
- [ ] F2. Code quality review：检查 TypeScript 严格类型、NodeNext `.js` 导入、无 `any`/TS suppressions、文件体积、无空 catch。证据：`.omo/evidence/omo-mcp-adapter-integration/f2-code-quality.md`。
- [ ] F3. Security/permission review：确认 hook、OMO adapter、virtual MCP、team allowlist 都不能扩大权限或绕过审计。证据：`.omo/evidence/omo-mcp-adapter-integration/f3-security-permission.md`。
- [ ] F4. Real manual QA：设置页 + chat + team 三个真实表面均完成 smoke。证据：`.omo/evidence/omo-mcp-adapter-integration/f4-manual-qa/README.md`。

## Success Criteria

- `codegraph/lsp/git_bash` 继续作为系统内置虚拟 MCP 可管理、可禁用、可调用。
- OMO/LazyCodex 风格能力经 adapter 进入 OpenAWork typed manifest。
- OMO 新能力以 `omo` virtual MCP 进入 MCP catalog，不直接 hook 注入。
- 已有原生能力不重复注册，不出现等价工具名漂移。
- flat MCP 注入、legacy `mcp_call`、sandbox 执行、permission、audit log 全链路一致。
- 设置页能管理内置、虚拟和 OMO adapter MCP。
- team session 的最小授权语义不扩大。
- 相关类型检查、单元测试、集成测试、视觉 QA 与手动 smoke 证据齐备。
