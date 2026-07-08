# OMO MCP Adapter Architecture

## ADR

- **Status**: Accepted
- **Date**: 2026-07-07
- **Scope**: chat、team、Settings 与 gateway MCP runtime

OpenAWork 采用“原生 MCP runtime 为主路径，OMO adapter / hook 作为适配输入源”的架构。Agent
可见工具只来自 OpenAWork MCP catalog / gateway tool registry；任何 LazyCodex / OMO 风格
manifest、hook 或插件声明都不能直接把工具注入 LLM tool list，也不能绕过网关执行链路。

这个决策保留 OpenAWork 现有的权限、审计、会话可见性和 Settings 管理模型，同时允许继续吸收
OMO/LazyCodex 风格能力。它明确不是纯 hook 注入方案。

## 内置 MCP 与 virtual MCP

系统内置 MCP 由 gateway runtime 管理。当前内置能力包括：

- `websearch`
- `grep_app`
- `codegraph`
- `git_bash`
- `lsp`

其中 `codegraph`、`git_bash`、`lsp` 是 virtual MCP：它们在 MCP catalog 中表现为内置 server，
但由 gateway runtime 桥接本地能力，不依赖外部 stdio 进程作为真实运行时。`grep_app` 与
`websearch` 这类已有 builtin 也继续作为 OpenAWork 原生能力管理。

已有原生能力不重复注册为 `mcp__omo__*`。例如 OMO 风格 manifest 声明了 codegraph、lsp 或
git_bash 能力时，adapter 只建立 alias / 复用关系：

- codegraph 复用 `codegraph`
- lsp 复用 `lsp`
- git_bash 复用 `git_bash`

只有 OpenAWork 尚无原生实现的 OMO 能力，才会被映射到 `omo` virtual MCP，并按 flat MCP 命名
暴露为 `mcp__omo__<tool>`。

## OMO adapter 输入路径

OMO/LazyCodex 风格 manifest 是输入源，不是运行时依赖。Gateway 的 OMO adapter 先把 manifest
parse 成 OpenAWork typed data，再映射为 MCP catalog entry、virtual MCP tool 或已有能力 alias。

约束：

1. 不引入 `lazycodex-ai` 作为产品运行时依赖。
2. 不读取或写入用户本机 Codex/OMO 配置目录作为 OpenAWork 的配置真相源。
3. adapter 只产出 typed manifest / typed error，不直接执行工具、不修改 prompt、不注册 hook。
4. 坏 manifest 只能隔离为 adapter error，不应影响 gateway 启动和已有 MCP server。

## Hook 边界

Hook 只保留在受控的 before/after 边界内：

- `tool.execute.before` 可以在已注册工具调用前调整 args 或补 metadata。
- `tool.execute.after` 可以观察或规范化结果。
- hook 抛错必须被隔离，不能让未注册工具获得执行能力。

Hook 不能：

- 注册工具或修改 Agent 可见工具列表。
- 直接执行系统命令。
- 绕过 `tool-sandbox`。
- 绕过 permission、session visibility、audit log。
- 把未进入 MCP catalog / gateway tool registry 的工具伪装成可调用工具。

因此，所有 `mcp__*` flat tool，包括后续 `mcp__omo__*`，仍必须走
`tool-sandbox -> callMcpToolForSession()`，再进入 remote MCP、virtual MCP 或 adapter 映射出的
provider。

## Settings 管理语义

Settings 页面必须与 gateway runtime 同源读取和保存 MCP 状态。页面展示的 builtin、virtual、adapter
MCP 都应来自 gateway 的 MCP runtime / settings API，而不是前端硬编码。

Settings 的语义：

1. `enabled`、`disabledTools`、status、retry / diagnose 必须影响下一轮 Agent 实际工具注入。
2. `codegraph`、`git_bash`、`lsp`、`websearch`、`grep_app` 与 `omo` adapter server 都在同一
   MCP 管理模型下展示。
3. virtual / adapter MCP 不应暴露假的 command / url 编辑入口。
4. Web 前端不得直接 `fetch()` gateway；必须通过 `@openAwork/web-client` 读取和保存设置。

这保证用户在 Settings 中看到的 server 状态，就是 Agent 下一轮会使用的 server 状态。

## Chat 与 Team 授权语义

普通 chat 和 team session 的 allowlist 语义不同：

- 普通会话 `allowedServerIds: undefined`：不做 MCP server 白名单过滤，仍受全局 enabled、
  disabledTools、permission、session visibility 与 `tool-sandbox` 约束。
- Team session `allowedServerIds: []`：只保留 system builtin，不默认继承用户私有或插件来源的
  OMO MCP。
- Team session 指定 `allowedServerIds`：只允许显式列入的 server，再叠加全局禁用、会话可见性、
  permission 与 audit 规则。

这条规则避免团队执行器在没有明确授权时继承用户私有插件来源 OMO MCP，同时保留普通聊天的现有可用性。

## Scope Out

本 ADR 明确排除：

- 不写用户本机 Codex/OMO 配置目录。
- 不让 hook 直接执行系统命令。
- 不绕过 sandbox、permission、session visibility 或 audit。
- 不把 `codegraph`、`lsp`、`git_bash` 复制成 `mcp__omo__codegraph_*` 等重复工具。
- 不编辑 `.evidence/`。

## 读者检查清单

实现或评审 OMO MCP 相关改动时，先确认：

- Agent 可见工具是否只来自 OpenAWork MCP catalog / gateway tool registry。
- OMO adapter 是否只把 manifest parse 成 typed data，再映射到 MCP catalog。
- `lazycodex-ai` 是否仍未成为 runtime dependency。
- hook 是否只在 before/after 边界修改 args 或观察结果。
- `tool-sandbox`、permission、session visibility、audit 是否仍在执行链路中。
- Settings 是否从 gateway runtime 同源读取/保存，而不是前端直接 fetch gateway。
- team 的 `allowedServerIds` 是否保持最小授权语义。
