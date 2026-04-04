# 260404 LSP language server coverage Bash 实施

## Task Overview

在 Rust、JSON / HTML / CSS、YAML、Dockerfile 的 gateway-side coverage 都完成并归档后，继续推进 richer LSP 的下一条 coverage 扩展：**增加 Bash / shellscript gateway-side language server coverage**。

本轮依旧只做 coverage 扩展，不增加新的 semantic query tool。

## Current Analysis

- 当前 gateway-side runtime server 已支持：
  - `typescript`
  - `gopls`
  - `pyright`
  - `json`
  - `html`
  - `css`
  - `yaml`
  - `dockerfile`
  - `rust-analyzer`
- `packages/lsp-client/src/language.ts` 已把下列扩展映射为 `shellscript`：
  - `.sh`
  - `.bash`
  - `.zsh`
- `fish` 与 `powershell` 已有独立 language id，不应在本轮 Bash coverage 中混入。
- 当前 `packages/lsp-client/src/lsp-filetypes.ts` 与 `packages/lsp-client/src/server.ts` 尚未给 `shellscript` 配套 gateway-side runtime server。

## Solution Design

- 本轮 scope 暂定为：
  - `shellscript` → Bash language server（待背景检查返回后冻结具体可执行名/命令形态）
- 继续保持保守原则：
  - 只补 gateway-side server definition / filetype metadata / exports / tests
  - 不改 semantic query tool surface
  - 不把 `fish` / `powershell` / shell lint 深度配置 一并带入
  - 不处理与本轮无关的构建/诊断问题

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 范围冻结 / lsp-client server 与 filetype 接线 / 测试与文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + 相关测试/验证 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: Bash coverage 是 language server coverage 的下一条正式扩展，需要同时冻结范围、接线 server/filetype、补测试并同步文档状态，因此继续采用 full orchestration。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：冻结 Bash-only 范围、可执行名与非目标

### Phase 1：server coverage 接线

- [x] T-02：在 `packages/lsp-client/src/server.ts` 新增 `ShellscriptServer`（命名待冻结）并纳入 `ALL_SERVERS`
- [x] T-03：在 `packages/lsp-client/src/lsp-filetypes.ts` 补齐 `shellscript` 对应 filetype/root marker 条目，并在 `index.ts` 导出新增 server

### Phase 2：测试与验证

- [x] T-04：扩展 `packages/lsp-client/src/__tests__/server.test.ts` 验证 `.sh/.bash/.zsh` 命中、server 列表包含与扩展名断言
- [x] T-05：运行 diagnostics、`pnpm --filter @openAwork/lsp-client test`、`pnpm --filter @openAwork/lsp-client build`

### Phase 3：文档收口与复核

- [x] T-06：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-07：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 本轮继续遵守用户新增边界：若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。
- 本轮非目标：
  - `fish`
  - `powershell`
  - shellcheck / shfmt / lint 深度配置
  - 新的 richer semantic query tool
- 本轮冻结后的具体方案：
  - server 可执行名：`bash-language-server start`
  - server id：`shellscript`
  - 覆盖范围限定为 `.sh` / `.bash` / `.zsh`
  - 不把 `fish` / `powershell` 混入本轮
  - 不顺带接 shellcheck / shfmt / 诊断深度配置
- 当前主线程验证已通过：
  - `packages/lsp-client/src/server.ts`、`index.ts`、`lsp-filetypes.ts`、`__tests__/server.test.ts` diagnostics 无错误
  - `pnpm --filter @openAwork/lsp-client test` 通过
  - `pnpm --filter @openAwork/lsp-client build` 通过
- 本轮实际落地内容：
  - gateway-side 新增 `ShellscriptServer`
  - `ALL_SERVERS` 现已包含 `shellscript`
  - `packages/lsp-client/src/index.ts` 已导出 `ShellscriptServer`
  - `packages/lsp-client/src/lsp-filetypes.ts` 已补齐 `shellscript` 条目与 root marker
  - `packages/lsp-client/src/__tests__/server.test.ts` 已覆盖 `.sh` / `.bash` / `.zsh` 命中、server 列表与扩展名断言
  - Librarian 子任务因外部 API key 过期失败，属于本轮外部问题；本轮未扩散处理，保守可执行名采用社区通用的 `bash-language-server start`
- Oracle 复核结论：当前 Bash/shellscript-only coverage 扩展已满足范围冻结要求，`ShellscriptServer`、测试与文档状态均已闭环，工作流可归档。
- Memory sync: completed
