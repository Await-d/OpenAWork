# 260404 LSP language server coverage YAML 实施

## Task Overview

在 Rust-only coverage parity 与 JSON / HTML / CSS 第二轮 coverage 都完成并归档后，继续推进 richer LSP 的下一条 coverage 扩展：**增加 YAML gateway-side language server coverage**。

本轮依旧只做 coverage 扩展，不增加新的 semantic query tool。

## Current Analysis

- 当前 gateway-side runtime server 已支持：
  - `typescript`
  - `gopls`
  - `pyright`
  - `rust-analyzer`
  - `json`
  - `html`
  - `css`
- `packages/lsp-client/src/language.ts` 已有 `.yaml` / `.yml` → `yaml` 映射。
- 但 `packages/lsp-client/src/lsp-filetypes.ts` 与 `packages/lsp-client/src/server.ts` 尚未给 YAML 配套 gateway-side runtime server。
- 结合前一轮参考库结论，YAML 是在 JSON / HTML / CSS 之后的下一条高价值 coverage 扩展。

## Solution Design

- 本轮 scope 冻结为：
  - `YAML` → `yaml-language-server --stdio`
- 继续保持保守原则：
  - 只补 gateway-side server definition / filetype metadata / exports / tests
  - 不改 semantic query tool surface
  - 不顺带引入 schema-store、telemetry 或其他更深的 YAML 专项配置
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
- **Routing rationale**: YAML coverage 是 language server coverage 的下一条正式扩展，需要同步修改 server/filetype 元数据、测试与文档状态，因此继续采用 full orchestration。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：冻结 YAML-only 范围与非目标

### Phase 1：server coverage 接线

- [x] T-02：在 `packages/lsp-client/src/server.ts` 新增 `YamlServer` 并纳入 `ALL_SERVERS`
- [x] T-03：在 `packages/lsp-client/src/lsp-filetypes.ts` 补齐 `yaml` 对应 filetype/root marker 条目
- [x] T-04：在 `packages/lsp-client/src/index.ts` 导出 `YamlServer`

### Phase 2：测试与验证

- [x] T-05：扩展 `packages/lsp-client/src/__tests__/server.test.ts` 验证 `.yaml/.yml` 命中、server 列表包含与扩展名断言
- [x] T-06：运行 diagnostics、`pnpm --filter @openAwork/lsp-client test`、`pnpm --filter @openAwork/lsp-client build`

### Phase 3：文档收口与复核

- [x] T-07：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-08：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 本轮继续遵守用户新增边界：若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。
- 本轮非目标：
  - `vscode-eslint-language-server`
  - `docker-langserver`
  - `bash-language-server`
  - YAML schema-store 深度配置
  - 新的 richer semantic query tool
- 当前主线程验证已通过：
  - `packages/lsp-client/src/server.ts`、`index.ts`、`lsp-filetypes.ts`、`__tests__/server.test.ts` diagnostics 无错误
  - `pnpm --filter @openAwork/lsp-client test` 通过
  - `pnpm --filter @openAwork/lsp-client build` 通过
- 本轮实际落地内容：
  - gateway-side 新增 `YamlServer`
  - `ALL_SERVERS` 现已包含 `yaml`
  - `packages/lsp-client/src/index.ts` 已导出 `YamlServer`
  - `packages/lsp-client/src/lsp-filetypes.ts` 已补齐 YAML 的 filetype/root marker 条目
  - `packages/lsp-client/src/__tests__/server.test.ts` 已覆盖 `.yaml` 命中、server 列表与扩展名断言
- Librarian 校准结论：YAML 继续使用 `yaml-language-server --stdio` 即可；schema store / Kubernetes CRD store 默认有额外网络与配置复杂度，本轮保持不接入。
- Oracle 复核结论：当前 YAML-only coverage 扩展已满足范围冻结要求，`YamlServer` 的 gateway-side parity、测试与文档状态均已闭环，工作流可归档。
- Memory sync: completed
