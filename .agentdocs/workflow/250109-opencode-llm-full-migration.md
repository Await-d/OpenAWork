# OpenCode LLM 完全集成方案 - 激进重构

## 任务概览

将整个 agent-gateway 迁移到 Effect 运行时，完全按照原始 OpenCode 的使用方式，消除所有转换层。

## 当前分析

### 方案对比

| 维度 | 方案 B（保守集成） | 方案 A（激进重构） |
|------|------------------|------------------|
| 转换层 | EventQueue + AsyncIterator | **无转换层** |
| 运行时 | async/await | **Effect 运行时** |
| Generator 类型 | `async function*` | **`function*` (Effect Generator)** |
| Stream 消费 | `for await` | **`yield* Stream.runDrain`** |
| 代码复杂度 | 中等 | **最低（与 OpenCode 一致）** |
| 迁移工作量 | 小 | **大** |
| 长期维护性 | 需要维护转换层 | **无额外维护负担** |

### 为什么选择方案 A

1. **彻底消除转换层**：没有 EventQueue，没有 AsyncIterator 转换，代码最简洁
2. **与 OpenCode 完全一致**：直接复用 OpenCode 的最佳实践
3. **长期收益高**：虽然初期工作量大，但长期维护成本最低
4. **类型安全**：Effect 的类型系统比 Promise 更强大
5. **错误处理更优雅**：Effect 的错误处理机制更完善

## 复杂度评估

- 原子步骤：15+ 步骤（需要重写多个模块）→ +2
- 并行流：是（可以分模块并行迁移）→ +2
- 模块数：8+ 个模块需要改造 → +2
- 长步骤（>5分钟）：是（很多步骤需要仔细重构）→ +1
- 持久化审查：是（需要详细的迁移文档和代码审查）→ +1
- OpenCode 可用：否 → 0

**总分**：8 分

**选择模式**：完全编排（Full orchestration）

**路由理由**：这是一个大规模的架构重构任务，需要详细规划、分阶段实施、多人协作。

## 解决方案设计

### 核心策略

**完全按照 OpenCode 的方式**：

```typescript
// 之前（async/await）
export async function* runUpstreamStream(input) {
  for await (const chunk of stream) {
    yield chunk
  }
}

// 之后（Effect Generator）
export function* runUpstreamStream(input: StreamInput) {
  const stream = LLMClient.stream(request)
  
  yield* stream.pipe(
    Stream.tap((event: LLMEvent) =>
      Effect.sync(() => {
        // 直接处理事件，无转换层
        handleEvent(event)
      })
    ),
    Stream.runDrain,
  )
}
```

### 迁移路径

采用**自底向上、渐进式迁移**策略：

```
阶段 1: 基础设施层（Effect 运行时基础）
    ↓
阶段 2: 工具函数层（Effectify utilities）
    ↓
阶段 3: 核心业务层（stream-runner, upstream）
    ↓
阶段 4: 路由层（routes/stream-model-round.ts）
    ↓
阶段 5: 入口层（main.ts, app.ts）
```

### 关键设计决策

#### 决策 1: Effect 依赖注入

使用 Effect 的 Layer 和 Service 系统替代当前的依赖注入：

```typescript
// 之前
class StreamRunner {
  constructor(private config: Config) {}
}

// 之后
const StreamRunner = Effect.gen(function* () {
  const config = yield* Config
  // ...
})
```

#### 决策 2: 错误处理统一

使用 Effect 的类型化错误系统：

```typescript
// 之前
try {
  await runUpstream()
} catch (err) {
  // 运行时才知道错误类型
}

// 之后
yield* runUpstream().pipe(
  Effect.catchTag("NetworkError", (e) => handleNetworkError(e)),
  Effect.catchTag("ValidationError", (e) => handleValidationError(e)),
)
```

#### 决策 3: 并发控制

使用 Effect 的并发原语：

```typescript
// 之前
await Promise.all([task1(), task2()])

// 之后
yield* Effect.all([task1, task2], { concurrency: "unbounded" })
```

## 详细代码对比参考

### 1. Stream Runner 对比

**原始 OpenCode** (`temp/opencode/packages/opencode/src/session/processor.ts:627-683`):

```typescript
const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
  yield* Effect.logInfo("process", {
    "session.id": input.sessionID,
    messageID: input.assistantMessage.id,
  })
  
  ctx.needsCompaction = false
  ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

  return yield* Effect.gen(function* () {
    yield* Effect.gen(function* () {
      ctx.currentText = undefined
      ctx.reasoningMap = {}
      yield* status.set(ctx.sessionID, { type: "busy" })
      const stream = llm.stream(streamInput)

      yield* stream.pipe(
        Stream.tap((value: StreamEvent) =>
          Effect.gen(function* () {
            switch (value.type) {
              case "text-delta":
                if (!ctx.currentText) return
                ctx.currentText.text += value.text
                yield* session.updatePart(ctx.currentText)
                return
              // ... 其他事件处理
            }
          })
        ),
        Stream.takeUntil(() => ctx.needsCompaction),
        Stream.runDrain,
      )
    }).pipe(
      Effect.retry(SessionRetry.policy({...})),
      Effect.catch(halt),
      Effect.ensuring(cleanup()),
    )

    if (ctx.needsCompaction) return "compact"
    if (ctx.blocked || ctx.assistantMessage.error) return "stop"
    return "continue"
  })
})
```

**当前系统** (`services/agent-gateway/src/v2-runtime/upstream/stream-runner.ts`):

```typescript
// 需要完全重写为 Effect Generator
export async function* runUpstreamStream(
  input: RunUpstreamStreamInput,
): AsyncGenerator<RunUpstreamStreamEvent, UpstreamStreamTextResult | undefined, void> {
  // 大量 async/await 代码
  for await (const chunk of stream) {
    yield chunk
  }
}
```

**改造目标**:

```typescript
export function* runUpstreamStream(input: StreamInput) {
  const diagnostics = yield* DiagnosticsService
  const logger = yield* LoggerService
  
  yield* Effect.logInfo("runUpstreamStream.start", {
    runId: input.runId,
    model: input.model,
  })
  
  const stream = yield* createLLMStream(input)
  
  yield* stream.pipe(
    Stream.tap((event: LLMEvent) =>
      Effect.gen(function* () {
        // 直接处理事件，发送到下游
        yield* handleLLMEvent(event, input)
      })
    ),
    Stream.runDrain,
  )
  
  return yield* collectResult()
}
```

### 2. 调用方改造对比

**当前调用方** (`services/agent-gateway/src/routes/stream-model-round.ts`):

```typescript
async function handleStream(req, res) {
  try {
    for await (const chunk of runUpstreamStream({...})) {
      res.write(JSON.stringify(chunk))
    }
  } catch (err) {
    res.status(500).send(err.message)
  }
}
```

**改造后**:

```typescript
const handleStream = Effect.gen(function* (req: Request) {
  const stream = yield* runUpstreamStream({...})
  
  return yield* stream.pipe(
    Stream.map(chunk => JSON.stringify(chunk)),
    Stream.runForEach(data => 
      Effect.sync(() => res.write(data))
    ),
  )
}).pipe(
  Effect.catchTag("StreamError", (e) => 
    Effect.sync(() => res.status(500).send(e.message))
  ),
)

// 在 Express/Fastify 中运行
app.post('/stream', (req, res) => {
  Effect.runPromise(handleStream(req))
})
```

### 3. 错误处理对比

**原始 OpenCode** (`temp/opencode/packages/opencode/src/session/processor.ts:656-677`):

```typescript
Effect.retry(
  SessionRetry.policy({
    provider: input.model.providerID,
    parse,
    set: (info) => {
      return status.set(ctx.sessionID, {
        type: "retry",
        attempt: info.attempt,
        message: info.message,
        action: info.action,
        next: info.next,
      })
    },
  }),
),
Effect.catch(halt),
Effect.ensuring(cleanup()),
```

**当前系统**:

```typescript
try {
  await runUpstream()
} catch (err) {
  if (isRetryableError(err)) {
    await retry()
  }
} finally {
  await cleanup()
}
```

**改造目标**:

```typescript
yield* runUpstream().pipe(
  Effect.retry(retryPolicy),
  Effect.catchTag("NetworkError", handleNetworkError),
  Effect.catchTag("ValidationError", handleValidationError),
  Effect.ensuring(cleanup),
)
```

## 实施计划

### Phase 1: 环境准备与基础设施（2-3 天）

#### Agent A 任务
- [x] T-01: 安装/对齐 Effect 依赖（当前实际为单一 `effect@4.0.0-beta.83`）✅ foundation_phase1.md
- [x] T-02: 配置 TypeScript 支持 Effect Generator（`downlevelIteration: true`）✅ foundation_phase1.md
- [x] T-03: 创建 Effect 运行时配置 (`src/runtime/effect-runtime.ts`) ✅ foundation_phase1.md
- [x] T-04: 创建基础 Service 定义（Logger, Config, Diagnostics）✅ foundation_phase1.md

#### Agent B 任务
- [x] T-05: 研究 OpenCode 的 Service 和 Layer 架构 ✅ foundation_phase1.md
- [x] T-06: 设计 agent-gateway 的 Service 依赖图 ✅ foundation_phase1.md
- [x] T-07: 创建类型定义文件 (`src/types/effect-services.ts`) ✅ foundation_phase1.md
- [x] T-08: 编写 Effect 使用文档和示例 ✅ foundation_phase1.md

**输出物**:
- `.agentdocs/runtime/250109-opencode-llm/phase1-setup-complete.md`
- `src/runtime/effect-runtime.ts`
- `src/types/effect-services.ts`
- `docs/effect-migration-guide.md`

### Phase 2: 工具函数层 Effectify（3-4 天）

#### Agent A 任务
- [x] T-09: 核验 `cache-breakpoints.ts` 的 Effect/策略边界 ✅ utilities_phase2.md
- [x] T-10: 核验 `provider.ts` 的 provider 构建逻辑 ✅ utilities_phase2.md
- [x] T-11: 修复 `opencode-llm-compat.ts` 的运行时/类型转换函数 ✅ utilities_phase2.md
- [x] T-12: 为改造后的函数编写单元测试 ✅ utilities_phase2.md

#### Agent B 任务
- [x] T-13: 改造诊断收集相关函数 ✅ utilities_phase2.md
- [x] T-14: 改造 idle watchdog/背压流转换 ✅ utilities_phase2.md
- [x] T-15: 改造错误处理工具函数 ✅ utilities_phase2.md
- [x] T-16: 为改造后的函数编写单元测试 ✅ utilities_phase2.md

**输出物**:
- `.agentdocs/runtime/250109-opencode-llm/phase2-utils-complete.md`
- 所有工具函数的 Effect 版本
- 对应的单元测试

### Phase 3: 核心业务层改造（5-7 天）

#### Agent A 任务
- [x] T-17: 记录 `stream-runner.ts` 当前版本回滚锚点（当前工作树无更早独立备份，已用 exact HEAD + SHA-256 收据替代）✅ `results/backup-receipts.md`
- [x] T-18: 重写 `runUpstreamStream` 为 Effect 原生流（已移除 AI SDK AsyncGenerator；native Effect SSE 与取消证据见终态 runtime）
- [x] T-19: 实现事件处理逻辑（兼容路径）✅ core.md
- [x] T-20: 处理 finish 事件和 usage 收集（兼容路径）✅ core.md
- [x] T-21: 实现 stall 检测（watchdog）✅ core.md

#### Agent B 任务
- [x] T-22: 记录 `run-upstream-generate.ts` 当前版本回滚锚点（当前工作树无更早独立备份，已用 exact HEAD + SHA-256 收据替代）✅ `results/backup-receipts.md`
- [x] T-23: 重写为 Effect 原生 generate 函数（已移除 AI SDK generateText；native generate 证据见终态报告）
- [x] T-24: 确保与 stream-runner 的接口一致（兼容路径）✅ core.md
- [x] T-25: 编写集成测试 ✅ core.md（53/53）

**协作点**:
- T-19 和 T-24 需要协调事件格式 ✅
- T-20 和 T-23 需要协调 usage 收集逻辑 ✅

**输出物**:
- ✅ `.agentdocs/opencode-llm-migration-complete.md` (迁移完成报告)
- ✅ 新的 `stream-runner.ts`（Effect 版本）
- ✅ 新的 `run-upstream-generate.ts`（优化版本）
- ✅ 集成测试套件 (`packages/opencode-llm/src/__tests__/integration/`)

### Phase 4: 路由层改造（3-4 天）

#### Agent A 任务
- [x] T-26: 备份 `routes/stream-model-round.ts` ✅ routes.md（SHA-256 已核验）
- [x] T-27: 核验路由 Effect 边界（不做破坏性的整函数 Generator 改写；`runModelRound` 仅在 native `Stream` 消费处运行 Effect，Fastify/SSE/WS 仍是合法终止边界）✅ `results/route-effect-core.md`
- [x] T-28: 适配 Express/Fastify 的响应流 ✅ routes.md
- [x] T-29: 处理 HTTP 错误响应 ✅ routes.md

#### Agent B 任务
- [x] T-30: 核验其他使用 `runUpstreamStream` 的路由（无额外生产调用点）✅ routes.md
- [x] T-31: 核验中间件边界（Fastify 生命周期 async 保留；业务 LLM Effect 不向 middleware 泄漏，未新增兼容层）✅ `results/route-effect-core.md`、`results/transport.md`
- [x] T-32: 测试所有路由端点（独立重跑：6 files / 30 tests passed）✅ routes.md
- [x] T-33: 编写 API 集成测试（独立重跑：stream-replay-race 1/1 passed）✅ routes.md

**输出物**:
- `.agentdocs/runtime/250109-opencode-llm/phase4-routes-complete.md`
- 所有路由的 Effect 版本
- API 集成测试

### Phase 5: 入口层改造（2-3 天）

#### Agent A 任务
- [x] T-34: 改造 `main.ts`，初始化 Effect 运行时 ✅ entry_phase5.md
- [x] T-35: 配置全局错误处理（既有注册 + 5/5 错误契约测试）✅ entry_phase5.md
- [x] T-36: 配置日志系统（与 Effect Logger 集成）✅ entry_phase5.md
- [x] T-37: 验证应用启动和关闭流程（Windows signal callback caveat recorded）✅ entry_phase5.md

#### Agent B 任务
- [x] T-38: 改造健康检查端点（既有 200 `{status:ok}` + live QA）✅ entry_phase5.md
- [x] T-39: 配置监控和度量（Effect Metric + Prometheus `/metrics`）✅ entry_phase5.md
- [x] T-40: 编写端到端测试（metrics/health live scenario + 11 focused tests）✅ entry_phase5.md
- [ ] T-41: 真实 LLM 性能/压力测试（本地 health-only smoke 与 native fixture 已完成；真实供应商吞吐、延迟、内存基线待用户提供凭据后执行）⏸️ `results/backup-performance.md`

**输出物**:
- `.agentdocs/runtime/250109-opencode-llm/phase5-entry-complete.md`
- 完整的 Effect 应用
- 端到端测试套件
- 性能测试报告

### Phase 6: 清理与优化（2-3 天）

#### Agent A & B 联合任务
- [x] T-42: 移除 native LLM 业务路径的旧 async/await（Fastify、文件、数据库、插件 hook 的边界 async 明确保留；upstream stream/generate 无 async/Promise 包装）✅ `results/effect-purity.md`、`results/transport.md`
- [x] T-43: 清理不再需要的依赖（AI SDK 相关）（gateway manifest/lock/source residue scan = 0）
- [x] T-44: 优化类型定义，消除 gateway 类型错误（gateway typecheck/build exit 0；其他 workspace 历史问题另行记录）
- [x] T-45: 代码审查和重构（审查完成；无满足安全阈值的重构/删除项）✅ cleanup_phase6.md
- [x] T-46: 更新所有文档（已追加当前状态与历史快照警告）✅ cleanup_phase6.md
- [x] T-47: 准备发布说明（已准备 release hold 语言，未触发发布）✅ cleanup_phase6.md

**输出物**:
- `.agentdocs/runtime/250109-opencode-llm/phase6-cleanup-complete.md`
- 清理后的代码库
- 完整的技术文档
- 迁移指南

### Phase 7: 部署与验证（2-3 天）

#### Agent A 任务
- [ ] T-48: 部署到隔离测试环境（代码构建/typecheck 已恢复通过；仍待用户指定数据目录、端口与部署方式）⏸️ `results/backup-performance.md`
- [x] T-49: 运行迁移回归测试（native 包 25 files/399 tests、gateway focused/verification matrix 当前通过）✅ `results/qa-release.md`、`results/tests.md`
- [ ] T-50: 监控真实 LLM 性能指标（health-only 100 concurrent 仅作基线；真实 LLM SLO 待用户执行）⏸️ `results/backup-performance.md`
- [x] T-51: 收口本轮测试环境问题（Effect API、native contract、fixture、cancel/replay blocker 已修复并复验）✅ `results/qa-release.md`

#### Agent B 任务
- [ ] T-52: 进行真实供应商负载测试（本地 native fixture 已覆盖 stream/generate/tool/cancel/stall/replay；真实供应商负载待用户执行）⏸️ `results/backup-performance.md`
- [ ] T-53: 验证所有真实供应商功能（本地协议矩阵已通过；真实 provider/API key/model/base URL 待用户执行）⏸️ `results/backup-performance.md`
- [x] T-54: 准备回滚方案 ✅ deployment-rollback.md
- [x] T-55: 编写部署文档 ✅ phase7-deployment-complete.md

**输出物**:
- `.agentdocs/runtime/250109-opencode-llm/phase7-deployment-complete.md`
- 部署检查清单
- 回滚方案文档
- 监控看板

## 关键代码位置映射表

| 功能 | 原始 OpenCode | 当前系统 | 改造后 |
|------|--------------|---------|--------|
| Stream 创建 | `native-runtime.ts:74-146` | `stream-runner.ts:1000-1066` | `stream-runner.ts:newRunUpstreamStream` |
| 事件处理 | `processor.ts:320-536` | `stream-runner.ts:336-493` | `stream-runner.ts:handleLLMEvent` |
| 错误重试 | `processor.ts:656-677` | `stream-runner.ts:try-catch` | `stream-runner.ts:Effect.retry` |
| Tool 执行 | `native-runtime.ts:169-192` | `stream-runner.ts:toolHandling` | `stream-runner.ts:Effect.gen` |
| 路由处理 | N/A | `routes/stream-model-round.ts` | `routes/stream-model-round.ts:Effect.gen` |
| 应用启动 | N/A | `main.ts` | `main.ts:Effect.runPromise` |

## 风险与缓解

### 风险 1: 学习曲线陡峭
- **影响**: 高
- **概率**: 高
- **缓解**: 
  - 先进行 Effect 培训（2-3 天）
  - 创建内部 Effect 使用指南
  - 从简单模块开始迁移

### 风险 2: 迁移过程中引入 bug
- **影响**: 高
- **概率**: 中
- **缓解**:
  - 每个 Phase 完成后运行完整测试套件
  - 保留旧代码备份
  - 使用 feature flag 逐步切换

### 风险 3: 性能问题
- **影响**: 中
- **概率**: 低
- **缓解**:
  - 每个 Phase 进行性能测试
  - 与 AI SDK 版本进行基准对比
  - 必要时进行性能优化

### 风险 4: 第三方库不兼容
- **影响**: 中
- **概率**: 中
- **缓解**:
  - 提前识别所有依赖
  - 为不兼容的库编写 Effect 适配器
  - 考虑替换不兼容的库

### 风险 5: 回滚困难
- **影响**: 高
- **概率**: 低
- **缓解**:
  - 在独立分支开发
  - 保持完整的回滚方案
  - 使用 Git tag 标记每个 Phase

## 测试策略

### 单元测试
- 每个改造后的函数必须有对应的单元测试
- 覆盖率要求 >= 80%
- 使用 Effect Testing 库

### 集成测试
- 每个 Phase 完成后运行集成测试
- 测试 Effect 函数之间的组合
- 测试 Service 依赖注入

### 端到端测试
- 完整的请求-响应流程测试
- 测试所有 API 端点
- 测试错误场景

### 性能测试
- 与 AI SDK 版本进行基准对比
- 测试高并发场景
- 测试内存使用

## 回滚计划

### 回滚触发条件
- 迁移后出现严重 bug 且无法在 8 小时内修复
- 性能显著下降（>50%）且无法优化
- 测试覆盖率无法达到要求

### 回滚步骤
1. 切换到回滚分支（保留所有旧代码）
2. 重新部署旧版本
3. 验证功能正常
4. 分析失败原因
5. 制定改进计划

### 回滚责任人
- **主要负责**: Agent A
- **协助验证**: Agent B
- **最终决策**: 技术负责人

## 成功标准

### 功能标准
- [ ] 所有现有功能正常工作
- [ ] 所有测试通过（单元、集成、端到端）
- [ ] 无新增 bug

### 性能标准
- [ ] 响应时间 <= AI SDK 版本的 110%
- [ ] 吞吐量 >= AI SDK 版本的 90%
- [ ] 内存使用合理（无泄漏）

### 代码质量标准
- [ ] 无类型错误
- [ ] 测试覆盖率 >= 80%
- [ ] 代码审查通过
- [ ] 文档完整

### 运维标准
- [ ] 监控系统正常
- [ ] 日志系统正常
- [ ] 部署流程文档化
- [ ] 回滚方案经过验证

## 时间估算

| Phase | 工作量（人天） | 并行后（天） | 备注 |
|-------|--------------|-------------|------|
| Phase 1 | 4 | 2-3 | 环境准备 |
| Phase 2 | 6 | 3-4 | 工具函数 |
| Phase 3 | 10 | 5-7 | 核心业务 |
| Phase 4 | 6 | 3-4 | 路由层 |
| Phase 5 | 4 | 2-3 | 入口层 |
| Phase 6 | 4 | 2-3 | 清理优化 |
| Phase 7 | 4 | 2-3 | 部署验证 |
| **总计** | **38** | **19-27** | 约 4-5 周 |

## 备注

- 这是一个大规模重构，需要充分的时间和资源
- 建议在独立分支开发，不影响主分支
- 每个 Phase 都要有明确的验收标准
- 定期与团队同步进度和问题
- 记录所有重要决策和权衡

### 2026-08-15 续作复核记录

> 历史快照：本节记录的是终态修复前的中间状态；后续“2026-08-15 Effect 原生终态续作”和“最终验证补充”已覆盖其中的 T-17/T-22/T-27/T-31/T-42 代码结论。T-41/T-48/T-50/T-52/T-53 仍按人工/外部 gate 保留未勾选。

- 本轮以当前源码为准逐项复核，未把旧报告中的“完成”当作证据。
- T-01~T-16 已由 foundation/utilities 代理提供针对性测试与运行面证据；Effect 依赖保持单一 `4.0.0-beta.83`，没有混入 Effect 3 的 `@effect/platform@0.x`。
- T-17/T-22 的历史备份收据缺失，保留未完成；T-18/T-23/T-27/T-31 仍未完成原生 Effect Generator/中间件迁移，当前只恢复了真实 AI SDK 兼容路径。
- T-26/T-28/T-29/T-30 已核验；T-32/T-33 等待 core 修复后的独立路由矩阵验证。
- 详细证据：`.agentdocs/runtime/250109-opencode-llm-resume-20260815/results/`；续作主计划已记录 Phase 5~7 尚未执行，不提前宣称完成。
- 2026-08-15 续作更新：T-32 路由矩阵独立重跑 6 files/30 tests 通过；T-33 `stream-replay-race` 独立重跑 1/1 通过。Phase 6 审查确认 T-42/T-43/T-44 仍 blocked/partial，T-45/T-46/T-47 已完成审查/文档/发布 hold 说明；未删除活跃 AI SDK 依赖或未核验的嵌套脚手架。
- Phase 5/7 续作证据：T-34~T-40 已由 entry 代理完成并通过目标测试与隔离 live `/health`/`/metrics`；T-41 仅本地 100 请求 smoke。T-48/T-49/T-51/T-52/T-53 仍因 gateway typecheck/build、Effect 4 `Stream.async`/runtime 漂移、AI SDK 消息契约与验证矩阵失败而 blocked/partial；T-54/T-55 已准备回滚与部署文档，未放行发布。

### 2026-08-15 Effect 原生终态续作

- Responses reasoning metadata replay 的 `thinking_end.itemId → ReasoningPart → AssistantReasoning → providerMetadata.openai.itemId` 链路已补齐；完整 `pnpm run test:responses` exit 0。
- gateway `test:v2-runtime`、typecheck、build、replay bookend、cancellation/stall 聚焦测试均通过；AI SDK residue scan 为 0。
- HTTP 重试测试夹具已修正：成功重试用例不再错误注册 rejection observer，最大重试用例在推进 fake timers 前注册 rejection observer；定向 HTTP 测试 34/34 通过。
- 完整 `@openAwork/opencode-llm` 套件现为 25/25 文件、399/399 测试、0 unhandled errors；包级 typecheck/build、gateway typecheck/build、Responses、v2-runtime、replay bookend、cancellation/stall 聚焦验证均 exit 0。
- 本轮清理了迁移临时调试日志/标记；其余历史 `[DEBUG]` 日志和旧文档术语未扩大处理。

### 2026-08-15 最终验证补充

- 采用混合迁移路线：保留 `packages/opencode-llm` 的 OpenAWork schema/exports/gateway seam，以 `temp/opencode/packages/llm/src` 作为协议和 Effect 架构参考，不直接覆盖 upstream 包。
- 本轮删除的临时文件：`temp/opencode-llm-test-failures.log`、`temp/opencode-llm-test-after.log`；两者均为本轮生成且已确认不存在。
- 外部供应商凭据未用于本轮；Responses/replay/cancel/tool 证据来自隔离本地 fixture 和 gateway verifier。

### 2026-08-15 真实代理协议验证补充

- 使用用户提供的代理（凭据未写入文件）和 `gpt-5.6-terra`，native Effect 客户端已真实验证 OpenAI Chat Completions 与 Responses：非流式文本、流式文本、usage、`stop` 终止事件均通过。
- 使用同一代理 `/v1/messages` 与 `grok-4.6`，native Effect Anthropic Messages 客户端非流式和流式均通过；流式收到 12 个事件并以 `finish/stop` 结束。
- native `Providers.OpenAI.configure` 与 `Providers.Anthropic.configure` 的 `baseURL` 按完整 API 前缀使用：本代理需传 `https://demo6666.awitk.cn/v1`；仅传代理根地址会把请求渲染到 `/chat/completions`、`/responses`，不属于协议解析故障。Gateway 的 `normalizeRuntimeBaseUrl` 会在 openai 根地址场景补 `/v1`。
- 本次仅完成单模型/单代理真实验收，不替代 T-41/T-50/T-52 的性能压测、隔离部署与全供应商验证；这些 gate 继续保持未勾选。
