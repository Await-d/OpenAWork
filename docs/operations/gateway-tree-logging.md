# 网关树结构日志约定

适用范围：`services/agent-gateway` 的 HTTP / SSE / WebSocket 入口，以及 `packages/logger` 中的 `WorkflowLogger`。

## 目标

网关日志必须回答三个问题：

1. **是谁触发的这次请求**：通过 `requestId + method + path` 关联。
2. **请求内部做了什么**：通过树结构步骤展示验证、查询、写入、上游调用等阶段。
3. **哪里失败了**：失败必须落在最接近真实故障点的 child step 上，而不是只依赖最终 HTTP 500。

## 默认结构

HTTP 请求统一使用 `services/agent-gateway/src/request-workflow.ts`：

- 根步骤：`request.handle`，由插件自动创建和 flush。
- 路由步骤：优先调用 `startRequestWorkflow(request, 'domain.action')` 获取 route root step。
- 子步骤：通过 `workflow.child('suffix')` 自动生成，避免手写完整前缀；只有低层兼容场景才直接使用 `startRequestStep()`。

典型结构：

```text
request.handle
└── settings.providers.put
    ├── settings.providers.put.load-selection
    ├── settings.providers.put.parse-body
    ├── settings.providers.put.materialize
    ├── settings.providers.put.save-providers
    └── settings.providers.put.save-active-selection
```

推荐调用方式：

```ts
const { step, child } = startRequestWorkflow(request, 'settings.providers.put');

const parseStep = child('parse-body');
const saveProvidersStep = child('save-providers');
parseStep.succeed();
saveProvidersStep.succeed();
step.succeed();
```

`startRequestWorkflow()` 现在返回的是**step handle**，不是单纯的 `WorkflowStep`：

- `step.succeed(message?, fields?)`
- `step.fail(message?, fields?)`
- `const childStep = child('suffix')`
- `childStep.succeed(...)`
- `childStep.fail(...)`

这样大多数 HTTP 路由不需要直接调用原始 `workflowLogger.succeed/fail(...)`。

## 命名规则

### 1. 路由根步骤

- 格式：`domain.action`
- 例子：
  - `auth.login`
  - `session.create`
  - `usage.records.list`
  - `workspace.search`

要求：

- 与路由的业务动作一一对应。
- 不要使用泛化名称，如 `handler`、`process`、`do-work`。

### 2. 子步骤

- 代码里传入的参数应是**suffix**，例如 `parse-body`、`lookup`、`upstream.fetch`
- 最终日志名由 helper 自动拼成 `${rootStep}.${suffix}`
- 常用后缀：
  - `parse-body`
  - `parse-query`
  - `lookup`
  - `query`
  - `load`
  - `save`
  - `insert`
  - `delete`
  - `fetch`
  - `read`
  - `stat`
  - `invoke`
  - `plugin-start`
  - `plugin-stop`

要求：

- 子步骤必须对应一个可定位的边界操作。
- 不要把完整名字再次传给 helper，例如 `child('settings.providers.put.parse-body')`。
- 不要把整段 handler 逻辑都塞进一个含糊步骤里。
- 不要为循环内每一条数据创建步骤，避免日志爆炸。

## 成功 / 失败语义

### 应该在 child step 上失败的情况

- 数据校验失败
- 业务对象不存在
- 数据库 / 文件系统 / 上游请求失败
- 插件启动、停止、发送消息失败

### root step 的处理规则

- **HTTP 4xx/5xx**：通常 root step 也应 `fail(...)`。
- **HTTP 200 但业务回退**：允许 child step `fail(...)`，root step 仍 `succeed(...)`，前提是这是刻意的非异常回退路径。
- **长连接（SSE / WS）**：更关注子步骤状态；HTTP 状态码可能无法完整表达中途失败。

### 不允许的情况

- 客户端已经收到 `error` 事件，但日志最终是全绿成功。
- 真实失败只落在 root step，没有 child step 指明故障位置。
- 异步调用抛错后直接冒泡，child step 没有 `fail(...)`。

## 字段记录规则

可以记录：

- `count` / `rows` / `entries`
- `statusCode`
- `model`
- `enabled`
- `scheduleKind`
- `waitForDiagnostics`
- `channelId` / `sessionId` / `templateId` 这类内部主键

不要记录：

- 渠道配置、Provider 配置、OAuth 凭据、API Key
- 用户消息正文、Prompt、聊天内容
- `email`、`chatId` 等直接 PII
- 完整本地路径（除非用户明确要求诊断路径问题）

路径相关日志优先使用：

- `valid: true/false`
- `isDirectory`
- `truncated`
- `bytesRead`
- `visitedEntries`
- `scannedFiles`

而不是原始绝对路径。

## WebSocket / SSE 规则

### SSE

- 如果是一个 HTTP 请求内部的流式过程，继续挂在该请求的 route root step 下。
- 典型子步骤：
  - `stream.sse.session-check`
  - `stream.sse.model-resolve`
  - `stream.sse.upstream.fetch`
  - `stream.sse.upstream.stream`

### WebSocket

- 如果是“一个握手请求 + 多条消息”，不要强行复用 HTTP root step 去记录每条消息。
- 为每条消息使用单独的 `WorkflowLogger` 是允许的。
- 但如果握手请求能拿到 `requestId`，新的 WS 日志上下文必须**复用这个 requestId**，避免链路断裂。
- 例如 `routes/stream.ts` 和 `lsp/router.ts` 中的 WS 日志都应沿用握手阶段的 `workflowContext.requestId`。

## 新路由接入清单

新增或重构网关路由时，至少检查：

1. 是否优先调用了 `startRequestWorkflow()`？
2. 是否把 DB / FS / upstream / plugin 边界拆成 child step？
3. 是否在错误分支对 child step 调用了 `fail(...)`？
4. 是否避免记录敏感字段？
5. 如果是 WS/SSE，是否保持 requestId 关联？
6. 修改后是否执行：
   - `lsp_diagnostics`
   - `pnpm --filter @openAwork/logger build`（如果改到 logger）
   - `pnpm --filter @openAwork/agent-gateway build`
   - `pnpm --filter @openAwork/agent-gateway test`

## 参考实现

- 请求级自动日志：`services/agent-gateway/src/request-workflow.ts`
- 路由示例：
  - `services/agent-gateway/src/auth.ts`
  - `services/agent-gateway/src/routes/sessions.ts`
  - `services/agent-gateway/src/routes/stream.ts`
  - `services/agent-gateway/src/routes/settings.ts`
  - `services/agent-gateway/src/channels/router.ts`
- 渲染实现：`packages/logger/src/workflow-logger.ts`
