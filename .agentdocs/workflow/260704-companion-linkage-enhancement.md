# 伴侣系统联动场景强化方案

## Task Overview

当前伴侣系统（Buddy/Companion）已具备完整的端到端基础架构（精灵生成、Persona 注入、语音播报、交互记忆），但在真实联动场景方面存在大量缺口：工具调用状态未接入、错误/重试无反应、附件/队列计数硬编码为 0、无空闲提醒、无任务完成庆祝。本方案旨在系统性补齐这些联动缺口，让伴侣从"被动展示"进化为"主动陪跑"。

## Current Analysis

### 已有能力
- 精灵生成系统（18物种 × 5稀有度 × 确定性哈希派生）
- Persona/Prompt 注入（off / mention_only / always 三种模式）
- `/buddy` 斜杠命令触发独立聊天
- 语音播报（Web Speech API + 冷却机制）
- 交互记忆（localStorage）
- 前端面板（精灵动画 + 属性展示 + 输出历史 + 6 个模式切换按钮）
- 流式生成完成时推送 "生成完成" 通知
- 新审批到达时推送 "新审批" 通知

### 关键缺口
| # | 缺口 | 现状 | 影响 |
|---|---|---|---|
| 1 | **工具调用联动** | `toolCallCards` 已在 ChatPage 计算但未传入 CompanionStage | 伴侣对工具执行无感知 |
| 2 | **错误/重试联动** | `streamError` 状态存在但未传入 CompanionStage | 出错时伴侣无反应 |
| 3 | **附件计数** | `attachedCount` 硬编码为 `0` | 反应规则中附件分支永远不触发 |
| 4 | **队列计数** | `queuedCount` 硬编码为 `0` | 反应规则中队列分支永远不触发 |
| 5 | **语音输入** | `showVoice` 硬编码为 `false` | 反应规则中语音分支永远不触发 |
| 6 | **空闲检测** | 无 | 用户长时间不操作时伴侣无主动提醒 |
| 7 | **工具完成反应** | 仅流式结束有反应，工具执行完成无独立反应 | 伴侣无法在工具执行中/后给出反馈 |
| 8 | **错误恢复鼓励** | 无 | Agent 出错重试时伴侣无情绪支持 |

### 联动数据流现状
```
ChatPage 已有状态                     CompanionStage 接收
─────────────────────                ──────────────────
toolCallCards (Array)        ───✗──→  (未传入)
streamError (string|null)    ───✗──→  (未传入)
queuedComposerMessages       ───✗──→  queuedCount = 0 (硬编码)
effectiveFiles (Array)       ───✗──→  attachedCount = 0 (硬编码)
streaming (boolean)          ───✓──→  streaming
pendingPermissions (Array)   ───✓──→  pendingPermissionCount
sessionTodos (Array)         ───✓──→  todoCount
rightPanelState              ───✓──→  rightOpen (部分)
input (string)               ───✓──→  input
```

## Solution Design

### 设计原则
1. **最小侵入**：不改变现有 CompanionStage 的组件结构和 props 传递模式，只扩展字段
2. **渐进增强**：每个联动场景独立可控，可单独开关
3. **低打扰**：新增反应遵守现有 muted / quietMode / outputPolicy 管控链路
4. **纯函数优先**：反应推导逻辑保持在 `companion-display-model.ts` 中，便于测试

### 改动范围

#### 后端（最小改动）
- `companion-settings.ts`：`buildCompanionPrompt` 增加工具调用/错误上下文感知

#### 前端模型层
- `companion-display-model.ts`：扩展 `CompanionActivitySnapshot`，新增 `deriveCompanionReaction` 分支

#### 前端组件层
- `companion-stage.tsx`：新增 useEffect 监听工具调用/错误/空闲状态变化
- 新增 `use-buddy-idle-detector.ts`：空闲检测 hook

#### 前端接入层
- `ChatPage.tsx`：把 `toolCallCards.length`、`streamError`、真实附件/队列计数传入 CompanionStage

## Complexity Assessment
- Atomic steps: 8 → +2
- Parallel streams: 是（4 条可并行流）→ +2
- Modules/systems/services: 4+（companion-display-model, companion-stage, ChatPage, companion-settings）→ +1
- Long step (>5 min): 是（companion-stage.tsx 改动较大）→ +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 否 → 0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 8 个原子任务横跨 4+ 模块，有多条可并行流，companion-stage.tsx 改动较大需要独立验证

## Implementation Plan

### Phase 1: 模型层扩展（基础设施）
- [ ] T-01: 扩展 `CompanionActivitySnapshot` 类型，新增 `toolCallCount`、`lastToolName`、`hasStreamError`、`streamErrorMessage`、`idleSeconds` 字段
- [ ] T-02: 扩展 `deriveCompanionReaction`，新增工具调用中/工具出错/Agent出错/空闲太久反应规则；扩展 `deriveCompanionStatus` 和 `deriveCompanionFocusTags`

### Phase 2: 空闲检测 Hook
- [ ] T-03: 新建 `use-buddy-idle-detector.ts`，监听用户最后操作时间（鼠标/键盘/输入框变化），返回 `idleSeconds`

### Phase 3: 组件层联动（依赖 Phase 1）
- [ ] T-04: 扩展 `CompanionStageProps`，新增工具/错误/空闲相关 props
- [ ] T-05: 在 `companion-stage.tsx` 新增 useEffect：工具调用开始/完成反应、错误发生/恢复反应、空闲提醒

### Phase 4: ChatPage 接入（依赖 Phase 3）
- [ ] T-06: 在 `ChatPage.tsx` 中把 `toolCallCards.length`、`streamError`、真实 `attachedCount`、`queuedCount` 传入 CompanionStage
- [ ] T-07: 在 `ChatPage.tsx` 中接入 `useBuddyIdleDetector`，把 `idleSeconds` 传入 CompanionStage

### Phase 5: 后端增强
- [ ] T-08: 在 `companion-settings.ts` 的 `buildCompanionPrompt` 中增加工具调用/错误上下文感知，让伴侣在 `/buddy` 聊天时能感知当前工具状态

## Dependency DAG

```
T-01 ──→ T-02 ──┬──→ T-04 ──→ T-05 ──┬──→ T-06
                │                      ├──→ T-07
T-03 ───────────┘                      │
                                       │
T-08 (独立，可并行)  ──────────────────┘
```

## Notes
- 所有新增反应必须遵守现有 `deriveCompanionOutputPolicy` 管控（muted / quietMode）
- 空闲提醒需要冷却机制，避免反复触发
- 工具调用反应需要区分"开始执行"和"执行完成"两个时刻
- 错误反应需要区分"出错"和"恢复"两个时刻
- `ChatPage.tsx` 已超过 4000 行，改动需最小化，仅扩展 props 传参
