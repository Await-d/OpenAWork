# 260404 LSP language server coverage 扩展实施

## Task Overview

在 richer LSP 的语义工具主线（Phase 1、hover、implementation、call hierarchy）全部完成并归档后，继续推进下一条最自然的 follow-up：**扩展 gateway-side language server coverage**。

本轮目标不是再增加新的语义工具，而是让当前已经存在的 richer LSP 查询能力在更多语言上真正可用。

## Current Analysis

- 当前 gateway-side 内置 runtime server 只有：
  - `typescript`
  - `gopls`
  - `pyright`
- 但 `packages/lsp-client/src/lsp-filetypes.ts` 中已经登记了大量语言：Rust、Java、C#、Ruby、C/C++、Kotlin、Swift、PHP、Lua、Dart、Elixir、Haskell、Zig 等。
- 这意味着当前存在一个明确断层：**filetype matrix 远大于 runtime server coverage**。
- 另一个重要信号是：`packages/lsp-client/src/tauri.ts` 已经存在额外 server 定义：
  - `rust-analyzer`
  - `eslint`
  - `biome`
- 因此本轮 language server coverage 扩展的最小高价值方向，很可能是：
  - 优先把已有配置/惯例最接近的 server 带到 gateway-side
  - 避免一次性引入过多依赖或需要复杂安装前置条件的语言

## Solution Design

- 本轮先冻结“最小可实施 server 集合”，再做实现，不把 coverage 扩成大而泛的语言清单工程。
- 评估维度固定为：
  1. 当前仓库是否已有相近配置（如 `tauri.ts`）
  2. 语言 server 的可执行名 / 安装方式是否保守、稳定
  3. 是否会与当前 server 冲突（如 ESLint/Biome vs TypeScript）
  4. 是否能在不扩散 unrelated errors 的前提下完成 build / verification
- 本轮要遵守用户新增边界：**若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。**

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 仓库覆盖盘点 / 外部 server 选择 / workflow 文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + 相关 verification/docs → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是 richer LSP 的下一条正式主线，需要先做 coverage 盘点与 candidate 选择，再冻结实现范围并完成代码、验证与文档同步；继续使用 full orchestration 最稳妥。

## Implementation Plan

### Phase 0：盘点与范围冻结

- [x] T-01：盘点当前 filetype matrix、gateway-side runtime server 与现有 extra server 配置
- [x] T-02：冻结本轮扩展的具体语言/server 范围与非目标

### Phase 1：server coverage 接线

- [x] T-03：在 `packages/lsp-client/src/server.ts` 扩展新的 gateway-side server 定义与 `ALL_SERVERS`
- [x] T-04：如有需要，同步相关 language/root marker/辅助导出

### Phase 2：验证与文档同步

- [x] T-05：补齐与 coverage 扩展直接相关的最小测试或 verification
- [x] T-06：运行 diagnostics、相关测试、相关 build（仅处理本轮改动引入的问题）
- [x] T-07：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-08：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 当前 richer LSP 语义工具主线已完成并归档：不要回头扩 scope 到新的 query tool。
- 本轮优先目标是“让现有工具在更多语言上可跑”，不是“把所有语言一次接齐”。
- 遇到非本次 coverage 扩展引入的错误时，默认不扩散治理，只记录为外部阻塞或现存问题。
- 本轮冻结后的最小实现范围：只把 **Rust / `rust-analyzer`** 从 `packages/lsp-client/src/tauri.ts` 的既有 extra server 定义带到 gateway-side `packages/lsp-client/src/server.ts` / `ALL_SERVERS`。
- 选择 Rust 的原因：
  - `lsp-filetypes.ts` 已有 Rust filetype/root marker
  - `tauri.ts` 已有现成 `rust-analyzer` server 定义，可直接复用惯例
  - `rust-analyzer` 是单二进制，较 Node-based server 更不容易引入额外运行时打包复杂度
- 本轮非目标：
  - 不引入 `eslint` / `biome` 到 gateway-side（避免与现有 TypeScript 语义能力重叠并引入额外噪音）
  - 不新增 JSON/HTML/CSS/YAML/Dockerfile/Bash coverage
  - 不修改 semantic query tool surface
- Explore 子任务 `bg_9d218576` 因 API key 过期失败，属于本次工作外部错误；本轮不治理该问题，结论改由本地代码证据 + librarian 结果支撑。
- 当前主线程验证已通过：
  - `packages/lsp-client/src/server.ts`、`index.ts`、`__tests__/server.test.ts` diagnostics 无错误（`index.ts` 仅有既有 unused-parameter hint）
  - `pnpm --filter @openAwork/lsp-client test` 通过
  - `pnpm --filter @openAwork/lsp-client build` 通过
- 本轮实际落地内容：
  - gateway-side 新增 `RustAnalyzerServer`
  - `ALL_SERVERS` 现已包含 `rust-analyzer`
  - `packages/lsp-client/src/index.ts` 已导出 `RustAnalyzerServer`
  - `packages/lsp-client/src/__tests__/server.test.ts` 已覆盖 `.rs` 命中、server 列表与扩展名断言
- Oracle 复核结论：当前 Rust-only coverage 扩展已满足范围冻结要求，`rust-analyzer` 的 gateway-side parity、测试与文档状态均已闭环，工作流可归档。
- Memory sync: completed
