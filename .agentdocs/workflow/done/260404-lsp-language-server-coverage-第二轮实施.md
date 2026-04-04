# 260404 LSP language server coverage 第二轮实施

## Task Overview

在 Rust-only gateway-side coverage parity 已完成并归档后，继续推进 richer LSP 的下一条 language server coverage 扩展：**基于 `vscode-langservers-extracted` 增加 JSON / HTML / CSS 三类 server coverage**。

本轮目标依旧不是增加新的语义工具，而是让当前已经存在的 richer LSP 查询能力在更多常见前端/配置文件类型上真正可用。

## Current Analysis

- 当前 gateway-side runtime server 已支持：
  - `typescript`
  - `gopls`
  - `pyright`
  - `rust-analyzer`
- `packages/lsp-client/src/language.ts` 已有：
  - `.json` / `.jsonc` / `.json5`
  - `.html` / `.htm`
  - `.css` / `.scss` / `.sass` / `.less`
- 但 `packages/lsp-client/src/lsp-filetypes.ts` 与 `packages/lsp-client/src/server.ts` 尚未给这些文件类型配套 gateway-side runtime server。
- 前一轮参考库/上游资料已得出排序：
  - `vscode-langservers-extracted` 是下一个最高性价比的扩展来源
  - 其中 `vscode-json-language-server` / `vscode-html-language-server` / `vscode-css-language-server` 是低风险高收益组合
  - `vscode-eslint-language-server` 虽同包存在，但更容易引入额外诊断噪音，因此不纳入本轮

## Solution Design

- 本轮 scope 冻结为：
  - `JSON` → `vscode-json-language-server --stdio`
  - `HTML` → `vscode-html-language-server --stdio`
  - `CSS` → `vscode-css-language-server --stdio`
- 继续保持 coverage 扩展的保守原则：
  - 只补 gateway-side server definition / filetype metadata / exports / tests
  - 不改 semantic query tool surface
  - 不顺带引入 eslint server
  - 不处理与本轮无关的构建/诊断问题

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 覆盖范围冻结 / lsp-client server 与 filetype 接线 / 测试与文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + 相关测试/验证 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这不是单文件微调，而是 language server coverage 第二轮正式扩展；需要同时冻结范围、修改 server/filetype 元数据、补齐测试并同步工作流状态，因此继续采用 full orchestration。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：确认第二轮 coverage 扩展目标为 JSON / HTML / CSS，并排除 eslint

### Phase 1：server coverage 接线

- [x] T-02：在 `packages/lsp-client/src/server.ts` 新增 JSON / HTML / CSS server definition 并纳入 `ALL_SERVERS`
- [x] T-03：在 `packages/lsp-client/src/lsp-filetypes.ts` 补齐 JSON / HTML / CSS 对应 filetype/root marker 条目
- [x] T-04：在 `packages/lsp-client/src/index.ts` 补齐新增 server 的导出

### Phase 2：测试与验证

- [x] T-05：扩展 `packages/lsp-client/src/__tests__/server.test.ts`（必要时补充已有相关测试文件）验证新 server 命中与列表包含
- [x] T-06：运行 diagnostics、`pnpm --filter @openAwork/lsp-client test`、`pnpm --filter @openAwork/lsp-client build`

### Phase 3：文档收口与复核

- [x] T-07：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-08：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 本轮继续遵守用户新增边界：若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。
- 本轮非目标：
  - `vscode-eslint-language-server`
  - `yaml-language-server`
  - `docker-langserver`
  - `bash-language-server`
  - 新的 richer semantic query tool
- 当前主线程验证已通过：
  - `packages/lsp-client/src/server.ts`、`index.ts`、`lsp-filetypes.ts`、`__tests__/server.test.ts` diagnostics 无错误（`index.ts` 仅有既有 unused-parameter hint）
  - `pnpm --filter @openAwork/lsp-client test` 通过
  - `pnpm --filter @openAwork/lsp-client build` 通过
- 本轮实际落地内容：
  - gateway-side 新增 `JsonServer` / `HtmlServer` / `CssServer`
  - `ALL_SERVERS` 现已包含 `json` / `html` / `css`
  - `packages/lsp-client/src/index.ts` 已导出新增 server
  - `packages/lsp-client/src/lsp-filetypes.ts` 已补齐 JSON / HTML / CSS 的 filetype/root marker 条目
  - `packages/lsp-client/src/__tests__/server.test.ts` 已覆盖 `.json` / `.html` / `.css` 命中、server 列表与扩展名断言
- Oracle 复核结论：当前 JSON / HTML / CSS 第二轮 coverage 扩展已满足范围冻结要求，server/filetype/export/test/documentation 状态均已闭环，工作流可归档。
- Memory sync: completed
