# .agentdocs/workflow/260421-net10-wave2-run-008-question-reply-resume迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 2 主干，补 RUN-008 的最小子切片：**owner-session question reply / resume**。
- 范围：仅覆盖 `GET /sessions/{id}/questions/pending` + `POST /sessions/{id}/questions/reply`，以及 answer 后复用现有 runtime 主线继续跑一轮所需的最小 `.NET` route/query/helper/test/账本 改动。
- 不做：shared session question reply、question authoring UX、完整 question 读面控制台、更多 plan-mode 扩展分支。

## Current Analysis
- 现有前置已经足够支撑最小 RUN-008：
  - `DATA-013` 的 `question_requests` durable layer 已落地；
  - `RUN-004/007/010` 方向已经把 runtime mainline、pending interaction、resume/tool-result continuation 基础打通；
  - TS 真值里 question answer 后 resume 直接复用现有 runtime continuation，而不是另造一条执行链。
- 三路探索给出的共同结论：
  - **最小 owner-session question reply / resume** 比继续推 RUN-003 写侧更小、更独立；
  - `.NET` 当前缺的是 route + payload 解析 + runtime request 组装，不是 question store 本身；
  - shared reply 与更完整 question UX 都应该继续后置。

## Solution Design
- 先做 **question reply / resume 最小闭环**，不扩共享面：
  1. 对齐 TS `GET /sessions/:id/questions/pending` + `POST /sessions/:id/questions/reply` 的最小 response/request 形状
  2. 复用现有 `IQuestionRequestStore` 与 runtime 主线
  3. answer 后构造最小 question tool-result 文本，并把 owner session 继续跑一轮
  4. 补 `.NET` integration tests 与 `.agentdocs` 账本同步
- 这刀的核心不是“更多 question UI”，而是 **把现有 pending question 存储和 runtime 主线接成可实际回答+恢复的闭环**。

## Complexity Assessment
- Atomic steps: 5+（TS 真值、.NET 触点、route/helper 改动、测试、账本同步）→ +2
- Parallel streams: 是（TS 真值 / .NET 触点 / parity tests 可并行）→ +2
- Modules/systems/services: 3+（TS routes/runtime truth、.NET route/runtime/tests、.agentdocs）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 虽然切片范围比 full RUN-008 小，但它仍横跨 TS route 真值、`.NET` route + runtime continuation、测试与账本同步，而且需要精确限制在 owner-session reply/resume，不适合直接散改。

## Implementation Plan

### Phase 1: 真值与触点锁定
- [x] T-01: 读取 TS 最小 RUN-008 question reply / resume 真值，锁定 request/response 形状与 continuation 语义 ✅
- [x] T-02: 盘点 `.NET` question store / runtime / route / test 触点，确定最小改动集合 ✅

### Phase 2: Reply / resume 最小闭环
- [x] T-03: 在 `.NET` 实现 pending questions list + reply route（已新增 `QuestionsRouteGroupExtensions.cs` 并在 `Program.cs` 注册） ✅
- [x] T-04: 接上 answered question tool-result 构造与 owner-session runtime resume（当前通过 `SessionStreamInitialToolResult` + 背景 runtime 续跑接到现有主线） ✅

### Phase 3: 验证与记账
- [x] T-05: 补 `.NET` 测试，覆盖 pending list、reply answered、already resolved/expired、resume 关键场景（已新增 `QuestionsEndpointTests.cs`） ✅
- [x] T-06: 回写总迁移账本、workflow 与 runtime plan，同步 RUN-008 子切片状态与验证边界 ✅

## Notes
- 当前选择的是 **RUN-008 最小 owner-session reply / resume 子切片**，不是 full RUN-008；shared reply 与更大的 question UX 继续后置。
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，所以真实 `.NET` 编译/动态测试证据如仍无法执行，需要在文档中显式保留验证边界。
- 已锁定的 TS 最小真值：`routes/questions.ts`、`routes/stream-runtime.ts`、`question-tools.ts`，以及 `questions-routes.plan-mode.test.ts` / `stream-resume-reconcile.test.ts` 的关键回归场景。
- 当前已落地的 `.NET` 触点：
  - `Host/Routes/QuestionsRouteGroupExtensions.cs`：新增 `GET /sessions/{id}/questions/pending` 与 `POST /sessions/{id}/questions/reply`
  - `Host/Program.cs`：注册 `MapQuestionsRoutes()`
  - `tests/OpenAWork.Gateway.IntegrationTests/QuestionsEndpointTests.cs`：覆盖 pending list、answered resume、payload 保留、ExitPlanMode、resolved/expired
- 当前实现已经二次收敛到 TS 最小真值：
  - pending list 不再主动 dismiss expired question；
  - reply 不再单独返回 expired 分支；
  - background reconciler 不再替 question 做 expiry/dismiss；
  - owner-session resume 的 `observability` 改为只保留 `presentedToolName/canonicalToolName/adapterVersion`；
  - `nextRound` 严格必填，否则 answered 后不 auto-resume；
  - 新增回归：invalid nextRound type、background reconcile 不过期 question、expired pending 仍可 answered、resume 非 200 时状态回收。

- 实现后复核状态：
  - 第一轮 review/work 与聚焦检查暴露的主要 gap 已全部收敛：`PublishAsync` 编译错误、question 过期/dismiss 事件与状态推进不一致、`requestData/observability` 未完整/未规范保留、`nextRound` 过宽松、非 200 resume 状态未收敛，以及若干 `.NET` 自行增加的过期语义偏差。
  - 最终聚焦终检与 .NET 终检均通过，当前最小 RUN-008 owner-session question reply / resume 子切片无剩余 blocker。
  - 真实 `dotnet` 编译/动态测试证据仍待可运行环境补齐。

Memory sync: completed
