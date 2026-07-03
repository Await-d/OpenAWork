# handoff/ — 五层架构核心模块

> 本文件是 `services/agent-gateway/src/handoff/` 目录的 Agent 约束文档。
> 所有在此目录下新增、修改、移动文件的操作必须遵循以下规则。

---

## 目录结构（强制）

```
handoff/
├── store/          # 数据访问层（DB CRUD + 状态机）
├── runner/         # 运行时执行体（watcher + 各层 runner）
├── capability/     # 层级约束系统（guard + 内置指令 + toolset 门控）
├── bus/            # 事件通信（事件总线 + 心跳 + session 创建）
└── workflow/       # 工作流模板（模板 schema + 解析 + 内置包）
```

**禁止**在 `handoff/` 根目录直接放置 `.ts` 文件。所有新文件必须归入上述 5 个子目录之一。

---

## 子目录职责边界

### store/ — 数据访问层

**放什么**：

- 与 SQLite 表直接交互的 CRUD 函数（`sqliteRun` / `sqliteGet` / `sqliteAll`）
- 状态机过渡逻辑（pending → claimed → running → completed/failed/cancelled）
- 数据模型类型定义（`HandoffRecord` / `InboundMessageRecord` 等）

**不放什么**：

- 业务编排逻辑（属于 runner/）
- 事件发布（属于 bus/）
- LLM 调用（属于 runner/）

**命名规范**：`*-store.ts`

### runner/ — 运行时执行体

**放什么**：

- 各层的 LLM 调用 + 产物生成逻辑（artifact-chain / pm2-runner 等）
- 守护进程（watcher：轮询 + claim + schedule）
- 调度器（scheduler：任务生命周期管理）
- 路由决策（reception-router：规则引擎 + LLM 兜底）
- 编排器（reception-orchestrator：intent rewrite + handoff 创建）

**不放什么**：

- 纯数据 CRUD（属于 store/）
- 层级约束校验（属于 capability/）
- 事件定义（属于 bus/）

**命名规范**：`*-runner.ts` / `*-orchestrator.ts` / `*-router.ts` / `watcher.ts` / `scheduler.ts`

### capability/ — 层级约束系统

**放什么**：

- 五层 capability 矩阵（`layer-capabilities.ts`）
- Guard 函数（`assertCanHandoffTo` / `assertCanReceiveInbound` / `assertSubstateAllowed` / `assertCanWriteArtifactPhase`）
- 内置指令注册表 + dispatcher（`builtin-instructions.ts`）
- 各层内置指令实现（`builtin-instructions-impl.ts`，超 1500 行时拆为 `instructions-reception.ts` / `instructions-pm1.ts` / `instructions-pm2.ts` / `instructions-execution.ts`）
- Toolset 门控（`toolset-gate.ts`）
- Dispatch package 标准结构（`dispatch-package.ts`）

**不放什么**：

- 实际执行逻辑（属于 runner/）
- DB 操作（属于 store/）

**命名规范**：`layer-*.ts` / `builtin-*.ts` / `toolset-*.ts` / `dispatch-*.ts` / `instructions-*.ts`

**扩展规则**：

- 新增内置指令 → 在 `builtin-instructions-impl.ts` 中 `registerInstruction()`
- 当 `builtin-instructions-impl.ts` 超过 1500 行 → 按层拆分为独立文件
- 新增 capability 维度 → 在 `layer-capabilities.ts` 的 `LayerCapabilities` interface 加字段 + 矩阵加列
- 新增 guard → 在 `layer-capabilities.ts` 底部加 `assertXxx` 函数

### bus/ — 事件通信

**放什么**：

- 事件总线（`team-events-bus.ts`：publish / subscribe / event types）
- Session 创建辅助（`team-session-create.ts`）
- 心跳机制（`heartbeat.ts`：touch / clear / stale cutoff）
- 延迟监控（`latency-monitor.ts`：L1.6 p95 约束）

**不放什么**：

- 事件消费逻辑（属于 runner/ 或 routes/）
- DB 状态机（属于 store/）

**命名规范**：`team-*.ts` / `heartbeat.ts` / `latency-*.ts`

### workflow/ — 工作流模板

**放什么**：

- 模板 schema 定义（`workflow-template-schema.ts`）
- 模板解析 + 角色绑定（`workflow-resolver.ts`）
- 内置工作流包（`workflow-builtin-packs.ts`）
- 模板驱动 runner（`workflow-driven-runner.ts`）
- 评审聚合（`review-aggregator.ts`）
- 角色适配矩阵（`role-adapter.ts`）

**不放什么**：

- 非模板驱动的 runner 逻辑（属于 runner/）
- 层级约束（属于 capability/）

**命名规范**：`workflow-*.ts` / `role-*.ts` / `review-*.ts`

---

## 文件体积规则（继承 AGENTS.md）

- **单文件上限 1500 行**，1300 行开始预警
- 超过 1500 行必须按职责边界拆分
- 拆分后每个文件应有明确的单一职责

---

## 新功能归类决策树

当需要新增文件时，按以下顺序判断归属：

1. **是否直接操作 DB 表？** → `store/`
2. **是否是 LLM 调用 / 任务执行 / 编排逻辑？** → `runner/`
3. **是否是层级权限校验 / 内置指令 / 工具过滤？** → `capability/`
4. **是否是事件发布 / 心跳 / 监控 / session 创建？** → `bus/`
5. **是否是工作流模板 / 角色适配 / 评审聚合？** → `workflow/`
6. **以上都不是？** → 大概率不属于 `handoff/`，考虑放在 `src/` 其他位置

---

## 跨目录依赖方向（强制）

```
capability/ ──→ store/     ✅（guard 需要查 DB 验证）
runner/     ──→ store/     ✅（runner 读写 handoff/inbound/substate）
runner/     ──→ bus/       ✅（runner 发事件 + 创建 session）
runner/     ──→ capability/ ✅（runner 内部调 guard 做校验）
bus/        ──→ store/     ✅（team-session-create 写 sessions 表）
workflow/   ──→ runner/    ✅（workflow-driven-runner 调 runner 逻辑）
workflow/   ──→ bus/       ✅（workflow 发事件）

store/      ──→ capability/ ✅（createHandoff 调 assertCanHandoffTo）
store/      ──→ bus/       ✅（substate-store 发 team event）

capability/ ──→ runner/    ❌ 禁止（capability 不依赖执行逻辑）
bus/        ──→ runner/    ❌ 禁止（bus 不依赖执行逻辑）
store/      ──→ runner/    ❌ 禁止（store 不依赖执行逻辑）
```

---

## 跨层禁止直连（L1.4，ESLint 静态强制）⭐

团队五层架构（a/b/c/d/e-g）的层间通信**必须只走受控通道**，严禁某层 runner 直接 import 另一层的 runner 绕过协议。

**受控通道**（层间唯一合法路径）：

| 通道                   | 用途                                           |
| ---------------------- | ---------------------------------------------- |
| `store/handoff-store`  | createHandoff / complete / fail —— 派发协议    |
| `store/inbound-store`  | submitInboundMessage —— 反向消息通道           |
| `store/substate-store` | setSubstate —— 子状态机                        |
| `bus/team-events-bus`  | publishHandoffEvent / publishTeamEvent —— 事件 |

**runner ↔ 运行层映射**：

| runner 文件                                    | 层            |
| ---------------------------------------------- | ------------- |
| `reception-orchestrator` / `reception-router`  | reception (b) |
| `pm1-runner` / `artifact-chain`                | pm1 (c)       |
| `pm2-runner` / `pm2-quality-review-reconciler` | pm2 (d)       |

**禁止**：上述任一 runner 跨层直接 `import`（含静态 `import` 与动态 `await import()`）另一层的 runner。例如 `artifact-chain`（c）不得 import `pm2-runner`（d）。

**受控编排器白名单**（允许跨层引用下游 runner，因其本身是分发/调度基础设施）：

- `watcher.ts` —— 守护进程，claim handoff 后按 `toRoleLayer` 分发
- `pm1-runner.ts` —— 承载 `createPhaseCAwareRunner` 分发器
- `scheduler.ts` —— 纯任务调度，不感知层语义

**同层组合允许**：`pm1-runner` ↔ `artifact-chain`、`reception-orchestrator` ↔ `reception-router`。

**静态强制**：自定义 ESLint 规则 `team-architecture/no-cross-layer-runner-import`
（`scripts/eslint-rules/no-cross-layer-runner-import.mjs`，配套 RuleTester 自测
`no-cross-layer-runner-import.test.mjs`，由 `pnpm run lint:rules` 运行）。新增白名单
编排器或新受控通道，必须走架构 review（见 `docs/architecture/team-architecture-l1-baseline.md` §L1.4）。

---

## barrel 导出规则

- `capability/index.ts` 是唯一的 barrel 文件，导出该子目录的公共 API
- 其他子目录（store / runner / bus / workflow）**不使用 barrel**——直接按文件路径导入
- 外部消费者（routes / tool-sandbox / index.ts）通过完整路径导入：
  ```ts
  import { assertCanHandoffTo } from '../handoff/capability/layer-capabilities.js';
  import { createHandoff } from '../handoff/store/handoff-store.js';
  import { publishHandoffEvent } from '../handoff/bus/team-events-bus.js';
  ```

---

## 测试文件位置

- 测试文件统一放在 `src/__tests__/` 目录（与现有约定一致）
- 测试文件命名：`<模块名>.test.ts`（如 `layer-capabilities.test.ts`）
- 不在 `handoff/` 子目录内放测试文件
