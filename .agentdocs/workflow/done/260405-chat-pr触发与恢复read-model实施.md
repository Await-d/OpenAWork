# 260405 Chat PR 触发与恢复 Read Model 实施

## Task Overview

在 chat 恢复链已有 fast/live CI 分层的基础上，继续推进两项高价值增强：
1. 让 `chat-recovery-live` 在高风险 PR 也能自动触发；
2. 实现 recovery read model，减少刷新恢复时的多次请求与状态重建延迟。

## Current Analysis

- 当前 live gate 仅在 push 且路径相关时运行，PR 上仍缺高风险自动触发策略。
- 当前刷新恢复仍依赖多次请求拼装：session snapshot、active stream、pending permission、pending question。

## Solution Design

- CI：为 live gate 增加“高风险 PR”条件；
- Gateway/Web：增加单次 recovery read model，并让 ChatPage 优先消费。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: CI 优化 + recovery endpoint + web 消费 + 验证 → +2
- Modules/systems/services: GitHub Actions + gateway + web-client + web → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是对现有恢复链体验与工程门禁的双向增强，涉及多模块协同与验证，需要完整跟踪。

## Implementation Plan

### Phase 1：高风险 PR 触发
- [x] T-01：让 live gate 在高风险 PR 自动触发

### Phase 2：恢复读模型
- [x] T-02：设计并实现 recovery read model
- [x] T-03：让 web 消费 recovery read model

### Phase 3：验证与归档
- [x] T-04：运行 fast/live 与类型/构建验证
- [x] T-05：同步结论与归档

## Final Outcome

- CI：`chat-recovery-live` 已支持高风险 PR 自动触发，保留路径感知与 label override。
- Gateway：新增 `GET /sessions/:sessionId/recovery`，聚合返回 `session / ratings / activeStream / children / tasks / todoLanes / pendingPermissions / pendingQuestions`。
- Web Client：新增 `getRecovery(...)` 与 `SessionRecoveryReadModel` 导出。
- Web：`ChatPage` 主加载、软刷新、终态同步、分支创建已切到 `getRecovery(...)`，移除恢复主链上的旧 `sessionsClient.get(...)`。
- Layout：pending permission / question 初始读取与刷新桥已走 recovery 聚合读取。
- 轮询策略：运行中的 remote recovery poll 生效时不再叠加 sidebar fan-out；本地 streaming 期间仍允许立即轮询子资源，stream 结束但 task 仍活跃时延迟一个周期再轮询，避免 recovery 首屏与下一轮 sidebar poll 重叠。

## Verification

- `pnpm --filter @openAwork/web exec vitest run src/pages/ChatPage.test.tsx src/pages/ChatPage.commands.test.tsx src/pages/chat-page/right-panel-sections.test.tsx`
- `pnpm --filter @openAwork/web exec tsc --noEmit`
- `pnpm --filter @openAwork/web build`

## Notes

- 本次不做 warm-resume 本地缓存，先优先做 read model 聚合。
