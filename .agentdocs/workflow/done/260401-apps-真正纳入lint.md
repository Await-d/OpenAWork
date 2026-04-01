# .agentdocs/workflow/260401-apps-真正纳入lint.md

## Task Overview

优先让 `apps/desktop`、`apps/mobile` 真正纳入仓库 ESLint 检查；`apps/web` 暂不阻塞当前收口，后续再单独处理其历史 lint 债务。

## Current Analysis

当前根 `eslint.config.js` 曾通过 `apps/**` 全局忽略把应用层整体排除在外；之后虽然短暂把 apps 全部接入了 lint，但 `apps/web` 暴露出一大批历史问题。根据最新用户指令，当前阶段先只收口 `desktop/mobile`，`web` 暂不阻塞。

## Solution Design

按两层收口：

1. 先调整根 ESLint 配置和 app 脚本，让 `desktop/mobile` 被真正纳入检查，同时保留 `web` 暂不阻塞。
2. 再分批修复 `desktop/mobile` 暴露的 lint 问题，直到相关 lint 命令通过。

## Complexity Assessment

- Atomic steps: 3–4 → 0
- Parallel streams: no → 0
- Modules/systems/services: 3（根 ESLint + desktop + mobile）→ +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: no → 0
- OpenCode available: yes → -1
- **Total score**: 1
- **Chosen mode**: Lightweight
- **Routing rationale**: 这是一个跨多个 app 的配置与代码收敛任务，但依赖关系清晰，适合使用轻量工作流追踪并在当前上下文顺序执行。

## Implementation Plan

### Phase 1: 配置纳入
- [x] T-01: 审查 desktop/mobile 的 ESLint / tsconfig / package 脚本现状与真实报错面
- [x] T-02: 调整根 ESLint 配置与 app lint 脚本，使 desktop/mobile 真正参与 lint，web 暂不阻塞

### Phase 2: 代码收口
- [x] T-03: 分批修复 desktop/mobile 暴露的 lint 错误
- [x] T-04: 运行 desktop/mobile 相关 lint / typecheck 验证回归
- [x] T-05: 记录结论并同步记忆

## Notes

- 用户已明确：`web` 先不处理，因此当前以 `desktop/mobile` 收口为准；`web` 的 lint 历史债务后续单开任务处理。
- 已同步补齐 `quality` CI 对 `desktop/mobile` 的 lint/typecheck 覆盖，以及根 `lint-staged` 对 `apps/desktop` / `apps/mobile` 的 ESLint 兜底。
- `web` 当前仅在 lint 层面暂缓，typecheck 仍保留；同时由于 desktop 直接复用部分 web 源码，web 改动仍可能影响 desktop 的 typecheck。
- Memory sync: completed
