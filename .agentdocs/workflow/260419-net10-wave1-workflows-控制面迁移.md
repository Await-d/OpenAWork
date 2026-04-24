# .agentdocs/workflow/260419-net10-wave1-workflows-控制面迁移.md

## Task Overview
- 目标：继续推进 `.NET 10 gateway` Wave 1 控制面，补齐 `CTRL-015 /workflows`。
- 范围：优先交付 **team-playbook 模板控制面** 的最小闭环：`/workflows/templates` list/create/delete、默认模板 seed 对齐、与 Team `saved-template` 元数据协议兼容；如实现成本可控，再补 `optimize-prompt` / `translate` 两个附属 LLM 工作流端点。
- 不做：Wave 2 runtime execute、泛化 DAG 执行引擎、桌面 cutover。

## Current Analysis
- TS 真值在 `services/agent-gateway/src/routes/workflows.ts`：当前 `/workflows` 不是完整引擎 API，而是 **模板 CRUD + optimize + translate**。
- 真正影响控制面闭环的主轴是 `team-playbook` 模板元数据：`apps/web` Team 新建会话与 `services/agent-gateway/src/routes/team.ts` 都会直接消费 `metadata.teamTemplate`。
- `.NET` 侧比预想更接近完成：
  - `GatewayDbContext` 已包含 `WorkflowTemplates`
  - `WorkflowTemplateRecord` / `WorkflowTemplateRecordConfiguration` 已存在
  - `DefaultUserSeedData` 与 `UserRegistrationBootstrapper` 已实现默认模板 seed
  - `IWorkflowLlmClient` / `WorkflowLlmClient` 已存在，可作为 optimize/translate 的基础设施
- 当前真正缺的还是控制面入口：contracts、application handlers、`Host/Routes/WorkflowsRouteGroupExtensions.cs`、对应测试与 Program 注册。

## Solution Design
- 第一阶段聚焦模板控制面：
  - `GET /workflows/templates`
  - `POST /workflows/templates`
  - `DELETE /workflows/templates/:id`
- 控制面行为严格对齐 TS：
  - 仅按当前登录用户读取/删除模板
  - `team-playbook` 创建时自动补齐 `defaultBindings` 与 `requiredRoles`
  - 返回 shape 与 `packages/web-client/src/workflows.ts` 对齐
- 第二阶段评估是否同批补 `POST /workflows/optimize-prompt` 与 `POST /workflows/translate`；若补，则基于现有 `IWorkflowLlmClient` 与 `.NET` 侧最小实现完成 JSON 结构化返回，而不提前扩到 runtime 引擎。

## Complexity Assessment
- Atomic steps: 5+（真值对照、contracts、handlers、routes、tests、账本同步）→ +2
- Parallel streams: 是（模板控制面主线 + optimize/translate 评估可并行）→ +2
- Modules/systems/services: 3+（TS gateway、.NET host/application/persistence、Team/Web 消费面）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: `/workflows` 涉及模板表、默认 seed、Team saved-template 消费协议与可选 LLM 子能力，跨模块且需要持续记账；必须使用 workflow + runtime master plan 收口状态与证据。

## Implementation Plan

### Phase 1: 模板控制面主线
- [x] T-01: 对照 TS `/workflows/templates` 路由与 web-client DTO，定义 `.NET` contracts / metadata 模型 ✅
- [x] T-02: 实现 template list/create/delete application handlers 与 JSON parse/normalize 逻辑 ✅
- [x] T-03: 实现 `WorkflowsRouteGroupExtensions` 并在 `Program.cs` 注册 ✅

### Phase 2: 模板 seed 与 Team 协议校验
- [x] T-04: 校验现有 `DefaultUserSeedData` / `UserRegistrationBootstrapper` 与 TS seed metadata 对拍，补足缺口 ✅
- [x] T-05: 补集成测试，覆盖 team-playbook 默认 binding、seed 可见性、删除归属校验 ✅

### Phase 3: 附属 LLM 端点与收口
- [x] T-06: 评估并实现 `optimize-prompt` / `translate` 的最小 `.NET` 版本，或明确记录为后续切片 ✅
- [x] T-07: 运行可用验证、更新迁移总账 `CTRL-015` 状态与证据 ✅

## Notes
- 本切片的完成标准优先级：**模板控制面 > team saved-template 协议 > optimize/translate 附属能力**。
- 若 `optimize/translate` 在本轮因缺少现成 `.NET` 算法实现而拖慢主线，应先把模板控制面做成独立闭环，再在备注中标记剩余差距。
- 当前已落地的 `.NET` 文件：
  - `src/OpenAWork.Gateway.Contracts/Workflows/WorkflowTemplateResponse.cs`
  - `src/OpenAWork.Gateway.Contracts/Workflows/WorkflowLlmResponses.cs`
  - `src/OpenAWork.Gateway.Application/Features/Workflows/WorkflowTemplateSupport.cs`
  - `src/OpenAWork.Gateway.Application/Features/Workflows/WorkflowTemplateRequests.cs`
  - `src/OpenAWork.Gateway.Application/Features/Workflows/WorkflowLlmRequests.cs`
  - `src/OpenAWork.Gateway.Host/Routes/WorkflowsRouteGroupExtensions.cs`
  - `tests/OpenAWork.Gateway.IntegrationTests/WorkflowsEndpointTests.cs`
- 当前已补的可运行证据：
  - `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/workflows-routes.test.ts src/__tests__/default-workflow-templates.test.ts` ✅
  - `pnpm --filter @openAwork/web-client exec vitest run src/__tests__/workflows-client.test.ts` ✅
- 后续根据 review 补的收口修复：
  - `packages/web-client/src/workflows.ts` 已补 `translate()` client 方法与 `TranslationTaskInput` / `TranslationResult` 契约，`packages/web-client/src/__tests__/workflows-client.test.ts` 已覆盖 batch translate payload/response。
  - `WorkflowsRouteGroupExtensions.cs` 已补 `metadata.teamTemplate/defaultBindings/requiredRoles` 的深层校验，不再静默接受 `null/number/array` 这类非法嵌套 payload。
  - `WorkflowTemplateSupport.NormalizeMetadata()` 已改为只合并固定 5 个角色，避免未知 role key 继续污染 `defaultBindings`。
  - `WorkflowLlmRequests.cs` 中的 batch translate 已改为 `Task.WhenAll(...)` 并发执行，对齐 TS `Promise.all` 语义。
- 已复用而无需重建的基础：
  - `WorkflowTemplateRecord` / `WorkflowTemplateRecordConfiguration`
  - `DefaultUserSeedData.WorkflowTemplates`
  - `UserRegistrationBootstrapper`
  - `IWorkflowLlmClient` / `WorkflowLlmClient`
- 当前环境仍缺少 `dotnet` 与 `csharp-ls`，因此本轮 `.NET` 验证仍以代码对拍、测试补齐和后置 review 为主，真实 build/test 需待可运行环境补证。
- focused review 结果：目标符合度 PASS、代码质量 PASS、上下文遗漏 PASS、安全复核 PASS；唯一未闭环项仍是环境级 QA——当前机器缺少 `dotnet`，无法执行 `.NET` 真正的 build/test/manual QA。
- Memory sync: completed
