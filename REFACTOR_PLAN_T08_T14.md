# stream.ts 分层重构计划（T-08~T-14）

## 概述

OpenAWork gateway 核心路由 stream.ts 现已超过 3500 行，职责混乱，包含权限检查、消息持久化、SSE 编码、错误处理、核心编排等完全不同的关注点。本计划按工时 6.5 天分阶段拆分为 5 个专责模块。

> **⚠️ 当前状态说明（2026-11-04 复核）**
>
> 本计划中的 ✅ 标记此前是**乐观表述**，与实际不符，现已按实修正。真实情况如下：
>
> - **叶子模块确实已物理提取**（`stream-auth.ts` / `stream-persistence.ts` / `stream-sse-encoder.ts` / `stream-error-handler.ts` / `stream-replay.ts` / `stream-agent-resolution.ts` 均存在于 `services/agent-gateway/src/routes/`），且有各自的单元测试。
> - **但绝大多数提取物并未接入生产**。`stream.ts` 的编排主体（`handleStreamRequest` 及其内联的权限、持久化、SSE 编码、错误处理、工具/模型循环）**没有**改为调用这些叶子模块。据核实：
>   - **门面已撤除（2026-11-04）**：`stream-handler.ts`（236 行）与 `stream-refactor-index.ts`（141 行）经逐个复核确认**生产引用为 0**，连同其专属测试已删除；分层仅在叶子模块层面成立，`stream.ts` 仍是唯一的编排入口。
>   - `attachCursorToEvent` / `resolveCursorQueryParam` / `shouldPersistEvent` 生产与测试引用均为 0，已从 `stream-sse-encoder.ts` 删除；`createUpstreamRouteChunk` / `createRouteOnlyUpstreamSummary` 仅剩 `stream-layered-refactor-simple.test.ts` 消费（无生产引用），暂保留。
>   - `stream-persistence.ts` 的 12 个别名导出中，只有 `clearRequestArtifacts` 有下游消费者（`stream-replay.ts`）；其余 11 个零引用别名已删除，该文件现仅保留 `clearRequestArtifacts`。
> - **`stream.ts` 实际行数 3137 行**（未达标；计划目标是 `<250` 行）。
> - **覆盖率 / 性能基线均未测量**（计划中的 `>80% 覆盖率`、`首 token ±5%` 均无实测数据，不应视为已达成）。
> - 本次（2026-11-04）**仅做去重与如实化**，未做大迁移、未删除任何文件。

## 职责边界图

```
┌─────────────────────────────────────────────────────────────────┐
│                     handleStreamRequest (入口)                   │
│                   stream-handler.ts (核心编排)                    │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ stream-auth      │  │ stream-sse       │  │ stream-error   │ │
│  │  权限检查        │  │  编码器          │  │  错误处理      │ │
│  │  会话加载        │  │  cursor 管理     │  │  日志审计      │ │
│  │  用户信息        │  │  事件序列化      │  │  错误映射      │ │
│  └──────────────────┘  └──────────────────┘  └────────────────┘ │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         stream-persistence.ts (消息/事件/diff 存储)        │  │
│  │  消息持久化 / 事件队列 / 文件差异 / 使用统计              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 任务分解

### T-08：建立测试用例（已完成）

**交付物**：`stream-layered-refactor-simple.test.ts`（`stream-layered-refactor.test.ts` 随
`stream-handler.ts` 门面于 2026-11-04 一并删除）

- 复制现有流式路由测试作为基线（确保无回归）
- 针对 5 个新模块的单元测试框架
- 模块间集成测试用例

**关键断言（以下为「测试文件覆盖的目标」，非「已达成」）**：

- 🟡 权限检查返回正确的状态码 —— 单测覆盖叶子模块，未覆盖 `stream.ts` 真实权限路径
- ✅ 错误处理保留技术细节和审计日志 —— `stream-layered-refactor-audit.test.ts` 覆盖
- ✅ SSE 事件编码正确递增序列号 —— `stream-layered-refactor-simple.test.ts` 覆盖
- ⚠️ 消息持久化不丢失内容 —— 仅叶子模块单测，无端到端验证
- ✅ 模块间无循环依赖 —— 2026-11-04 实测修复，见「循环依赖实测（2026-11-04）」（口径：剥离注释、区分 `import type`、范围 `routes/stream*.ts` 21 文件）

---

### T-09：提取 stream-auth.ts（模块已提取，**部分接入**）

**职责**：权限检查与会话上下文加载

**导出接口**：

```typescript
export function loadSessionContext(sessionId, userId): SessionStreamContext | null;
export function loadSessionUser(sessionId, userId): JwtPayload | null;
export function parseSessionProviderSelection(metadataJson): SessionProviderSelection;
export function parseStoredJson<T>(value): T | undefined;
```

**文件体积**：~180 行
**依赖**：`infra/db.js`、`infra/auth.js`、`session/session-workspace-metadata.js`
**被依赖**：`stream.ts` 已直接导入 `parseSessionProviderSelection` / `parseStoredJson`
（`stream.ts:105`），并 re-export `loadSessionContext` / `loadSessionUser`；**但 `stream-handler.ts` 门面未被生产引用**。

**测试覆盖**：

- 会话存在性检查
- 元数据 JSON 解析
- Provider/Agent 选择解析
- 无效 JSON 处理

---

### T-10：提取 stream-persistence.ts（模块已提取，**基本未接入**）

**职责**：消息、事件、差异、使用统计的持久化

**导出接口**：

```typescript
export function persistToolResult(input): void;
export function queueRunEvent(input): { seq: number | null };
export function flushRunEvents(sessionId): void;
export function persistFileDiffs(input): Promise<void>;
export function clearRequestArtifacts(input): void;
export function recordUsageStats(input): void;
export function listRunEventsByRequest(input): RunEvent[];
export function listRunEventsAfterSeq(input): RunEvent[];
```

**文件体积**：~26 行（仅剩 `clearRequestArtifacts` 及其底层调用）
**依赖**：`message-v2-adapter.js`、`session-run-events.js`、`session-file-diff-store.js`、`session-snapshot-store.js`、`session-entry-store.js`
**被依赖**：**仅 `clearRequestArtifacts` 有下游**（经 `stream-replay.ts` 间接被 `stream.ts` 使用）；
其余 11 个别名导出生产与测试引用均为 0，已于 2026-11-04 删除——`stream.ts` 的主循环仍直接调用底层
`session-run-events.js` / `message-v2-adapter.js` 等原始模块。

**测试覆盖**：

- 工具结果消息持久化
- 事件队列的批量提交
- 文件差异存储
- 请求范围清理的完整性

---

### T-11：提取 stream-sse-encoder.ts（模块已提取，**部分接入**）

**职责**：SSE 协议编码与事件序列化

**导出接口**：

```typescript
export function createRunEventMeta(runId, sequence): RunEventMeta;
export function createUpstreamRouteChunk(input): RunEvent;
export function createRouteOnlyUpstreamSummary(input): UpstreamStreamSummary;
export function createStreamErrorEvent(input): RunEvent;
export function createRunAcceptedEvent(input): RunEvent;
export function attachCursorToEvent<T>(event, cursor?): T;
export function shouldPersistEvent(event): boolean;
export function resolveCursorQueryParam(cursor?): { afterSeq?; clientRequestId? };
```

**文件体积**：~180 行
**依赖**：`@openAwork/shared`（类型）
**被依赖**：`stream.ts` 已导入并 re-export `createRunEventMeta`，且使用 `createStreamErrorEvent` /
`createRunAcceptedEvent`（`stream.ts:56-58, 880`）；`stream-routes-plugin.ts:19` 使用 `encodeStreamEvent`。
**但** `attachCursorToEvent` / `shouldPersistEvent` / `resolveCursorQueryParam` **生产与测试引用均为 0**，
已于 2026-11-04 删除；`createUpstreamRouteChunk` / `createRouteOnlyUpstreamSummary` **生产引用数为 0**，
仅剩 `stream-layered-refactor-simple.test.ts` 消费——`stream.ts` 内部仍保留
`createStreamUpstreamRouteChunk`（886 行）与 `buildRouteOnlyUpstreamSummary`（902 行）两份**入参类型不同**
的同形实现，未替换。

**测试覆盖**：

- eventId 序列号递增
- cursor 信息正确附加
- 事件持久化标记
- 特殊事件不入库判定

---

### T-12：提取 stream-error-handler.ts（模块已提取，**部分接入**）

**职责**：统一错误处理与日志审计

**导出接口**：

```typescript
export const STREAM_ERROR_MESSAGES: { ... }
export class TeamModelBindingUnavailableError extends Error { ... }
export function buildErrorContent(code, message): MessageContent[]
export function recordStreamError(input): { message, detail, stack? }
export function recordRouteResolutionError(input): void
export function recordPermissionError(input): void
export function buildStreamFailureMessage(input): { summary, detail?, code? }
export function isRecoverableError(error): boolean
export function extractErrorDiagnostics(error): string
```

**文件体积**：~140 行
**依赖**：`infra/gateway-logger.js`、`infra/audit-log.js`
**被依赖**：`stream.ts` 导入 `TeamModelBindingUnavailableError`（109 行）并**于 2026-11-04 起
改为从本模块导入 `STREAM_ERROR_MESSAGES` 并 re-export**（去重，见「本次去重记录」）。
其 `buildErrorContent`（60 行）为本模块**唯一实现**；`stream-replay.ts:190` 原有一份逐字相同的副本，
已于 2026-11-04 改为向本模块转发的 re-export（见「本次去重记录」）。
`recordStreamError` / `recordRouteResolutionError` / `buildStreamFailureMessage` 仅被测试引用。

**测试覆盖**：

- 错误分类（Team、瞬时、业务致命）
- 错误消息映射表完整性
- 审计日志记录
- 自定义错误类识别

---

### T-13：重构 stream-handler.ts（**门面已撤除（2026-11-04）**）

**职责（目标）**：核心编排逻辑与请求生命周期管理

**导出接口（门面名义接口，已随文件删除）**：

```typescript
export async function handleStreamRequest(input): Promise<HandleStreamResult>;
export function checkStreamPermissions(input): PermissionCheckResult;
export function handleStreamError(input): HandleStreamResult;
export function handleSessionConflict(input): HandleStreamResult;
export function acceptStreamRequest(input): void;
export function emitRouteSelectedEvent(input): RunEvent;
export function createStreamDoneEvent(input): RunEvent;
```

**文件体积**：236 行（门面 + 未接生产的 helper）——**已删除**。

**实际状态**：`handleStreamRequest` 的**实现真身仍在 `stream.ts`**；`stream-handler.ts` 只是
`export { handleStreamRequest } from './stream.js'` 的转发门面，其余 helper 源码自述
「历史 helper 暂未接入生产」。**该文件生产引用数为 0**，连同 `stream-refactor-index.ts`
（零消费兼容汇出层）于 2026-11-04 一并删除；分层仅在叶子模块层面成立，`stream.ts` 仍是
唯一的编排入口。

**核心编排流程（目标，未落地）**：

1. **权限检查** → 调用 `checkStreamPermissions()` (stream-auth)
2. **错误处理** → 调用 `handleStreamError()` (stream-error-handler)
3. **SSE 编码** → 调用 `createRunEventMeta()` (stream-sse-encoder)
4. **事件发送** → 调用 `queueRunEvent()`/`flushRunEvents()` (stream-persistence)
5. **请求清理** → 调用 `clearRequestArtifacts()` (stream-persistence)

**依赖**：stream-auth、stream-persistence、stream-sse-encoder、stream-error-handler
**被依赖**：**无生产引用**（`stream-refactor-index.ts` 与 `stream-handler.ts` 及各自测试均已于 2026-11-04 删除）

**迁移步骤**：

- [ ] 从原 stream.ts 提取 `handleStreamRequest()` 主体 —— **未做**
- [ ] 用新模块替代内联逻辑 —— **未做**（脚本仅做零散去重）
- [ ] 验证所有路径不断裂 —— **未做**
- [ ] 运行集成测试 —— 仅定向单测通过，未做端到端回归

---

### T-14：集成测试与回归（**未开始**）

**测试清单**：

- [x] 所有现有 stream 相关测试通过（无回归）—— 定向 `stream-*.test.ts` 全绿（2026-11-04；门面测试删除后文件数相应减少）
- [ ] 新模块集成测试 100% 通过 —— **未做**
- [ ] 无循环依赖检查（`madge`）—— **未跑**
- [x] TypeScript strict 编译无错误 —— `bun run --filter @openAwork/agent-gateway typecheck` exit 0
- [ ] 代码覆盖率 >80% —— **未测**
- [ ] 模块体积都 <300 行 —— 叶子模块达标，但 `stream.ts` 仍 **3137 行**（未达标）

**发版检查**：

- [ ] 性能基线（首 token 时间、内存占用）无恶化 —— **未测**
- [ ] 错误处理路径完整 —— **未系统验证**
- [ ] 权限审查无遗漏 —— **未做**
- [ ] 日志和审计完整 —— **未做**

---

## 本次去重记录（2026-11-04）

在「只做去重与如实化、不做大迁移、不删文件」的约束下，本轮完成的代码去重：

| 项                      | 处理                                                                                                                                                                                                          | 证据                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STREAM_ERROR_MESSAGES` | `stream.ts` 内原 186-191 行的副本 **逐字相同**于 `stream-error-handler.ts:22-27`；已删除本地声明，改为 `export { ... } from` + 同名 `import`（`stream.ts:186-189`）                                           | 4 个键值逐行比对一致；`grep STREAM_ERROR_MESSAGES stream.ts` 仅剩 1 处 export + 1 处 import + 3 处使用，无本地 `const` 声明                                                    |
| `buildErrorContent`     | `stream-error-handler.ts:60` 与 `stream-replay.ts:190` **逐字节相同**；以 error-handler 为唯一真相源，`stream-replay.ts` 改为 `export { buildErrorContent } from './stream-error-handler.js'`（原导出名不变） | 两份源码 `return [{ type: 'text', text: \`[错误: ${code}] ${message}\`.trim() }];` 完全一致；`stream-replay.ts`不再导入`MessageContent`（已删无用 import）；对外名字与语义不变 |

**登记为差异、未强行替换（不完全等价，强替会改变行为）**：

- `buildErrorContent` 第三份：`stream-model-round.ts:1050` **多一个 `technicalDetail` 参数**（追加
  `\n\n技术详情：…`），**语义不同**，且属禁改文件，不合并。`stream.ts:90` 仍从 `stream-replay.js` 导入（现为转发到 error-handler）。
- `attachCursorToEvent` / `resolveCursorQueryParam` / `shouldPersistEvent`：`stream.ts` 内**没有任何同名实现**，
  现有两处是**手写内联对象拼接**，与 helper **不完全等价**，故未替换：
  - `stream.ts:2044-2068`（`emitChunk`）：`seq` 类型为 `number | null`，判据 `seq === null`；
    helper `attachCursorToEvent(event, cursor?: StreamCursor)` 收的是 **cursor 对象**，需外层包一层
    `seq === null ? undefined : { clientRequestId, seq }`，且无 cursor 时 helper **返回入参原引用**
    而原代码**总是新建对象**——字段等价、引用语义不等价。
  - `stream.ts:2135-2148`（attach 订阅回调）：判据是 `meta?.seq === undefined`（`PublishRunEventMeta.seq?: number`，
    `meta` 本身也可选），与 A 的 `=== null` **判据不同**；同样需要包一层，并额外保留 `hasPersistedRunEvent` 早返回分支。
  - 结论：**字段形状相同、判据/引用语义不同 → 不等价 → 保持手写**，待后续抽象一个收 `number | null | undefined`
    的专用 helper 再统一（不在本轮范围）。
- `createStreamUpstreamRouteChunk` / `buildRouteOnlyUpstreamSummary`（`stream.ts:886/902`）与
  `stream-sse-encoder.ts` 的 `createUpstreamRouteChunk` / `createRouteOnlyUpstreamSummary`：形状相同但
  **入参类型不同**（前者收 `ModelRouteConfig`，后者收 `{ modelId, providerId?, ... }`），非逐字副本，未替换。
- `stream-handler.ts` / `stream-refactor-index.ts` 原为**未跟踪文件**；2026-11-04 按用户指令经逐个复核
  （含动态/字符串/测试引用）确认生产引用为 0 后**已删除**，连同 `stream-layered-refactor.test.ts` /
  `stream-refactor-index.test.ts` 两个专属测试文件。
- `stream-sse-encoder.ts` 的 `attachCursorToEvent` / `shouldPersistEvent` / `resolveCursorQueryParam`
  零引用，已删除；`stream-persistence.ts` 的 11 个零引用别名已删除，文件仅留 `clearRequestArtifacts`。

---

## 依赖关系（DAG 验证）

> **说明**：下表描述的是**目标**依赖关系，非当前实际。当前 `stream.ts` 仍内联实现大部分逻辑，
> 叶子模块的「被依赖」关系多数**未建立**（见各任务实际状态）。**`madge` 循环依赖检查尚未执行**，
> 故下方「无反向依赖 ✅」是设计意图而非实测结论。

```
stream-auth
├─ 被依赖：stream.ts（parseSessionProviderSelection / parseStoredJson）
└─ 无反向依赖（设计意图）

stream-persistence
├─ 被依赖：stream-replay.ts（clearRequestArtifacts）
└─ 无反向依赖（设计意图）

stream-sse-encoder
├─ 被依赖：stream.ts（部分）
└─ 无反向依赖（设计意图）

stream-error-handler
├─ 被依赖：stream.ts（部分）
└─ 无反向依赖（设计意图）

stream.ts （原文件）
├─ 逐步迁移代码到上述模块 —— **尚未迁移**
├─ 最终保留 API 入口和高阶逻辑
└─ 目标 <250 行；**当前 3137 行**
```

> **门面已撤除（2026-11-04）**：`stream-handler.ts` 与 `stream-refactor-index.ts` 零生产引用，
> 已连同其专属测试删除；分层仅在叶子模块层面成立，`stream.ts` 仍是唯一的编排入口。

✅ **无循环依赖：已实测 0 环**（2026-11-04，见「循环依赖实测」）

---

## 循环依赖实测（2026-11-04）

**扫描口径（可复现）**：对 `services/agent-gateway/src/routes/stream*.ts` 的 **21 个文件**做 DFS：

1. **剥离块注释（`/* */`）与行注释（`//`）**——否则注释里的示例 import 会造成假阳性；
2. **区分 `import type` / `export type`**——类型导入不进运行时图；
3. 只统计 `import ... from './x.js'` 与 `export ... from './x.js'` 的 **value 边**（解析为同目录 `.ts`）；
4. 三色 DFS 找环。

**修复前实测（协调者扫描）存在 2 处真实运行时环**：

- **环 1 `stream.ts` ⇄ `stream-model-round.ts`**：正向 `stream.ts` → `stream-model-round.ts`（`runModelRound`）；
  回边 `stream-model-round.ts:101` value 导入 `{ createRunEventMeta, createStreamErrorChunk } from './stream.js'`。
- **环 2 `stream.ts` ⇄ `stream-usage-event.ts`**：正向 `stream.ts` → `stream-usage-event.ts`（`buildStreamUsageChunk`）；
  回边 `stream-usage-event.ts:4` value 导入 `{ createRunEventMeta } from './stream.js'`。

**本轮处置（行为零变化）**：

- `createRunEventMeta` 真身在叶子 `stream-sse-encoder.ts:53`：两处回边改为
  `from './stream-sse-encoder.js'`（`stream-model-round.ts:101`、`stream-usage-event.ts:4`）。
- `createStreamErrorChunk` 真身原在 `stream.ts:3119`（薄委托）：**整函数移至叶子
  `stream-sse-encoder.ts`**，`stream.ts` 改为 `export { createStreamErrorChunk } from './stream-sse-encoder.js'`
  保持对外名与签名不变（`stream-routes-plugin.ts:16` 等下游无需改动）。
- 兼容 re-export 复查：`stream.ts` 的 `export { replayPersistedAssistantResponse }`（→ replay）、
  `export { loadSessionContext, loadSessionUser }`（→ auth）、`export { TeamModelBindingUnavailableError }` /
  `STREAM_ERROR_MESSAGES`（→ error-handler）、`export { createRunEventMeta }` / `createStreamErrorChunk`（→ sse-encoder）、
  `export { runModelRound }`（→ model-round）——**各目标均无到 `stream.ts` 的 value 回边**，不引入额外环。

**修复后实测：21 文件 / 0 环**（同一扫描脚本复跑）。

> 说明：仓库未安装 `madge`，故用上述等价口径的 DFS 脚本替代；脚本为一次性临时文件，运行后已删除。

---

## 代码审查检查清单

### 每个模块提交时

- [ ] 文件 <300 行（或分解）
- [ ] 无 `as any` / `@ts-ignore`
- [ ] TypeScript strict mode 通过
- [ ] 导出接口清晰（不导出实现细节）
- [ ] 单元测试覆盖 >80%
- [ ] 无外部副作用（除必需的 DB 调用）

### 集成时

- [x] 无循环依赖检查（`routes/stream*.ts`）—— 自建 DFS 0 环，见「循环依赖实测」
- [ ] `bun run lint` 通过 —— **未在本次范围统一跑**（改动文件 eslint 已过）
- [x] `bun run typecheck` 通过 —— gateway typecheck exit 0
- [x] `bun run test src/__tests__/routes/stream-*.test.ts` 全绿 —— 定向 6 文件 123 例全绿
- [x] 现有 stream 相关测试无回归 —— 网关全量 737 文件 / 6447 例全绿（协调者实测）

---

## 时间估算（6.5 天）

| 任务                      | 工时 | 状态          | 完成日期 |
| ------------------------- | ---- | ------------- | -------- |
| T-08 基线                 | 0.5d | ✅            | Nov 01   |
| T-09 stream-auth          | 0.5d | 🟡 部分接入   | Nov 01   |
| T-10 stream-persistence   | 1.0d | 🟡 基本未接入 | Nov 01   |
| T-11 stream-sse-encoder   | 0.5d | 🟡 部分接入   | Nov 01   |
| T-12 stream-error-handler | 0.5d | 🟡 部分接入   | Nov 01   |
| T-13 stream-handler       | 1.5d | ❌ 已撤除     | Nov 04   |
| T-14 集成测试             | 2.0d | ⏳ 未开始     | —        |

> 状态图例：✅ 完成且接入生产｜🟡 模块已提取但未/仅部分接入生产｜⏳ 未完成

---

## 验证标准

### 功能正确性

- ❌ 原 handleStreamRequest 的所有请求路径都被覆盖 —— **未验证**（编排主体仍在 `stream.ts`，未迁移）
- ⚠️ 权限检查、错误处理、事件编码三个关键路径**物理上**已分模块，但**未接入生产**，不能视为「已独立」
- ⚠️ 消息和事件持久化的行为不变 —— 仅定向单测通过，**未做端到端 ACID 验证**

### 非功能属性

- ⚠️ 新模块总代码量 < 1000 行 —— 叶子模块合计达标，但 `stream.ts` 仍 **3137 行**，整体未达标
- ✅ 无循环依赖 —— 已实测 0 环（见文末「循环依赖实测（2026-11-04）」）
- ✅ 类型安全率 100% (TypeScript strict) —— 网关 typecheck exit 0
- ❌ 测试覆盖率 >80% —— **未测量**（无 `--coverage` 数据）
- ❌ 性能无恶化（首 token 时间 ± 5%）—— **未测性能基线**

### 可维护性

- ✅ 每个模块职责单一 —— 叶子模块满足
- ✅ 模块间接口清晰 —— 叶子模块满足
- ⚠️ 代码注释率 >30%（关键路径）—— **未统计**
- ⚠️ 易于单元测试（无强耦合）—— 叶子模块有单测，但未接生产意味着覆盖不到真实路径

---

## 后续优化（不在本计划内）

- [ ] stream.ts 最终拆分为业务入口 + 辅助工具
- [ ] 工具执行逻辑提取到独立模块（executeToolCalls 已是 >400 行）
- [ ] 模型交互逻辑分离（runModelRound）
- [ ] 性能优化（并行请求、缓存）
