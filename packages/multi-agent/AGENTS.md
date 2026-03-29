# multi-agent — 知识库

## 概述

多 Agent 工作流的 DAG 编排器。定义 Agent 如何组合成有向无环图、按依赖顺序执行，以及如何分析失败原因并进行升级处理。

## 目录结构

```
src/
├── index.ts          # 公开导出
├── types.ts          # AgentDAG、DAGNode、DAGEdge、WorkflowMode、RootCauseAnalysis 等
├── dag.ts            # DAGRunner — 按依赖顺序执行 DAG 节点
├── orchestrator.ts   # MultiAgentOrchestratorImpl — 高层工作流编排
└── team.ts           # TeamStoreImpl — 团队成员/任务/消息状态管理
```

## 查找指引

| 任务                   | 位置                                                 |
| ---------------------- | ---------------------------------------------------- |
| DAG 执行逻辑           | `src/dag.ts` → `DAGRunner`                           |
| 工作流编排器           | `src/orchestrator.ts` → `MultiAgentOrchestratorImpl` |
| 团队状态（成员、任务） | `src/team.ts` → `TeamStoreImpl`                      |
| 所有公开类型           | `src/types.ts`                                       |

## 关键类型

- `AgentDAG` — 定义工作流图的节点与边
- `DAGNode` — 单个 Agent 任务节点，含重试策略
- `WorkflowMode` — 执行模式（sequential / parallel / conditional）
- `RootCauseAnalysis` — 带 `RootCauseCategory` 的结构化失败分析
- `FailureEscalationRecord` — 失败节点的升级处理历史
- `TeamMember`、`TeamTask`、`TeamMessage`、`ActiveTeam` — 团队协作原语

## 禁止事项

- 禁止创建循环 DAG 边——DAGRunner 运行时不检测环路。
- 禁止从 `dist/` 导入——使用 `workspace:*`。
