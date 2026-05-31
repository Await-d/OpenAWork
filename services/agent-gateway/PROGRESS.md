# agent-gateway 上游迁移进度（AI SDK 5.x）

跟踪 OpenAWork agent-gateway 把上游 LLM 协议（chat_completions /
anthropic_messages / responses）从手卷 fetch + SSE parser 迁到 Vercel
AI SDK 的工程进展。所有路径默认仍跑 v1，只有当
`OPENAWORK_RUNTIME_UPSTREAM=v2` 时才走新栈。

## 当前状态：Phase A / B.1 / B.2 / C 全部完成；B.3 灯位灰度已上线

```
A.1–A.4  generateText 路径与 3 处非流式调用切换  ✅
C.1      runUpstreamStream 事件覆盖              ✅
C.2      tool-sandbox → AI SDK ToolSet           ✅
C.3      cache_control / anthropic-betas /
         providerOptions middleware              ✅
C.4      shadow-traffic chunk 序列对比测试       ✅
B.1      stream-model-round v2 早返回              ✅
B.2      tools 接入 + maxRetries 透传             ✅
B.3.a    OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS 灯位  ✅
B.3.b    shadow-mode 桥接 diff（零双拼 LLM）       ✅
B.3.c    生产逐步切流量                          ⏳
E        事后小项：token usage 透传             ✅
```

## 关键文件地图

| 模块                                                   | 用途                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `src/v2-runtime/upstream/provider.ts`                  | AI SDK provider 工厂（含 anthropic-beta header 自动组装）    |
| `src/v2-runtime/upstream/bridge.ts`                    | OpenAWork `AIProvider` → AI SDK provider 配置桥              |
| `src/v2-runtime/upstream/run-upstream-generate.ts`     | 非流式 `generateText` 封装（A 阶段使用）                     |
| `src/v2-runtime/upstream/stream-runner.ts`             | 流式 `streamText` runner，输出 OpenAWork StreamChunk         |
| `src/v2-runtime/upstream/normalized-message-bridge.ts` | NormalizedConversationMessage → ModelMessage                 |
| `src/v2-runtime/upstream/unified-message-bridge.ts`    | UnifiedMessage → ModelMessage（B.1 接入点）                  |
| `src/v2-runtime/upstream/tool-adapter.ts`              | ToolDefinition → AI SDK ToolSet（含 declarations-only 变体） |
| `src/v2-runtime/upstream/cache-breakpoints.ts`         | Anthropic 缓存断点决策                                       |
| `src/v2-runtime/upstream/provider-options.ts`          | thinking / reasoning effort → providerOptions 映射           |

## Phase A：非流式调用迁移

4 处自卷 fetch 已统一到 `runUpstreamGenerate`：

- `src/session-title-llm.ts` — 会话标题生成
- `src/compaction-llm.ts` — 历史压缩 / 总结
- `src/look-at-tools.ts` — 多模态文件分析（含 `providerType` 替代旧 `protocol`）
- `src/routes/workflow-llm.ts` — 工作流 / 团队 / 设置面板里的非流式补全
  调用（`requestWorkflowLlmCompletion`）。同时清理了 v1 only 的
  `buildWorkflowLlmRequest` / `extractWorkflowLlmText` /
  `WorkflowLlmRequest` 类型，公开签名 `requestWorkflowLlmCompletion`
  与 `WorkflowLlmRequestConfig` 保持向后兼容。

## Phase C：事件 + middleware

### C.1 流式事件覆盖

`stream-runner.ts` 已映射 AI SDK fullStream → OpenAWork StreamChunk：

- `text-delta`、`reasoning-{start,delta,end}`
- `tool-input-{start,delta,end}` + `tool-call`（tool name 缓存）
- `finish` / `finish-step`（折叠为单次 done，避免重复发）
- `error` / `abort`

### C.2 工具适配

`tool-adapter.ts` 提供两种包装：

- `wrapToolsForAiSdk` — 完整 `execute` 直通，AI SDK 自动跑 tool loop
- `wrapToolsForAiSdkDeclarationsOnly` — 仅声明，不挂 `execute`，AI SDK
  在 `tool-calls` 完成时停步；**B.1 / B.2 v2 路径将使用此变体**保留外
  层 OpenAWork agent loop 语义（权限、沙箱、文件 diff 捕获、子会话）

### C.3 Provider middleware

- `cache-breakpoints.ts`：anthropic / openrouter 路径自动给 system + 末
  尾 2 条非系统消息打 `cache_control: ephemeral`
- `provider-options.ts`：thinking / reasoning effort 映射到对应供应商
  的 AI SDK `providerOptions` 字段（anthropic.thinking、
  openai-compatible.reasoningEffort、qwen/moonshot/mimo/gemini 的 body 字段）
- `provider.ts` 内置 `anthropic-beta` 头自动组装（含
  `prompt-caching-scope`、`interleaved-thinking`、
  `fine-grained-tool-streaming`，并读取 `ANTHROPIC_BETAS` 环境变量）

### C.4 Shadow-diff 测试

`src/__tests__/v2-runtime-shadow-diff.test.ts` 用 `MockLanguageModelV2`
针对相同语义的输入并跑 v1 parser + v2 runner，比较 chunk 序列：

- 纯文本 + done
- 流式 tool_call
- reasoning + text 混合

## Phase B.1：stream-model-round 接线

`src/routes/stream-model-round.ts` 在 `markFailedRequestScopeMessages`
之后增加 v2 早返回分支（约 220 行）：

- **触发条件**：`isV2UpstreamForProviderType(route.providerType)
&& (protocol === 'chat_completions' ||
protocol === 'anthropic_messages')`
- **复用闭包**：`accumulateChunk` / `writeChunk` /
  `persistStreamChunkAsSessionEvents` / `ensureStepStarted` /
  `finalizeAssistant` / `emitStepEnded` / `markFailedRequestScopeMessages`
- **失败回退**：provider 构造或 bridge 失败时写
  `V2_UPSTREAM_FALLBACK` 审计日志并落回 v1

## Phase B.2：tools + retry

- `tool-adapter.ts` 新增 `wrapGatewayToolsForAiSdkDeclarationsOnly`：取
  网关侧已渲染的 `GatewayToolDefinition`（JSON Schema parameters）包
  装为 AI SDK 声明式 Tool，覆盖静态 / 动态 / MCP / LSP / deferred 所
  有路径。`runModelRound` v2 分支传入 `tools`，AI SDK 透出
  `tool-input` 增量并在 `tool-calls` finish-step 停步，外层
  OpenAWork agent loop 继续接管权限 / 沙箱 / file-diff / 子会话
  调用。
- `runUpstreamStream` 新增 `maxRetries` 参数。`runModelRound` 透传
  `requestData.upstreamRetryMaxRetries`，复用 AI SDK 内置的
  5xx / 429 / transient 退避，与 v1 `fetchUpstreamStreamWithRetry`
  等价。

## Phase B.3.b：shadow-mode（桥接结构 diff，零双拼 LLM 调用）

`OPENAWORK_RUNTIME_UPSTREAM_SHADOW=1` 环境变量独立于主体灯位，
任何 v1 路径完成 ProviderAdapter 渲染后、发起上游调用之前：

1. 跳 `unifiedConversationToModelMessages(allUnifiedMessages)` 生成 v2
   ModelMessage[]。
2. 跳 `compareV1V2BridgeStructural(v1Messages, v2Messages)` 产生结构 diff
   （count / role / text-size ± 1% / tool_calls count）。
3. 写 `V2_BRIDGE_DIFF` 审计日志，`isError = !matched`。

严格不发任何 LLM 请求。应用：生产流量上验证桥接高保真度，为
全量切换提供信号。

## Phase B.3.a：providerType 灯位灰度

`OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS=anthropic,openai` 环境变量限
定 v2 路径只对名单内 providerType 生效：

- 未设置 → 所有 providerType 均符合资格（在 `OPENAWORK_RUNTIME_UPSTREAM=v2`
  差异下）
- 设置后 → 仅名单内 providerType 走 v2，其余仍走 v1
- 全局 flag 为 `v1` 时任何 providerType 都走 v1（安全默认）

实现：`v2-runtime/runtime-flag.ts` 导出 `isV2UpstreamForProviderType`,
`runModelRound` v2 早返回判定改走该 helper。
同时清理了旧 probe 块（原 562-606）——B.1 已覆盖。

## 风险点 & 已知差距

| 项                               | 影响                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **不支持 responses 协议**        | `@ai-sdk/openai` 未安装；responses-API 路由继续走 v1                                                                                    |
| **`previous_response_id` 暂缓**  | 同上，需要 `@ai-sdk/openai`                                                                                                             |
| **deferLoading 由 v2 fall back** | 任一 tool 标 `deferLoading: true` 时 v2 主动落回 v1，避免 schema 行为差异（gate 在 `runModelRound` 中）                                 |
| **tool-adapter 缺少权限/沙箱**   | C.2 的带 execute 变体未接 ToolSandbox；B 阶段使用 declarations-only，外层 agent loop 继续负责权限/diff，未来如果切为全 AI SDK loop 需补 |

### LLM 上游覆盖完整性

经全仓 `await fetch(...)` 排查，所有走 LLM 协议的入口现已统一通过
`runUpstreamGenerate` / `runUpstreamStream`：

- 流式：`runModelRound` 主流程（v2 路径下走 streamText）
- 非流式：session-title / compaction / look-at / workflow-llm

剩余的直接 `fetch` 调用全部是非 LLM 路径——消息渠道（Telegram /
Discord / 飞书 / 钉钉 / WhatsApp / QQ）、Exa MCP、技能 manifest 拉取、
deep-conversation 验证脚本——与本次迁移目标无关。

## Phase F：一致性 audit 发现的遗留 bug

后续梳理仓库一致性时发现并修复了以下点：

1. **`deleteSessionWithMalformedRecovery` 漏了 v2 表**
   - 该函数在 `PRAGMA foreign_keys=OFF` 下手工删除 session-scoped 表，
     但定义表名列表则是仅含 v1 方面的表（session_messages 等）。
     v2 事件源表（message_v2 / part_v2 / session_entry）与 FTS 镜像
     （session_messages_fts）被遮蔽，在 恢复路径会产生孤立行。
   - 修复：拆出 `src/session-delete-recovery-statements.ts`（无依赖红色
     可测），补齐事件源 4 张表，加上 `__tests__/session-delete-recovery.test.ts`
     冻结出名单（+父子表顶点顺序 、sessions 放最后、
     audit_logs 仅 NULL 不删）。
2. **verification 矩阵同遗漏**
   - `verify-session-delete-cleanup-matrix.ts` 只验证 v1 表 cascade 的干净
     状态。补 message_v2 / part_v2 / session_entry 的 count 断言，
     避免 v2 表 cascade 静默退化进入生产。
3. **事件源对称性 / boot order 检查通过**
   - 10 个事件类型（4 条 SessionEvents 加 7 条 MessageEvents）都有
     对应 projector 注册。两处 emitEvent 调用点（message-store-v2 及
     message-v2-adapter）都 top-import、事件源 boot 顺序安全。
4. **flag 边界检查通过**
   - storage / upstream / services 子灯位互不耦合；isV2Storage 仅供 boot.ts 调，
     isV2UpstreamForProviderType 仅供 runModelRound 调，isV2UpstreamShadow 独立。
   - 错伍值 、 未设置 、空 allowlist 、undefined providerType 都有明确静默退化。
5. **类型安全检查通过**
   - 全仓无 `as any` / `@ts-ignore` / `@ts-expect-error`（仅 dynamic-agent-prompt
     里存在中文描述字串里包含该关键字）。
6. **`onClose` 钩子漏调 stopAll**
   - `cronScheduler.stopAll()` 与 `channelManager.stopAll()` 早就实现，但
     `index.ts` 的 fastify `onClose` hook 从未调到。生产里 cron job
     的 setInterval 与 messaging-channel websocket 在 hot-reload 周期里
     直接泄漏到下个进程，长跑实例容易看到 timer / fd 漏。
   - 修复：把两个 `stopAll` 加入 onClose 起首位置，并各自包 try/catch
     防止单点失败阻断后续 lsp / v2-runtime / db 清理。
7. **事件源↔SessionEntry aggregator 对称性通过**
   - `session-event.ts` 定义的 18 个事件类型 (prompt / synthetic /
     step._ / text._ / reasoning._ / tool.input._ / tool.called /
     tool.success / tool.error / retried / compacted) 都在 `session-entry.ts`
     的 `aggregateSessionEntries` switch 里有处理分支，replay 不会丢事件。
8. **`MessageEvents.Removed` projector 漏清 v1 mirror**
   - `appendSessionMessageV2` 双写：v1 mirror (`session_messages` +
     `session_messages_fts`) 和 v2 事件源 (`message_v2`/`part_v2` 经
     projector)。但 `MessageEvents.Removed` projector 只删 v2 表，
     v1 mirror 鬼魂行残留。
   - 影响路径：`truncateSessionMessagesAfterV2` 在 retry / 工具权限恢复
     场景调用 `MessageEvents.Removed`，FTS 搜索仍能命中已 truncate 的内容；
     `session-message-rating-store` 的 UNION 查询会把删除的消息标为存在。
   - 修复：`message-v2-projectors.ts` 的 Removed 分支补 `session_messages`
     和 `session_messages_fts` 的 DELETE，FTS 用 `message_id` key（其它
     表用主键 `id`）。新增 `__tests__/message-v2-projectors.test.ts`
     冻结表清理顺序，2 个用例。
9. **`SESSION_DELETE_RECOVERY_STATEMENTS` 漏 8 张 FK 表**
   - 全 schema 走查发现 recovery 列表只覆盖了主流程常用的 13 张表，但
     现行 schema 一共有 21 张表 FK→sessions(id)（CASCADE 或 SET NULL）。
     `PRAGMA foreign_keys=OFF` 下 cascade 不会跑，漏的表会全部留下孤立行。
   - 漏的 CASCADE 表：`message_ratings` / `notifications` / `session_shares` /
     `artifacts` / `artifact_versions` / `shared_session_comments` /
     `shared_session_presence` / `memory_extraction_logs`。
   - 漏的 SET NULL 表：`request_workflow_logs`（应 UPDATE …
     SET session_id = NULL，与 audit_logs 一致）。
   - artifact_versions 的 FK 指向 `artifacts(id)` 而非 `sessions(id)`，
     必须用子查询先删，否则父级 artifacts 删除后子行就找不到 join key。
   - 修复：补全 `session-delete-recovery-statements.ts` 的语句序，扩
     `__tests__/session-delete-recovery.test.ts` 冻结新表名 + 父子顺序，
     并改正 regex helper（原 `\bartifacts\b` 会误中
     `artifact_versions` 子查询里的 `FROM artifacts`，造成索引错位）。

## 验证

```sh
# typecheck（应零错误）
pnpm --filter @openAwork/agent-gateway typecheck

# 单测（v2 相关）
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/v2-runtime-upstream.test.ts \
  src/__tests__/v2-runtime-tool-adapter.test.ts \
  src/__tests__/v2-runtime-provider-options.test.ts \
  src/__tests__/v2-runtime-shadow-diff.test.ts \
  src/__tests__/v2-runtime-unified-bridge.test.ts \
  src/__tests__/v2-runtime-bridge-diff.test.ts \
  src/__tests__/session-delete-recovery.test.ts \
  src/__tests__/message-v2-projectors.test.ts

# 全套测试（CI 基线）
pnpm --filter @openAwork/agent-gateway test
```

最近一次本地结果：155 tests / 22 files all pass。

## 下一步（按优先级）

1. **Phase B.3.c — 逐步切流量**
   - 开启几台实例 `OPENAWORK_RUNTIME_UPSTREAM_SHADOW=1`，观测
     `V2_BRIDGE_DIFF` 审计日志里 `matched=false` 的频率与原因。
   - 在另外实例上带 `OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS=anthropic`
     → `openai,anthropic` → ... 逐步扩大。
   - 耀路点：每一批都验证 V2_UPSTREAM_FALLBACK / V2_UPSTREAM_ERROR
     低于 SLA 阈值，再推下一批。
2. **待 `@ai-sdk/openai` 引入**
   - 补 responses-API 路径 + `previous_response_id`。
3. **越点 — 全 AI SDK loop**
   - 以后可考虑把外层 agent loop 交给 streamText 自动调 tools，需要
     处理权限 / 沙箱 / file-diff 捕获在 AI SDK execute callback 里
     接入。会使 tool-adapter 变体中那个完整 wrapToolForAiSdk 被使用。
