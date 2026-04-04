# 260404 LSP language server coverage Dockerfile 实施

## Task Overview

在 Rust、JSON / HTML / CSS、YAML 的 gateway-side coverage 都完成并归档后，继续推进 richer LSP 的下一条 coverage 扩展：**增加 Dockerfile gateway-side language server coverage**。

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
  - `rust-analyzer`
- `packages/lsp-client/src/language.ts` 已能按文件名把 `Dockerfile` 识别为 `dockerfile`。
- 但 `packages/lsp-client/src/server.ts` 的 `findServerForFile()` 仍然只按扩展名匹配 server，尚不支持 `Dockerfile` 这类无扩展名但按文件名识别的语言。
- 因此 Dockerfile 这一轮不只是“再加一个 server”，还需要把 **filename-based server matching** 作为最小必要能力补进来。

## Solution Design

- 本轮 scope 冻结为：
  - `Dockerfile` → `docker-language-server start --stdio`
  - 补齐 `Dockerfile` filename-based server matching
- 继续保持保守原则：
  - 只补 gateway-side server definition / server selection / filetype metadata / exports / tests
  - 不改 semantic query tool surface
  - 不扩到 Compose / Bake 的额外专项配置
  - 不处理与本轮无关的构建/诊断问题

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 范围冻结 / lsp-client server 与 filename matching 接线 / 测试与文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + 相关测试/验证 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: Dockerfile coverage 需要同时修改 server definition、filename-based matching 逻辑、测试与文档状态；这已经超过单文件微调，继续采用 full orchestration 最稳妥。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：冻结 Dockerfile-only 范围、可执行名与 filename-based matching 方案

### Phase 1：server coverage 接线

- [x] T-02：在 `packages/lsp-client/src/server.ts` 新增 `DockerfileServer` 并纳入 `ALL_SERVERS`
- [x] T-03：在 `packages/lsp-client/src/server.ts` 把 `findServerForFile()` 从纯扩展名匹配升级为支持文件名匹配
- [x] T-04：在 `packages/lsp-client/src/lsp-filetypes.ts` 补齐 `dockerfile` 对应 filetype/root marker 条目，并在 `index.ts` 导出 `DockerfileServer`

### Phase 2：测试与验证

- [x] T-05：扩展 `packages/lsp-client/src/__tests__/server.test.ts` 验证 `Dockerfile` 命中、server 列表包含与 filename matching 断言
- [x] T-06：运行 diagnostics、`pnpm --filter @openAwork/lsp-client test`、`pnpm --filter @openAwork/lsp-client build`

### Phase 3：文档收口与复核

- [x] T-07：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [x] T-08：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 本轮继续遵守用户新增边界：若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。
- 本轮非目标：
  - Compose / Bake 专项支持
  - `docker-language-server` 的 telemetry / deeper initialization options
  - `bash-language-server`
  - 新的 richer semantic query tool
- 本轮冻结后的具体方案：
  - server 可执行名：`docker-language-server start --stdio`
  - server id：`dockerfile`
  - 只做 Dockerfile，不扩到 Compose / Bake
  - `findServerForFile()` 需要支持 `Dockerfile` 这类文件名匹配，不能继续只看扩展名
- 当前主线程验证已通过：
  - `packages/lsp-client/src/server.ts`、`index.ts`、`lsp-filetypes.ts`、`__tests__/server.test.ts` diagnostics 无错误
  - `pnpm --filter @openAwork/lsp-client test` 通过
  - `pnpm --filter @openAwork/lsp-client build` 通过
- 本轮实际落地内容：
  - gateway-side 新增 `DockerfileServer`
  - `ALL_SERVERS` 现已包含 `dockerfile`
  - `packages/lsp-client/src/index.ts` 已导出 `DockerfileServer`
  - `packages/lsp-client/src/lsp-filetypes.ts` 已补齐 `dockerfile` 条目与 root marker
  - `findServerForFile()` 已从纯扩展名匹配升级为支持 filename-based matching
  - `packages/lsp-client/src/__tests__/server.test.ts` 已覆盖 `Dockerfile` 命中、server 列表与 filename matching 断言
- Librarian 校准结论：Dockerfile 继续采用 `docker-language-server start --stdio`；Compose / Bake 与 deeper initialization options 不纳入本轮。
- Oracle 复核结论：当前 Dockerfile-only coverage 扩展已满足范围冻结要求，`DockerfileServer`、filename-based matching、测试与文档状态均已闭环，工作流可归档。
- Memory sync: completed
