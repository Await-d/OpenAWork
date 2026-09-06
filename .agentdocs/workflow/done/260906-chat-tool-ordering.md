# Chat 工具消息顺序修复

## Task Overview

定位并修复聊天消息在实时流、快照对账和工具卡渲染中的先后顺序错位，重点覆盖工具调用与前后文本交错的场景。

## Current Analysis

已修复 attach 恢复时按类型分桶重建的问题，但用户实测仍有错序，说明至少还存在另一条路径。当前候选包括：跨消息工具合并错误、快照对账丢失有序 parts、服务端消息 part 查询不稳定，以及虚拟化高度更新造成的视觉错位。工作树包含大量用户并行修改，必须只触碰确认相关文件。

## Solution Design

先分别获取四条链路的源码证据并建立失败测试，再只修复被测试证实的根因。数据顺序与视觉布局分开验证：单元测试验证 parts/消息顺序，浏览器测试验证 DOM 几何位置和工具卡动态高度。

## Complexity Assessment

- Atomic steps: 6 → +2
- Parallel streams: yes → +2
- Modules or systems: 4 → +1
- Long step over 5 min: yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no → 0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 问题横跨前端恢复、消息对账、服务端持久化和虚拟化布局，需要并行取证与分阶段验证。

## Implementation Plan

### Phase 1: 并行取证

- [x] T-01 ✅: 验证跨消息工具合并是否越过含 parts 文本的消息
- [x] T-02 ✅: 验证快照 reconciliation 是否保留本地有序 parts
- [x] T-03 ✅: 验证服务端 V2 parts 查询与 V1 投影的稳定顺序
- [x] T-04 ✅: 验证虚拟化列表在工具卡高度变化时是否发生视觉重叠

### Phase 2: 修复与验证

- [x] T-05 ✅: 为已证实根因建立失败测试并实施最小修复
- [x] T-06 ✅: 完成专项、类型、构建、格式及浏览器回归验证

## Notes

- 用户此前已明确要求“修复优化”，满足实现批准门槛。
- 2026-09-06：工作树已有大量无关修改，禁止回滚或整理用户变更。
- 2026-09-06：确认三项根因：快照按旧本地位置替换 part、跨消息合并隐藏 parts-first 工具、旧 V1→V2 迁移用随机 UUID 后按 ID 排序。
- 2026-09-06：Web 全量 290 文件/1741 测试、Web/Gateway 类型检查与构建、格式、相关 diff check、真实浏览器顺序断言全部通过。
- Memory sync: completed
