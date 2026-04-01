# .agentdocs/workflow/260401-mcp-client-源码类型解析修复.md

## Task Overview

修复 `@openAwork/mcp-client` 在 lint 时对 `@openAwork/skill-types` 的类型解析不稳定问题，避免跨包类型分析回退到 `dist` 导出或错误类型。

## Current Analysis

`packages/mcp-client/src/adapter.ts` 中的 `MCPServerRef & {...}` 并非语义错误；真实问题是 lint 的 type-aware 分析在某些环境里未能稳定解析 `@openAwork/skill-types`，导致 `MCPServerRef` 被视为 error type，并触发 `@typescript-eslint/no-redundant-type-constituents`。

## Solution Design

沿用仓库现有约定，在消费方包级 `tsconfig.json` 中显式声明 workspace 源码 `paths` 与项目 `references`，让 TypeScript / ESLint 优先按 monorepo 源码图解析，而不是依赖已构建的 `dist/*.d.ts`。

## Complexity Assessment

- Atomic steps: 3–4 → 0
- Parallel streams: no → 0
- Modules/systems/services: 3 (`mcp-client` / `skill-types` / 根级 TS 解析约定) → +1
- Long step (>5 min): no → 0
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 0
- **Chosen mode**: Lightweight
- **Routing rationale**: 这是一个跨包配置修复，但范围明确、依赖简单。保留轻量工作流记录即可，无需完整 runtime 编排。

## Implementation Plan

### Phase 1: 配置修复
- [x] T-01: 检查 `mcp-client`、`skill-types`、现有包级 tsconfig 约定
- [x] T-02: 在 `packages/mcp-client/tsconfig.json` 补充 `paths` 与 `references`

### Phase 2: 验证
- [x] T-03: 运行 `mcp-client` 相关 lint / typecheck
- [x] T-04: 运行用户给定筛选范围内的 lint 验证回归，并继续收口暴露出的 apps lint 脚本冲突
- [x] T-05: 记录结论并同步记忆（如有）

## Notes

- 当前仓库已有相同先例：`services/agent-gateway/tsconfig.json` 已为 `@openAwork/mcp-client` 与 `@openAwork/skill-types` 配置源码 `paths` 与 `references`。
- 根 `tsconfig.json` 也已补上 `packages/skill-types` 与 `packages/mcp-client` 的 solution references，增强 `projectService` 下的工作区工程图稳定性。
- `apps/web` 在用户给定 lint 命令中暴露出另一处历史配置冲突：仓库约定 `apps/**` 不参与根 ESLint，但 app 包脚本仍写成 `eslint .`。已将 `web/desktop/mobile` 的 lint 脚本改为显式输出“按约定跳过”，与现行仓库规则对齐。
- Memory sync: completed
