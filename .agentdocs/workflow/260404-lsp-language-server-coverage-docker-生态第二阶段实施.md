# 260404 LSP language server coverage Docker 生态第二阶段实施

## Task Overview

在 Dockerfile coverage 已完成并归档后，继续推进 richer LSP 的 Docker 生态 coverage：**增加 Compose / Bake gateway-side language server coverage**。

本轮依旧只做 coverage 扩展，不增加新的 semantic query tool。

## Current Analysis

- 当前 gateway-side 已支持 `dockerfile`，且 `findServerForFile()` 已支持 basename 命中。
- Docker 官方 language server 同一个 `docker-language-server` 同时覆盖：
  - Dockerfile
  - Compose files
  - Bake files
- 但当前 OpenAWork 仍缺：
  - `dockercompose` language id 的文件名识别与 server coverage
  - `dockerbake` language id 的文件名识别与 server coverage
- 参考官方资料：
  - Compose 常见文件名：`compose.yaml|yml`、`docker-compose.yaml|yml`（以及 override 变体）
  - Bake 当前保守支持目标：`docker-bake.hcl`、`docker-bake.override.hcl`
  - Bake CLI 虽可接受其他格式，但本轮不扩张到所有 `.hcl` / `.json`

## Solution Design

- 本轮 scope 冻结为：
  - `dockercompose` → `docker-language-server start --stdio`
  - `dockerbake` → `docker-language-server start --stdio`
- 继续保持保守原则：
  - Compose 只按**规范文件名**命中，不吞掉全部 `.yaml/.yml`
  - Bake 只按 `docker-bake*.hcl` 命中，不吞掉全部 `.hcl`
  - 不改 semantic query tool surface
  - 不扩到 Compose/Bake deeper initialization options、telemetry、或全部 HCL/JSON 泛化支持

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 范围冻结 / language & filetype & server 接线 / 测试与文档同步 → +2
- Modules/systems/services: `.agentdocs` + `packages/lsp-client` + 相关测试/验证 → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这轮不只是加 server，还需要补 languageId 的文件名识别与受控的 basename 匹配策略，因此继续采用 full orchestration。

## Implementation Plan

### Phase 0：范围冻结

- [x] T-01：冻结 Compose / Bake 的文件名策略、language id 与非目标范围

### Phase 1：language + server coverage 接线

- [ ] T-02：在 `packages/lsp-client/src/language.ts` 增加 Compose / Bake 的 basename → languageId 识别
- [ ] T-03：在 `packages/lsp-client/src/server.ts` 新增 `DockerComposeServer` 与 `DockerBakeServer`，并纳入 `ALL_SERVERS`
- [ ] T-04：在 `packages/lsp-client/src/lsp-filetypes.ts` 补齐 `dockercompose` / `dockerbake` 条目，并在 `index.ts` 导出新增 server

### Phase 2：测试与验证

- [ ] T-05：扩展现有测试，覆盖 Compose / Bake 文件名命中、server 列表与 languageId 断言
- [ ] T-06：运行 diagnostics、`pnpm --filter @openAwork/lsp-client test`、`pnpm --filter @openAwork/lsp-client build`

### Phase 3：文档收口与复核

- [ ] T-07：同步 `.agentdocs/index.md` 与当前 workflow 状态
- [ ] T-08：Oracle 只读复核并决定是否归档本 workflow

## Notes

- 本轮继续遵守用户新增边界：若遇到不是本次改动引入的错误，不扩散处理，只在最终结果中注明。
- 本轮非目标：
  - 泛化所有 `.yaml` 为 Compose
  - 泛化所有 `.hcl` 为 Bake
  - Compose/Bake telemetry 与 deeper initialization options
  - 新的 richer semantic query tool
- 本轮冻结后的具体方案：
  - `dockercompose` 文件名：`compose.yaml`、`compose.yml`、`docker-compose.yaml`、`docker-compose.yml`、`compose.override.yaml`、`compose.override.yml`、`docker-compose.override.yaml`、`docker-compose.override.yml`
  - `dockerbake` 文件名：`docker-bake.hcl`、`docker-bake.override.hcl`
  - Compose / Bake 都继续复用 `docker-language-server start --stdio`
  - 不把所有 `.yaml` / `.hcl` 泛化给 Docker language server
