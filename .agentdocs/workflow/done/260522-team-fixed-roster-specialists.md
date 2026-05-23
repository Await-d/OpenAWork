# Team 固定团队与专长成员扩展

> 创建时间：2026-05-22
> 状态：完成

## Task Overview

把 Team 从“按 taskProfile 切换 executor 提示词”升级为“页面可见、可创建的默认固定团队”，并覆盖 DevOps / SRE / Platform / Security / Release / Observability 等专长成员。

## Current Analysis

- `roleLayer` 当前是运行时协议边界：`user / reception / pm1 / pm2 / executor / reviewer`。
- `taskProfile(kind + surface)` 已能描述任务画像，但不是可见人员。
- Team 创建实施方案已有 `teamDefinition` 快照方向，但 required roles 仍偏旧四角色，缺少全层级默认人物与专长成员。
- 新增人员不应扩成新 `roleLayer`，否则会牵动 capability matrix、handoff、substate、persona seed 和大量路由。

## Solution Design

1. 保持 `roleLayer` 枚举不变。
2. 新增/明确“可见成员槽位”概念：`layer + specialty + displayName + personaKey + toolsets + required`。
3. 默认固定团队覆盖所有层级：reception、pm1、pm2、executor、reviewer。
4. DevOps / Platform 放 executor；Release 放 pm2；Security / SRE / Observability 默认放 reviewer，可按任务需要被 executor 执行实现型任务。
5. Team 页面展示“运行层 → 具体人物卡片”，创建会话时保存 roster 快照到 `sessions.metadata_json.teamDefinition`。

## Complexity Assessment
- Atomic steps: 6+ → +2
- Parallel streams: yes（文档、模型、UI/API）→ +2
- Modules/systems/services: 5+ → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 涉及 Team 架构文档、创建方案、前后端模型和 UI 展示，应先冻结方案与构思，再分阶段实现。

## Implementation Plan

### Phase 1: 方案与构思
- [x] T-01: 更新 Team 创建实施方案，纳入全层级固定成员与专长扩展 ✅
- [x] T-02: 更新 L1 架构文档，明确 roleLayer 与 visible member 的边界 ✅

### Phase 2: 模型与默认值
- [x] T-03: 定义默认固定团队成员槽位与 specialty taxonomy ✅
- [x] T-04: 扩展创建流/metadata 类型以承载 specialist roster ✅

### Phase 3: 页面展示与验证
- [x] T-05: 页面按层级展示默认固定团队成员 ✅
- [x] T-06: 补充测试、diagnostics、构建验证 ✅

## Notes

- Memory sync: completed
