# Team 通信层优化 - P0 立即实施方案

## 任务概述

基于架构分析，实施 Team 成员间通信机制的 P0 优先级优化，解决当前架构中缺少结构化通信、请求-响应关联、状态粒度不足等核心问题。

## 当前分析

### 现有问题
1. **TeamMessage 过于简单**：无 `replyTo`、`threadId`、`to` 字段，无法追踪对话上下文
2. **缺少消息路由机制**：成员间无法主动通信，只能被动接收 DAG 事件
3. **成员状态粒度粗糙**：只有 4 种状态，无法表达 "等待输入"、"被阻塞" 等中间态
4. **无交接协议**：`handoffTargets` 只是字符串数组，缺少触发条件、数据契约、确认机制

### 影响范围
- `packages/multi-agent/src/team.ts` - 核心状态管理
- `packages/web-client/src/team/team-workflows.ts` - Workflow 定义
- `apps/web/src/pages/team/` - 前端 UI 和 hooks

## 解决方案设计

### 架构决策
1. **采用事件驱动的消息总线模式**：所有成员通信通过 MessageBus 路由，支持发布-订阅
2. **引入对话上下文管理**：每个对话线程独立追踪，支持多轮交互
3. **细化成员状态机**：从 4 态扩展到 8 态，明确中间状态和阻塞原因
4. **定义交接协议**：标准化交接触发、数据契约、超时处理

### 技术选型
- TypeScript strict mode + Zod 校验
- 事件驱动架构（Event Bus）
- 状态机模式（State Machine）
- 契约优先设计（Contract-First）

## 复杂度评估

- 原子步骤数：9+ 步骤 → +2
- 并行流：3 个独立流 → +2
- 模块/系统/服务数：3+ 模块 → +1
- 长步骤（>5 分钟）：是 → +1
- 持久化审查产物：是 → +1
- OpenCode 可用：是 → -1
- **总分**：6
- **选择模式**：Full Orchestration
- **路由理由**：多包架构级改造，3 条并行流，每条流 10+ 分钟，需持久化设计决策

## 实施计划

### Phase 1: 消息结构增强（Agent-01）

- [x] T-01: 扩展 `TeamMessage` 接口（增加 `replyTo`、`threadId`、`to`、`priority` 字段）✅
- [x] T-02: 定义消息类型枚举（`request`、`response`、`broadcast`、`handoff`、`escalation`）✅
- [x] T-03: 实现 Zod 校验 schema ✅
- [x] T-04: 更新 `TeamStoreImpl.addMessage` 兼容新字段 ✅

### Phase 2: 状态机增强（Agent-02）

- [x] T-05: 扩展 `MemberStatus` 类型（增加 `waiting_for_input`、`blocked`、`collaborating` 等）✅
- [x] T-06: 为 `TeamMember` 增加 `blockedBy`、`waitingFor`、`collaboratingWith` 字段 ✅
- [x] T-07: 实现状态转换规则（状态机逻辑）✅
- [x] T-08: 更新 `handleDAGEvent` 处理新状态 ✅

### Phase 3: 消息总线基础（Agent-03）

- [x] T-09: 实现 `MessageBus` 接口（`subscribe`、`publish`、`route`）✅
- [x] T-10: 实现消息路由逻辑（单播、广播、条件路由）✅
- [x] T-11: 集成到 `TeamStoreImpl` ✅
- [x] T-12: 添加单元测试 ✅

### Phase 4: 集成与验证（Agent-04）

- [x] T-13: 创建集成测试场景 ✅
- [x] T-14: 实现端到端测试用例 ✅
- [x] T-15: 验证状态-消息联动 ✅
- [x] T-16: 性能和边界测试 ✅
- [x] T-17: 生成测试报告 ✅

## 依赖关系

```
T-01, T-02, T-03 (消息定义) → T-04 (Store 集成)
                            ↓
T-05, T-06, T-07 (状态机) → T-08 (DAG 事件处理)
                            ↓
T-09, T-10 (消息总线) → T-11 (集成) → T-12 (测试)
                                        ↓
                                    T-13, T-14, T-15
```

## 并行执行策略

**阶段 1-3 并行**：
- Agent-01 负责 Phase 1（消息结构）
- Agent-02 负责 Phase 2（状态机）
- Agent-03 负责 Phase 3（消息总线）

**阶段 4 串行**：
- 主线程完成集成与验证（依赖前 3 阶段成果）

## 验证标准

### 功能验证
- ✅ 消息支持 `replyTo` 追踪回复链
- ✅ 成员状态能反映 "等待输入" 和 "被阻塞"
- ✅ 消息总线能正确路由单播和广播

### 性能验证
- ✅ 消息路由延迟 < 10ms
- ✅ 状态更新延迟 < 5ms

### 兼容性验证
- ✅ 现有前端代码无破坏性变更
- ✅ TypeScript 类型检查通过
- ✅ 所有单元测试通过

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 三个 Agent 并行可能产生类型冲突 | 中 | 先定义共享类型接口，各 Agent 基于接口实现 |
| 消息总线性能瓶颈 | 低 | 使用内存 Map + 事件循环，避免阻塞 |
| 状态机复杂度增加维护成本 | 中 | 充分的单元测试覆盖 + 状态转换图文档 |

## 后续优化（P1/P2）

- [ ] 实现对话上下文管理（`ConversationContextManager`）
- [ ] 完善交接协议（`HandoffProtocol`）
- [ ] 增加请求-响应模式（`request/response`）
- [ ] 实现协作模式抽象（`CollaborationPattern`）

## 备注

- 本方案聚焦 P0（立即实施）优化，P1/P2 优化作为后续迭代
- 所有代码遵循项目 TypeScript strict mode 和 ESLint 规则
- 提交信息格式：`feat(multi-agent): 增强团队成员通信机制`
