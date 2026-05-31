# Team 后端差距审计（2026-05-24）

> 用途：基于 `docs/architecture/team-*.md` 与 `services/agent-gateway/src/` 实际代码交叉核对后，给出当前 Team 后端能力的真实完成度清单。
>
> 结论优先级：
>
> - `未完成`：功能主闭环缺失，必须继续做
> - `半完成`：能力存在，但未达到架构文档目标
> - `已完成但文档过时`：代码已落地，不应继续按旧文档算作缺口

---

## 0. 复核更新（2026-05-29，以代码与测试为准）

> 本节为最新复核结论，**优先级高于下方 §1–§6 的旧判断**。下方旧章节保留作为演进留痕，不再代表当前状态。

交叉核对 `services/agent-gateway/src/` 与聚焦测试后，原列为「未完成 / 半完成」的三项已全部闭环：

1. `d.2 architecture review` 已是正式守门，而非软 lint。`pm2-runner.ts` 区分 `warning` / `blocking`，写 review artifact、写 d 层 `handoff_records.result_json`，blocking 时记录 `architecture_review` runtime incident 并阻断 e/f/g 派发。证据：`handoff/runner/pm2-runner.ts`、`__tests__/handoff/pm2-runner.test.ts`。
2. `L1.6` 四项延迟指标均有真实采样点：`a_to_b_direct`（`reception-orchestrator.ts`）、`a_to_b_ack`（`team-inbound.ts`）、`substate_push`（`team-events.ts`）、`progress_interval`（`substate-store.ts`）。超阈值写 `latency_violation` incident，并经 `team-runtime-diagnostics-store.ts → team-runtime-telemetry.ts` 接出 telemetry 通道。
3. `sessions` 级暂停元数据已落库：`infra/db.ts` 补齐 `paused / paused_at / paused_by_user_id / pause_reason` 与 `idx_sessions_paused`；`team-runtime-control-store.ts` 提供 `pauseTeamRuntimeTree / resumeTeamRuntimeTree` 子树级联，REST 控制面 `pause-all / resume-all` 已接入。证据：`__tests__/team/team-handoffs-routes.test.ts`。

复核当天通过的聚焦测试：`pm2-runner`、`team-runtime-telemetry`、`team-events-bus`、`team-events-routes`、`team-runtime-routes`、`session-run-events`、`stream-error-contracts`（7 文件 39 用例）；`team-handoffs-routes`、`handoff-store`、`handoff-watcher`（3 文件 61 用例）。

### 0.1 本轮新增的错误/网络健壮性加固

- LSP 诊断分发：`packages/lsp-client/src/index.ts` 新增 `dispatchDiagnostics`，对每个 handler 做 try/catch 隔离，避免单个订阅者（如半关闭的 WS）抛错中断其余订阅或回灌 LSP 通知线程。
- `/lsp/events` WS：`services/agent-gateway/src/lsp/router.ts` 改用 `safeSendLspEvent`，发送失败即 `finalize` 收口，不再让裸 `socket.send` 抛错冒泡进诊断分发。
- 回归证据：`packages/lsp-client/src/diagnostics-dispatch.test.ts`（2 用例）覆盖「抛错 handler 不阻断其余订阅且不上抛」与「取消订阅后不再收事件」。
- 同时复核确认其余发布链路已具备订阅者异常隔离：`team-events-bus.ts`、`session-run-events.ts`（`notifyRunEventHandler`）、`mcp-tool-catalog.ts`（`publishChange`）；`mcp-events.ts`、`session-terminals.ts` 的 SSE 写入已带 `clientClosed` 守卫与 try/catch。

### 0.2 上游网络连接异常分类加固（2026-05-29 续）

- `services/agent-gateway/src/provider/retry-classify.ts` 新增 `network` 分类：原本传输层失败（`ECONNRESET / ETIMEDOUT / ECONNREFUSED / ENOTFOUND / EAI_AGAIN / UND_ERR_*` 等）会落入 `unknown` 且 `retryable=false`，恢复层既不重试也无稳定类别。
- 现在优先按 Node/undici 的 `error.code`（含 `cause` 链解包，覆盖 `TypeError: fetch failed` 这类包装）识别连接失败，标记 `retryable=true` 并带退避；message 兜底（`fetch failed / socket hang up / connection reset / timeout` 等）放在 rate-limit / overloaded 判定之后，避免「timeout」误抢更具体的类别。
- `stream-model-round.ts` 的上游错误收口会把该分类透传到 `V2_NETWORK` / `STREAM_NETWORK` 错误码与审计 `category`，让前端与告警看到稳定的网络异常类别而非「stream failed」。
- 回归证据：`__tests__/provider/retry-classify.test.ts` 新增 5 个用例（code 命中、cause 链解包、socket hang up message 兜底、rate_limit/transient_5xx 优先级保持），共 17 用例通过；`stream-error-contracts`、`stream-model-round-error`、`v2-runtime-upstream` 3 文件 21 用例回归通过。

### 0.3 消息渠道网络健壮性加固（2026-05-29 续）

- 问题：`channels/` 下 7 个渠道（Telegram / Discord / Feishu / DingTalk / WeCom / QQ / WhatsApp）全部裸 `fetch`、无超时。上游连接挂起时发送会永久 pending；Telegram 后台轮询循环还会被卡死，且出错后固定 1s 紧重试、未检查 `res.ok`，持续故障会打爆上游。
- 新增共享 `services/agent-gateway/src/channels/channel-http.ts`：`channelFetch`（默认 15s 超时，超时即 abort 并抛 `ChannelFetchTimeoutError`，支持与调用方 `AbortSignal` 合并）+ `computeChannelRetryDelayMs`（指数退避封顶 30s）。
- 7 个渠道的全部 26 处 `fetch` 调用改走 `channelFetch`（Slack 走 Bolt SDK，无裸 fetch）。Telegram 轮询额外加固：长轮询超时放宽到 35s（容纳 `timeout=25`）、`res.ok` 校验、失败计数驱动退避、`stop()` 主动 abort 在途长轮询、恢复后重置退避。
- 回归证据：新增 `__tests__/channels/channel-http.test.ts`（7 用例：超时抛错、成功透传、调用方 abort 原样抛、abort 状态透传、退避指数/封顶/非法值），全部通过；网关 typecheck 与 8 个触及文件 ESLint 干净。

### 0.4 渠道自动回复异常隔离（2026-05-29 续）

- 问题：`channels/router.ts` 用 `void autoReply.handle(event)` fire-and-forget 触发自动回复，但 `auto-reply.ts` 的 `handle()` 有多处可逃逸 reject（`tryHandleCommand`、`sendStreamingMessage`、以及 catch 内复用同一条可能已坏连接再发一次的 `handle.finish` / `sendMessage`）。任一抛出都会变成 unhandled rejection（项目明令禁止）。
- 加固：`handle()` 拆出 `handleInternal()` 并在最外层 try/catch 兜底吞错 + 记录；错误通知发送统一走 `safeSend()`，使「恢复发送」自身的传输失败也不会再抛。
- 回归证据：新增 `__tests__/channels/auto-reply.test.ts`（3 用例：agent 失败→错误回执且 handle 不 reject、错误回执发送再失败被吞掉、正常回复路径），全部通过；网关 typecheck 与触及文件 ESLint 干净。

附：`infra/db.ts` 的 `redis` 是内存 Map shim（非真实网络连接），不涉及网络健壮性；`channels/mcp-oauth.ts` 与 `verification/*` 是桌面一次性回调 / 本地 mock 校验服务器，均不在长连接健壮性范围内。

### 0.5 MCP 建连超时（2026-05-29 续）

- 问题：`packages/mcp-client/src/adapter.ts` 的 `connect()` 直接 `await client.connect(transport)`，SDK 的握手（`initialize` 往返）没有超时。stdio 子进程能 spawn 却不回 `initialize`、或 HTTP/SSE 端点 socket 挂起时，`connect()` 永久 pending；又因 `skill-mcp-connection-pool.ts` 用 `pendingConnections` 去重，单个挂起握手会拖死该 (user, server) 的所有并发工具调用，且 `status` 永远停在 `connecting`。
- 加固：新增 `connectWithTimeout`（30s，复用既有 `MCPTimeoutError`），超时即 best-effort `client.close()` 关闭半开连接再抛错；三处 transport 握手（stdio / Streamable HTTP / SSE）全部接入。Streamable HTTP→SSE 回退也加判定：连接超时直接抛出，不再静默回退导致二次 30s 挂起。
- 工具调用层已有 30s 超时（`adapter.callTool` 的 `timeout: options?.timeout ?? 30_000`），本轮补齐了「建连」这一缺口。
- 回归证据：新增 `packages/mcp-client/src/connect-timeout.test.ts`（3 用例：握手挂起→`MCPTimeoutError`+关闭、正常握手透传、非超时错误原样抛不关闭），全部通过；`mcp-client` typecheck/lint 干净；网关侧 `skill-mcp-connection-pool` / `mcp-runtime-retry` / `mcp-tool-catalog` 共 22 用例回归通过。

### 0.6 设备配对超时与连接收口（2026-05-29 续）

- 问题：`packages/pairing/src/manager.ts` 的 `waitForClient(token, timeoutMs)` 把 `timeoutMs` 标成 `_timeoutMs` 完全忽略——返回的 Promise 永不超时，且 resolver 永久滞留在 `pendingClients`（内存泄漏）。`connectWithToken` / `verifyConnection` 用裸 `fetch` 无超时，对端挂起会永久阻塞配对登录。
- 加固：`waitForClient` 实现真实超时（到点以新增 `PairingTimeoutError` 拒绝并清理注册与计时器）；`pendingClients` 改为 `Set<PendingClientWaiter>`，resolve/timeout/disconnect 三条路径都会注销等待者并清计时器，杜绝泄漏。两处 HTTP 调用改走 `fetchWithTimeout`（15s，AbortController）。
- 回归证据：新增 `packages/pairing/src/manager.test.ts`（5 用例：confirm 成功 resolve 并清理、超时→`PairingTimeoutError`、disconnect 清理计时器、connect 透传 AbortSignal、verify 失败返回 false），全部通过；`pairing` typecheck/lint 干净；网关 `pairing-login-route` 4 用例回归通过。
- 旁证：`packages/browser-automation` 的各操作已把 `timeout?` 透传给 Playwright（自带默认超时与抛错），本轮未发现同级缺口。

### 0.7 浏览器端流式客户端事件分发隔离 + 发送队列（2026-05-29 续）

- 问题一：`packages/web-client/src/gateway/gateway-ws.ts` 与 `gateway-sse.ts` 都用裸 `for (const h of this.handlers) h(chunk)` 分发流事件。订阅者是外部 React effect / store 更新器，其中一个抛错（如组件已卸载却引用了过期 ref）会中断循环，导致其余订阅者收不到后续 `done` / `error`，UI 卡在 loading。
- 问题二：`gateway-ws.ts` 的 `send()` 在 socket 仍 CONNECTING 时只用单槽 `pendingPayload` 缓存，连续多次 send 会互相覆盖、静默丢消息。
- 加固：新增并导出 `dispatchStreamEvent`（对每个 handler try/catch 隔离 + 快照防 mid-dispatch 退订错位），WS / SSE 两处的 onmessage/onerror/解析失败分支全部接入；`pendingPayload` 改为 `pendingPayloads` 队列，`onopen` 时按序 flush，`disconnect` 清空。
- 回归证据：新增 `gateway-stream-dispatch.test.ts`（3 用例：抛错 handler 不阻断其余、mid-dispatch 退订按快照分发、空集合 no-op），全部通过；`web-client` typecheck/lint、`no-english-failure-literals` 架构约束、全量 35 文件 194 用例回归通过。

### 0.8 LSP WebSocket 客户端重连退避 + 回调隔离（2026-05-29 续）

- 问题：`packages/lsp-client/src/ws-client.ts` 断开后用固定 `reconnectDelayMs ?? 3000` 重连——无退避、无上限、无抖动，网关持续宕机时每 3s 死磕，多客户端同时重连会形成 thundering herd。`onmessage` 里的 `onDiagnostics?.()` 回调无 try/catch，抛错会冒泡进 WS 事件循环。
- 加固：改为指数退避（`base*2^(attempt-1)`）+ 满抖动 + `maxReconnectDelayMs`（默认 30s）封顶；`onopen` 成功后重置 `reconnectAttempts`，瞬断仍快速恢复；`new WebSocket` 同步抛错（畸形 URL 等，`onclose` 不会触发）也补排重连。`onDiagnostics` 回调包 try/catch，抛错转 `onError` 不冒泡。
- 回归证据：新增 `packages/lsp-client/src/ws-client.test.ts`（4 用例：指数退避+onopen 重置、封顶、disconnect 不再重连、回调抛错隔离），全部通过；`lsp-client` 全量 6 用例、typecheck/lint 干净。
- 旁证：`services/agent-gateway/src/routes/session-terminals.ts` 的 SSE 写入已带 `clientClosed` 守卫与 try/catch、spawn 失败有 `spawn_failed` 结构化错误，本轮未发现同级缺口。

### 0.9 移动端网关客户端帧解析/回调隔离 + 发送队列（2026-05-29 续）

- 问题：`apps/mobile/src/hooks/useGatewayClient.ts` 的 `onmessage` 直接 `JSON.parse(ev.data)` 无 try/catch，坏帧会抛出并逃逸进 WS 事件循环；分发到 `handlers.*` 也无隔离，回调抛错（卸载屏的 setState 等）会断连。`send()` 用单槽 `pendingPayload`，CONNECTING 期间连续多次 send 会互相覆盖、静默丢消息。
- 加固：`onmessage` 解析失败转 `WS_INVALID_PAYLOAD` 结构化错误；分发抽出 `dispatchChunk` 并包 try/catch，回调抛错转 `WS_HANDLER_ERROR` 不冒泡。`pendingPayload` 改为 `pendingPayloads` 队列，`onopen` 按序 flush、`disconnect` 清空。指数退避重连（封顶 30s、`onopen` 重置）此前已存在，保留。
- 回归证据：新增 `apps/mobile/src/__tests__/gateway-client.test.ts`（4 用例：坏帧→`WS_INVALID_PAYLOAD`、回调抛错→`WS_HANDLER_ERROR`、多 payload 按序 flush、正常 done 帧），全部通过；mobile typecheck/lint、全量 2 文件 14 用例回归通过。
- 旁证：`apps/desktop/src-tauri/src/lib.rs` 的 sidecar 健康检查/优雅关闭已带 2s `timeout` 与端口释放轮询；`apps/desktop/src/utils/gateway-mode.ts` 健康检查带 2.5s 超时，本轮未发现同级缺口。

### 0.10 技能注册表安装/源校验网络超时（2026-05-29 续）

- 问题：`packages/skill-registry/src/client.ts` 已有 `fetchWithTimeout`，但 `installer.ts`（`parseManifestFromEntry` 拉远端 manifest、`defaultLocalFileReader` 两处）与 `source.ts`（`verifySource` 拉 registry-info.json）仍是裸 `fetch` 无超时。远端 URL 挂起时安装 / 源校验会永久卡住。
- 加固：在 `installer.ts` 与 `source.ts` 各加模块级 `fetchWithTimeout`（8s，AbortController，与 client.ts 口径一致），覆盖全部 3+1 处远程 `fetch`。
- 回归证据：新增 `packages/skill-registry/src/installer-fetch-timeout.test.ts`（2 用例：远端 manifest 挂起 8s 后 abort 拒绝、正常 manifest 透传解析），全部通过；`skill-registry` typecheck/lint 干净。
- 旁证：`agent-core` 的 provider 流式调用走 AI SDK（`maxRetries` + `abortSignal`），其网络错误分类与上游收口已在 §0.2 / 网关 `stream-runner` 覆盖，本轮未发现同级缺口。

### 0.11 skill 工具远程内容拉取超时 + 出站 fetch 审计（2026-05-29 续）

- 问题：`services/agent-gateway/src/skill/skill-tools.ts` 的 `fetchSkillText(manifestUrl)` 裸 `fetch` 无超时也无 signal；远端 skill 内容 URL 挂起时会占满工具执行直到 agent run 的 30s 工具预算耗尽（部分传输甚至不 abort socket）。
- 加固：`fetchSkillText` 加 15s `AbortController` 超时（finally 清理定时器），并导出以便单测。
- 出站 fetch 全量审计结论：`settings.ts`（npm 版本检查，`AbortSignal.timeout(5000)`）、`skill-update-checker.ts` / `routes/skills.ts`（controller signal）、`tools/web-tools.ts` / `tools/codesearch-tools.ts` / `image-generation/*`（工具 signal + abort 处理）均已具备超时/取消；`channels/*`、`skill-registry/*`、`pairing` 已在前几轮收口。
- 回归证据：新增 `services/agent-gateway/src/__tests__/skill/skill-content-fetch-timeout.test.ts`（3 用例：挂起 15s 后 abort、200 返回文本、非 2xx 抛 HTTP 错误），全部通过；既有 `skill-tools-effective` 11 用例、网关 typecheck/lint 干净。
- 并发竞态旁证：`packages/web-client/src/gateway/token-refresh.ts` 的 `withTokenRefresh` 已用共享 `refreshPromise` 对并发 401 刷新去重（成功/失败都在 finally 清空），无重复刷新竞态。

### 0.12 多 Agent DAG 失败传播死循环修复 + SQLite busy_timeout（2026-05-29 续）

- 严重 bug：`packages/multi-agent` 的 `executeDAG` 在「无 ready 节点但未全部终态」时只 `await 50ms` 空转。当某节点 `failed` 而下游依赖它时，`isEdgeSatisfied` 只认 `completed/skipped`，下游永远停在 `pending`，`allDone` 永不成立 —— 单个带下游依赖的失败节点会让 `executeDAG` 永久挂起。
- 修复：`dag.ts` 新增 `resolveStuckNodes`（fixpoint 级联）：上游全终态但仍不 ready 的 pending 节点，按是否有 failed/缺失上游分类为 `failed`（失败沿依赖链传播、发 `node_failed` 事件）或 `skipped`（仅因条件分支未取）。`orchestrator.ts` 的空转分支改为调用它；若一轮无法推进（真正死锁，如环），直接把 DAG 置 `failed` 并发 `dag_completed`，不再 hang。
- 加固二：`packages/agent-core/src/session/sqlite-session-store.ts` 与 `services/agent-gateway/src/infra/db.ts` 都开了 WAL 但无 `busy_timeout`，并发写遇 `SQLITE_BUSY` 直接抛错；各加 `busy_timeout=5000`，让竞争写等待而非硬失败。
- 回归证据：新增 `packages/multi-agent/src/orchestrator-failure-propagation.test.ts`（2 用例：上游失败→不死循环 + DAG failed + 下游 failed、全成功→completed），全部通过；multi-agent / agent-core typecheck/lint 干净；gateway `team-handoffs-routes` 22 用例冒烟通过。

### 0.13 withRetry 不可重试错误语义修正（2026-05-29 续）

- 问题：`packages/agent-core/src/error/retry.ts` 的 `withRetry` 在 `isRetryable(error) === false` 时也 `break` 并最终抛 `RetryExhaustedError`，吞掉原始错误类型且谎报「Exhausted N attempts」（实际第一次就放弃）。
- 修复：不可重试错误直接 `throw error`（原样上抛）；只有真正用尽 `maxAttempts` 才抛 `RetryExhaustedError`。abort/backoff 上限/jitter/可取消 sleep 原本已健壮，保留。
- 既有审计：`task-system/store.ts` 用原子写（temp + rename）+ JSON 损坏重试降级，`workflow/state-machine.ts` 是纯函数 FSM（含 interrupted/error/retry 转移），均无缺口。
- 回归证据：新增 `packages/agent-core/src/error/retry.test.ts`（6 用例：首次成功、不可重试原样抛、可重试耗尽抛 RetryExhaustedError 保留 lastError、已 abort 立即抛、backoff 期间 abort、computeDelay 封顶），全部通过；agent-core typecheck/lint 干净。无既有调用方依赖旧的「总是 RetryExhaustedError」契约。

### 0.14 session-run-events 发布快照隔离（2026-05-29 续）

- 问题：`services/agent-gateway/src/session/session-run-events.ts` 的 `publishSessionRunEvent` / `broadcastPersistedSessionRunEvent` 直接对活跃订阅 `Set` 做 `handlers.forEach(...)`。`/stream/attach` 的终态事件会在回调内同步 `cleanup()→unsubscribe()`，而某些 handler 也可能在分发中触发对同一 session 的新订阅；直接迭代活跃 Set 时，`Set.forEach` 会把本轮新增订阅者也遍历到（破坏 attach 的 replay→live 边界，可能给刚加入的订阅者投递它本不该收到的事件）。
- 加固：两处改为遍历前快照 `[...handlers]`，与 `team-events-bus` / lsp 诊断分发 / web-client 流分发的既有口径一致。退订只影响后续事件、mid-dispatch 新增订阅者不会收到当前这一轮。
- 审计旁证：`/sessions/:id/stream/attach` 的 replay→live 衔接已很稳健（先订阅、replay 完成前缓冲 live 进 `pendingLiveEvents`、`deliverEvent` 用 `seq <= lastSeq` 去重、replay 后排序 flush、终态 cleanup、全程 safe 写）；`seq` 分配在 `persistRunEventRow` 内同步（MAX(seq)+1 与 INSERT 之间无 await），单进程无交错。
- 回归证据：`session-run-events.test.ts` 扩到 3 用例（异常隔离 + 回调内退订自己其余仍按快照收到 + 回调内新增订阅者不收当前轮），全部通过；`stream-error-contracts` 4 用例回归通过；网关 typecheck/lint 干净。

### 0.15 artifacts 索引容错 + telemetry 上报超时（2026-05-29 续）

- 问题一：`packages/artifacts/src/manager.ts` 的 `loadPersistedArtifacts` 在构造函数里 `readFileSync` + `JSON.parse` 无 try/catch —— 索引文件损坏（崩溃半写、磁盘错误、手改）会让 `new ArtifactManagerImpl()` 直接抛错，使整个 artifacts 子系统无法初始化；`persistArtifacts` 的 `writeFileSync` 非原子，写入中途崩溃正好留下损坏索引。
- 修复一：load 失败/非数组时降级为空 store 并告警（构造不再崩溃），逐条跳过缺 `id` 的损坏项；persist 改为原子写（temp + `renameSync`，失败清理 temp）。
- 问题二：`packages/telemetry/src/telemetry-manager.ts` 的 `send` 用裸 `fetch` 无超时；telemetry endpoint 挂起时上报 fetch 永久 pending，跨 flush tick 累积未决连接，且 `shutdown()`（await flush）会卡住优雅退出。
- 修复二：`send` 加 `AbortSignal.timeout(10s)`；超时/网络错误仍按原样被吞，不影响主流程。
- 回归证据：新增 `packages/artifacts/src/manager.test.ts`（4 用例：非法 JSON 降级、非数组降级、原子写往返、跳过损坏条目）与 `packages/telemetry/src/telemetry-manager.test.ts`（2 用例：flush 传入 AbortSignal、send 失败吞错且队列清空），全部通过；artifacts/telemetry typecheck/lint 干净；网关 `team-runtime-telemetry` 5 用例回归通过。

### 0.16 LSP 子进程 spawn 错误隔离（2026-05-29 续）

- 问题：`packages/lsp-client/src/server.ts` 的所有 `spawn(bin, ...)` 创建的 ChildProcess 都没挂 `'error'` 监听。Node 的 spawn 子进程启动失败（ENOENT/EACCES）会异步 emit `'error'`；无监听时变成 uncaught exception，可能 crash 整个网关进程。`createLSPClient` 直接用 `process.stdout/stdin` 建连，spawn 失败时这两个流可能为 null，`createMessageConnection` 会抛模糊错误。
- 加固：`createLSPClient` 入口给 `process` 挂吞错的 `'error'` 监听（坏 LSP 退化为死连接，由 LSPManager 的 operation-retry/broken-set 恢复），并在 stdout/stdin 缺失时快速抛出清晰错误供 `getOrSpawnClient` 的 try/catch 捕获。
- 回归证据：新增 `packages/lsp-client/src/client-spawn-resilience.test.ts`（2 用例：缺 stdio 快速抛错、子进程 emit error 不产生未捕获异常），全部通过；lsp-client 全量 8 用例、typecheck/lint 干净。
- 旁证：`logger`（workflow-logger/frontend-logger 仅 console 输出，字段限 string|number|boolean，无序列化抛错风险）与 `browser-automation/proxy.ts`（薄转发层，transport 由调用方注入、各操作已透传 `timeout?`）本轮未发现同级缺口。

### 0.17 OAuth token 并发刷新去重（2026-05-29 续）

- 问题：`packages/agent-core/src/oauth/token-store.ts` 的 `autoRefresh` 在 `await client.refreshToken(...)` 期间无并发去重。两个并发调用同时看到过期 token，会各自用同一个 `current.refreshToken` 发起刷新；对会轮换 refresh token 的 OAuth 服务器（RFC 6749 §10.4 推荐），第二次用已失效的旧 refresh token 会失败，导致连接断裂。
- 加固：新增 `inflightRefreshes` 按 token key 缓存在途刷新 Promise，并发 `autoRefresh` 复用同一往返，`finally` 清理；用捕获的局部 `refreshToken` 常量避免非空断言。
- 回归证据：新增 `packages/agent-core/src/oauth/token-store.test.ts`（3 用例：并发合并为单次刷新且拿到同一新 token、刷新后 inflight 清空可再次刷新、未过期直接返回不刷新），全部通过；agent-core typecheck/lint 干净。
- 旁证：`ssh/ssh-session-binding.ts` 是 binding 表 + `getStatus==='connected'` 守卫的薄封装，真正的连接生命周期在 `ssh-connection-manager.ts`；本层无新增网络缺口。

### 0.18 SSH 连接握手超时（2026-05-29 续）

- 问题：`packages/agent-core/src/ssh/ssh-connection-manager.ts` 的 `connect` 用 `.on('ready')` / `.on('error')` 包成 Promise，但既没传 ssh2 的 `readyTimeout`、也没有自身超时兜底。若 TCP 对端接受连接后停滞（既不 ready 也不 error），`connect()` 的 Promise 永久 pending。
- 加固：显式传 `readyTimeout: 30s`；并加客户端侧 30s 超时兜底（`ready`/`error`/超时三者用 `settled` + `finish()` 互斥，超时则 `client.end()` 拆半开连接并标记 `error` 后 reject），resolve/reject 后清理定时器避免泄漏。新增可注入 `clientFactory`（默认动态 import 可选依赖 `ssh2`）作为测试缝。
- 回归证据：新增 `packages/agent-core/src/ssh/ssh-connection-manager.test.ts`（3 用例：握手挂起 30s 超时 reject 并 end + 标记 error、ready 正常 resolve、error reject 标记 error），全部通过；agent-core typecheck/lint 干净。

### 0.19 MCP OAuth 回调超时定时器泄漏（2026-05-29 续）

- 问题：`services/agent-gateway/src/channels/mcp-oauth.ts` 的 `DesktopLocalhostCallbackHandler.waitForCallback` 在成功回调（resolve/reject）路径下不 `clearTimeout` 那个 `timeoutMs`（默认 5 分钟）的超时定时器；定时器会一直挂到到期才触发（虽 `dispose` 后 server.close 是 no-op，但定时器在此期间保持句柄、阻碍进程优雅退出）。`MobileDeepLinkCallbackHandler` 同样在 `handleDeepLink` 成功路径不清理超时定时器。
- 加固：Desktop 端把超时定时器存为字段并在 `dispose()`（成功/超时都会调）里 `clearTimeout`；Mobile 端按 state 存 `timers` map，`handleDeepLink` 成功/失败与超时三条路径都 `clearState` 清理，`dispose` 清空全部。
- 回归证据：新增 `services/agent-gateway/src/__tests__/channels/mcp-oauth-callback-timers.test.ts`（4 用例：成功后无待触发定时器、dispose 清理全部、超时 reject 后清理、Desktop dispose 清理），全部通过；网关 typecheck/lint 干净。
- 测试基础设施旁证：网关全量 `test:unit` 在并行下有 3-4 个非确定性失败（共享 `:memory:` DB + vitest 并行 pool 串扰，伴随 `FOREIGN KEY constraint failed`）；A/B 验证（临时移除 §0.12 的 `busy_timeout` 后失败恶化到 35 个）证明该 flaky 为既有测试隔离缺陷、非本目标改动引入，且 `busy_timeout` 反而缓解之。FK 写 audit 失败已被 `safeWriteTeamRuntimeIncidentAudit` 的 try/catch 隔离、不反噬主流程。受影响包的隔离测试与包级全量测试均通过。

### 0.20 taskkill 子进程 error 未隔离（2026-05-29 续）

- 问题：Windows 杀进程兜底 `spawn('taskkill', ...)` 出现在两处——`session/persistent-terminals.ts:267`（关闭持久终端）与 `tools/bash-tools.ts:528`（killTree 超时/中止）。两处都没给返回的 ChildProcess 挂 `'error'` 监听；`taskkill` 缺失或 PATH 解析失败时其异步 `'error'` 事件会成为 unhandled exception 并 crash 网关（外层 `try/catch` 只能捕同步抛错，捕不到异步 error）。
- 加固：两处都改为捕获 spawn 返回值并 `killer.on('error', () => {})` 吞错（best-effort kill，失败无补救动作，但绝不能崩进程）。
- 旁证：同文件的主 shell `spawn`（persistent-terminals）与 `killTerminal` 的 `process.kill`（registry）均已挂 `on('error')` 或 try/catch；SIGTERM→3s→SIGKILL 升级、boot-time stale 清理、tmux/卡死 row 兜底状态翻转都已就绪，本轮只补 taskkill 这一处遗漏。
- 回归证据：`session-terminals-routes` + `session-terminal-registry` 共 24 用例回归通过；网关 typecheck/lint 干净。

### 0.21 上下文 URL 摄入超时 + 状态校验（2026-05-29 续）

- 问题：`packages/agent-core/src/context/manager.ts` 的 `addUrl` 用裸 `fetch(url)` 无超时、也不检查 `response.ok`——用户把 URL 加进上下文时，对端挂起会让 `addUrl` 永久 pending；404/500 还会把错误页 HTML 当正文摄入上下文。
- 加固：`fetch` 加 `AbortSignal.timeout(15s)`；非 2xx 抛出带状态码的错误，避免把错误页正文塞进上下文。
- 收尾盘点：对剩余产品代码裸 `fetch` 逐一核实，均已具备超时/取消——`web-search.ts`（每个 provider 透传 signal，`searchMerge` 带 `timeoutMs` abort + `finally` clearTimeout/removeEventListener + `Promise.allSettled` 隔离）、`catwalk`/`models-dev`（`AbortSignal.timeout(10s)`）、`settings`（5s）、`oauth/client`（同步 SQLite 持久化）、`cli/opkg`（一次性命令行，非常驻）。
- 回归证据：新增 `packages/agent-core/src/context/manager.test.ts`（3 用例：成功摄入并截断、非 2xx 抛错且不摄入、传入超时 AbortSignal），全部通过；agent-core typecheck/lint 干净。

### 0.22 Provider OAuth token 端点超时（2026-05-29 续）

- 问题：`packages/agent-core/src/provider/oauth.ts` 的 `fetchTokens`（exchange/refresh 共用）与 `revokeToken` 的 `revokeOne` 都检查了 `response.ok` 但都无超时；授权服务器挂起时，provider 的 token 刷新/吊销/兑换流程会永久 pending。
- 加固：两处 `fetch` 加 `AbortSignal.timeout(15s)`（共享 `OAUTH_HTTP_TIMEOUT_MS` 常量）。
- 旁证：`tools/web-tools.ts` 的 webfetch 已有 `createAbortSignal`（默认 20s 可配、合并外部 signal、`cleanup` 清理），无缺口。
- 回归证据：新增 `packages/agent-core/src/provider/oauth.test.ts`（3 用例：refreshToken 传入超时 signal 并解析新 token、非 2xx 抛状态码错误、revokeToken 传入超时 signal），全部通过；agent-core typecheck/lint 干净。

至此 agent-core 内所有对外 `fetch`（web-search、context.addUrl、provider/oauth、oauth/client 经同步 SQLite、catwalk/models-dev、lsp tools 走网关）均已具备超时/取消或非常驻豁免，产品代码无遗留的无超时网络出站点。

### 0.23 MCP OAuth client 端点超时（2026-05-29 续）

- 问题：`packages/agent-core/src/oauth/client.ts`（MCP OAuth client，区别于 §0.22 的 provider OAuth）的三处 `fetch`——`discoverMetadata`（元数据发现）、动态注册、token 兑换/刷新——都检查了 `response.ok` 但无超时；授权服务器挂起会让 MCP 鉴权流程永久 pending。
- 加固：三处 `fetch` 全部加 `AbortSignal.timeout(15s)`（共享 `OAUTH_CLIENT_HTTP_TIMEOUT_MS`）。
- 回归证据：新增 `packages/agent-core/src/oauth/client.test.ts`（2 用例：discoverMetadata 传入超时 signal、非 2xx 抛状态码错误），全部通过；agent-core typecheck/lint 干净。
- 更正 §0.22 末尾的措辞：`oauth/client` 此前并非「经同步 SQLite」（那是 gateway 侧的 `mcp-oauth-store`），它是直接 HTTP 的 MCP OAuth client，本轮补齐其超时。至此 agent-core 全部对外 `fetch` 确认具备超时/取消。

### 0.24 cron 调度器递归重排健壮性（2026-05-29 续）

- 问题：`services/agent-gateway/src/cron/scheduler.ts` 的 cron 分支用 `void this.fireJob(job).then(() => scheduleNext())` 递归重排。`.then` 只有 onFulfilled、没有 onRejected——一旦 `fireJob` 的 Promise 意外 reject，下一次 `scheduleNext()` 不会被调用，该 cron job 永久停摆，且产生 unhandled rejection。
- 加固：改为 `.then(() => scheduleNext(), () => scheduleNext())`，无论本次 fire 成功或失败都重排下一个 tick，cron 永不因单次异常停摆。
- 旁证（本轮全仓扫描，均无缺口）：所有 `spawn` 消费点都已挂 `on('error')`（lsp-client 经 §0.16 的 createLSPClient 入口统一覆盖、repo-clone-tools 有 5min 超时+SIGTERM+error/close、shadow-git-store 有 error/close/stdin.error、worker/index.ts 有 once(exit/error)、bash-tools/persistent-terminals 的 taskkill 经 §0.20 修复）；`setInterval` 要么是受管调度句柄（cron/watcher 存 map、有显式 stop），要么是请求作用域心跳（随连接 cleanup clearInterval）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/cron/scheduler-reschedule.test.ts`（2 用例：handler 持续 reject 仍继续重排、handler 成功也持续重排），全部通过；`cron-routes` 3 用例回归通过；网关 typecheck/lint 干净。

### 0.25 agent-core 调度器 runTask 异常隔离（2026-05-29 续）

- 问题：`packages/agent-core/src/schedule/index.ts` 的 `runTask` 用 `try { await task.handler() } finally { ... }`——只有 `finally`、没有 `catch`。三处调用（interval / once / cron tick）都是 `void this.runTask(...)` fire-and-forget；handler reject 时错误会穿过 finally 继续上抛，成为 unhandled rejection（可能 crash 宿主进程）。
- 加固：`runTask` 加 `catch`，把 handler 异常吞掉并 `console.error`，保留 finally 的重排/once 清理逻辑不变。
- 旁证：该文件的 `setInterval`（interval 任务 + 60s cron ticker）都存入 `intervalTimers`/`cronTimer` 并由 `stop()`/`clearTaskTimers` 显式清理，非泄漏；cron tick 用固定 interval 而非递归重排，无 §0.24 那类停摆问题。
- 回归证据：新增 `packages/agent-core/src/schedule/index.test.ts`（2 用例：interval handler 持续 reject 不抛未捕获异常且继续按周期触发、once handler reject 仍完成清理不再触发），全部通过；agent-core typecheck/lint 干净。

### 0.26 handoff watcher 后台 tick 异常隔离（2026-05-29 续）

- 问题：`services/agent-gateway/src/handoff/runner/watcher.ts` 的两个后台定时器用 `void this.tickOnce()` / `void this.recoveryTick()` fire-and-forget。`tickOnce` 只有 `try/finally` 无 `catch`，`recoveryTick` 完全无顶层 try/catch；它们调用的 `listPendingHandoffs`/`claimHandoff`/`createTeamSession`/`reclaimAbandonedHandoffs`/动态 import 等任一抛错（如 SQLite 抖动）都会逃逸成 unhandled rejection，可能 crash 持续运行的网关。
- 加固：在 `start()` 的两个 timer 回调处把 `tickOnce()`/`recoveryTick()` 改为 `.catch()` 收口（记录 `console.error`）。选择在 timer 回调隔离而非改方法本身，以保留直接调用方（测试/手动触发）观察异常的契约。timer 本就 `unref()` + `stop()` 清理，无泄漏。
- 回归证据：新增 `services/agent-gateway/src/__tests__/handoff/watcher-timer-isolation.test.ts`（1 用例：后台 tick/recovery 持续 reject 被隔离为 console.error、不产生未捕获异常）；既有 `handoff-watcher` 13 用例回归通过；网关 typecheck/lint 干净。

### 0.27 stream runtime-thread 心跳定时器异常隔离（2026-05-29 续）

- 问题：`routes/stream-runtime.ts` 与 `routes/stream.ts` 的 `runtimeThreadHeartbeat` `setInterval` 回调直接调 `touchSessionRuntimeThread`（裸 `sqliteRun`，不吞错）。这两个心跳在每个活跃 stream 请求期间持续运行；SQLite 抖动（SQLITE_BUSY / IO error）会在 timer 回调里抛出未捕获异常，可能 crash 网关。
- 加固：两处 heartbeat 回调包 try/catch，失败仅 `console.warn`（心跳是 best-effort liveness ping，下一次 tick 自动重试）。
- 回归证据：`stream-error-contracts` + `stream-model-round-error` 共 7 用例回归通过；网关 typecheck/lint 干净。该路径在大型 stream handler 内，无法在不重构的前提下独立单测，改动只在 DB 抛错时多一层吞咽、不改正常路径。

至此三个后台调度器（cron / agent-core schedule / handoff watcher）+ 两个 per-request 心跳定时器（stream-runtime / stream）的 fire-and-forget 与 timer 回调异常隔离已全部收口，网关侧无遗留的会逃逸成 unhandled rejection/exception 的后台定时器路径。

### 0.28 飞书渠道发送响应解析健壮性（2026-05-29 续）

- 问题：`channels/feishu.ts` 的 `sendMessage`/`replyMessage`/`sendStreamingMessage` 直接读 `data.data.message_id`，既不查 `resp.ok` 也不查飞书的 `code !== 0` 错误信封。飞书在 token 失效/限流时返回 HTTP 200 但 `code != 0` 且 `data` 缺失——盲读会抛 `Cannot read properties of undefined`，把发送失败掩盖成不可读的解析崩溃。（auth 与 card update 路径此前已检查 code，唯独发送路径漏了。）
- 加固：新增 `parseFeishuMessageId(resp, body)`，依次校验 `resp.ok`、`code === 0`、`data.message_id` 存在，否则抛出含 code/msg 的清晰错误；三处发送路径统一接入。响应类型放宽为 `data?` 可选以匹配错误信封。
- 旁证：其余渠道发送响应解析已是防御式——wecom/dingtalk 检查 `errcode`、telegram `data.result?.message_id ?? ''`、discord/qq `data.id ?? ''` 兜底，不会因字段缺失崩溃。feishu 是渠道层唯一的盲读缺口。
- 回归证据：新增 `services/agent-gateway/src/__tests__/channels/feishu-send-errors.test.ts`（3 用例：非零 code 抛清晰错误、正常返回 message_id、code 0 但缺 message_id 抛明确错误），全部通过；网关 typecheck/lint 干净。

### 0.29 渠道列表/群消息响应结构容错（2026-05-29 续）

- 问题一：`channels/feishu.ts` 的 `getGroupMessages`/`listGroups` 用 `data.data.items ?? []`——错误信封无 `data` 时 `data.data` 为 undefined，`.items` 抛 `Cannot read properties of undefined`；且每条 item 盲读 `item.sender.id`/`item.body.content`，单条缺字段崩整列表。
- 问题二：`channels/discord.ts` 的 `getGroupMessages`/`listGroups` 直接 `(await res.json()).map(...)`——Discord 错误时返回对象 `{ message, code }` 而非数组，`.map` 抛 `not a function`；且盲读 `m.author.id`。
- 加固：feishu 改 `data.data?.items ?? []` + 每条 item 防御式取值（sender/body/create_time 都有兜底）；discord 加 `Array.isArray` 守卫（非数组返回空列表）+ 每条防御式取值。
- 回归证据：`feishu-send-errors.test.ts` 扩到 5 用例（+getGroupMessages/listGroups 错误信封返回空列表）、新增 `discord-list-parsing.test.ts` 3 用例（非数组响应返回空、缺 author 防御解析、listGroups 错误返回空），共 8 用例通过；网关 typecheck/lint 干净。
- 至此渠道层的发送与列表/群消息响应解析全部具备「错误信封不崩、缺字段有兜底」的健壮性。

### 0.30 非流式 team/workflow LLM 调用墙钟超时（2026-05-30 续）

- 问题：`routes/workflow-llm.ts` 的 `requestWorkflowLlmCompletion` 是 team 运行时所有非流式 LLM 跳点的共用入口（reception 路由/意图改写 `reception-orchestrator.ts`、pm1 产物链 `pm1-runner.ts`、pm2 宪法+架构评审 `pm2-runner.ts`、d.4 质量评审 `pm2-quality-review-reconciler.ts → review-aggregator.ts`，以及 `workflows.ts`/`settings.ts`）。它把调用透传给 AI SDK 的 `generateText`，而 `generateText` 只认 `abortSignal`、**没有任何墙钟超时**；调用方又从不传 signal。上游 socket 挂起（连上但不回包）时这些 `await` 会永久 pending。
- 影响放大：pm2 质量评审用内存 `inFlightPm2QualityReviews` Set 去重，单个挂起调用会让该 d 层 handoff 永远停在 `reviewing`、reconciler 既不超时也不重试；reception 改写虽有上层 try/catch，但同样会卡在 routing 子状态。`reception-router.ts` 早先只给「LLM 兜底路由」加了 3s `Promise.race` 超时，覆盖面仅限路由分类那一处，主链路其余 LLM 跳点全部裸奔。
- 加固：在 `requestWorkflowLlmCompletion` 内置默认 60s 墙钟超时——`AbortController` + `unref()` 定时器；新增可选 `timeoutMs`（传 `0`/非有限值可显式关闭，留给已自带超时的调用方）与可选 `signal`（用 `AbortSignal.any` 与内部 deadline 合并，任一触发即 abort）。超时把 abort 透传到 `runUpstreamGenerate` 的 `abortSignal`，并抛稳定的 `workflow LLM timeout (<ms>ms)` 错误；非超时上游错误原样上抛，调用方既有 catch/重试语义不变。
- 回归证据：新增 `__tests__/routes/workflow-llm-timeout.test.ts`（5 用例：透传真实 AbortSignal、上游挂起到点 abort 并抛稳定超时错误、`timeoutMs:0` 不武装 deadline、非超时错误原样透传、调用方 abort 与超时区分），全部通过；网关 `typecheck` 与 `workflow-llm.ts`+新测试 ESLint 干净。`src/__tests__/team`、`src/__tests__/handoff` 一括复跑 253/255 通过——余 2 例（`team-runtime-routes` 的 alert acknowledge、`team-workspace-roster-routes` 的 create）为该两文件单独跑时各自 18/18、全绿，属一括运行时 SQLite 共享态相互污染的既有现象，与本改动（仅 `workflow-llm.ts`）无关。

### 0.31 多模态 look_at 工具上游调用墙钟超时（2026-05-30 续）

- 问题：`tools/look-at-tools.ts` 的 `runLookAtTool` 经 `tool-sandbox.ts` 的 gateway-managed 分支**直接调用**（`if (request.toolName === lookAtToolDefinition.name) { ... return runLookAtTool(...) }`），绕过了 agent-core `ToolRegistry.execute` 的 `timeout`+`AbortSignal.any` 包装。因此 `lookAtToolDefinition.timeout: 120000` 这个声明对该路径**完全不生效**；而内部的 `requestLookAtText → runUpstreamGenerate`（AI SDK `generateText`）又不传 signal、无墙钟超时。上游 socket 连上但不回包时，多模态分析会永久 pending，连带发起该工具调用的 agent 轮次一起卡死。
- 加固：在 `requestLookAtText` 内置 120s 墙钟超时（`AbortController` + `unref()` 定时器），把 abort 透传到 `runUpstreamGenerate` 的 `abortSignal`，超时抛稳定的 `look_at LLM timeout (120000ms)`；非超时上游错误原样上抛，既有 sandbox 错误回执语义不变。
- 与 §0.30 的关系：§0.30 收口的是经 `requestWorkflowLlmCompletion` 的非流式 team/workflow LLM 调用；look_at 走独立的 `runUpstreamGenerate` 直连，不经过那个入口，故需单独收口。至此 gateway 侧所有非流式 `runUpstreamGenerate` 调用方（compaction 两处、session-title、skill-recommend、look_at，以及 workflow-llm 入口）均已具备墙钟超时或显式 abort。
- 回归证据：新增 `__tests__/tools/look-at-timeout.test.ts`（2 用例：透传真实 AbortSignal、上游挂起到点 abort 并抛稳定超时错误），与既有 `look-at-upstream-protocol.test.ts`（2 用例）共 4 用例全过；网关 `typecheck` 与 `look-at-tools.ts`+新测试 ESLint 干净。

### 0.32 compaction / 会话记忆抽取上游调用墙钟超时（2026-05-30 续）

- 问题：`compaction/compaction-llm.ts` 的 `callCompactionLlm` 与 `compaction/session-memory-extractor.ts` 的 `extractSessionMemory` 都直接调 `runUpstreamGenerate`，且仅在调用方传 `signal` 时才转发。实际链路里 `session-compaction.ts` 传的是请求级 abort（仅客户端断开触发，上游 socket 连上不回包**不**触发），`stream-runtime.ts` 的 `extractSessionMemory` 是 fire-and-forget 且**完全不传 signal**。两者都无墙钟死线，上游挂起会让摘要/记忆抽取永久 pending：compaction 在上下文压力下（常在轮次中途）自动触发，挂起会拖死整个会话；记忆抽取虽 fire-and-forget，但会泄漏一个挂起请求与其会话缓冲直到进程退出。
- 加固：两处各内置 120s 墙钟超时（`AbortController` + `unref()` 定时器），用 `AbortSignal.any` 与调用方既有 signal 合并（任一触发即 abort），超时分别抛稳定的 `compaction LLM timeout (120000ms)` / `session memory LLM timeout (120000ms)`；非超时上游错误原样上抛，既有 PTL 重试与 best-effort 容错语义不变。
- 至此 §0.30–§0.32 收口了 gateway 侧全部非流式 `runUpstreamGenerate` 调用方的墙钟超时：workflow-llm 入口（reception/pm1/pm2/d.4 评审，60s）、look_at（120s）、compaction（120s）、session-memory 抽取（120s）；session-title、skill-recommend 早已自带超时。流式主链路（`stream-runner.ts`）走 `abortSignal` + 心跳，不在本组范围。
- 回归证据：新增 `__tests__/compaction/compaction-llm-timeout.test.ts`（2 用例：透传真实 AbortSignal、上游挂起到点 abort 并抛稳定超时错误），compaction 套件由 19 增至 21 用例全过；网关 `typecheck` 与两处实现+新测试 ESLint 干净。

### 0.33 流式上游 idle/stall 看门狗（2026-05-30 续）

- 问题：流式主链路 `v2-runtime/upstream/stream-runner.ts` 的 `runUpstreamStream` 用 `for await (result.fullStream)` 消费 AI SDK `streamText`，只传 `abortSignal`。AI SDK 对流没有任何 idle 死线；`abortSignal` 仅在客户端断开时触发。当上游连上、吐出首块后停住（不再吐 token 也不关闭连接）时，这个 `for await` 会永久阻塞——`stream-model-round.ts` 的消费循环、其外层 agent 轮次乃至该会话都被无限拖住。`touchSessionHeartbeat` 仅 team 会话且只在循环前调一次，不构成 stall 检测。
- 加固：给 `runUpstreamStream` 增加 inter-chunk（idle）看门狗。新增内部 `idleController` 与 `input.signal` 经 `AbortSignal.any` 合并后传给 `streamText`；流被 `withStreamIdleWatchdog` 包裹——每块重置定时器，若 `idleTimeoutMs`（默认 120s，可经 `idleTimeoutMs` 配置，传 0 关闭）内无新块，则 abort 上游释放挂起 socket、优雅结束迭代，循环后发一个稳定的 `STREAM_STALL`（status 504）错误块。看门狗抽成模块级导出的纯生成器 `withStreamIdleWatchdog`，便于隔离单测。
- 与 §0.30–§0.32 的关系：那三项收口的是非流式 `runUpstreamGenerate` 的整体墙钟超时；本项针对流式 `streamText` 的逐块 idle 死线，二者正交。至此 gateway 侧流式与非流式上游调用都具备「连上但挂起」的兜底。
- 回归证据：新增 `__tests__/v2-runtime/stream-idle-watchdog.test.ts`（3 用例：正常透传全部块、idle 超时触发 onStall+关闭源+结束迭代、超时 0 关闭看门狗），全过；`stream-error-contracts`（4 用例）回归通过；网关 `typecheck` 与改动文件 ESLint 干净。

### 0.34 cron 定时任务 handler 墙钟超时与并发槽位回收（2026-05-30 续）

- 问题：`cron/scheduler.ts` 的 `CronScheduler` 用全局 `runningCount` 对 `maxConcurrent`（默认 3）做并发节流，`fireJob` 在 `runningCount >= maxConcurrent` 时直接早返回。`fireJob` 内部 `await this.handler(updated)` **没有任何墙钟上限**。当前 `defaultHandler` 只是同步写库，风险有限；但 handler 类型为 `(job) => Promise<void>`，后续接入「真正跑 agent / 调上游」的 handler 后，一旦某次执行因上游连上但不返回而挂起，它会**永久占用一个并发槽位**；累积到 `maxConcurrent` 次挂起后，`runningCount` 永远 >= 上限，之后所有 cron 触发都被静默丢弃（既不报错也不补偿），整个定时子系统停摆。
- 加固：新增 `DEFAULT_CRON_JOB_TIMEOUT_MS = 600_000`（10 分钟，可经构造函数第三参 `jobTimeoutMs` 配置，传非正数禁用）与 `CronJobTimeoutError`。`fireJob` 改为 `await this.runHandlerWithTimeout(updated)`：该方法把 handler promise 与一个 `setTimeout` 死线竞速，到点 reject `CronJobTimeoutError`；无论 handler 成功、失败还是超时，`fireJob` 的 `finally` 都会 `runningCount--`，**保证槽位总能回收**。定时器 `unref()` 不阻止进程退出；并对底层 handler promise 始终挂了 rejection handler，避免其超时后才 settle 时冒出 unhandled rejection。超时的执行记录被标记为 `failed` 并写入 `timed out after Nms` 错误信息，便于审计。
- 与既有韧性的关系：§0.30–§0.33 收口的是「单次上游调用」自身的墙钟/idle 死线；本项收口的是 cron 调度层「执行槽位」这一资源维度——即便未来 handler 内部漏了超时，调度器也不会被一两个挂起拖垮。与 `scheduler-reschedule.test.ts` 已验证的「reject 不停摆」正交：那条保证 cron 不因异常停止重排，本条保证并发槽位不被挂起耗尽。
- 回归证据：新增 `__tests__/cron/scheduler-timeout.test.ts`（2 用例：handler 永久挂起→跨 5s 死线后该执行记 `failed` 且 `maxConcurrent=1` 下后续任务仍能正常 fire+complete，证明槽位已回收；`jobTimeoutMs=0` 禁用死线→挂起执行越过默认 10 分钟仍保持 `running`），全过；原 `scheduler-reschedule.test.ts`（2 用例）回归通过；网关 `typecheck` 与改动文件（impl + test）ESLint 干净。

### 0.35 runtime incident 审计去重签名稳定化（防 latency 写风暴）（2026-05-30 续）

- 问题：`team/team-runtime-diagnostics-store.ts` 的 `recordTeamRuntimeIncident` 每条 incident 都经 `safeWriteTeamRuntimeIncidentAudit → logTeamAudit → sqliteRun(INSERT team_audit_logs)` 落库。它本有 60s 去重（`INCIDENT_AUDIT_DEDUPE_MS`），但 `buildIncidentAuditSignature` 把 `context` 与 `message` 一并纳入签名。`latency-monitor.ts` 的 `latency_violation` 事件里 `context.durationMs` 与 `message` 每次采样都不同——签名因此每次都变，60s 去重**永不命中**。结果：上游/链路持续变慢时，每个超阈值采样都写一条 SQLite 审计，恰在系统已经承压时对 `team_audit_logs` 形成写风暴。内存事件桶有 `MAX_INCIDENTS=100` 上限、telemetry 仅按长度计数，唯独审计表是无界落库的放大点。
- 加固：把去重签名收敛为稳定维度 `userId + category + code + entityId`，刻意剔除每次都变的 `context` / `message`。新增 `resolveIncidentAuditEntityId`（复用审计行原有的 entityId 派生：优先 `handoffId`，其次 `sessionId`，再退化为 `code`），并让签名与落库 entityId 共用它。于是 `latency:<type>` 这类高频事件在 60s 窗口内只落一条；而 handoff 失败因 `handoffId` 不同仍生成不同签名，按实体分别留痕的粒度**保持不变**。审计 `detail` 仍记录完整 `context`/`message`（含当次 `durationMs`），可观测性不损失——被压缩的只是落库频次。
- 与既有韧性的关系：§0.30–§0.34 收口的是「调用 / 槽位」维度的挂起兜底；本项收口的是「诊断回写」维度的资源放大——在故障态下保护持久层不被诊断写入二次打爆。
- 回归证据：新增 2 个用例（`team-runtime-routes.test.ts`）：25 次 durationMs 各异的 latency 违规在窗口内只落 1 条审计、且内存桶仍逐条保留 25 条用于聚合观测；两个不同 `handoffId` 的 handoff 失败仍各落 1 条共 2 条，证明去重不会误合并不同实体。原有「去重窗口内避免重复落库」用例（相同 durationMs）回归通过；该测试文件 20 用例全过，网关 `typecheck` 与改动文件（impl + test）ESLint 干净。

### 0.36 team_audit_logs 保留裁剪（防审计表无界增长）（2026-05-30 续）

- 问题：`team/team-audit-store.ts` 的 `logTeamAudit` 只 INSERT，全代码库对 `team_audit_logs` 无任何 DELETE / prune / TTL。该表是只增的治理审计汇聚点——handoff 控制（pause/resume/cancel）、会话共享、共享评论、权限/澄清回复、route 决策、runtime incident（含 §0.35 收敛后的 latency/handoff 事件）每条都落一行。长时间运行的网关会让它无界膨胀：拖慢 `/team/runtime` 的 `listTeamAuditLogs` 查询（即便有 `LIMIT`，`ORDER BY` 仍要扫越来越大的索引），并持续吃磁盘。`MAX_INCIDENTS`/window 等内存结构都有界，唯独这张持久表是无界沉淀点。
- 加固：给 `logTeamAudit` 增加「每用户保留最近 N 条」的有界裁剪（默认 `DEFAULT_TEAM_AUDIT_MAX_ROWS_PER_USER = 2000`，可经 `OPENAWORK_TEAM_AUDIT_MAX_ROWS_PER_USER` 配置，传非正数关闭，与其它 env 死线开关语义一致）。裁剪用 `id NOT IN (… ORDER BY id DESC LIMIT N)` 按自增主键保留最新 N 条（避免 `created_at` 秒级精度同秒并列的问题）。关键是**摊销执行**：不是每次 INSERT 都 DELETE（否则写放大翻倍），而是按用户累计每 `TEAM_AUDIT_PRUNE_CHECK_INTERVAL = 50` 次插入才触发一次，实际行数最多比上限多出一个检查间隔的过冲。裁剪包在 try/catch 里，失败只 `console.warn`、**绝不影响审计写入本身**。
- 与 §0.35 的关系：§0.35 收敛的是 latency 违规对审计表的高频**写入**（让去重真正生效）；本项收口的是审计表自身的**总量**上界。二者互补——前者降低写入速率，后者保证即便长期低速写入也不会无界沉淀。
- 回归证据：新增 `__tests__/team/team-audit-retention.test.ts`（4 用例：超量插入后行数被裁剪到 `上限 + 检查间隔` 以内且远小于插入次数、最新记录仍保留；连续多轮触发稳定收敛；裁剪按 user 隔离不误删其它用户行；上限设 0 时关闭裁剪、行数随插入线性增长）。`team-runtime-routes`（20 用例，含 §0.35 的审计断言）与 `team-events-bus`（6 用例）回归通过；网关 `typecheck` 与改动文件（impl + test）ESLint 干净。

### 0.37 渠道流式部分更新失败回退已完成运行（防 happy-path 误判）（2026-05-30 续）

- 问题：`channels/router.ts` 的 `onAgentRun` 在流式回复时把累积文本经 `onPartialText` 持续推给渠道（如 Telegram editMessageText），用一个串行 `partialUpdateQueue` 保序。但早期实现把错误隔离写成 `partialUpdateQueue.catch(() => undefined).then(() => onPartialText(text))`——`.catch` 在 `.then` **之前**，只能吞掉「上一链节」的失败，链尾那次 `onPartialText` 自身 reject 时无人接住。运行结束时的 `await partialUpdateQueue` 因此会抛出，冲出 `onAgentRun` → auto-reply 的 catch 分支把它当成 agent 运行失败，给用户回 `Error: …`。可实际上最终完整回复**已经落库**（`listSessionMessagesV2` 取得到）。部分更新是装饰性中间态、渠道限流/抖动导致其失败极常见——结果是大量「其实成功」的对话被误判成失败回退。
- 加固：把这段队列逻辑抽成可独立单测的纯模块 `channels/partial-text-queue.ts`（`createPartialTextQueue` → `push` / `flush`）。错误隔离改为包在每个链节「自身」的 `onPartialText` 外（`try/catch` 在 `.then` 内部），保证返回的队列 promise 恒为 fulfilled、`flush()` 永不 reject；单次失败经 `onError` 回调上报告警，并**不阻断**后续部分更新。`router.ts` 改用该队列：`writeChunk` 里 `partialUpdates.push(...)`、运行结束 `await partialUpdates.flush()`。如此部分更新失败只丢一帧装饰性中间态，绝不回退一次已完成的运行。
- 与既有韧性的关系：auto-reply 的顶层 try/catch 与 `safeSend`（§渠道层既有）兜的是「主响应失败 + 错误通知失败」；本项收口的是相反的误伤方向——「主响应其实成功，却被装饰性部分更新的失败拖累成失败」。
- 回归证据：新增 `__tests__/channels/partial-text-queue.test.ts`（5 用例：串行保序、忽略空白、最后一次失败 flush 仍 resolve、中间失败不阻断后续、无 onPartialText 时 push 为 no-op）。原 `auto-reply.test.ts`（3 用例）回归通过；网关 `typecheck` 与改动文件（impl + test）ESLint 干净。

### 0.38 /mcp/events SSE 半开连接的订阅 + heartbeat 泄漏（2026-05-30 续）

- 问题：`routes/mcp-events.ts` 的 `GET /mcp/events` 在 connect 时注册两个**模块级**订阅（`subscribeToolCatalogChanges` + `subscribeOAuthRedirects`，都挂进 `mcp-tool-catalog.ts` 的全局 `Set`）并起一个 heartbeat 定时器，断开时需全部拆除。早期实现的 `safeWrite` / heartbeat 在 `reply.raw.write` 抛错时**只把 `clientClosed` 置位**，真正的拆订阅 / `clearInterval` 仅挂在 `request.raw` 的 `'close'` 事件上。但半开 / broken-pipe 的 socket 完全可能写抛错却**永不**触发 `'close'`——于是两个订阅永久滞留在模块级 `Set`、heartbeat 成僵尸定时器，活到进程退出；且此后**每一次** catalog/oauth publish 都会扇出到这些死订阅，泄漏随重连次数线性累积。这与同仓库 `stream-routes-plugin.ts` 已确立的「写失败即 `cleanup()` 主动拆订阅」模式不一致——唯独这条 SSE 漏了。
- 加固：把 SSE 连接生命周期抽成可独立单测的纯模块 `routes/sse-client-channel.ts`（`createSseClientChannel` → `write` / `addTeardown` / `close`）。核心不变量：`close()` 幂等（TCP close、写失败、显式调用三条触发路径只执行一次全部 teardown，倒序、单个 teardown 抛错不阻断其余）；`write()` 在底层 raw 写抛错时**主动调用 `close()`**，而非仅置位等待一个可能永不到来的 `'close'`。`mcp-events.ts` 改用它：catalog/oauth 的 `unsubscribe`、`clearInterval(heartbeat)`、`request.raw.off('close', …)`、Promise 的 `resolve` 全部注册为 teardown。如此半开 socket 第一次写失败就会立即拆净两个订阅与 heartbeat。
- 与既有韧性的关系：§0.37 收口渠道**出站**的部分更新失败误判；本项收口网关**SSE 推送**侧的资源泄漏。事件总线发布侧（`publishChange` / `publishOAuthRedirect`）此前已 try/catch 隔离每个 listener，但「死订阅永不移除」是订阅侧缺口，二者互补。
- 回归证据：新增 `__tests__/routes/sse-client-channel.test.ts`（8 用例：write 透传、close 幂等只 teardown 一次、倒序 teardown、写抛错主动 close 并拆订阅、close 后 write 为 no-op、单个 teardown 抛错不阻断、close 后 addTeardown 立即执行防泄漏、rawEnd 抛错被吞）。网关 `typecheck` 与改动文件（impl + 重构后的 mcp-events + test）ESLint 干净。

### 0.39 终端 SSE 流半开连接的订阅 + heartbeat 泄漏（收口 SSE 全量清扫）（2026-05-30 续）

- 问题：`routes/session-terminals.ts` 的 `GET /sessions/:sessionId/terminals/:terminalId/stream` 与 §0.38 修掉的 `/mcp/events` 是**同一处泄漏模式**。该 handler 在 connect 时经 `subscribeSessionRunEvents(sessionId, …)` 注册一个**模块级**运行事件订阅并起 25s heartbeat 定时器，但早期实现的 `safeWrite` / heartbeat 在 `reply.raw.write` 抛错时**只把 `clientClosed` 置位**，真正的 `unsubscribe()` / `clearInterval` 仅挂在 `request.raw` 的 `'close'` 事件上。半开 / broken-pipe 的 socket 可能写抛错却**永不**触发 `'close'`——于是订阅永久滞留、heartbeat 成僵尸定时器，活到进程退出；此后该会话每产生一帧 `terminal_output` / `terminal_exited` 都会扇出到这条死订阅，泄漏随重连次数线性累积。xterm 终端抽屉在弱网下频繁重连，命中概率比 `/mcp/events` 更高。
- 加固：直接复用 §0.38 抽出的 `routes/sse-client-channel.ts`（`createSseClientChannel` → `write` / `addTeardown` / `close`），与 `/mcp/events` 完全对齐。`session-terminals.ts` 改用它：`subscribeSessionRunEvents` 的 `unsubscribe`、`clearInterval(heartbeat)`、`request.raw.off('close', onClose)`、Promise 的 `resolve` 全部注册为 teardown；`safeWrite` 改走 `channel.write(...)`，底层写抛错即触发幂等 `close()`，一次拆净订阅与 heartbeat，不再依赖一个可能永不到来的 `'close'`。初始 snapshot 写入移到 channel 创建之后。
- 与既有韧性的关系：本项与 §0.38 共同完成了网关 SSE 端点的**全量清扫**。`rg "text/event-stream" services/agent-gateway/src/routes` 命中 3 个文件：`stream-routes-plugin.ts`（早已正确——写失败即 `cleanup()`，是参考实现）、`mcp-events.ts`（§0.38 修复）、`session-terminals.ts`（本项修复）。三条 SSE 推送通道现已统一为「写失败即主动拆除」语义，无残留缺口。
- 回归证据：复用既有 `__tests__/routes/sse-client-channel.test.ts`（8 用例覆盖 channel 不变量）；`session-terminals-routes.test.ts`（10 用例）回归全绿。网关 `typecheck` 通过；改动 handler 区 ESLint 干净（文件内另有 `terminalErrorPayload` 重载的 `no-redeclare` 告警属既有未提交改动，与本项 SSE 修复无关）。

### 0.40 request_workflow_logs 全局保留裁剪（防最高频只增表无界增长）（2026-05-30 续）

- 问题：`runtime/request-workflow-log-store.ts` 的 `persistRequestWorkflowLog` 在每个请求结束时落一行——`request-workflow.ts` 的 `onResponse` / `onError` / `onTimeout` / `onRequestAbort` 四个钩子之一都会触发 `flushRequestWorkflow` → 持久化。这是全网关**写入频率最高**的只增表（每个 HTTP/WS 请求一行，含健康检查、登录前流量等未认证请求），却只有 `INSERT` / `SELECT`、从无裁剪。长时间运行的网关会让它无界膨胀，吃满磁盘并拖慢 `/settings` 诊断页的 `listRequestWorkflowLogs` 查询。这与 §0.36 修掉的 `team_audit_logs` 是同构缺口，但量级更大。
- 加固：按 §0.36 的「摊销 + 有界保留」模式裁剪，但改为**全局总行数上限**而非按用户——因为 `request_workflow_logs.user_id` 可为 NULL（未认证流量正是其无界增长的主要来源，按用户裁剪覆盖不到）。新增 `DEFAULT_REQUEST_WORKFLOW_LOG_MAX_ROWS=5000`、env `OPENAWORK_REQUEST_WORKFLOW_LOG_MAX_ROWS`（非正数禁用），每累计 `REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL=100` 次插入才跑一次 `DELETE ... WHERE id NOT IN (... ORDER BY id DESC LIMIT N)`，避免每次写入都 DELETE 造成写放大。裁剪失败遇库损坏与写入侧一致地禁用整个 store，其余错误只告警、绝不阻断请求日志写入或主请求流程。同时给 `listRequestWorkflowLogs` 的 `ORDER BY created_at DESC` 补 `id DESC` 次级排序：`created_at` 是 `datetime('now')` 秒级精度，同秒多行顺序不稳定，补自增 id 让「最近 N 条」查询确定化（与裁剪用 id 排序的理由一致）。
- 与既有韧性的关系：§0.35 稳定化 runtime incident 审计去重签名（防 latency 写风暴）、§0.36 裁剪 `team_audit_logs`（按用户）、本项裁剪 `request_workflow_logs`（全局）——三者共同收口持久化层「只增表无界增长」这一类磁盘/查询退化风险。`event_log`（`db.ts` 迁移期去重）与 `audit_logs`（`settings.ts` 提供手动清理）此前已各有处置，至此高频只增表均已有界。
- 回归证据：新增 `__tests__/runtime/request-workflow-log-retention.test.ts`（4 用例：全局行数裁剪到上限附近且不随插入线性增长 + 保留最新行、连续多轮触发稳定收敛、非正数关闭裁剪时线性增长、裁剪不影响 `listRequestWorkflowLogs` 对最新行的查询）。网关 `typecheck` 通过；改动文件（store + test）ESLint 干净。

### 0.41 /lsp/events WS 缺少 ping 保活 + idle 看门狗（半开连接订阅泄漏）（2026-05-30 续）

- 问题：`lsp/router.ts` 的 `GET /lsp/events` 是网关三个 WS 端点中唯一持有**模块级**订阅（`lspManager.onDiagnosticsUpdate` → `LSPManager.diagnosticHandlers` 数组）却缺少保活与 idle 看门狗的端点。拆订阅只挂在 TCP `'close'` / `'error'` 或「恰好有诊断推送且 `socket.send` 抛错触发 `finalize`」上。但半开 / broken-pipe 的 socket 完全可能既不触发 `'close'`，安静工作区里又长时间没有诊断推送来触发 send 失败——于是诊断订阅永久滞留在模块级数组、活到进程退出，此后每次 `dispatchDiagnostics` 都会扇出到死订阅。这与 §0.38/§0.39 修掉的 SSE 半开泄漏同类，只是发生在 WS 侧；也与同仓库 `team-events.ts` 已确立的「WS 必须 ping 保活 + idle 超时主动拆除」模式不一致——唯独这条 WS 漏了。对照另两个 WS：`team-events.ts` 已是黄金标准（ping + idle watchdog + cleanup），`stream-routes-plugin.ts` 的 `/sessions/:id/stream` 不持模块级订阅、半开期间靠后台续跑 + attach 重连，无泄漏。
- 加固：按 `team-events.ts` 的模式给 `/lsp/events` 加 `setInterval` 心跳（默认 `DEFAULT_LSP_EVENTS_HEARTBEAT_INTERVAL_MS=10_000`）：每拍检查 `Date.now() - lastActivityAt` 是否超过 idle 超时（默认 `DEFAULT_LSP_EVENTS_IDLE_TIMEOUT_MS=45_000`），超时则 `finalize(408)` 拆订阅并 `safeCloseLspSocket(1001)` 主动关连接；否则 `socket.ping()`，ping 抛错即 `finalize(500)` + `safeCloseLspSocket(1011)`。`socket.on('message' | 'pong')` 都刷新 `lastActivityAt`，诊断 push 成功也刷新。`finalize` 改为同时 `clearInterval(heartbeat)`，确保任何拆除路径都不漏定时器。两个阈值经 `OPENAWORK_LSP_EVENTS_HEARTBEAT_INTERVAL_MS` / `OPENAWORK_LSP_EVENTS_IDLE_TIMEOUT_MS` 可覆盖（非正数 / NaN 回落默认），既给运维旋钮也让单测能用极短超时确定性驱动看门狗。
- 与既有韧性的关系：§0.38（/mcp/events SSE）、§0.39（终端 SSE）收口 SSE 侧半开泄漏；本项把同一不变量补到 WS 侧最后一个缺口。至此三个 WS 端点（`team-events`、`/sessions/:id/stream`、`/lsp/events`）对半开连接均有界：要么有 idle 看门狗主动拆除，要么不持模块级订阅。
- 回归证据：新增 `__tests__/lsp/lsp-events-watchdog.test.ts`（3 用例：鉴权通过后注册订阅并转发诊断推送、客户端断开后释放模块级订阅、idle 看门狗超时后主动拆订阅并关闭半开连接——后者用极短 env 超时驱动）。原 `packages/lsp-client` 的 `diagnostics-dispatch.test.ts`（2 用例）回归通过。网关 `typecheck` 通过；改动文件（router + test）ESLint 干净。

### 0.42 notifications 用户级保留裁剪（防用户通知只增表无界增长）（2026-05-30 续）

- 问题：`session/notification-store.ts` 的 `notifications` 是用户级只增表——`session-run-events.ts::publishSessionRunEvent` 每收到一条 `permission_asked` / `question_asked` / `task_update(done|failed)` 运行事件就 `createNotification` 落一行（主键为 `notification:<sessionId>:<type>:<scope>:<seq>` 确定性串），已读项 `markNotificationRead` / `markAllNotificationsRead` 只改 `status`、从不删除。唯一的清理路径是 session / user 被删时的 `ON DELETE CASCADE`。于是一个长期活跃、很少删会话的用户，其通知行会随每轮 agent 运行单调累积，无任何上限，最终拖慢 `GET /notifications`（`idx_notifications_user_created` 走 `user_id, created_at DESC`）并吃满磁盘。这与已加裁剪的 `team_audit_logs`（§0.36）、`request_workflow_logs`（§0.40）是同一类「只增表无界增长」缺口，唯独用户可见通知表漏了。
- 加固：按 `team-audit-store.ts` 的成熟模式给 `createNotification` 加「每用户保留最近 N 条」有界裁剪。`DEFAULT_NOTIFICATION_MAX_ROWS_PER_USER=1000`，env `OPENAWORK_NOTIFICATION_MAX_ROWS_PER_USER` 可覆盖（非正数 / NaN 视为关闭裁剪，与其它 env 死线开关语义一致）。裁剪摊销执行：每用户累计 `NOTIFICATION_PRUNE_CHECK_INTERVAL=50` 次插入才跑一次 `DELETE ... WHERE rowid NOT IN (SELECT rowid ... ORDER BY rowid DESC LIMIT N)`，因此实际行数最多比上限多出一个检查间隔的过冲，绝不随插入线性增长。排序键用隐式 `rowid` 而非 `created_at`：后者是 `datetime('now')` 秒级精度、同秒并列，且主键 `id` 是非单调的确定性字符串，唯有 `rowid` 随插入单调递增能稳定区分「最近 N 条」。裁剪按 `user_id` 隔离、失败只 `console.warn` 绝不影响通知写入本身。新增测试钩子 `__setNotificationRetentionForTesting` / `__resetNotificationPruneStateForTesting`。
- 与既有韧性的关系：§0.36（team_audit_logs 每用户裁剪）、§0.40（request_workflow_logs 全局裁剪）收口治理 / 请求工作流只增表；本项把同一不变量补到最后一张高频用户级只增表 `notifications` 上。至此网关三张面向用户/治理的高频只增表均有界。`permission_decision_logs` / `memory_extraction_logs` 经核对随 session `ON DELETE CASCADE` 天然有界且写入为低频用户动作，非无界增长目标，保持不动。
- 回归证据：新增 `__tests__/session/notification-retention.test.ts`（4 用例：每用户裁剪到上限附近且保留最新行、连续多轮稳定收敛、按 user 隔离不误伤他人、非正数关闭裁剪则线性增长）。原 `session-run-events`（3）、`session-delete-recovery`（5）、`memories-routes`（4）回归通过。网关 `typecheck` 通过；改动文件（notification-store + test）ESLint 干净。

### 0.43 Telegram 长轮询循环订阅者异常隔离 + finally 重排兜底（2026-05-30 续）

- 问题：`channels/telegram.ts` 的 `poll()` 把「重排下一拍」的 `this.poll()` 放在 fire-and-forget 异步 IIFE 的 try/catch/finally **之后**，而非 `finally` 内。两个真实风险：（1）消息派发 `this.notify({type:'message',...})` 走的是外部订阅者（`router.ts::notifyChannel → autoReply.handle`），若它同步抛错，会被外层 catch 捕获 → 该批剩余消息被跳过、`pollFailureCount += 1` **误触发失败退避**（网络其实正常），并派发一条假的 error 事件；（2）更严重的是 catch 内的 `this.notify({type:'error',...})` 若也抛错，异常会逃出 IIFE 成为 unhandled rejection（项目明令禁止），且 `this.poll()` 永远不会执行——长轮询循环**彻底停摆**，直到手动重启渠道。§0.3 给这条循环加了超时 / 退避 / `res.ok` 校验，但订阅者抛错这条逃逸路径仍在。
- 加固：新增 `safeNotify()` 包装 `this.notify`，对每次派发做 try/catch 隔离（抛错只 `console.warn`，不冒泡、不中断批次、不污染 `pollFailureCount`）；消息路径与错误路径全部改走 `safeNotify`。并把 `this.poll()` 重排移入 `finally`——这样无论任何路径上发生意外抛出，循环都能保证重排；`poll()` 开头的 `if (!this.running) return` 守卫让 `stop()` 后（catch 内 `return` 仍会流经 finally）不会再发起新轮询，语义不变。
- 与既有韧性的关系：§0.3（渠道网络超时 + 退避）、§0.4（auto-reply fire-and-forget 异常隔离）收口的是「发送 / 自动回复」侧；本项收口的是 Telegram「接收长轮询循环」自身的存活不变量——订阅者抛错既不能误判为网络故障，也不能杀死轮询。其余渠道（Discord/Feishu/...）走 webhook / 一次性拉取，无此长驻自驱循环，不在同一形态。
- 回归证据：新增 `__tests__/channels/telegram-poll-resilience.test.ts`（3 用例：消息回调抛错不中断后续轮询且不误触发退避 / 不派发假 error、错误回调抛错后 finally 仍重排下一拍、`stop()` 后不再发起新轮询——全部用 fake timers 确定性驱动）。原 `channel-http`（7）、`auto-reply`（3）回归通过。网关 `typecheck` 通过；改动文件（telegram + test）ESLint 干净。

### 0.44 MCP 上游分页响应有界化（防 cursor_loop / max_pages / max_items 无限循环）（2026-05-30 续）

- 问题：`packages/mcp-client/src/adapter.ts` 的 `listTools` / `listResources` / `listPrompts` 都是经典的 `do { ... } while (cursor)` 游标分页，且**完全信任上游 MCP server 返回的 `nextCursor`**——SDK 与协议层都不强制终止。三种现实故障会把这条循环吃成无界 CPU+内存：（1）有 bug 的 server 始终回放同一非空 cursor，构成 cursor 死循环；（2）server 走入「runaway 游标空间」每页都返回新 cursor 但永不结束；（3）server 单页就返回数十万条目（恶意或同步 bug）。任何一种都会把 `mcp-tool-catalog.ts::ensureToolListSubscription` 的 `await adapter.listTools(serverId)` 卡死，且因为该调用挂在 `withOperationRetry` / 通知线程上，会**反向拖垮整个 MCP 连接池**——`tryGetAdapter` 取出的 adapter 持有同一 SDK client，`listTools` 不返回则其它依赖该 client 的调用全部排队阻塞，最终事件循环堆积导致 `out of memory`。§0.10 给 connect 握手加了 30s 超时，但分页阶段的存活不变量空缺。
- 加固：在 `adapter.ts` 抽出共享 `collectPaginated()` 辅助（同时导出常量 `MCP_PAGINATION_MAX_PAGES=1000` / `MCP_PAGINATION_MAX_ITEMS=50_000`、错误类 `MCPPaginationError`），三种 list 方法统一改走它。三道独立终止守卫：（a）页数 ≥ `MCP_PAGINATION_MAX_PAGES` 抛 `max_pages`；（b）累计条目 ≥ `MCP_PAGINATION_MAX_ITEMS` 抛 `max_items`；（c）`cursor` 命中 `Set<string|undefined>` 已见过的值（包括首页前的 `undefined`）抛 `cursor_loop`，正是「server 回放同一 cursor」最常见的形态。`MCPPaginationError` 携带 `serverId / operation / reason`，下游 `mcp-tool-catalog.ts` 已在 try/catch 中把异常转成 `console.warn` 并 `clearCatalogSnapshot`，与现有「连接异常即清缓存等待下次重建」的 fallback 路径自然合流；`mcp-runtime.ts` 的两处 listTools 已经在 `withOperationRetry` 包装内，分页错误会落到统一错误归类。常量上限对真实 MCP server 极宽松（典型工具列表数十条 / 单页），命中即代表上游确实异常，宁可显式中断也不能默默放任循环跑飞。`listTools` 仍保留「先收集原始页再过滤 disabled」的语义，确保「server 灌大量本地 disabled 工具」也能被分页守卫识别（不会因为最终 `all[]` 为空就放任游标继续走）。
- 与既有韧性的关系：§0.10（MCP transport 握手 30s 超时 + 半开拆除）收口连接握手；§0.41（/lsp/events WS 半开 idle 看门狗）收口 LSP WS 半开订阅；本项把存活不变量补到 MCP 客户端**协议层分页**这条最后一条「无终止条件外推 server 输入」的游标循环上。`adapter.callTool` 已经透传 `timeout`（默认 30s）+ `onprogress` 看门狗，与 §0.10 / 本项形成连接握手 → 协议分页 → 单次工具调用三层有界覆盖。
- 回归证据：新增 `packages/mcp-client/src/pagination.test.ts`（5 用例：合法多页分页正常终止 / 上游回放同 cursor 时按 `cursor_loop` 终止且只调用 2 次 fetchPage 不无限循环 / 页数超过上限按 `max_pages` 终止 / 单页超额按 `max_items` 终止 / 上游 fetchPage 抛错原样冒泡）。原 `connect-timeout.test.ts`（3）回归通过——`pagination` + `connect-timeout` 共 8/8 通过。`@openAwork/mcp-client typecheck` 通过；改动文件（adapter + index + pagination test）ESLint 干净。下游 `services/agent-gateway/src/mcp/mcp-tool-catalog.ts:171` / `mcp-runtime.ts:356,465` 三处 listTools 调用点全部已在 try/catch / `withOperationRetry` 内，签名未变，无需修改。

---

### 0.45 pairing manager waitForClient 默认 TTL 兜底 + disconnect 真实 reject pending waiter（2026-05-30 续）

- 问题：`packages/pairing/src/manager.ts` 的 `waitForClient(token, timeoutMs?)` 是面向 cli/web 端「绑定客户端→等待对端 confirm」的核心同步点，存在两条 pending promise 永久挂起的逃逸路径，会让调用栈帧永远不解栈，最终拖垮事件循环 + 内存：（1）`disconnect()` 只是把 `pendingClients.clear()` + 抹掉 timer，**完全没有 reject 任何 pending waiter**——所有正在 await 的调用方手上的 promise 既不 resolve 也不 reject，从此变成内存里漂浮的孤儿 promise。（2）`waitForClient(token)` 不传 `timeoutMs`（或传 `0`/负数）时压根不挂 watchdog timer——靠 token 自身的 TTL 自然过期？但 token 过期只在 `confirmClient` 路径里 `verifyToken` 拒绝，`waitForClient` 这边只要没人来 confirm 就**永远 pending**；线上若上游 cli 崩了不再发 confirm，pending 数量随每次 `waitForClient` 单调增长。
- 加固：在 `PendingClientWaiter` 加 `reject: (reason: Error) => void` 字段，`waitForClient` 内部把 resolve / reject 都包成「先 detach（清 timer + 清 Map）后再 settle」，确保任意 settle 路径都不漏一个清理动作。新增导出错误类 `PairingDisconnectedError`，`disconnect()` 改成「快照 → `pendingClients.clear()` → 逐个 `waiter.reject(new PairingDisconnectedError())`」，把孤儿 promise 真正 reject 让调用方 catch 块得以解栈。新增导出常量 `PAIRING_DEFAULT_WAIT_TIMEOUT_MS = PAIRING_TL_MS = 5min`，`waitForClient` 计算 `effectiveTimeoutMs`：caller 传正数则用 caller 的；否则回退到 session-TL 兜底——这样即便 `confirmClient` 路径未触发，5 分钟后 watchdog 也会 `PairingTimeoutError` 解栈，与 token TTL 语义对齐。`reject` 字段类型固定为 `Error`（非 `unknown`），既匹配两条真实 reject 路径都是 Error 子类，又满足 `@typescript-eslint/prefer-promise-reject-errors`。
- 与既有韧性的关系：§0.10（MCP transport 30s 握手超时 + 半开拆除）、§0.41（/lsp/events WS 半开 idle 看门狗）、§0.44（MCP cursor 分页三道终止守卫）依次收口连接握手 / WS 半开 / 分页协议三层无终止条件外推。本项把存活不变量补到 pairing 子系统**调用方等待 promise** 这条最后一条「无 watchdog 即可永远 pending」的同步点上——配合用户既有的 `PairingTimeoutError` + `fetchWithTimeout` 已在 transport 侧的覆盖，至此 pairing 三层（HTTP fetch / 等待 confirm / disconnect 强制解栈）全部有显式终止保证。
- 回归证据：原有 5 个用例（fetch 超时 / fetch unhandled rejection / waitForClient 主动超时 / pending 注册表只增不漏 / disconnect 清 timer）全部通过；新增 3 个用例（`disconnect()` 真的 `PairingDisconnectedError` reject 所有 pending waiter / `waitForClient(token)` 不传 timeout 走 `PAIRING_DEFAULT_WAIT_TIMEOUT_MS` 兜底然后 `PairingTimeoutError` reject / `waitForClient(token, 0)` 同样走默认 TTL 兜底）共 8/8 通过。`@openAwork/pairing typecheck` 通过；改动文件（manager.ts + manager.test.ts）ESLint 干净。

### 0.46 ScheduleManagerImpl runTask 重入保护（防慢 handler + 短 interval 任务栈式堆叠）（2026-05-30 续）

- 问题：`packages/agent-core/src/schedule/index.ts` 的 `ScheduleManagerImpl.runTask(taskId)` 是一个 fire-and-forget 异步入口（`setInterval(() => void this.runTask(task.id), intervalMs)` / cron tick `void this.runTask(task.id)` / once timer），自身只挂了 catch 兜底防 unhandled rejection，**完全没有任何 in-flight 重入保护**。两个真实风险：（1）interval 任务的 `handler()` 执行时间 > `intervalMs` 时，每次 tick 都会再投一份 `runTask`，前一份还在 await，后一份立刻进 try → 调用栈线性堆叠，handler 执行越慢堆叠越深，直到事件循环饱和；（2）cron tick 的 same-minute 守卫（`lastRunMinute === currentMinute`）只防同分钟二次 fire，但「上一分钟的 handler 还没跑完，这一分钟的 cron tick 又触发」会绕过守卫。`services/agent-gateway/src/cron/scheduler.ts` 已经用 `activeJobs` 槽位 + 并发计数明确建模这条不变量，`services/agent-gateway/src/handoff/runner/watcher.ts` 也用 `tickInFlight` 防同样问题——agent-core 这一份是缺位的弱兄弟，作为 SDK 暴露给上层 cli/web/mobile 的调度层风险面更广。
- 加固：新增私有字段 `private inFlightTasks = new Set<string>()`，`runTask` 入口加守卫：（a）取 task / 启用检查通过后立刻 `if (this.inFlightTasks.has(taskId)) return`——重入直接丢弃当前 tick，不排队、不阻塞 timer；（b）`this.inFlightTasks.add(taskId)` 紧跟 try 之前；（c）原 try/catch/finally 包裹 handler 调用并维护 `lastRunAt` / `nextRunAt` / once 清理逻辑保持不动；（d）`finally` 末端 `this.inFlightTasks.delete(taskId)` 释放槽位——必须在 finally 而非 try 内，否则 catch 已吞掉的异常路径会让 task 永久卡在 in-flight 状态再也不触发。设计选择上故意 drop 而非 queue：上一轮还没跑完就说明系统已经处于 hot path 状态，再排队只会放大负载，下一拍 interval 自然会再 fire。
- 与既有韧性的关系：§0.43（Telegram 长轮询订阅者异常隔离 + finally 重排）收口的是「单一长驻循环 fire-and-forget 的存活性」；§0.44（MCP 上游分页有界化）收口的是「外推外部输入的循环必须有终止守卫」；本项收口的是「内部 timer 驱动的 fire-and-forget 入口必须有重入保护」——三类 fire-and-forget 形态在 agent-core / mcp-client / agent-gateway 三层都有了对称的存活性建模。`HandoffWatcher.tickInFlight` / `cron/scheduler.ts::activeJobs` 已经各自走过这条路，agent-core 这次跟齐。
- 回归证据：新增两条单测（在原 `index.test.ts` 同文件 describe 内）：「慢 handler 不会被并发再投」（fake timer 推进 5 个 interval，handler 始终未 resolve，整个过程 handler 仅被调用 1 次，无栈式堆叠）/「handler resolve 后下一个 tick 正常恢复触发」（验证 finally 释放槽位的正确性）。原 2 个 case（interval handler 持续 reject 不抛 / once handler reject 仍清理）回归通过——共 4/4 通过。`@openawork/agent-core typecheck` 通过；改动文件（schedule/index.ts + index.test.ts）ESLint 干净。

### 0.47 TelemetryManager flush 单航管制（防 splice/send 竞态丢事件）（2026-05-30 续）

- 问题：`packages/telemetry/src/telemetry-manager.ts` 的 `TelemetryManager.flush()` 历史实现是 `const batch = this.queue.splice(0, this.queue.length); await this.send(batch);` 配合 `setInterval(() => this.flush().catch(()=>{}), flushIntervalMs)`。`flushIntervalMs` 默认 60s，`TELEMETRY_SEND_TIMEOUT_MS=10s`，看似不会重叠，但实际故障路径下会：（a）多个调用方并发触发——除了定时器，`shutdown()` 也会 `await this.flush()`，外部代码也可手动 `flush()`；（b）网络层重试 / 慢 DNS / 连接池耗尽时 fetch 自身可能持有比 10s timeout 更久的 promise（未触发 abort，或 abort 后 microtask 排队过晚）；（c）`flushIntervalMs` 配置成更短值（被 LSP-runtime / health-runtime 类组件按更高频次推送）。一旦两次 `flush()` 重叠：第一次 `splice` 已把队列清空、`send(batch)` 还在 await；第二次 `flush` 取到的 `this.queue.length === 0` 走「队列空」分支不发送，但 batch1 events **未送达且未回滚**——事件被静默丢弃。同步块 `splice` + 异步 `send` 之间存在 read-modify-publish 窗口，是典型的 fire-and-forget 单航管制缺位。
- 加固：新增私有字段 `private pendingFlush: Promise<void> | null = null`，`flush()` 入口改为：（a）若 `optedOut` 直接 `return`；（b）若 `this.pendingFlush` 非空则 `return this.pendingFlush`——并发调用方共享同一 in-flight promise，不再各自 splice；（c）只有当无 in-flight 且队列非空时才 splice + 发送，并把 `send().finally(() => { this.pendingFlush = null })` 赋给 `pendingFlush` 后返回；`shutdown()` 同步收紧：先 `await this.pendingFlush`（确保未完成的发送结束）再 `await this.flush()`（把 in-flight 期间通过 `track()` 落入队列的新事件再发一批），保证「shutdown 时点之前 track 的事件全部尝试发送一次」这一契约。设计上故意 drop-on-failure：捕获在 `send()` 内静默吞掉，「队列空 + 不再 fetch」的旧用例（`send 失败时 flush 吞错不抛`）保持兼容。
- 与既有韧性的关系：§0.46 收口的是「内部 timer 驱动的 fire-and-forget 入口必须有重入保护」，这次 §0.47 收口的是「fire-and-forget 内部存在 read-modify-publish 操作时必须单航管制以防 splice/send 竞态」——前者保护重入，后者保护并发数据完整性，两者在 SDK 暴露的运行时遥测路径上是对称完备的。
- 回归证据：原有 2 个用例（`flush` 给 fetch 传入 AbortSignal / send 失败时吞错且不重发）继续通过；新增 2 个用例：（a）「overlapping flush 共享 in-flight，不二次 splice」（同时 kick off 两个 `flush()` 调用，验证 fetch 被调用 1 次而不是 2 次、batch.events 长度等于队列总长度、第二次 flush 在 await 后保持 1 次 fetch 不变、随后 `flush()` 不会再 fetch）/（b）「shutdown 排空 in-flight 并补发 in-flight 期间 track 的事件」（验证 shutdown 期间 fetch 被调用 2 次，第二次 body 仅含 in-flight 期间 track 的新事件）共 4/4 通过。`@openawork/telemetry typecheck` 通过；改动文件（telemetry-manager.ts + telemetry-manager.test.ts）ESLint 干净。

### 0.48 models-dev fetch 单航管制（防冷启动 thundering herd + refresh 重叠）（2026-05-30 续）

- 问题：`packages/agent-core/src/provider/models-dev.ts` 的网络拉取路径存在两类并发缺位。（1）冷启动惊群：`get()` 在 `_cache` 为空且本地缓存缺失时直接 `await fetchData()`，而 `get()` 是 SDK 公开 API（`provider/manager.ts::syncFromModelsDev` -> `provider-catalog.ts` 每用户 catalog 同步都会调用），多用户/多 session 同时 boot 时每个并发调用各自打开一条到 `models.dev` 的 socket，形成对上游的惊群请求；（2）`refresh()` 重叠：`startPeriodicRefresh()` 用 `setInterval(() => void refresh(), REFRESH_INTERVAL_MS)` fire-and-forget，慢刷新（DNS/连接慢、上游限流但未超过 10s timeout）未结束时下一拍又触发，两次 `refresh` 竞争写 `_cache` 与 `writeLocalCache` 同一文件。两者本质都是「无单航管制的网络拉取 + 缓存发布」。
- 加固：新增模块级 `let _inFlightFetch: Promise<ModelsDevData> | null = null` 与 `fetchAndCache()` 包装：入口 `if (_inFlightFetch) return _inFlightFetch` 让并发调用方共享同一请求；否则启动一个 IIFE async 任务执行 `fetchData()` -> 赋值 `_cache` -> `writeLocalCache()`，并在 `finally` 中 `_inFlightFetch = null` 释放槽位（失败也释放，避免一次失败永久 wedge 后续刷新）。`refresh()` 改为 `await fetchAndCache()` 并保留 try/catch + warn 日志；`get()` 冷启动分支改为 `return await fetchAndCache()`，本地缓存命中与 `_cache` 命中的快路径不变。
- 与既有韧性的关系：§0.46（schedule runTask 重入保护）/ §0.47（telemetry flush 单航管制）/ §0.48（models-dev fetch 单航管制）构成 agent-core 内三类 fire-and-forget 形态的对称收口——定时器重入、内部 splice/send 竞态、网络拉取惊群。三者都用「共享 in-flight 状态 + finally 释放」同一模式，行为一致、易推理。
- 回归证据：新增 2 个用例：（a）「并发 `get()` 冷启动合并为单次网络 fetch」（三个并发 `get()` 在空数据目录下全部走网络路径，验证 fetchSpy 仅被调用 1 次，三个 promise 都拿到同一 payload）/（b）「失败 fetch 释放 in-flight 槽位，下一次 refresh 重试」（第一次 refresh fetch reject 后 `getSync()` 仍为 null、fetchSpy 调 1 次；第二次 refresh 成功、fetchSpy 调 2 次、`getSync()` 等于 payload、warn 被调用）共 2/2 通过。测试通过 `XDG_DATA_HOME` 指向临时目录隔离本地缓存读写，`vi.resetModules()` + 动态 import 重置模块级状态。`@openawork/agent-core typecheck` 通过；改动文件（models-dev.ts + models-dev.test.ts）ESLint 干净。

### 0.49 CronScheduler fireJob 每作业重入保护（防同一 every/cron 作业自我堆叠 + 饿死其他作业）（2026-05-30 续）

- 问题：`services/agent-gateway/src/cron/scheduler.ts` 的 `fireJob` 只有一个**全局** `runningCount >= maxConcurrent` 早退门禁，没有**按作业**的重入保护。`every` 作业用 `setInterval(() => void this.fireJob(job), schedule_every)`、`cron` 作业用 `setTimeout` 自重排，二者都是 fire-and-forget。一旦某个作业的 handler 运行时间超过它自己的触发周期（慢上游、网络黑洞但未触发墙钟超时、长 LLM 调用），同一个作业会一拍接一拍地把自己再次 `fireJob`：每个重叠拍都吃掉一个 `runningCount` 槽位，最多堆叠到 `maxConcurrent` 份**同一作业**并发执行——既对非幂等任务（发消息、跑 agent、写交付物）造成重复副作用，又把其它作业的并发槽位饿死（全局 cap 被同一作业占满，其它作业的 `fireJob` 全部静默早退）。这正是 §0.46 在 agent-core `ScheduleManagerImpl` 收口过的同类缺位，gateway 这侧的 `CronScheduler` 仍存在。
- 加固：新增实例字段 `private inFlightJobs = new Set<string>()`，`fireJob` 入口在全局 cap 检查之前先判 `if (this.inFlightJobs.has(job.id)) return`——上一拍同一作业还在飞行就丢弃这一拍（下一拍会自然再触发，刻意 drop 而非排队，避免慢 handler 把队列堆成线性增长）。进入执行即 `this.inFlightJobs.add(job.id)`，并在 `finally` 中 `this.inFlightJobs.delete(job.id)` 最后释放（handler 抛错被 catch 后也要释放，否则作业被永久 wedge 成"在飞行"再不触发）。`stopAll()` 增补 `this.inFlightJobs.clear()`，避免 stop 时仍在飞行的 handler 残留 id、在后续 restart 后误跳过首拍。与既有的 `runHandlerWithTimeout`（§0.34 墙钟超时 + 槽位回收）正交叠加：墙钟超时负责"单次 handler 挂死必然释放槽位"，每作业重入保护负责"慢 handler 不会自我堆叠"。
- 与既有韧性的关系：§0.46（agent-core `ScheduleManagerImpl` runTask 重入）/ §0.49（gateway `CronScheduler` fireJob 重入）是同一类「interval/cron 驱动 fire-and-forget 必须有按作业重入保护」缺位在两套调度器上的对称收口；§0.34（cron handler 墙钟超时 + 并发槽位回收）与 §0.49 在同一文件内互补，分别防"单次挂死"与"自我堆叠"。
- 回归证据：新增 3 个用例（`__tests__/cron/scheduler-reentrancy.test.ts`）：（a）「慢 handler 不会在自身周期内自我堆叠」（`every` 作业 handler 挂起跨多个周期，验证 handler 只被调用 1 次、`runningCount` 不被同一作业占满）/（b）「重叠拍被丢弃后，慢 run settle 则下一拍正常再触发」/（c）「stopAll 清理 in-flight 簿记，restart 后首拍不被误跳过」共 3/3 通过；既有 `scheduler-timeout.test.ts`（2）/`scheduler-reschedule.test.ts`（2）继续通过，cron 套件 7/7。`@openawork/agent-gateway typecheck` 通过；改动文件（scheduler.ts + scheduler-reentrancy.test.ts）ESLint 干净。

### 0.50 MultiAgentOrchestrator cancelDAG 解除挂起审批门（防交互审批无超时时取消请求被无视、DAG 永久挂起）（2026-05-30 续）

- 问题：`packages/multi-agent/src/orchestrator.ts` 的 `executeDAG` 在 `interactive` 模式下，对每个 subagent 节点发出 `human_approval_required` 事件后 `await this.waitForApproval(node.id, node.approvalTimeoutMs)`。当节点未配置 `approvalTimeoutMs`（或 <=0）时，`waitForApproval` 不挂 `setTimeout`，这个 promise **只能**靠外部 `resolveApproval(...)` 解除。而 `cancelDAG(dagId)` 旧实现只做 `this.cancelledDags.add(dagId)`：它依赖 `executeDAG` 主循环顶部的 `if (this.cancelledDags.has(dagId))` 来观测取消，但此时主循环正卡在本批次的 `await Promise.allSettled(execPromises)` 上——而该批次里至少有一个 promise 卡在永不 settle 的 `waitForApproval`。于是 `Promise.allSettled` 永不返回、主循环回不到顶部的取消检查，DAG 在「已被取消」状态下**永久挂起**，对应的 `pendingApprovals` 句柄与事件订阅也一并泄漏。
- 加固：`cancelDAG` 在置位 `cancelledDags` 之后，遍历该 DAG 的所有节点，对仍存在于 `pendingApprovals` 的节点调用其 resolver 并传入 `'Cancel'`（同时从 map 删除）。这样在途审批门立即以 `Cancel` 决议返回，`executeDAG` 里对应分支把节点标记 `failed` 并发 `node_failed`，本批 `Promise.allSettled` 得以 settle，主循环回到顶部观测到 `cancelledDags` 命中 → `dag.status = 'failed'` 正常收尾。复用既有 `'Cancel'` 决议路径，不新增状态机分支。
- 与既有韧性的关系：与 §0.45（pairing waitForClient 默认 TTL 兜底 + disconnect 真实 reject pending waiter）同属「外部事件驱动的 await 必须有可被取消/超时解除的出口，否则取消信号会被在途 await 吞掉」一类；这次是 DAG 编排层的交互审批门收口。
- 回归证据：新增 2 个用例（`__tests__`/同目录 `orchestrator-cancel-approval.test.ts`）：（a）「cancelDAG 解除挂起的审批门，executeDAG 不会永久挂起且终态 failed」（订阅到 `human_approval_required` 后再 `cancelDAG`，断言 `executeDAG` 能返回、终态 `failed`——回归前会命中 vitest 默认超时）/（b）「resolveApproval(Proceed) 仍按正常路径执行」（确认取消逻辑没有破坏正常审批放行，终态 `completed`）共 2/2 通过；既有 `orchestrator-failure-propagation.test.ts`（2）继续通过，multi-agent 套件 4/4。`@openawork/multi-agent typecheck` 通过；改动文件（orchestrator.ts + orchestrator-cancel-approval.test.ts）ESLint 干净。

### 0.51 LSP 客户端请求墙钟超时（防语言服务器连上但不应答导致工具调用永久挂起）（2026-05-30 续）

- 问题：`packages/lsp-client/src/client.ts` 里 `initialize`（45s）与 `waitForDiagnostics`（3s）都有墙钟超时，但 12 个具体请求方法（`hover` / `definition` / `implementation` / `references` / `documentSymbols` / `workspaceSymbols` / `prepareRename` / `rename` / `prepareCallHierarchy` / `incomingCalls` / `outgoingCalls`）只用 `.catch(() => null | [])` 兜 reject，**没有任何超时**。语言服务器「连上了但不回包」（索引器死锁、子进程卡死、stdio 管道半开）时，底层 `connection.sendRequest(...)` 的 promise 永远 pending：await 它的工具调用（`lsp_hover` / `lsp_definition` 等）随之永久挂起；编辑器侧每次光标移动还会再压一个永不 settle 的请求，句柄线性堆积。`.catch()` 只能接住「服务器明确报错」，接不住「服务器装死」。
- 加固：把既有 `withTimeout` 收紧为「settle 即 `clearTimeout`」（高频请求如逐次 hover 不再累积上千个等满 `ms` 的定时器；`timer.unref?.()` 防止 pending 定时器拖住进程退出），并新增模块级 `REQUEST_TIMEOUT_MS = 10_000` 与局部 `request<T>(method, params)` 包装：每个请求 `Promise.race` 到墙钟上限，超时即 reject —— 复用每个方法既有的 `.catch()` 兜底（`null` / `[]`），所以「服务器装死」与「服务器报错」收敛到同一条降级路径，调用方无需改动。`initialize`（保留 45s 长超时，冷启动建索引慢）与 `shutdown` 不走该包装。
- 与既有韧性的关系：与 §0.5（MCP 建连超时）/ §0.22–§0.23（OAuth/MCP 端点超时）同属「外部进程/网络交互的每一次请求都必须有墙钟上限，否则对端装死会把调用方拖成永久挂起」一类；这次补的是 LSP stdio 请求侧最后一处缺超时的交互。
- 回归证据：新增单测 `request-timeout.test.ts`（导出 `withTimeout` + `REQUEST_TIMEOUT_MS` 做针对性验证）：（a）「promise 在超时前 resolve 则原值返回、不受墙钟影响」/（b）「promise 挂起超过 ms 时 race 出 `Timeout after Nms` reject」（用 fake timers 推进）/（c）「settle 后定时器被清理，不残留」共 3/3 通过；既有 `diagnostics-dispatch`（2）/`client-spawn-resilience`/`ws-client` 套件继续通过，lsp-client 全量 12/12。`@openawork/lsp-client typecheck` 通过；改动文件（client.ts + request-timeout.test.ts）ESLint 干净。

### 0.52 gateway WebSocket 客户端 pendingPayloads 有界化（防网关不可达时发送缓冲无界增长）（2026-05-30 续）

- 问题：`packages/web-client/src/gateway/gateway-ws.ts` 的 `GatewayWebSocketClient.send()` 在 socket 尚未 `OPEN` 时把 payload `push` 进 `pendingPayloads`，等 `onopen` 再一次性 flush。这层缓冲本意是不丢「CONNECTING 窗口内连发的消息」，但没有任何上限：当网关不可达（sidecar 未起、网络断、URL 错误）时 socket 永远不 `OPEN`，`onopen` 永不触发，而调用方（前端自动重发、用户快速输入、自动化脚本）每次 `send` 都继续 push——`pendingPayloads` 数组单调增长，是典型的客户端侧无界内存泄漏。`disconnect()` 虽然清空它，但「一直连不上又一直发」的场景下根本不会走到 `disconnect`。
- 加固：新增模块级 `MAX_PENDING_PAYLOADS = 64`，`send()` 在 push 之后用 `while (this.pendingPayloads.length > MAX_PENDING_PAYLOADS) this.pendingPayloads.shift()` 做 FIFO 逐出——丢最旧、保留最近的 intent（最新的发送意图才是用户当前想要的，被顶掉的旧 head 多半已被新消息取代）。缓冲容量恒定，不再随「连不上的时长 × 发送频率」线性膨胀；`onopen` flush 与 `disconnect` 清空逻辑保持不变。
- 与既有韧性的关系：与 §0.7（浏览器端流式客户端发送队列）/ §0.9（移动端网关客户端发送队列）同属「连接未就绪时的发送缓冲必须有界」一类；这次补的是 web-client 主网关 WS 客户端这处缺上限的发送缓冲，把「各个层级」里的前端连接层也纳入同一约束。
- 回归证据：新增 2 个用例（`gateway-ws.test.ts`）：（a）「CONNECTING 窗口内连发多条，onopen 后按序全部 flush」（验证缓冲在容量内不丢消息、顺序正确）/（b）「socket 长期未 OPEN 时缓冲有界，丢最旧、保留最近 intent」（连发 200 条远超 64 上限，验证 flush 后恰好 64 条、首条是 `msg-136`、末条是 `msg-199`）共 2/2 通过；既有 2 个用例（onerror 中文错误 / 损坏 JSON 关闭连接）继续通过，gateway-ws 套件 4/4。`@openawork/web-client typecheck` 通过；改动文件（gateway-ws.ts + gateway-ws.test.ts）ESLint 干净。

### 0.53 移动端网关客户端 pendingPayloads 有界化（防网关不可达时发送缓冲无界增长）（2026-05-30 续）

- 问题：`apps/mobile/src/hooks/useGatewayClient.ts` 的 `MobileGatewayClient.send()` 与 §0.52 的 web-client 完全同构：socket 未 `OPEN` 时把 payload `push` 进 `pendingPayloads`，等 `onopen` 一次性 flush；同样没有上限。移动端网络更易长时间不可达（切后台、弱网、隧道断流），`openConnection` 失败后还有自动重连（`maxReconnectAttempts=5`）期间窗口更长，调用方持续 `send` 会让 `pendingPayloads` 单调增长，是同类客户端侧无界内存泄漏。`disconnect()` 虽清空，但「连不上又持续发」根本不走 disconnect。
- 加固：与 §0.52 一致——新增模块级 `MAX_PENDING_PAYLOADS = 64`，`send()` push 后用 `while (this.pendingPayloads.length > MAX_PENDING_PAYLOADS) this.pendingPayloads.shift()` 做 FIFO 逐出，丢最旧、保留最近 intent。`onopen` flush 与 `disconnect` 清空逻辑不变。
- 与既有韧性的关系：与 §0.52（web-client 网关 WS 发送缓冲有界）/ §0.9（移动端帧解析与发送队列）同属一类；两端主网关 WS 客户端的发送缓冲现在都恒定容量，前端连接层（web + mobile）在「连接未就绪缓冲必须有界」上对称收口。
- 回归证据：新增 1 个用例（`__tests__/gateway-client.test.ts`）：「socket 长期未 OPEN 时缓冲有界，丢最旧、保留最近 intent」（连发 200 条远超 64 上限，open 后验证恰好 flush 64 条、首条 `msg-136`、末条 `msg-199`）通过；既有 4 个用例（坏帧 / handler 抛错隔离 / CONNECTING 顺序 flush / done 帧）继续通过，gateway-client 套件 5/5。`@openawork/mobile typecheck` 通过；改动文件（useGatewayClient.ts + gateway-client.test.ts）ESLint 干净。

### 0.54 session_run_events 按会话作用域保留裁剪（防 text_delta 逐 token 持久化导致只增表无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/session/session-run-events.ts` 的 `persistRunEventRow` 对每个 RunEvent 都 `INSERT INTO session_run_events`，而主流式链路（`routes/stream.ts` 的 `emitChunk` → `publishSessionRunEvent`）会把**每一个 `text_delta`**（逐 token）连同 `thinking_delta` / `tool_call_delta` / `tool_progress` 等高频 chunk 全部写入。该表是 `/stream/attach` 断线续传的持久化重放源，只在**失败**运行（`clearRetryableFailedRequestArtifacts` 里 `latestBookend.kind === 'run_failed'`）时按 `client_request_id` 清理；**成功**运行的全部 delta 行永久留存。叠加 `session-delete` 级联删除只在会话被删时触发，于是一个长期活跃、从不删会话的用户，其 `session_run_events` 随对话轮次单调增长——典型的高频只增表无界膨胀（与 §0.36 team_audit_logs / §0.40 request_workflow_logs / §0.42 notifications 同类，但这是写入频率最高的一张）。
- 加固：新增按「会话内 scope 数」的保留裁剪。关键安全前提：该表行按 `(session_id, client_request_id)` 成组，重放是**整组全有或全无**的单元——快路径 `replayPersistedAssistantResponse` 读取某 `client_request_id` 的全部 durable 事件并逐条 verbatim 重放，缺失时回退到用 `session_messages` 重建。因此「整组删除较旧的已完成 scope」只会把那些旧轮次从「快重放」降级为「消息重建」（无正确性损失），而**截断某 scope 的头部**才会破坏重放——所以裁剪必须以 scope 为最小单位、且永远保留最近的 scope（含在飞行的当前运行，它的 `MAX(id)` 最高）。实现 `pruneSessionRunEventScopes(sessionId, maxScopes)`：按每个非空 `client_request_id` 的 `MAX(id)` 降序保留前 `maxScopes` 组，其余整组 `DELETE`；NULL（legacy/未 scope）行从不裁剪。默认每会话保留 50 个 scope（`OPENAWORK_SESSION_RUN_EVENT_MAX_SCOPES_PER_SESSION` 可调，<=0 关闭），按 `SESSION_RUN_EVENT_PRUNE_CHECK_INTERVAL=200` 次插入触发一次以摊薄写放大；裁剪失败只告警、DB 损坏时与兄弟保留 store 一致地禁用裁剪路径，绝不影响事件持久化或在线流。
- 与既有韧性的关系：补齐「高频只增表必须有保留上限」这条不变量在系统里写入频率最高的一张表上的缺口，与 §0.36 / §0.40 / §0.42 构成同一模式的完整覆盖；裁剪以重放单元为粒度，确保续传正确性不被保留策略破坏。
- 回归证据：新增 2 个用例（`__tests__/session/session-run-events-retention.test.ts`，scope 上限设 3、check interval 设 1 以确定性触发）：（a）「超过上限时整组删最旧 scope、保留最近 N 组」（写 5 个 scope 各含多条事件，验证最旧 2 组被整组清空、最近 3 组完整保留、且各保留 scope 的事件序列未被截断）/（b）「retention=0 关闭裁剪时所有 scope 保留」共 2/2 通过；既有 `session-run-events.test.ts`（3）继续通过。`@openawork/agent-gateway typecheck` 通过；改动文件（session-run-events.ts + session-run-events-retention.test.ts）ESLint 干净。

### 0.55 session_entry 按会话作用域保留裁剪（防 text.delta 逐 token 持久化导致只增表无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/session/session-entry-store.ts` 的 `session_entry` 是 §0.54 `session_run_events` 的「类型化事件日志」孪生表——`persistRunEventRow` 在同一持久化路径里通过 `persistStreamChunkAsSessionEvents` 把**每一个 `text.delta` / `reasoning.delta` / `tool.input.delta`**（逐 token）翻译成 SessionEvent 行写入，外加 `translateRunEventToSessionEvent` 的 tool.success / tool.error / compacted 等。它同样没有任何保留上限，而且比 §0.54 更糟：连失败运行都不清理（`session_run_events` 至少在 `run_failed` 时按 scope 删，`session_entry` 只有删会话时才级联清）。长期活跃用户的 `session_entry` 随对话轮次单调增长。当前仅 `replaySessionEntries` 消费（verification 用，无线上路由），但「只增表必须有保留上限」的不变量同样适用。
- 加固：与 §0.54 完全同构的按 scope 保留裁剪。`session_entry` 行同样按 `(session_id, client_request_id)` 成组、每会话 `seq` 单调递增，重放（`aggregateSessionEntries`）按整组消费。`pruneSessionEntryScopes(sessionId, maxScopes)` 按每个非空 `client_request_id` 的 `MAX(seq)` 降序保留前 `maxScopes` 组，其余整组 `DELETE`；NULL（未 scope）行从不裁剪；永远保留最近 scope（含在飞行运行）。默认每会话 50 scope（`OPENAWORK_SESSION_ENTRY_MAX_SCOPES_PER_SESSION` 可调，<=0 关闭），按 `SESSION_ENTRY_PRUNE_CHECK_INTERVAL=200` 次插入触发一次摊薄写放大；裁剪失败只告警、DB 损坏时禁用裁剪路径，绝不影响事件持久化（含 FK 错误静默丢弃的既有语义）或在线流。
- 与既有韧性的关系：与 §0.54 成对收口——主流式链路的两张逐 token 持久化表（`session_run_events` 重放源 + `session_entry` 类型化事件日志）现在都有按重放单元粒度的保留上限；与 §0.36 / §0.40 / §0.42 共同把「高频只增表必有保留上限」覆盖到系统写入频率最高的两张表。
- 回归证据：新增 2 个用例（`__tests__/session/session-entry-retention.test.ts`，scope 上限 3、check interval 1 确定性触发）：（a）「超过上限时整组删最旧 scope、保留最近 N 组，且保留 scope 的事件序列未被截断」/（b）「retention=0 关闭裁剪时所有 scope 保留」共 2/2 通过；既有 `session-entry-store.test.ts`（13）继续通过，session-entry 套件 15/15。`@openawork/agent-gateway typecheck` 通过；改动文件（session-entry-store.ts + session-entry-retention.test.ts）ESLint 干净。

### 0.56 audit_logs 全局行数保留裁剪（防每工具调用 / 每错误只增表无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/infra/audit-log.ts` 的 `writeAuditLog` 在每次工具调用、以及每个 llm / stream / route 错误时都 `INSERT INTO audit_logs`（全仓 19+ 调用点，是仅次于 §0.54/§0.55 的高频写入）。该表 `session_id` 用 `ON DELETE SET NULL`（非 cascade），所以删会话也不清行；唯一的清理是 `DELETE /settings/diagnostics` 这个按需端点，且只删某用户的 `is_error = 1` 行。成功调用的行永久留存——长期运行的实例上 `audit_logs` 单调增长，是典型高频只增表无界膨胀（与 §0.36 / §0.40 / §0.42 同类）。
- 加固：套用 §0.40 `request_workflow_logs` 的全局行数保留模式。消费方只读最近行（`/settings/dev-logs` `ORDER BY created_at DESC LIMIT 100`、`/settings/diagnostics` `LIMIT 200`、`edit-tools` `id DESC LIMIT 50`、`session-manager` 按 session 读，以及按 `request_id` 精确查），因此「全局保留最近 N 行」安全。`pruneAuditLogs(limit)` 按自增 `id` 降序保留前 N 行（`id` 单调唯一，规避 `created_at` 秒级精度并列），其余 `DELETE`。默认 20000 行（`OPENAWORK_AUDIT_LOG_MAX_ROWS` 可调，<=0 关闭），按 `AUDIT_LOG_PRUNE_CHECK_INTERVAL=200` 次插入触发一次摊薄写放大；裁剪在 `writeAuditLog` 既有 try 块内、INSERT 之后调用，失败被同一 catch 吞掉绝不阻塞主流程，DB 损坏时与兄弟 store 一致禁用裁剪路径。
- 与既有韧性的关系：把「高频只增表必有保留上限」补到诊断审计表，与 §0.36 team_audit_logs（用户级）/ §0.40 request_workflow_logs（全局）/ §0.42 notifications（用户级）/ §0.54 session_run_events / §0.55 session_entry（均按 scope）一起，让所有高频只增表在保留策略上完整收口。
- 回归证据：新增 2 个用例（`__tests__/infra/audit-log-retention.test.ts`，上限设 5、check interval 设 1 确定性触发）：（a）「超过上限时按 id 保留最近 N 行、删除更旧行」（写 20 条，验证裁剪后恰好 5 行且都是最近写入的）/（b）「retention=0 关闭裁剪时全部保留」共 2/2 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（audit-log.ts + audit-log-retention.test.ts）ESLint 干净。

### 0.57 event_log 全局行数保留裁剪（防 SyncEvent 事件溯源日志无 cascade 永久泄漏 + 逐 delta 持久化无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/session/sync-event.ts` 的 `emitEvent` 对每个 persist 的 SyncEvent（message/part 的 create/update/delete，含 `PartDelta` 逐 token 增量）都 `INSERT INTO event_log`。该表是事件溯源的事件流，但 schema 用通用 `aggregate_id` 且**对 sessions 没有外键**——所以与 `session_entry` / `session_run_events`（均 `ON DELETE CASCADE`）不同，删会话时它的行**不会被级联清理**，被删会话的事件永久遗留；叠加全程无任何其它清理与逐 delta 高频写入，长期运行实例上 `event_log` 单调增长且只增不减。
- 加固：套用全局行数保留（§0.40 / §0.56 模式）。此处「全局保留最近 N 行」安全有三条依据：(1) 线上读模型真相源是 `message_v2` / `part_v2` 投影表（在同一事务内同步写入），`event_log` 自身唯一读者 `replayEventsForAggregate` 仅 verification 用、不在任何线上请求路径；(2) `seq` 来自独立单调计数器 `event_sequences`（而非 `MAX(event_log.seq)`），删行绝不会导致后续插入在 `uq_event_log_aggregate_seq` 唯一索引上碰撞；(3) 幂等键 `isEventProcessed` 按随机 UUID `id` 去重，裁掉旧行不会造成真实碰撞。`pruneEventLog(limit)` 按隐式 `rowid`（PK 是文本 UUID，故用 rowid 表征单调插入顺序）降序保留前 N 行、其余 `DELETE`。默认 50000 行（`OPENAWORK_EVENT_LOG_MAX_ROWS` 可调，<=0 关闭），按 `EVENT_LOG_PRUNE_CHECK_INTERVAL=500` 次插入触发一次摊薄写放大；裁剪在事务**之后**、仅当 `shouldPersist` 时调用，失败只告警、DB 损坏时与兄弟 store 一致禁用裁剪路径，绝不影响事件持久化或在线流。
- 与既有韧性的关系：补齐最后一张高频只增表——也是唯一一张「无 FK cascade、删会话仍遗留」的，与 §0.36 / §0.40 / §0.42 / §0.54 / §0.55 / §0.56 一起，让全部高频/事件溯源只增表在保留策略上完整闭环。
- 回归证据：新增 2 个用例（`__tests__/session/event-log-retention.test.ts`，上限 5、check interval 1 确定性触发）：（a）「超过上限时按 rowid 保留最近 N 行、删除更旧行，且 message_v2 投影不受影响」/（b）「retention=0 关闭裁剪时全部保留」共 2/2 通过；既有 `sync-event-bun-null-row.test.ts`（1）继续通过。`@openawork/agent-gateway typecheck` 通过；改动文件（sync-event.ts + event-log-retention.test.ts）ESLint 干净。

### 0.58 shadow-git runGit 单次调用墙钟超时（防 git 进程挂死拖垮快照捕获/恢复）（2026-05-30 续）

- 问题：`services/agent-gateway/src/snapshot/shadow-git-store.ts` 的 `runGit` 是 shadow-git 快照引擎的底层 git 执行器（capture / restore / diff / write-tree / checkout-index 等全部经它）。两条路径——`execFileAsync('git', ...)`（无 stdin）与 `spawn('git', ...)`（带 stdin，如 `hash-object --stdin`）——都只有 `maxBuffer`（默认 16MB）护栏，**没有任何墙钟超时**。git 子进程可能因 `index.lock` 争用、卡住的 hook、等待 tty 的 credential / editor 提示、停滞的网络文件系统而永不退出；此时返回的 promise 永不 settle，`await` 它的快照捕获/恢复随之永久挂起，并持有其工作区锁（`locksByGitDir`），后续同工作区的快照操作全部排队等死。`maxBuffer` 只能挡「输出太大」，挡不住「进程装死不出声」。
- 加固：新增 `DEFAULT_GIT_TIMEOUT_MS = 30_000` 与 `GitInvocationInput.timeoutMs`（默认 30s，<=0 关闭）。`execFile` 路径用原生 `{ timeout, killSignal: 'SIGKILL' }`：到点 SIGKILL 子进程，rejection 走既有 catch；并补一个分支——被 kill 但无数字 exit code（`err.killed && typeof err.code !== 'number'`）时，stderr 明确标注 `git timed out after Nms` 而非空串。`spawn` 路径手动加 `setTimeout(() => fail('git timed out after Nms'), timeoutMs)`（`timer.unref()` 不拖住进程退出），`fail` 与正常 `close` 都 `clearTimeout`。两条路径超时后都返回正常的失败结果（exitCode 1 + 可识别 stderr），调用方按既有「git 失败」分支优雅降级而非挂起。
- 与既有韧性的关系：与 §0.5（MCP 建连超时）/ §0.18（SSH 握手超时）/ §0.31（多模态上游墙钟）/ §0.51（LSP 请求墙钟）同属「每一次外部进程/网络交互都必须有墙钟上限，否则对端装死拖垮调用方」一类；这次补的是快照子系统的 git 子进程执行器——本地子进程同样可能挂死，且它持工作区锁，挂起后果比无锁路径更重。
- 回归证据：新增 2 个用例（`__tests__/session/shadow-git-timeout.test.ts`，用一个 `sleep 30` 的替身脚本经 `__setGitBinaryForTests` 注入、`timeoutMs=150`）：（a）「execFile 路径 git 挂起超 timeoutMs 时返回超时失败结果而非永久挂起」（断言 exitCode=1、stderr 含 `timed out`、耗时 < 5s 远小于 30s sleep）/（b）「spawn(stdin) 路径同上」共 2/2 通过；既有 `shadow-git-store.test.ts`（9）继续通过，shadow-git 套件 11/11。`@openawork/agent-gateway typecheck` 通过；改动文件（shadow-git-store.ts + shadow-git-timeout.test.ts）ESLint 干净。

### 0.59 command-loop worktree 探针 git 调用墙钟超时（防 git rev-parse 挂死拖垮 loop 执行启动）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/command-loop-runtime.ts` 的 `resolveRequestedWorktree` 在 loop 执行启动阶段对用户给定的 worktree 路径跑 `execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd })` 校验。该调用**只给了 `cwd`，既无 `timeout` 也无 `maxBuffer`**——与 §0.58 同类：git 子进程可能因 `index.lock` 争用、停滞的网络挂载、卡住的 hook 而永不退出，此时 promise 永不 settle，`await` 它的 loop 执行启动随之永久挂起。全仓其它 `execFile`/`spawn` 调用点（post-write-formatter 10s、ast-grep 60s、interactive-bash tmux 60s、repo-clone 5min spawn+SIGTERM）都已带超时，唯独这处 worktree 探针漏了。
- 加固：给该 `execFileAsync` 补 `timeout: WORKTREE_PROBE_TIMEOUT_MS(=10_000)` 与 `maxBuffer: 1MB`。超时触发后 execFile 自动 SIGKILL 子进程并 reject，rejection 落入函数既有的 `catch`，优雅降级为「Worktree 需要先初始化」提示（与路径不存在/非 git 仓库同分支），而不是把 loop 启动拖死。为可确定性测试，新增 `__setWorktreeProbeGitForTests(binary, timeoutMs)` 测试钩子（替换探针 git 二进制与超时），与 §0.58 的 `__setGitBinaryForTests` 同款做法。
- 与既有韧性的关系：与 §0.58（shadow-git runGit 墙钟）一起补齐 gateway 侧所有 git 子进程调用的墙钟上限；归入 §0.5 / §0.18 / §0.31 / §0.51 / §0.58「每次外部进程/网络交互必有墙钟上限」同一不变量。
- 回归证据：新增 1 个用例（`__tests__/routes/command-loop-worktree-timeout.test.ts`，用 `sleep 30` 替身脚本经 `__setWorktreeProbeGitForTests` 注入、timeout 150ms）：「git 探针挂起超过 timeout 时降级为『需要初始化』提示而非永久挂起」（断言返回 note 含「需要先初始化」、`path` 为 undefined、整体耗时 < 5s 远小于 30s sleep）通过。`@openawork/agent-gateway typecheck` 通过；改动文件（command-loop-runtime.ts + command-loop-worktree-timeout.test.ts）ESLint 干净。

### 0.60 WorkerManager sandbox timeoutMs 实际生效（防沙箱 worker 无界运行）（2026-05-30 续）

- 问题：`packages/agent-core/src/worker/index.ts` 的 `WorkerManagerImpl.launch` 接收 `SandboxConfig`（含 `timeoutMs`），`spawn` 子进程后把 `sandbox` 存进 `WorkerRuntime`，但**从未据 `timeoutMs` 武装任何定时器**——这个字段被存下来却从不生效。于是一个「沙箱」worker 可以永久运行，与「有界沙箱」的语义直接矛盾：调用方按 `SandboxConfig.timeoutMs` 设定的死线根本不会触发 kill。`WorkerManagerImpl` 是 agent-core 公开导出的 API（`index.ts` re-export），未兑现的契约即真实健壮性缺口。
- 加固：`WorkerRuntime` 新增 `timeoutTimer?` 字段；`launch` 在 `spawn` 后，若 `sandbox` 存在且 `timeoutMs` 为有限正数，`setTimeout` 武装死线：到点若 worker 仍 `running` 则 `process.kill()` 并标记 `stopped`、清 `pid`。`timer.unref()` 不拖住宿主进程退出；子进程的 `exit` / `error` 回调与 `stop()` 都 `clearTimeout` 并清空 `timeoutTimer`，确保定时器既不会对已退出/复用的 id 误触发，也不会泄漏。kill 包在 try/catch 里（子进程可能在检查与 kill 之间已自行退出）。无 sandbox 或 `timeoutMs<=0` 时不武装（保持原有不限时行为）。
- 与既有韧性的关系：与 §0.34（cron handler 墙钟 + 槽位回收）/ §0.58 / §0.59（git 子进程墙钟）同属「派生子进程必须有可生效的墙钟上限」一类；这次补的是 agent-core worker 管理器里「字段已声明却空转」的死线，把承诺的沙箱边界落到实处。
- 回归证据：新增 3 个用例（`worker/index.test.ts`，mock `node:child_process` + fake timers）：（a）「sandbox.timeoutMs 到点 kill 子进程并标记 stopped」（推进时钟越过死线，断言 `kill` 被调用、status=stopped、pid 清空）/（b）「worker 在死线前自行 exit 时定时器被清理、不再 kill」（先触发 exit 回调，再推进时钟，断言 `kill` 未被调用）/（c）「无 sandbox 时不武装定时器、worker 保持 running」共 3/3 通过；agent-core 全量 60/60 通过。`@openawork/agent-core typecheck` 通过；改动文件（worker/index.ts + worker/index.test.ts）ESLint 干净。

### 0.61 file-browser 搜索改用 execFile（消除 shell 注入面 + 补墙钟超时）（2026-05-30 续）

- 问题：`packages/agent-core/src/filesystem/file-browser-api.ts` 的 `searchText` / `searchFiles` / `searchSymbols` / `status` 全部把命令拼成 shell 字符串经 `exec` 执行，且用 `JSON.stringify(...)` 去「转义」`query` / `rootPath` / `filePattern`。但 `JSON.stringify` 只做 JSON 双引号转义，**不转义 shell 元字符**——双引号内的 `$(...)`、反引号在 bash 里照样会执行，因此这三个入参都是命令注入向量（如 `query = "$(rm -rf x)"`）。此外每个 `exec` 只设了 `maxBuffer`、**无 `timeout`**：grep/find 在超大或网络挂载的目录树上可能跑不完，promise 永不 settle，调用方挂死。`filePattern` 还被裸插进 `--include='${...}'` 单引号里，单引号本身也能被 payload 闭合。该类是 agent-core 导出 API（`FileBrowserAPIImpl` / `fileBrowserAPI`），虽暂无内部消费者，但导出的不安全实现就是真实隐患。
- 加固：整文件从 shell `exec` 改为 `execFile`（参数数组形式，**不经 shell 解析**，元字符天然失去特殊含义），新增统一 `runSearch(file, args, maxBuffer)` 包装：(1) 每次调用带 `timeout: SEARCH_TIMEOUT_MS(=15_000)`；(2) grep「无匹配」退出码 1、find/git 部分错误等非零退出，原 shell 形式靠 `2>/dev/null || true` 吞掉，这里改为从 error 对象上取回 `stdout` 返回（保持「非零退出不抛、返回已捕获输出」的等价语义）。`searchText` 的 `--include` 改为 `--include=${pattern}`（作为独立 argv 传入，无引号闭合问题），`-F` 固定字面匹配不变。
- 与既有韧性的关系：注入面消除归入内容安全/命令注入防护（参数化执行替代字符串插值）；墙钟超时归入 §0.5 / §0.51 / §0.58 / §0.59「每次外部进程/网络交互必有墙钟上限」同一不变量。两者在同一处一次性收口。
- 回归证据：新增 3 个用例（`filesystem/file-browser-api.test.ts`，真实 grep/find 跑临时目录，`skipIf` 无 grep 环境）：（a）「searchText 把含 shell 元字符的 query 当字面量匹配、绝不执行注入」（payload `$(touch marker)` 写进文件后搜索，断言命中该文件且 marker 文件**未被创建**——注入未执行）/（b）「searchFiles 把含元字符的 rootPath 当字面路径处理而非执行」（断言 marker 未创建）/（c）「searchText 在普通文件树上返回正确行号与路径」共 3/3 通过；agent-core 全量 63/63 通过。`@openawork/agent-core typecheck` 通过；改动文件（file-browser-api.ts + file-browser-api.test.ts）ESLint 干净。

### 0.62 artifacts FileBrowserAPIImpl 搜索改用 execFile（消除第二处 shell 注入面 + 补墙钟超时）（2026-05-30 续）

- 问题：`packages/artifacts/src/manager.ts` 的 `FileBrowserAPIImpl.searchText` / `searchFiles` 与 §0.61 的 agent-core 版本同构——把命令拼成 shell 字符串经 `exec` 执行，用 `JSON.stringify(query|pattern)` 充当「转义」。`JSON.stringify` 只转 JSON 双引号、不转 shell 元字符，双引号内的 `$(...)`/反引号照样执行，故 `query`/`pattern` 都是命令注入向量；且每个 `exec` 只设 `maxBuffer`、无 `timeout`。`searchText` 还多一层风险：`grep ... | head -${maxResults}` 把数字直接插进 shell 管道。`FileBrowserAPIImpl` 经 `packages/artifacts/src/index.ts` 导出，导出的不安全实现即真实隐患。
- 加固：与 §0.61 同款收口。新增 `runFileBrowserSearch(file, args, maxBuffer)` 包装，整体从 shell `exec` 改为 `execFile`（argv 数组、不经 shell），每次调用带 `timeout: FILE_BROWSER_SEARCH_TIMEOUT_MS(=15_000)`；非零退出（grep 无匹配 / find 部分错误）从 error 对象取回 `stdout`、不抛，等价于原 `2>/dev/null || true`。`searchText` 去掉 `| head -N` 的 shell 管道，改为在 JS 循环里 `if (results.length >= maxResults) break` 截断；`grep`/`find` 的入参全部作为独立 argv 传入。
- 与既有韧性的关系：与 §0.61 成对——agent-core 与 artifacts 两处同构的 file-browser 搜索实现现在都用参数化执行 + 墙钟超时，彻底消除「shell 字符串 + JSON.stringify 伪转义」这一注入模式在仓库里的两处实例。
- 回归证据：新增 3 个用例（`src/file-browser-api.test.ts`，真实 grep/find 在 chdir 后的临时目录跑，`skipIf` 无 grep 环境）：（a）「searchText 把含 shell 元字符的 query 当字面量匹配、绝不执行注入」（payload `$(touch marker)` 断言命中文件且 marker 未创建）/（b）「searchFiles 把含元字符的 pattern 当字面 glob 处理、不执行注入」/（c）「searchText 在普通文件树上返回正确行号与片段」共 3/3 通过；artifacts 全量 7/7 通过。`@openawork/artifacts typecheck` 通过；改动文件（manager.ts + file-browser-api.test.ts）ESLint 干净。

### 0.63 LSP 二进制探测改为纯 Node PATH 扫描（消除事件循环阻塞 + which/where shell 注入面）（2026-05-30 续）

- 问题：`packages/lsp-client/src/server.ts` 的 `whichSync` 与 `index.ts` 的 `isBinaryInstalled` 都用**同步 `execSync('which … || where …')`** 在 LSP spawn 路径上探测二进制。两处都有缺陷：(1) `execSync` 无 `timeout`——`which`/`where` 在异常 PATH、停滞的网络挂载下可能挂住，而同步调用会**阻塞整个 Node 事件循环**直到子进程返回，没有任何上界；(2) `bin` 被插进 shell 字符串（`which ${bin}`），虽然当前 `binary` 取值都是硬编码常量、注入风险低，但 `LSPManager` 接受 `servers` 注入，导出 API 上留着 shell 插值即潜在面。`whichSync` 在 server.ts 被调用 15 次（每次 spawn 解析二进制），事件循环阻塞影响面不小。
- 加固：把二进制探测整体从子进程改为**纯 Node 的 PATH 扫描**。新增导出 `whichSync(bin)`：按 `process.platform` 解析 `PATH`（Windows 叠加 `PATHEXT`、用 `Path` 兜底），对每个目录拼候选路径，用 `statSync` 判文件 + POSIX 下 `accessSync(X_OK)` 判可执行位（mirror `which` 语义）；含路径分隔符的 `bin` 直接解析不扫描 PATH。`index.ts` 的 `isBinaryInstalled` 改为复用 `whichSync(bin) !== undefined`，删掉自己那份 `execSync`。彻底消除事件循环阻塞、shell 解析与注入面三者。`ensureInstalled` 里的 `execSync(server.installCommand, { timeout: 120_000 })` 保留——它本就需要 shell（`npm install -g a b`、`… || cargo install …`）且已带超时，属合理用途。
- 与既有韧性的关系：与 §0.51（LSP 请求墙钟）/ §0.58 / §0.59（git 子进程墙钟）一脉相承——这次把「同步子进程阻塞事件循环」这一更隐蔽的形态也消除；注入面消除与 §0.61 / §0.62（参数化执行替代 shell 字符串插值）同类。
- 回归证据：新增 4 个用例（`src/which-sync.test.ts`）：（a）「能解析 PATH 上真实存在的二进制（node）为绝对路径」/（b）「不存在的二进制返回 undefined」/（c）「PATH 为空时返回 undefined 而非抛错」/（d）「含路径分隔符的 bin 直接按路径解析、不扫 PATH」共 4/4 通过；既有 `client-spawn-resilience` / `diagnostics-dispatch` / `request-timeout` / `ws-client` 套件继续通过，lsp-client 全量 16/16。`@openawork/lsp-client typecheck` 通过；改动文件（server.ts + index.ts + which-sync.test.ts）ESLint 干净。

### 0.64 SSH execCommand 墙钟超时 + 输出上限（防远端命令挂死 / 输出失控 OOM）（2026-05-30 续）

- 问题：`packages/agent-core/src/ssh/ssh-connection-manager.ts` 的 `execCommand` 把 `client.exec` 的回调包成 Promise，只在 `stream.close` 回调里 resolve。两处缺陷：(1) **无墙钟超时**——远端命令永不退出（`sleep infinity`、交互式程序等 tty）或底层 stream 永不 emit `close` 时，Promise 永远 pending、SSH channel 泄漏，调用方挂死；(2) **stdout/stderr 无上限**——`stdout += data.toString()` 逐块无界累加，远端 `yes` / `cat /dev/urandom` 这类输出可把宿主内存吃光（OOM）。`connect()` 已在 §0.18 加了客户端侧超时，`execCommand` 这条同样面向网络的路径却漏了。该类经 `index.ts` 导出、被 gateway `routes/ssh.ts` 使用。
- 加固：新增 `SSH_EXEC_TIMEOUT_MS=120_000` 与 `SSH_EXEC_MAX_OUTPUT_BYTES=16MB`，并加可选 `SSHExecOptions{ timeoutMs?, maxOutputBytes? }` 入参（per-call 覆盖，timeout<=0 关闭）。墙钟：到点 `finish` 守卫（与 `connect()` 同款单次 settle + clearTimeout 模式）best-effort `stream.destroy?.()` 并以 `{ exitCode: -1, timedOut: true, ...截断标记 }` resolve（保留已捕获输出，不抛、不挂）。输出上限：`appendStdout/appendStderr` 维护每流字节计数，到达 `maxOutputBytes` 后停止增长字符串并置 `stdoutTruncated/stderrTruncated`（与文件既有 `SSHFilePreview.truncated` 语义一致）。`ExecResult` 新增 `stdoutTruncated? / stderrTruncated? / timedOut?` 可选字段，正常完成路径不带这些标记，向后兼容。
- 与既有韧性的关系：与 §0.18（SSH 握手超时）配对，把 SSH 子系统「连接」与「执行」两条网络路径都收口到墙钟上限；超时归入 §0.5 / §0.51 / §0.58 / §0.59 / §0.63「每次外部进程/网络交互必有墙钟上限」同一不变量；输出上限归入 §0.58 runGit `maxBuffer` 同类「外部输出累加必有上界」。
- 回归证据：新增 3 个用例（`ssh-connection-manager` 的 `ssh-exec-command.test.ts`，注入 fake exec stream）：（a）「命令流不 close 时到达 timeout 后以 timedOut 解析而非永久挂起」（fake timers 推进至死线，断言 `timedOut=true`、`exitCode=-1`、保留已捕获的 `partial` 输出、stream 被 destroy）/（b）「输出超过 maxOutputBytes 时截断并打 truncated 标记」（100 字节输入、cap=10，断言 `stdout.length===10`、`stdoutTruncated=true`）/（c）「正常命令在 cap 与 deadline 内返回完整输出、无 truncated/timedOut 标记」共 3/3 通过；既有 connect 超时套件（3）继续通过，agent-core 全量 66/66。`@openawork/agent-core typecheck` 通过；改动文件（ssh-connection-manager.ts + ssh-exec-command.test.ts）ESLint 干净。

### 0.65 SSH SFTP 操作墙钟超时（防半开 SFTP 通道回调不返回导致 readFile/writeFile/listFiles 永久挂起）（2026-05-30 续）

- 问题：`packages/agent-core/src/ssh/ssh-connection-manager.ts` 的 `getSftp` 与三个 SFTP 操作（`readFile` / `writeFile` / `listFiles`）都把 ssh2 的回调式 API 包成 Promise，**只在回调触发时 settle**。这是与 §0.64 execCommand 同源的网络挂起：SFTP 子系统打开后，若操作回调因半开通道（网络停滞、对端假死、通道打开但永不应答）永不到达，对应 Promise 永远 pending、调用方挂死。`connect()`（§0.18）与 `execCommand`（§0.64）已分别收口，SFTP 这条同样面向网络的路径仍漏。该类经 `index.ts` 导出、被 gateway `routes/ssh.ts` 使用。
- 加固：新增 `SSH_SFTP_TIMEOUT_MS=60_000` 与通用 `withSftpTimeout(op, executor, timeoutMs?)` 包装——单次 settle 守卫（与 connect/execCommand 同款 `done` 模式）：超时定时器与操作回调都经 `done`，谁先触发谁赢、定时器必被清，超时则以可识别错误（`SSH SFTP <op> timed out after Nms`）reject 而非挂起；`timer.unref()` 不拖住进程退出。`getSftp` / `readFile` / `writeFile` / `listFiles` 全部改走该包装（各自标注 op 名）。`<=0` 关闭超时。
- 与既有韧性的关系：与 §0.18（connect）/ §0.64（execCommand）合体，把 SSH 子系统「连接 / 执行 / 文件传输」三条网络路径全部纳入墙钟上限；归入 §0.5 / §0.51 / §0.58 / §0.59 / §0.63 / §0.64「每次外部进程/网络交互必有墙钟上限」同一不变量。
- 回归证据：新增 2 个用例（`ssh-sftp-timeout.test.ts`，注入 fake sftp）：（a）「readFile 回调永不触发时到达 SFTP 超时后 reject 而非永久挂起」（fake timers 推进 60s，断言 reject 含 `SFTP readFile timed out`）/（b）「readFile 回调正常触发时返回内容、未受超时影响」共 2/2 通过；既有 connect（3）/ exec（3）套件继续通过，agent-core 全量 68/68。`@openawork/agent-core typecheck` 通过；改动文件（ssh-connection-manager.ts + ssh-sftp-timeout.test.ts）ESLint 干净。

### 0.66 持久终端每会话并发上限（防无界 spawn 持久 shell 耗尽宿主 PID/FD）（2026-05-30 续）

- 问题：`services/agent-gateway/src/session/persistent-terminals.ts` 的 `spawnPersistentTerminal` 每次调用都 `spawn` 一个长驻 shell（`bash -i` / PowerShell），由 `POST /sessions/:id/terminals` 路由直接触发，**没有任何每会话并发上限**。每个持久终端持有一个真实子进程 + 两条 stdio 管道 + 一段内存缓冲；一个出问题的前端重试循环、或恶意客户端反复打这个端点，就能无界 spawn shell，耗尽宿主的 PID / 文件描述符（典型资源耗尽向量）。输出大小（§256KB 缓冲 FIFO）已有上限，但「并发终端数量」没有。
- 加固：新增 `DEFAULT_MAX_PERSISTENT_TERMINALS_PER_SESSION=20`（`OPENAWORK_MAX_PERSISTENT_TERMINALS_PER_SESSION` 可调，<=0 关闭）。`spawnPersistentTerminal` 在 `spawn` **之前**先 `countLivePersistentTerminals(sessionId)`（遍历内存态 `persistentByTerminalId`、按 `sessionId` 且 `!closed` 计数），达到上限即抛 `PersistentTerminalLimitError`（带 sessionId + limit 的可识别错误），绝不 spawn。计数基于内存态 live 条目——终端退出 / 被 kill 时其 exit 处理器会从 map 删除，所以关闭一个即释放一个名额；不同 session 各自独立计数。路由 `POST /sessions/:id/terminals` 的既有 `catch` 把该错误连同其 message 经 `spawn_failed` 兜底返回，调用方据此可提示「先关闭一个」。默认 20 对正常多窗格使用足够宽松。
- 与既有韧性的关系：与 §0.34（cron 槽位回收）/ §0.52 / §0.53（发送缓冲有界）/ §0.54–§0.57（只增表保留）同属「每一类可由外部触发而无界增长的资源都必须有上限」一类；这次补的是「派生子进程数量」这一维度（区别于 §0.58/§0.60/§0.64 的子进程墙钟，那些限的是单次时长、这里限的是并发个数）。
- 回归证据：新增 2 个用例（`__tests__/session/persistent-terminal-cap.test.ts`，mock `node:child_process` 用 fake child 避免真 shell、env cap 设 2）：（a）「达到上限后再 spawn 抛 PersistentTerminalLimitError，终端退出后释放名额可再 spawn」（spawn 2 个到顶、第 3 个抛错；emit fake child 的 `exit` 释放名额后可再 spawn）/（b）「不同 session 各自独立计数，互不影响」共 2/2 通过；既有 `session-terminals-routes`（10）/ `session-terminal-registry` 套件继续通过，gateway session-terminal 相关 26/26。`@openawork/agent-gateway typecheck` 通过；我本回合实际改动文件（persistent-terminals.ts + persistent-terminal-cap.test.ts）ESLint 干净（`routes/session-terminals.ts` 为用户在脏工作区进行中的重构、其既有 `no-redeclare` 告警与本项无关，故本回合未改该文件）。

### 0.67 team-runtime 事件审计去重 map 过期清扫（防 lastIncidentAuditAtBySignature 按 sessionId/handoffId 无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/team/team-runtime-diagnostics-store.ts` 用模块级 `lastIncidentAuditAtBySignature: Map<string, number>` 对 runtime incident 审计写做 60s 去重。签名 `buildIncidentAuditSignature` 取 (userId × category × code × entityId)，而 `resolveIncidentAuditEntityId` 优先用 `handoffId` / `sessionId`——这两者随会话 / handoff 增长是高基数维度。于是长期运行的进程里，这张 map 的 key 空间实质无界、且**从不清理**（仅有测试用 `__reset...().clear()`）。关键观察：某个签名只在写入后的 60s 窗口内有意义（超过窗口的旧条目永远不会再命中 `now - lastAt < 60s` 去重判断），因此过期条目是纯泄漏——只增不用。
- 加固：新增按写入次数摊销的过期清扫。`sweepExpiredAuditSignatures(now)` 遍历删除所有 `now - at >= INCIDENT_AUDIT_DEDUPE_MS` 的条目；在每次成功记录签名后 `signatureWritesSinceSweep += 1`，达到 `DEFAULT_SIGNATURE_SWEEP_INTERVAL=256` 次写入触发一次 O(n) 扫描（摊销，避免每写都全扫）。清扫后 map 规模被「单个 60s 窗口内出现的不同签名数」上界限制，而非随进程寿命单调增长。新增测试钩子 `__setIncidentAuditSweepIntervalForTesting` / `__incidentAuditSignatureCountForTesting`，`__reset...` 同步清零计数。
- 与既有韧性的关系：与 §0.36 / §0.40 / §0.42 / §0.54–§0.57（只增表保留）/ §0.66（并发上限）同属「任何随外部输入增长的内存 / 存储结构都必须有界」一类；这次补的是「按高基数维度去重的内存 map」这一形态——去重 map 的常见隐患是 key 含高基数维度却只增不清。
- 回归证据：新增 2 个用例（`__tests__/team/team-runtime-diagnostics-sweep.test.ts`，hoisted-mock 掉 `logTeamAudit` / `trackTeamRuntimeIncident` 使测试全内存、绝不碰共享 SQLite，fake timers 基于真实 epoch 基准避免 `now=0` 去重误判）：（a）「过期签名在写入达到 sweep interval 时被清除，map 不随唯一 entityId 无界增长」（t=0 写 9 个不同 entityId 签名、推进 120s 越过窗口、第 10 次写触发 sweep，断言 map 仅剩刚写的 1 条）/（b）「窗口内未过期的签名不会被 sweep 误删」（3 条都在 60s 内，断言 sweep 后仍为 3）共 2/2 通过且隔离稳定（连跑 5 次 trio 全绿——修复前因 spy 未稳定生效、`recordTeamRuntimeIncident` 触达真实 DB 污染同进程的 `team-runtime-routes` 套件，改 hoisted mock 后消除）。`@openawork/agent-gateway typecheck` 通过；改动文件（team-runtime-diagnostics-store.ts + team-runtime-diagnostics-sweep.test.ts）ESLint 干净。

### 0.68 会话删除时清扫按 sessionId 键控的进程内 Map（防 substate/外部目录/doom-loop 跟踪表无界泄漏）（2026-05-30 续）

- 问题：三张模块级、以 `sessionId` 为 key 的进程内 Map 在会话删除时**没有任何清理**，于是每删一个会话就永久遗留一条，进程寿命内随会话总数单调增长：(1) `handoff/store/substate-store.ts` 的 `lastSubstateChangeAtBySession`（记录上次 substate 变更时刻、算进度间隔延迟）——从无清理函数；(2) `workspace/external-directory-guard.ts` 的 `sessionExternalDirs`（每会话已访问的外部目录集合）——有 `clearExternalAccessTracking` 但**零调用方**；(3) `session/doom-loop-detector.ts` 的 `sessionHistory`（每会话最近工具调用）——`resetDoomLoopHistory` 只在新用户消息时调，会话删除路径不调。`routes/sessions.ts` 的 `deleteSessionTree` 此前只删 DB 行，从不碰这些内存态（已有 `clearPendingTaskParentAutoResumesForSession` 一处先例，但只覆盖 task-resume 一张表）。
- 加固：给 substate-store 新增 `clearSubstateTrackingForSession(sessionId)`；在 `deleteSessionTree` 的逐会话循环里，紧跟既有 `clearPendingTaskParentAutoResumesForSession` 之后，补调三处清理：`clearSubstateTrackingForSession` / `clearExternalAccessTracking` / `resetDoomLoopHistory`。三者都是幂等 `Map.delete`（doom-loop 为 `sessionHistory.delete`），删不存在的 key 无副作用；放在 DB 删除**之前**，确保即便后续 DB 删除走 malformed-recovery 异常分支，内存态也已先行释放。
- 与既有韧性的关系：与 §0.67（去重 map 过期清扫）/ §0.66（并发上限）/ §0.34（cron 槽位回收）同属「以高基数维度为 key 的进程内结构必须有生命周期收口」一类；§0.67 靠时间窗口过期清扫、本项靠生命周期事件（会话删除）清扫，互补覆盖「无自然过期、但有明确销毁点」的 sessionId 维度。
- 回归证据：新增 2 个用例（`__tests__/workspace/external-directory-guard.test.ts`，纯内存无需 DB，直接验证清理机制——`clearExternalAccessTracking` 此前零调用方故无任何测试）：（a）「clear 丢弃该 session 的累计目录集合、first-access 检测随之重置」（record→true、重复→false、clear 后同目录再 record→true，证明 entry 确被逐出而非滞留）/（b）「clear 只影响目标 session、其它 session 不受影响」共 2/2 通过；既有 `doom-loop-detector`（12）继续通过，doom-loop + ext-dir 套件 14/14；`sessions-error-routes`（9，覆盖 deleteSessionTree 路径）继续通过。`@openawork/agent-gateway typecheck` 通过；改动文件（substate-store.ts + sessions.ts + external-directory-guard.test.ts）ESLint 干净。

### 0.69 githubSourceCache 用户查询键控缓存的过期清扫 + 容量上限（防 /skills/search?q= 任意查询无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/skills.ts` 的模块级 `githubSourceCache: Map<string, GitHubSourceCacheEntry>` 对 code-search 类技能源按 `buildGitHubSourceCacheKey` = `${source.id}::${query}` 缓存搜索结果。`query` 直接来自已登录用户的 `GET /skills/search?q=` 请求（经 `fetchGitHubSkills` 传入），而仓内有 26 个 code-search 源——于是每个「源 × 不同查询」组合产生一条永久缓存。两个 TTL 常量（`GITHUB_SOURCE_CACHE_TTL_MS=2h` 新鲜判定 / `GITHUB_SOURCE_STALE_IF_ERROR_MS=24h` 错误回退）**只在读取时判断能否复用**，从不删除任何条目。结果：一个用户用不同关键词反复搜索，就能让这张 map 随不同 query 单调增长——以用户输入为 key 的进程内缓存无界膨胀。
- 加固：新增容量上限 `GITHUB_SOURCE_CACHE_MAX_ENTRIES=512` 与 `pruneGitHubSourceCache()`，在每次 `githubSourceCache.set` 之后调用：先删除所有「超过 stale-if-error 窗口（24h）」的条目——它们既不能用于新鲜读取、也不能再做错误回退，是纯垃圾；若仍超过上限（窗口内涌入大量不同 query 的极端情况），按 `fetchedAt` 最旧优先淘汰到回落至上限。淘汰严格尊重 24h 错误回退窗口（窗口内条目优先靠容量上限而非时间删除），不破坏既有 stale-if-error 容错语义。
- 与既有韧性的关系：与 §0.68（按 sessionId 键控 map 的生命周期清扫）/ §0.67（去重 map 过期清扫）/ §0.36–§0.42 / §0.54–§0.57（只增表保留）同属「以高基数 / 外部输入为 key 的内存结构必须有界」一类；这次的高基数维度是「用户搜索关键词」，且是一张带 TTL 却只判读不删的缓存——TTL 缓存的常见隐患正是「过期只挡读、不回收内存」。
- 回归证据：新增 3 个用例（`__tests__/routes/github-source-cache-retention.test.ts`，经导出的测试 seam 直接 seed/prune/读 size，纯内存无需网络）：（a）「过期（超过 stale-if-error 窗口）条目在 prune 时被删除」（seed 一新鲜 + 一过期，prune 后剩 1）/（b）「超过容量上限时按 fetchedAt 最旧优先淘汰、回落到上限」（seed MAX+50 条窗口内条目，prune 后恰为 MAX）/（c）「未超上限且未过期时 prune 不删任何条目」共 3/3 通过；既有 `skills-routes`（9）继续通过。`@openawork/agent-gateway typecheck` 通过；改动文件（skills.ts + github-source-cache-retention.test.ts）ESLint 干净。

### 0.70 provider catalogCache / workspace allowlistCache 按 userId 键控缓存的过期清扫 + 容量上限（防只判读不回收的 TTL 缓存无界增长）（2026-05-30 续）

- 问题：两张按 `userId` 键控、带 TTL 却只在读取时判断、从不删除过期条目的进程内缓存——与 §0.69 同型（TTL 缓存只挡读、不回收内存）：(1) `provider/provider-catalog.ts` 的 `catalogCache`（30s TTL），每条 value 持有一个完整的 `ProviderManagerImpl`（重对象），任何曾发起请求的用户都会留下一条永久条目；(2) `workspace/user-workspace-allowlist.ts` 的 `allowlistCache`（30s TTL），任何曾命中 workspace 端点的用户留下一条。两者都有 `invalidate*`（配置/会话变更时清单个用户），但**没有任何路径回收"过期但用户未再活跃"的条目**——长期运行 + 用户基数大时，map 随历史用户总数单调增长，而非活跃用户数。
- 加固：给两张缓存各加 `prune*Cache()`，在每次 `set` 之后调用：先删除已过期条目（`catalogCache` 按 `builtAt + TTL`、`allowlistCache` 按 `expiresAt`——过期条目下次读取本就会从 DB 重建，删之无损语义），若仍超过容量上限（`CATALOG_CACHE_MAX_ENTRIES=1000` / `ALLOWLIST_CACHE_MAX_ENTRIES=5000`）则按时间最旧/最早过期优先淘汰到回落至上限。淘汰后 map 规模被「一个 TTL 窗口内活跃的用户数」上界限制，而非全历史用户数。既有 `invalidate*` 语义不变。
- 与既有韧性的关系：与 §0.69（githubSourceCache）/ §0.67（去重 map 过期清扫）/ §0.68（sessionId 键控 map 生命周期清扫）同属「以高基数维度为 key 的内存结构必须有界」一类；§0.69/§0.70 共同收口「带 TTL 但只判读不删」这一缓存反模式在仓内的三处实例（github 查询缓存 + provider catalog + workspace allowlist）。
- 回归证据：新增 4 个用例（`__tests__/provider/provider-catalog-retention.test.ts` 2 + `__tests__/workspace/user-workspace-allowlist-retention.test.ts` 2，经导出 seam 直接 seed/prune/读 size，纯内存）：两张缓存各验证「过期条目在 prune 时被删除」与「超上限时按时间最旧优先淘汰、回落到上限」共 4/4 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（provider-catalog.ts + user-workspace-allowlist.ts + 两个测试）ESLint 干净。

### 0.71 MCP tool-catalog 快照缓存容量上限（防 (用户×服务器×配置编辑) 维度无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/mcp/mcp-tool-catalog.ts` 的 `cache: Map<string, CatalogEntry>` 按 `(userId, mcpPoolKey)` 缓存每个 MCP 服务器的工具快照，其中 `mcpPoolKey = ${serverId}:${fingerprint}`。`fingerprint` 由 MCP 服务器配置哈希而来——用户每改一次配置，poolKey 就轮换、旧 key 的快照成为孤儿。更糟的是连接移除的几条路径（5min 空闲清理 `cleanupIdleConnections`、`disconnectUserConnection` / `disconnectAllForUser` / `disconnectAll`）都**不清理 catalog**，只有 connect-error 分支会清当前 key。于是长期运行进程里该 map 随 (用户数 × 服务器数 × 配置编辑次数) 单调增长。当前无任何线上读者直接取 `getCatalogSnapshot`（仅 PR-C 预留），故快照无既定 staleness 语义，泄漏的是纯增长而非正确性。
- 加固：新增容量上限 `CATALOG_SNAPSHOT_MAX_ENTRIES=2000` 与 `pruneCatalogSnapshots()`，在唯一插入点 `setCatalogSnapshot` 的 `cache.set` 之后、`publishChange` 之前调用：超过上限时按 `capturedAt` 最旧优先淘汰到回落至上限。由于快照无 TTL/staleness 窗口，这里纯按计数兜底（区别于 §0.69/§0.70 的「先按时间过期清扫、再按容量兜底」两段式——此处无时间维度可依，只保留最近活跃的 N 个快照）。既有 `clearCatalogSnapshot` / `clearAllCatalogSnapshots` / push 刷新语义不变。
- 与既有韧性的关系：与 §0.69（githubSourceCache）/ §0.70（provider catalog + workspace allowlist）/ §0.67（去重 map）/ §0.68（sessionId 键控 map）同属「以高基数维度为 key 的内存结构必须有界」一类；这次收口的是「连接生命周期与缓存生命周期未对齐、移除连接不清缓存」导致的孤儿快照增长——容量上限作为与连接生命周期解耦的兜底，即便未来新增 disconnect 路径漏清也不会无界。
- 回归证据：新增 2 个用例（`__tests__/mcp/mcp-tool-catalog-retention.test.ts`，mock 连接池、经导出 seam 直接 seed/prune/读 size）：（a）「超过容量上限时按 capturedAt 最旧优先淘汰、回落到上限」（seed MAX+30 条、prune 后恰为 MAX）/（b）「未超上限时 prune 不删任何条目」共 2/2 通过；既有 `mcp-tool-catalog`（5）继续通过，套件 7/7。`@openawork/agent-gateway typecheck` 通过；改动文件（mcp-tool-catalog.ts + mcp-tool-catalog-retention.test.ts）ESLint 干净。

### 0.72 进程级 unhandledRejection / uncaughtException 兜底处理器（防单个漏 catch 的 fire-and-forget 拖垮整个 gateway）（2026-05-30 续）

- 问题：`services/agent-gateway/src/index.ts` 启动流程**从未注册任何 `process.on('unhandledRejection')` / `process.on('uncaughtException')`**。而全仓存在大量刻意的 fire-and-forget 路径（`void promise`、后台定时器、SSE 推送、流式管线），它们各自 `.catch()`，但只要任意一处漏了 catch，在 Node 15+ 默认行为下未处理的 Promise rejection 会冒泡到 `process` 并**终止整个 gateway 进程**——一个走偏的后台任务就能拖垮所有在线 session/用户。来自后台定时器 / EventEmitter（在 Fastify 单请求错误边界之外）的 `uncaughtException` 同样是这个爆炸半径。Fastify 的 `setErrorHandler` 只覆盖请求生命周期内的错误，覆盖不到这些进程级事件。
- 加固：新增 `infra/process-safety.ts`，导出 `installProcessSafetyHandlers({ logger, proc?, exitOnUncaughtException? })`，在 `index.ts` 创建 `app` 之后、注册任何路由 / 后台任务**之前**调用（`{ logger: app.log }`）。两个处理器都「响亮地记日志」：`unhandledRejection` 记录后**默认保持服务**（漏 catch 的后台 promise 远不值得干掉所有 session，与全仓「失败隔离」哲学一致——每个 shutdown 分支 try/catch、每个轮询循环吞错退避、每个 fire-and-forget 都 `.catch()`）；`uncaughtException` 默认同样记录并保持服务，但可经 `OPENAWORK_EXIT_ON_UNCAUGHT=1` 切换为 fail-fast（记录后 `exit(1)`，让 Tauri sidecar / 进程管理器重启可能处于未定义状态的进程）。非 Error 的 reason 经 `toError` 规范化，处理器自身绝不二次抛错。安装幂等（`installed` latch），热重载 / 重复 boot 不会叠加监听器导致同一事件被记 N 次或泄漏 handler。
- 与既有韧性的关系：这是「错误/网络健壮性加固」系列的进程级兜底——前序各项（§0.1–§0.71）逐个收口具体路径的重入 / 竞态 / 超时 / 泄漏，本项在所有路径之外再加一层最后防线，确保「即便仍有一处未被审计到的漏 catch」也不会升级为全进程崩溃。与 §0.34 / §0.60 / §0.64（各自 try/catch 隔离）同属「单点失败不得升级为全局失败」不变量。
- 回归证据：新增 5 个用例（`__tests__/infra/process-safety.test.ts`，注入 fake proc + logger）：（a）「注册 unhandledRejection / uncaughtException 两个处理器」/（b）「unhandledRejection 被记录且默认不退出进程」/（c）「uncaughtException 默认记录但不退出、非 Error reason 被规范化」/（d）「exitOnUncaughtException=true 时记录后 exit(1)」/（e）「幂等：重复安装不重复注册监听器」共 5/5 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（index.ts + process-safety.ts + process-safety.test.ts）ESLint 干净。

### 0.73 WebSocket 流连接 ping/pong 存活探测（防半开 WS 永不触发 'close' 导致 socket+订阅滞留）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/stream-routes-plugin.ts` 的 WS 流处理器（`/sessions/:id/stream`，`{ websocket: true }`）仅依赖 `socket.on('close')` 做清理（解除 `subscribeSessionRunEvents` 订阅等）。但 WS 可能「半开」——对端无 FIN/close 帧地消失（笔记本休眠、NAT/空闲超时、网络分区、移动端被强杀），服务端 `'close'` 事件**永不触发**。于是该 socket、它的 run-event 订阅、以及每连接状态会滞留整个进程寿命，且每条 publish 的 run event 仍会扇出到死对端——既是泄漏也是无效 IO。同文件的 SSE 路径已有 10s keepalive 写（写失败即 cleanup）防住了这一情形，唯独 WS 只靠 TCP `'close'`、对半开 socket 无效。
- 加固：新增 `routes/ws-heartbeat.ts`，导出 `installWsHeartbeat(socket, { intervalMs?, setIntervalFn?, clearIntervalFn? })`：默认每 30s ping 一次，对端在一个间隔内回 pong 则清除 awaiting 标志；若整整一个间隔未回 pong 即判定对端已失联，`terminate()` 销毁 socket，进而触发既有 `'close'` teardown 跑完全部清理。返回幂等 `stop` thunk，WS 处理器在 `socket.on('close')` 里调用 `stopHeartbeat()`，保证定时器绝不长于连接；`timer.unref()` 不拖住进程退出；ping/terminate 全程 try/catch，socket 在探测间隙死亡也不抛。在 socket 未 OPEN（readyState!==1）时跳过 ping，只等下次 tick 或 close。
- 与既有韧性的关系：与同文件 SSE keepalive、§0.x（SSE/WS 半开连接清扫族）同属「每条长连接都必须有主动存活探测，不能只等对端礼貌关闭」不变量；这次把 WS 这条唯一只靠 TCP close 的长连接补齐，使 SSE / WS 两种流式传输在半开场景下都能主动回收。
- 回归证据：新增 5 个用例（`__tests__/routes/ws-heartbeat.test.ts`，注入 fake socket + 手动 timer harness）：（a）「socket OPEN 时每间隔发 ping」/（b）「对端一个间隔内回 pong 则持续存活、不终止」/（c）「对端整整一个间隔未回 pong 则 terminate」/（d）「socket 未 OPEN 时不 ping」/（e）「stop() 后不再 ping（幂等）」共 5/5 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（stream-routes-plugin.ts + ws-heartbeat.ts + ws-heartbeat.test.ts）ESLint 干净。

### 0.74 登录暴力破解节流（/auth/login 失败计数 + 锁定，防 LAN 暴露下在线猜密）（2026-05-30 续）

- 问题：`services/agent-gateway/src/infra/auth.ts` 的 `/auth/login` 把提交密码的 SHA-256 与库中 hash 比对，**没有任何尝试次数限制**。而 gateway 被刻意设计为可经局域网访问（桌面端「LAN Web 访问」开关），攻击者可对该端点全速猜密——在线暴力破解是真实暴露面（叠加 seed admin 默认弱密码 `admin123456` 时风险更高）。仓内 `redis` 本身只是进程内 Map shim、无 TTL，原本也没有任何节流原语。
- 加固：新增 `infra/login-rate-limiter.ts`，导出 `LoginRateLimiter`（可注入时钟）+ `buildLoginRateLimitKey(email, ip)`。按 (email+ip) key 维护滑动窗口失败计数：窗口（默认 15min）内累计失败达阈值（默认 5 次）即锁定 key 一段冷却期（默认 15min），`check()` 命中锁定返回 `{ allowed:false, retryAfterSeconds }`。`/auth/login` 在用户查找**之前**先 `check()`，命中即回 429 + `retry-after` 头；用户不存在 / 密码错两条失败分支都 `recordFailure()`；成功登录 `recordSuccess()` 清空该 key 计数。状态纯内存（与单进程架构一致，重启即重置仍远胜于无），并由 `sweep()` 在每次 recordFailure 后清理过期 key + 超 `maxEntries`（默认 1 万）按最旧活动淘汰，使「变 key 猜密洪流」也无法把 map 撑爆（沿用 §0.69–§0.71 的有界缓存模式）。
- 与既有韧性的关系：归入内容安全 / 滥用防护（暴力破解节流）一类，同时其内存状态的有界 sweep 与 §0.69–§0.71（有界缓存）/ §0.67（去重 map 过期清扫）同型；与 §0.72（进程级兜底）/ §0.73（WS 存活探测）一起属本轮「面向网络的攻击面 / 异常连接」加固。
- 残留说明：本项**未**改动密码哈希算法本身（仍是无盐 SHA-256）与登录比较的非常量时间 `!==`——两者需要用户库迁移策略、属更高风险改动，本轮聚焦可独立落地的节流；已在此记录为后续候选。
- 回归证据：新增 6 个用例（`__tests__/infra/login-rate-limiter.test.ts`，注入假时钟）：（a）「达到 maxFailures 前允许、达到后锁定并返回 retryAfter」/（b）「锁定在 lockoutMs 后解除」/（c）「窗口外旧失败不计入阈值」/（d）「成功登录清空失败计数」/（e）「不同 key 独立计数」/（f）「maxEntries 上限下 sweep 控制 map 规模（200 个不同 key 洪流后 size<=50）」共 6/6 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（auth.ts + login-rate-limiter.ts + login-rate-limiter.test.ts）ESLint 干净。

### 0.75 密码哈希升级为带盐 scrypt + 常量时间比较（替换全链路无盐 SHA-256，附 legacy 透明迁移）（2026-05-30 续）

- 问题：§0.74 记录的后续候选——全部凭据路径（`/auth/login`、`/auth/register`、`/auth/admin-set-password`、`index.ts` 的 `seedDefaultAdmin`）历史上都存 `sha256(password)`，**无盐**：相同密码哈希碰撞、可被彩虹表 / GPU 离线暴破，且 `/auth/login` 的比较用非常量时间 `!==`。gateway 可经 LAN 访问，一旦攻击者读到 DB（或测出比较时序），离线破解成本极低。这是真实的凭据存储弱点，不只是理论问题。
- 加固：新增 `infra/password-hash.ts`，导出 `hashPassword` / `verifyPassword` / `isLegacyPasswordHash`。新密码用 `node:crypto` 内置 `scryptSync`（无新依赖）对 16 字节随机盐派生，存为 `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`（N=16384,r=8,p=1，单次哈希 <~100ms）；验证经 `timingSafeEqual` 常量时间比较。`verifyPassword` 仍识别 legacy 64-hex SHA-256：匹配则返回 `{ valid:true, needsUpgrade:true }`，`/auth/login` 在该次成功登录里透明地用 scrypt 重新哈希落库——存量用户无需强制改密即自动迁移。四处写入点（login 升级 / register / admin-set-password / seed）与两处校验点（login / admin-password-status 的 isDefault 判定）全部改走新模块。
- 与既有韧性的关系：直接兑现 §0.74 残留说明里登记的两项（无盐哈希 + 非常量时间比较），与 §0.74（登录节流）共同把「LAN 暴露下的凭据攻击面」从在线、离线两侧收口；属内容安全 / 滥用防护族。
- 残留说明：scrypt 成本参数为固定常量（未做按硬件自适应或可配置），对交互式登录足够；legacy 迁移依赖「用户下次成功登录」触发，从不主动批量重算（无明文，也不应主动）——长期未登录的账号会保留 legacy 哈希直至其下次登录，属预期行为。
- 回归证据：新增 7 个用例（`__tests__/infra/password-hash.test.ts`）：（a）「hashPassword 产出 scrypt 格式且可验证」/（b）「相同密码两次哈希因随机盐而不同、各自可验证（无碰撞）」/（c）「错误密码失败」/（d）「legacy SHA-256 仍可验证并标记 needsUpgrade」/（e）「legacy 下错误密码失败且不标记升级」/（f）「isLegacyPasswordHash 仅对 64-hex 为真」/（g）「畸形/未知格式 stored hash 永不匹配」共 7/7 通过；login-rate-limiter（6）+ password-hash（7）合计 13/13；无测试直接走登录路由（fixtures 仅用 `'x'` 占位满足外键、从不真正登录），故无回归面。`@openawork/agent-gateway typecheck` 通过；改动文件（auth.ts + index.ts + password-hash.ts + password-hash.test.ts）ESLint 干净。

### 0.76 expired refresh_tokens 过期行清扫（防只增不删的会话令牌表无界增长）（2026-05-30 续）

- 问题：`refresh_tokens` 表只在轮换（`/auth/refresh`）、登出（`/auth/logout`）、改密（`/auth/admin-set-password`）三处 `DELETE`，而 `/auth/refresh` 的查找用 `expires_at > datetime('now')` **只过滤、从不删除**过期行。于是任何「关浏览器但不登出」的会话都会遗留一条 7 天后过期、却永远留在表里的死行——每个被遗弃的会话一条，随登录次数单调增长。属 §0.36 / §0.40 / §0.54–§0.57「只增表必须有保留收口」同族，且此前漏在认证子系统这一张。
- 加固：`infra/auth.ts` 新增导出 `pruneExpiredRefreshTokens()`（`DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')`，try/catch 包裹、best-effort 绝不阻断登录），在两处低频令牌签发路径（`issueTokenPair` 与 `/auth/refresh` 轮换 INSERT 之后）各调用一次。令牌签发本就低频（登录 / 刷新），故直接随写清扫即可、无需摊销计数器；过期行的删除幂等，与并发签发不冲突。
- 与既有韧性的关系：与 §0.40（request_workflow_logs）/ §0.54–§0.57（只增表保留）/ §0.74（登录节流）/ §0.75（密码哈希）同属本轮认证 / 存储健壮性收口；这次补齐「会话令牌表」这一最后的只增认证表。
- 回归证据：新增 2 个用例（`__tests__/infra/refresh-token-prune.test.ts`，真实内存 DB）：（a）「删除已过期行、保留未过期行」（插 2 过期 + 1 未过期，prune 后仅存活行留下且 token_hash 正确）/（b）「无过期行时 no-op、不误删未过期行」共 2/2 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（auth.ts + refresh-token-prune.test.ts）ESLint 干净。

### 0.77 配对 token 改用常量时间比较（防 /pairing/login 签发 admin token 的 token 经 LAN 时序侧信道泄露）（2026-05-30 续）

- 问题：`packages/pairing/src/manager.ts` 的 `verifyToken` 用 `this.activeSession?.token === token` 比较配对 token。该方法把守 `/pairing/login`——只要 `verifyToken` 通过，路由就给调用方签发**完整 admin token pair**（见 `routes/pairing.ts`）。`===` 是非常量时间比较：JS 字符串相等通常在首个不同字节处短路返回，LAN 上的攻击者可借响应时序逐字节恢复当前活动 token，进而骗取 admin 凭据。仓内 `hasValidDesktopAuthToken`（§桌面鉴权）与 §0.75 密码比较都已用 `timingSafeEqual`，唯独这条同样高敏感的 token 比较漏了。
- 加固：新增 `constantTimeTokenEqual(a, b)`——先比长度（仅暴露 token 公开的固定长度、不暴露内容），再 `Buffer.from` 经 `timingSafeEqual` 常量时间比较，异常吞掉返回 false。`verifyToken` 重写为：先做 null / TTL 过期 guard（与原语义一致、过期短路不进比较），再 `constantTimeTokenEqual(session.token, token)`。`confirmClient` 经 `verifyToken` 间接同样受益。
- 与既有韧性的关系：与 §0.74（登录节流）/ §0.75（密码哈希带盐 scrypt + 常量时间）同属本轮认证攻击面收口；这次把「签发 admin token 的最后一道 token 校验」也纳入常量时间比较不变量，消除时序侧信道。
- 回归证据：新增 5 个用例（`packages/pairing/src/verify-token.test.ts`）：（a）「正确 token 通过」/（b）「同长度的错误 token 失败（走 timingSafeEqual 路径而非长度短路）」/（c）「不同长度 token 失败且不抛错」/（d）「TTL 过期后正确 token 也失败」/（e）「无活动会话时失败」共 5/5 通过；既有 `manager.test.ts`（8）继续通过，pairing 全量 13/13。`@openawork/pairing typecheck` 通过；改动文件（manager.ts + verify-token.test.ts）ESLint 干净。

### 0.78 cron 调度器执行历史内存上限（防 executions 数组随高频 job 触发无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/cron/scheduler.ts` 的 `CronScheduler` 用进程内数组 `executions: CronExecutionRecord[]` 记录每次 job 触发，`fireJob` 每次都 `push` 一条、**从不裁剪**。一个高频 job（如 `every` 1 分钟、甚至秒级）会让该数组随调度器寿命单调增长——每触发一次一条记录，长期运行即内存泄漏。该结构经 `/cron/jobs/:id/executions` 路由读取（按 jobId 过滤返回全部历史）。属 §0.66 / §0.71（进程内集合容量上限）/ §0.40 / §0.54–§0.57（只增结构保留）同族，是 cron 子系统里漏掉的一处。
- 加固：新增可配置上限 `DEFAULT_CRON_EXECUTION_HISTORY_MAX=1000`（构造函数第 4 参，<=0 禁用）。`fireJob` 在 `push` 之后裁剪：超过上限即 `splice` 掉最旧记录、保留最近 N 条（FIFO ring）。上限远大于 `maxConcurrent`（默认 3），保证「仍处于 running、其 `finally` 尚未把状态改成 completed/failed」的记录始终在最近 N 条内、绝不会被提前裁掉——即裁剪只动早已 settle 的旧记录，不破坏运行中记录的可变引用语义。既有 `getExecutionHistory` / 重入 / 超时语义不变。
- 与既有韧性的关系：与 §0.66（持久终端并发上限）/ §0.71（MCP 快照缓存上限）/ §0.40（request_workflow_logs 保留）同属「任何随外部触发增长的内存 / 存储结构都必须有界」不变量；cron 子系统此前已有墙钟超时（DEFAULT_CRON_JOB_TIMEOUT_MS）+ 重入保护 + 并发上限，这次补齐「执行历史内存」这最后一处无界增长。
- 回归证据：新增 2 个用例（`__tests__/cron/scheduler-history-cap.test.ts`，fake timers）：（a）「频繁触发时 executions 被裁剪到上限、保留最近且 started_at 单调」（cap=5、触发约 20 次后 history<=5、全 completed）/（b）「executionHistoryMax<=0 时禁用裁剪、保留全部」共 2/2 通过；既有 cron 调度器三套件（reschedule 2 / reentrancy 3 / timeout 2）继续通过，cron 全量 9/9。`@openawork/agent-gateway typecheck` 通过；改动文件（scheduler.ts + scheduler-history-cap.test.ts）ESLint 干净。

### 0.79 look_at 工具文件大小上限（防用户提供的超大文件全量读入内存 OOM）（2026-05-30 续）

- 问题：`services/agent-gateway/src/tools/look-at-tools.ts` 的 `runLookAtTool` 三条文件分支都**在任何截断之前把整个文件读入内存**：图片走 `readFile(filePath, 'base64')`（base64 约 1.33× 膨胀）、文本走 `readFileAsText` 读完整 buffer 再 `.slice(0, 16000)`（截断发生在全量读取之后）、PDF 走 `readFile` 全量 buffer 给 pdf-parse。`file_path` 来自用户/agent 输入并经 `validateWorkspacePath` 仅做路径越界校验、不校验大小，因此指向一个数 GB 的工作区文件即可让 gateway OOM。该工具经沙箱路径执行，没有 ToolRegistry 的任何包裹兜底。
- 加固：新增 `DEFAULT_LOOK_AT_MAX_FILE_BYTES=64MiB`（`OPENAWORK_LOOK_AT_MAX_FILE_BYTES` 可调，<=0 禁用）与 `assertLookAtFileWithinLimit(filePath)`：在 `validateWorkspacePath` 通过后、任何 `readFile` 之前先 `stat` 取大小，超限即抛 `look_at file too large: <size> bytes exceeds limit <max> bytes`，绝不读一个字节。`stat` 失败（缺失/不可读）不在此处报错、留给后续 read 暴露精确的 ENOENT/EACCES。`image_data`（base64 内联）分支不走文件、不受影响。
- 与既有韧性的关系：与 §0.65（SFTP 读)/§0.52–§0.53（缓冲有界）/§0.66/§0.71/§0.78（内存结构有界）同属「任何把外部输入读入内存的路径都必须有大小/容量上限」一类；这次补的是「本地文件读入内存」这一维度——与 §0.64 execCommand 输出上限同源（限单次读入量），区别在这里靠 `stat` 预检在读取前拦截，比读后截断更早、不浪费 IO 与内存。
- 回归证据：新增 2 个用例（`__tests__/tools/look-at-file-size.test.ts`，mock `node:fs/promises` 的 stat/readFile）：（a）「超上限文件在读取前即被拒绝」（stat 返回 1GB、断言 reject 含 `look_at file too large`，且 `readFile` 与 `runUpstreamGenerate` 均未被调用——证明在读取/打上游之前拦截）/（b）「小于上限的图片正常读取并打上游」共 2/2 通过；既有 look-at 两套件（timeout 2 / upstream-protocol 2）继续通过，look-at 全量 6/6。`@openawork/agent-gateway typecheck` 通过；改动文件（look-at-tools.ts + look-at-file-size.test.ts）ESLint 干净。

### 0.80 permission_decision_logs 写后即增表的保留裁剪（防只写不读的权限决策审计表无界增长）（2026-05-30 续）

- 问题：`permission_decision_logs` 表在每次权限决策（approve / reject / permanent，经 `/permissions` 路由与 session-shared-read 路由两处）都 INSERT 一行，而该表**纯写不读**：生产代码无任何 SELECT 消费，唯一删除是 session 删除时的 CASCADE。于是一个长期运行、权限提示频繁的实例会让该表随决策次数无界增长，吃磁盘养一条没有读者的审计流水。两处 INSERT 语句还彼此重复（同样的列/占位）。属 §0.40（audit_logs）/ §0.54–§0.57（只增表保留）同族，是漏在权限子系统的一张。
- 加固：新增 `session/permission-decision-log-store.ts`，导出 `appendPermissionDecisionLog(input)` 收口两处写入（消除重复 SQL），并复用 audit_logs 同款摊销保留：默认上限 `DEFAULT_PERMISSION_DECISION_LOG_MAX_ROWS=20000`（`OPENAWORK_PERMISSION_DECISION_LOG_MAX_ROWS` 可调，<=0 禁用），每累计 `PRUNE_CHECK_INTERVAL=200` 次插入触发一次「按自增 id 保留最近 N 条」的 DELETE（id 单调、稳定区分最近 N；created_at 秒级精度会并列）。裁剪失败只吞/在 DB corruption 时禁用 prune，绝不阻断决策写入或权限主流程。两处路由（permissions.ts / session-shared-read-routes.ts）改调该函数。
- 与既有韧性的关系：与 §0.40（request_workflow_logs/audit_logs）/ §0.76（refresh_tokens 过期清扫）/ §0.78（cron 执行历史）同属「任何随外部触发增长的存储/内存结构都必须有界」不变量；这次补的是「只写不读的审计流水表」——这类表最易被忽视，因为没有读者会先暴露出慢查询，只会静默吃满磁盘。
- 回归证据：新增 2 个用例（`__tests__/session/permission-decision-log-retention.test.ts`，真实内存 DB）：（a）「累计插入超过上限后裁剪到最近 N 条」（cap=10、每 5 次插入裁剪一次、插 40 行后行数落在 [10,15]、且最旧存活行已非 req-0 证明旧行被裁）/（b）「retention<=0 时禁用裁剪、保留全部」（插 25 行全留）共 2/2 通过；既有 `permissions-routes` 套件继续通过。`@openawork/agent-gateway typecheck` 通过；改动文件（permission-decision-log-store.ts + permissions.ts + session-shared-read-routes.ts + permission-decision-log-retention.test.ts）ESLint 干净。

### 0.81 session_inbound_messages 终态行保留裁剪（防 pending→consumed/expired 后只增不删的反向消息表无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/handoff/store/inbound-store.ts` 背后的 `session_inbound_messages` 表（上游向下游 c session 注入 clarification_answer / user_input / cancel_signal 等结构化反向消息）的行经状态机走 pending → consumed/expired，但生产代码**从不 DELETE 终态行**——`consumePendingInboundMessage` / `listPendingInboundMessages` 只是把过期 pending 标为 expired，唯一的 DELETE 是测试钩子 `__resetInboundForTesting` 与 session 删除时的 CASCADE。于是一个长期运行、反向消息频繁的 team session 会让 consumed/expired 行无界堆积。属 §0.40 / §0.54–§0.57 / §0.80「只增表必须有保留收口」同族，是漏在 team handoff 子系统的一张。
- 加固：新增按写入次数摊销的时间窗保留。`pruneTerminalInboundMessages(maxAgeHours)` 只删 `state IN ('consumed','expired')` 且 `created_at` 早于保留窗口的行（`DELETE ... WHERE state IN (...) AND created_at < datetime('now', '-N hours')`）；`submitInboundMessage` 在 insert+readback+publish 之后每累计 `SESSION_INBOUND_PRUNE_CHECK_INTERVAL=100` 次插入触发一次。默认窗口 `DEFAULT_SESSION_INBOUND_TERMINAL_MAX_AGE_HOURS=24*7`（`OPENAWORK_SESSION_INBOUND_TERMINAL_MAX_AGE_HOURS` 可调，<=0 禁用）。**pending 行绝不在此删除**（仍可被消费）。保留窗口远大于所有类型的最大 TTL（24h），且 `resolveClarificationEscalationRequest` 只读未过期行，因此删除「早于一周」的终态行不破坏任何读路径。裁剪失败只吞、绝不影响反向消息写入或消费主流程。
- 与既有韧性的关系：与 §0.80（permission_decision_logs）/ §0.76（refresh_tokens）/ §0.40（request_workflow_logs/audit_logs）同属「任何随外部触发增长的存储结构都必须有界」不变量；这次补的是「带状态机、终态行只标不删」的表——状态机把行标成 consumed/expired 容易给人「已清理」的错觉，实则物理行仍在。
- 回归证据：新增 2 个用例（`__tests__/handoff/inbound-store-retention.test.ts`，真实内存 DB）：（a）「插入达到间隔时清除超过保留窗口的终态行，但保留窗口内的终态行与 pending 行」（48h 窗口、每 3 次插入裁剪；预置 100h/200h 的 consumed/expired + 1h 的 consumed + 500h 的 pending，3 次 submit 后断言两条老终态行被删、近期终态行与超老 pending 行均存活）/（b）「retention<=0 时禁用裁剪、保留全部终态行」共 2/2 通过；既有 `inbound-store`（12）继续通过，inbound 套件 14/14。`@openawork/agent-gateway typecheck` 通过；我本回合改动文件（inbound-store.ts 的保留区段 + inbound-store-retention.test.ts）ESLint 干净（同文件 `resolveClarificationEscalationRequest` 内 502/525 行的 `no-unnecessary-type-assertion` 告警属用户在脏工作区进行中的未提交重构、与本项无关，本回合未改该函数）。

### 0.82 team_messages 每用户保留裁剪（防只增不删、读取仅取最近 100 条的团队消息表无界增长）（2026-05-30 续）

- 问题：`team_messages` 表经 `POST /team/messages`（`routes/team-crud.ts`）每次调用追加一行、**无任何节流**，而两处读取（`routes/team.ts` 团队快照 / `team-crud.ts` 消息列表）都是 `ORDER BY created_at ASC LIMIT 100`。于是「最近 100 条」窗口之外的行永远不会被任何读路径展示，却也永远不删——生产代码无 DELETE，唯一清理是 user 删除时的 CASCADE。一个长期活跃账号会让该表随发消息次数无界增长，存一堆没有读者的死行。属 §0.40 / §0.80 / §0.81「只增表必须有保留收口」同族，是漏在 team 子系统的一张（与已具备每用户保留的 `notifications` 恰成对照——同样按 userId 键、同样 LIMIT 读取，却独缺裁剪）。
- 加固：新增 `team/team-message-store.ts`，导出 `appendTeamMessage(input)` 收口写入，复用 `notifications` 同款「每用户摊销保留」：默认每用户上限 `DEFAULT_TEAM_MESSAGE_MAX_ROWS_PER_USER=1000`（`OPENAWORK_TEAM_MESSAGE_MAX_ROWS_PER_USER` 可调，<=0 禁用），每用户累计 `PRUNE_CHECK_INTERVAL=50` 次插入触发一次「按 rowid 保留该用户最近 N 条」的 DELETE（rowid 单调、稳定区分最近 N；created_at 秒级会并列）。摊销计数按 userId 分桶（`Map<string, number>`，与 notification-store 一致，由 user 总数天然有界）。裁剪失败只吞 / DB corruption 时禁用 prune，绝不阻断消息写入。`team-crud.ts` 的 INSERT 改调该函数。上限（1000）远大于读取窗口（100），用户消息历史观感无任何变化。
- 与既有韧性的关系：与 §0.81（session_inbound_messages）/ §0.80（permission_decision_logs）/ §0.40（notifications/audit_logs）同属「任何随外部触发增长的存储结构都必须有界」不变量；这次补的是「读取已 LIMIT、却误以为天然有界」的表——LIMIT 读取最容易掩盖底层无界增长，因为前端永远只看到最近 100 条、慢查询也不会暴露，磁盘却在静默膨胀。
- 回归证据：新增 3 个用例（`__tests__/team/team-message-retention.test.ts`，真实内存 DB）：（a）「累计插入超上限后裁剪到最近 N 条」（cap=10、每 5 次插入裁剪、插 40 行后落在 [10,15]、msg-0 已删 / msg-39 存活）/（b）「裁剪只影响目标用户、其它用户不受影响」（user 插 20、other 插 3，裁剪后 other 仍为 3）/（c）「retention<=0 时禁用裁剪、保留全部」共 3/3 通过；既有 `team-crud-routes`（5）继续通过。`@openawork/agent-gateway typecheck` 通过；改动文件（team-message-store.ts + team-crud.ts + team-message-retention.test.ts）ESLint 干净。

### 0.83 memory_extraction_logs 去重日志的时间窗保留裁剪（防只增不删、仅点查的抽取去重表无界增长）（2026-05-30 续）

- 问题：`memory_extraction_logs` 表（`memory/memory-store.ts`）是一张「自动记忆抽取」的去重 / 幂等日志：每个抽取轮次 `INSERT OR IGNORE` 一行（`memory-runtime.ts` 每次成功 / 空文本运行各一处），读取**只有**点查 `hasExtractionLog(userId, sessionId, clientRequestId)`，删除只有 session 删除时的 CASCADE。`clientRequestId` 是单次流式运行的一次性 id，行一旦写入、其归属的那次运行早已结束，永不会被再次点查命中。于是长期活跃账号下该表随抽取次数无界增长，养一堆永不再被查询的死行。属 §0.40 / §0.80 / §0.81 / §0.82「只增表必须有保留收口」同族；与 §0.82 的「LIMIT 读取掩盖无界增长」同源——这里是「点查掩盖」：因为只按精确三元组查，没有读者会先暴露慢查询，磁盘却静默膨胀。
- 加固：给 `insertExtractionLog` 加按写入次数摊销的时间窗保留。`pruneExtractionLogs(maxAgeHours)` 删除 `created_at` 早于保留窗口的行（`DELETE ... WHERE created_at < datetime('now', '-N hours')`）；每累计 `MEMORY_EXTRACTION_LOG_PRUNE_CHECK_INTERVAL=100` 次插入触发一次。默认窗口 `DEFAULT_MEMORY_EXTRACTION_LOG_MAX_AGE_HOURS=24*30`（30 天，`OPENAWORK_MEMORY_EXTRACTION_LOG_MAX_AGE_HOURS` 可调，<=0 禁用）。安全性：删旧行不破坏去重语义——一次性 `clientRequestId` 不会在 30 天后重放，且 `upsertExtractedMemories` 本身在 memory 层按 key 去重，该日志只是「跳过重复抽取」的优化、非正确性保证。裁剪失败只吞 / DB corruption 时禁用 prune，绝不阻断抽取日志写入或记忆抽取主流程。
- 与既有韧性的关系：与 §0.82（team_messages）/ §0.81（session_inbound_messages）/ §0.80（permission_decision_logs）同属「任何随外部触发增长的存储结构都必须有界」不变量；本轮 §0.80–§0.83 连续收口四张只增表（权限决策日志 / 反向消息终态行 / 团队消息 / 记忆抽取去重日志），覆盖「只写不读」「状态机终态」「LIMIT 读取」「点查去重」四种最易被忽视的无界增长形态。
- 回归证据：新增 3 个用例（`__tests__/memory/memory-extraction-log-retention.test.ts`，真实内存 DB）：（a）「插入达到间隔时清除超过窗口的旧行、保留窗口内行」（48h 窗口、每 3 次插入裁剪；预置 100h/200h/1h 三行，3 次真实 insert 后断言两条老行被删、近期行 + 3 新行存活 = 4）/（b）「retention<=0 时禁用裁剪、保留全部」/（c）「hasExtractionLog 对窗口内现有行仍返回 true（dedup 语义不破坏）」共 3/3 通过；既有 `memory-security-scanner`（17）继续通过，memory 套件 20/20。`@openawork/agent-gateway typecheck` 通过；改动文件（memory-store.ts + memory-extraction-log-retention.test.ts）ESLint 干净。

### 0.84 effectiveContextWindowCache 只判读不回收的 TTL 缓存清扫 + 容量上限（防 (用户×模型) 维度无界增长）（2026-05-30 续）

- 问题：`services/agent-gateway/src/compaction/context-window-resolver.ts` 的 `effectiveContextWindowCache`（按 `${userId}:${modelId}` 键控、记录从 provider 报错里发现的「实际更小的上下文窗口」，1h TTL）的 TTL **只在读取时判断**：`resolveEffectiveContextWindow` 命中过期条目时只删它当场读到的那一条。一条被 `recordDiscoveredContextWindow` 写入、却再不被读取的条目永不回收——于是 map 随「曾出现过的 (用户×模型) 组合」单调增长。与 §0.69（githubSourceCache）/ §0.70（provider catalog + workspace allowlist）完全同型：带 TTL 但只挡读、不回收内存。
- 加固：新增容量上限 `EFFECTIVE_CONTEXT_WINDOW_CACHE_MAX_ENTRIES=5000` 与 `pruneEffectiveContextWindowCache()`，在 `recordDiscoveredContextWindow` 的 `set` 之后调用：先删除所有已过期（`discoveredAt + TTL`）条目（过期条目读路径本就会重算、删之无损语义），若仍超上限则按 `discoveredAt` 最旧优先淘汰到回落至上限。淘汰后 map 规模被「一个 TTL 窗口内活跃的 (用户,模型) 对数」上界限制，而非全历史。既有 `clearDiscoveredContextWindow` / `clearAllDiscoveredContextWindows` / 读路径过期删除语义不变。
- 与既有韧性的关系：与 §0.69 / §0.70 / §0.71 共同收口「带 TTL 但只判读不删」这一缓存反模式在仓内的全部已知实例（github 查询缓存 + provider catalog + workspace allowlist + MCP 快照 + 本项 context-window 发现缓存）；与 §0.66 / §0.78（内存结构容量上限）同属「以高基数维度为 key 的内存结构必须有界」不变量。
- 回归证据：新增 2 个用例（`__tests__/compaction/effective-context-window-retention.test.ts`，经导出 seam 直接 seed/prune/读 size、纯内存）：（a）「过期条目在 prune 时被删除」（seed 1 新 + 1 超 TTL，prune 后剩 1）/（b）「超上限时按 discoveredAt 最旧优先淘汰、回落到上限」（seed MAX+25、prune 后恰为 MAX）共 2/2 通过；既有 compaction 五套件（prompt 8 / tail-budget 6 / multi-round 3 / upstream-protocol 2 / llm-timeout 2）继续通过，compaction 全量 23/23。`@openawork/agent-gateway typecheck` 通过；改动文件（context-window-resolver.ts + effective-context-window-retention.test.ts）ESLint 干净。

### 0.85 webfetch 响应体大小上限（防任意 URL 超大响应全量缓冲 OOM）（2026-05-30 续）

- 问题：`services/agent-gateway/src/tools/web-tools.ts` 的 `webfetch` 工具抓取**任意用户/agent 提供的 URL**，原实现 `await response.text()` 把整个响应体一次性缓冲进内存、再做下游格式转换。它虽有墙钟超时（默认 20s，上限 120s），但超时挡不住这一类 OOM——一个快的服务器能在 deadline 内流式吐出数 GB（大文件、无限生成器、压缩炸弹解压后的明文），gateway 直接 OOM。属 §0.79（look_at 文件读入上限）同源的「任何把外部输入读入内存的路径都必须有大小上限」一类，区别在这里是网络响应、且 URL 完全由调用方控制（攻击面更直接）。
- 加固：新增 `DEFAULT_WEBFETCH_MAX_RESPONSE_BYTES=25MiB`（`OPENAWORK_WEBFETCH_MAX_RESPONSE_BYTES` 可调，<=0 禁用）与导出的 `readResponseTextWithLimit(response, maxBytes)`：①先看 `content-length`，声明值超限即在读一个字节前 `response.body.cancel()` 并抛错；②header 缺失/谎报时，用 `response.body.getReader()` 流式累计字节，一旦越过上限立即抛错并 `reader.cancel()` 释放 socket；③`maxBytes<=0` 关闭上限。`webfetch` 的 `execute` 改调该函数；非 2xx 分支也补了 `response.body?.cancel()` 及时释放未用 socket。墙钟超时 + abort 透传逻辑保持不变。
- 与既有韧性的关系：与 §0.79（look_at 文件 stat 预检）/ §0.64（execCommand 输出上限）/ §0.52–§0.53（缓冲有界）同属「读入内存量必须有界」不变量；本项补的是「网络响应体」这一维度——`fetch().text()` 是最易被忽视的无界读入，因为它在语义上看起来是「一次性拿到字符串」，实则缓冲量等于对端想发多少。
- 回归证据：新增 5 个用例（`__tests__/tools/webfetch-size-limit.test.ts`，用 `ReadableStream` 构造 fake `Response`）：（a）「正常读取未超限响应体」/（b）「content-length 超限时读取前即拒绝」（断言含 `content-length` 的错误文案）/（c）「content-length 缺失/谎报时流式累计超限即中止」（4×400B > 1024 cap）/（d）「maxBytes<=0 时禁用上限、完整读取 2048B」/（e）「恰好等于上限的响应体被接受」共 5/5 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（web-tools.ts + webfetch-size-limit.test.ts）ESLint 干净。

### 0.86 外部响应体读入统一抽出共享有界 reader 并补齐 skill 内容 / 版本检查抓取（§0.85 推广，防多处 fetch().text() 无界缓冲 OOM）（2026-05-30 续）

- 问题：§0.85 给 `webfetch` 单点加了响应体大小上限，但同样「fetch 任意/registry 提供的 URL 后 `await response.text()` 全量缓冲」的路径在仓内还有多处未设防：`tools/skill-tools.ts::fetchSkillText`（`skill` 工具按需把任意 `manifestUrl` 的远程 SKILL.md 内容读进上下文）与 `skill/skill-update-checker.ts::fetchTextWithTimeout`（后台批量抓 raw.githubusercontent.com 的 SKILL.md 查版本）都只有超时、无大小上限。两者 URL 均非完全可信（registry / CDN / 用户安装源），一个超大或恶意响应即可在超时窗口内流式喂爆内存。`fetch().text()/.json()` 是最易被忽视的无界读入——语义上看似「一次性拿字符串」，实则缓冲量 = 对端愿意发多少。
- 加固：把 §0.85 的有界 reader 抽出为共享模块 `infra/http-body-limit.ts`，导出 `readResponseTextWithLimit(response, maxBytes)`（content-length 预检 + 流式累计 + 超限即 `reader.cancel()` 释放 socket；`maxBytes<=0` 禁用）与 `resolveHttpBodyLimitBytes(envVar, fallback)`（统一的「正整数取整 / 非正数与 NaN→0 禁用」env 解析）。三处接入：①`web-tools.ts` 改为复用共享 reader（删除本地重复实现，错误文案统一为 `response body too large`）；②`fetchSkillText` 用 `OPENAWORK_SKILL_CONTENT_MAX_BYTES`（默认 5MiB）封顶、非 2xx 分支补 `response.body?.cancel()`；③`fetchTextWithTimeout` 用 5MiB 封顶、非 2xx 补 cancel。三处的既有超时 / abort 透传逻辑均不变。
- 与既有韧性的关系：与 §0.85（webfetch）/ §0.79（look_at 文件）/ §0.64（execCommand 输出）同属「任何把外部输入读入内存的路径都必须有大小上限」不变量；本项把该不变量从「webfetch 单点」推广为「所有网络响应体读入走同一个共享有界 reader」，消除「下一个 `fetch().text()` 又忘了封顶」的复发面。
- 回归证据：§0.85 的 5 个 reader 用例迁到 `__tests__/infra/http-body-limit.test.ts`（错误文案随共享化更新为 `response body too large`），并新增 3 个 `resolveHttpBodyLimitBytes` 用例（未设置→fallback / 正整数取整 / 非正数·NaN→0）共 8/8 通过；tools 全量套件（含 skill / sandbox / web）26 文件 208/208 通过。`@openawork/agent-gateway typecheck` 通过；改动文件（http-body-limit.ts + web-tools.ts + skill-tools.ts + skill-update-checker.ts + http-body-limit.test.ts）ESLint 干净。

### 0.87 skill-registry 包内统一有界 fetch + reader（text/json/arraybuffer），收口 manifest/listing/zipball 全部无界读入（§0.86 跨包推广）（2026-05-30 续）

- 问题：`packages/skill-registry`（经 `services/agent-gateway/src/skill/local-skills.ts` + `routes/skills.ts` 实际接入运行时）从任意 registry / CDN / 用户安装源抓取后全量读 body：`client.ts` 两处 `.json()`（搜索列表 / 详情）、`source.ts` 一处 `.json()`（registry-info）、`installer.ts` `.text()`（远程 manifest）+ `defaultLocalFileReader` 两处 `.text()`、`installers/local.ts` `.text()`（`file://` skill.yaml）、`installers/github.ts` `.arrayBuffer()`（**下载整个仓库 zipball 再 `unzipSync`**）+ `.text()`（`file://` manifest）。全部只有 8s 超时、无大小上限。其中 github zipball 尤为危险：先把整包缓冲进内存再解压，一个超大仓库或 zip bomb 的压缩载荷即可 OOM。且三个文件各自重复了一份 `fetchWithTimeout`。本包不依赖 gateway，无法复用 §0.86 的 `infra/http-body-limit.ts`。
- 加固：新增包内共享 `packages/skill-registry/src/http.ts`，导出 `fetchWithTimeout`（合并三处重复实现）+ `readResponseTextWithLimit`（默认 8MiB）/ `readResponseJsonWithLimit`（文本封顶后再 `JSON.parse`）/ `readResponseArrayBufferWithLimit`（默认 50MiB，给 zipball 用）。三者都做 content-length 预检 + 流式累计 + 超限即 `reader.cancel()` 释放 socket，`maxBytes<=0` 禁用。七处读入点全部改走共享 reader：client ×2 json、source ×1 json、installer 远程 manifest + localFileReader ×2、local.ts `file://`、github.ts zipball（arraybuffer）+ `file://`（text）；各文件删除本地 `fetchWithTimeout` 重复实现。既有 8s 超时与 fetchFn 注入（测试用）逻辑不变。
- 与既有韧性的关系：与 §0.85（webfetch）/ §0.86（gateway 内 skill 抓取）同型，把「外部响应体读入必须有界」不变量从 gateway 推广到 skill-registry 包；github zipball 的 arraybuffer 上限是本轮唯一覆盖到的二进制下载路径（先于解压封顶，挡住 zip bomb 压缩载荷与超大仓库）。gateway 与本包各自维护一份等价 reader（无跨包依赖），文案分别为 `response body too large` / `registry response too large` / `registry archive too large` 以便定位来源。
- 回归证据：新增 8 个用例（`packages/skill-registry/src/http.test.ts`，`ReadableStream` 构造 fake `Response`）：text reader 4（正常 / content-length 超限前置拒绝 / 流式累计超限中止 / `maxBytes<=0` 禁用）、json reader 1（上限内解析）、arraybuffer reader 3（正常 / 累计超限中止「zip bomb 压缩载荷」/ `maxBytes<=0` 禁用）共 8/8 通过；既有 `installer-fetch-timeout`（2）继续通过，包内 10/10。`@openawork/skill-registry typecheck` + `@openawork/agent-gateway typecheck`（依赖本包）均通过；改动文件（http.ts + client.ts + source.ts + installer.ts + installers/local.ts + installers/github.ts + http.test.ts）ESLint 干净。

### 0.88 上下文 addUrl 响应体大小上限（截断式有界读取，防任意 URL 超大响应全量缓冲 OOM）（2026-05-30 续）

- 问题：`packages/agent-core/src/context/manager.ts` 的 `addUrl(url)` 抓取**任意用户提供 URL** 后做 `await response.text()` 再 `.slice(0, 5000)`——只保留前 5000 字符，却先把**整个响应体**缓冲进内存。§0.21 已给它加了 15s `AbortSignal.timeout` 与非 2xx 拒绝，但墙钟超时不约束内存：快服务器可在超时窗口内 stream 数 GB（超大页面 / 无限生成器 / 解压载荷），在 `.slice` 执行前就 OOM 掉宿主。与 §0.85（webfetch）/ §0.87（skill-registry）同型的「`fetch().text()` 有超时无大小上限」缺口，且这是 agent-core 内最后一个面向任意 URL 的全量读入点。
- 加固：新增 `packages/agent-core/src/context/http-body-limit.ts`，导出 `readResponseTextTruncated(response, maxBytes)` + `resolveAddUrlMaxResponseBytes()`（env `OPENAWORK_ADD_URL_MAX_RESPONSE_BYTES` 覆盖，默认 1MiB，`<=0` 禁用）。与 §0.85/§0.87 的 reader 不同：那两处需要完整 payload，故超限**拒绝**；`addUrl` 只保留前缀，故 reader **截断**——流式累计到字节上限即 `reader.cancel()` 释放 socket 并解码已读部分，让超大但合法的页面仍能摄入前 5000 字符，同时把内存封顶在 ~`maxBytes`。`addUrl` 改走该 reader 后再 `.slice(0, 5000)`，既有 15s 超时与非 2xx 拒绝逻辑不变。
- 与既有韧性的关系：与 §0.85（webfetch）/ §0.86（gateway 内 skill 抓取）/ §0.87（skill-registry 包）同属「外部响应体读入必须有界」不变量，把它补到 agent-core 的 `addUrl` 这条最后的任意-URL 全量读入路径上。reader 维护在 agent-core 包内（无 gateway 依赖），采用截断而非拒绝语义以匹配「只保留前缀」的消费方式；其余 agent-core 对外 `fetch`（provider/oauth、oauth/client）读的是受控授权服务器的小 JSON，非任意 URL，保持不动。
- 回归证据：`packages/agent-core/src/context/manager.test.ts` 扩到 10 用例：原 3 用例（成功截断 / 非 2xx 拒绝 / 传入超时 signal）保留，新增「超大响应体只缓冲到字节上限即停止仍摄入前 5000 字符」（50MiB 无限流 + 200KiB 上限，断言产出远小于全量）、`readResponseTextTruncated` 3（正常读取 / 累计超限截断到上限 / `maxBytes<=0` 禁用）、`resolveAddUrlMaxResponseBytes` 3（默认 / 非法或非正数视为禁用 / 正数覆盖）共 10/10 通过。`@openAwork/agent-core typecheck` 通过；改动文件（manager.ts + http-body-limit.ts + manager.test.ts）ESLint 干净。

### 0.89 SQLite 会话存储行级 JSON 解析容错（防单条损坏行让整个 list() / 会话不可读）（2026-05-30 续）

- 问题：`packages/agent-core/src/session/sqlite-session-store.ts` 的 `rowToSession` 直接 `JSON.parse(row.messages_json)` / `JSON.parse(row.metadata_json)` 且**无任何容错**。这是 AGENTS.md 点名的「生产级 SQLite 会话存储」。崩溃半写、磁盘错误、手改 DB 都可能让某一行的列不是合法 JSON（或形状不对）。`get()` 命中损坏行会抛错；更糟的是 `list()`（`rows.map(rowToSession)`）只要**单条**损坏行就会整体抛错，让**所有会话**都列不出来、彻底不可访问——与 §0.15（artifacts 索引损坏拖垮整个子系统）完全同型的「单点损坏升级为全局失败」缺口。
- 加固：抽出 `parseJsonColumn<T>(raw, fallback, context)`——`JSON.parse` 失败即降级为 `fallback` 并 `console.warn`；并按 `fallback` 形状做基本校验（数组列解析出非数组、对象列解析出非对象/数组/null 都降级），避免后续把错误形状当正常数据用。`rowToSession` 改为 `messages` 降级到 `[]`、`metadata` 降级到 `{}`。这样损坏会话条目仍可见（id / 时间戳 / 状态完整）、其余会话照常加载，与 §0.15 artifacts「降级为空 store 并告警，逐条跳过损坏项」的容错语义一致。写入路径（`create` / `update` / `checkpoint`）本就用 `JSON.stringify`，不受影响。
- 与既有韧性的关系：§0.15（artifacts 索引损坏降级 + 原子写）收口的是产物子系统的「持久化损坏不得拖垮初始化」；本项把同一不变量补到 agent-core 的会话存储读取路径——「单条持久化行损坏不得让整个会话列表不可读」。两者同属「单点失败不得升级为全局失败」不变量（与 §0.72 进程级兜底、§0.34/§0.60/§0.64 的各自 try/catch 隔离一脉相承）。
- 回归证据：新增 `packages/agent-core/src/session/sqlite-session-store.test.ts`（3 用例：`list()` 含一条 JSON 非法行时不抛错、损坏会话降级为 `[]`/`{}` 且其余会话正常、并断言 `console.warn` 被调用；`get()` 对损坏行降级而非抛错——含「合法 JSON 但形状错误（metadata 是数组）」也降级；正常行往返解析不受影响）共 3/3 通过。`@openAwork/agent-core typecheck` 通过；改动文件（sqlite-session-store.ts + sqlite-session-store.test.ts）ESLint 干净。

### 0.90 V2 消息读模型行级 JSON 解析容错（防单条损坏 data 列让整页/整会话消息不可读）（2026-05-30 续）

- 问题：`services/agent-gateway/src/message/message-v2-schema.ts` 的 `messageInfoFromRow` / `partFromRow` 直接 `JSON.parse(row.data)` 且**无容错**。V2 消息存储是 CQRS 读模型，是聊天 UI 的**实时读源**（`message_v2` / `part_v2` 由 projector 写入、所有读取都经这两个转换函数）。`message-store-v2.ts` 里有 14 处调用，多数是 `rows.map(messageInfoFromRow/partFromRow)`（`listMessages` / `listMessagesByTurnLimit` / `listPartsForMessage` / `listPartsForSession` / `partsForMessage` / `attachPartsToMessages` / 分页 `pageMessagesWithParts` 等）。崩溃半写、磁盘错误、手改 DB 都可能让某一行 `data` 列不是合法 JSON——只要**单条**损坏行，整页或整个会话的消息列表就会抛错、彻底不可读。这与 §0.89（agent-core 会话存储）/ §0.15（artifacts 索引）完全同型的「单点损坏升级为全局失败」缺口，但 blast radius 更大：它直接决定用户能否看到自己的对话历史。
- 加固：在 schema 层新增 `tryMessageInfoFromRow` / `tryPartFromRow`——包裹原函数，解析失败返回 `null` 并 `console.warn`（保留原 `*FromRow` 供写入/内部使用）。在 `message-store-v2.ts` 新增本地 `mapMessageInfoRows` / `mapPartRows`（遍历跳过返回 `null` 的损坏行），把全部 14 处读取调用改走 try 变体：列表/分页/part 挂载路径**跳过**损坏行、保留其余；单行 getter（`getMessage` / `getPart` / `getMessageWithParts`）对损坏行降级为 `undefined` / `null`；`findToolPartByCallID` 扫描循环对损坏行跳过继续。损坏行只丢自己，不再连累同页其余消息。写入路径（projector / `*ToRowData`）本就用 `JSON.stringify`，不受影响。
- 与既有韧性的关系：与 §0.89（agent-core SQLite 会话存储行级容错）/ §0.15（artifacts 索引降级）同属「单条持久化行损坏不得升级为整体读取失败」不变量；本项把它补到 gateway 侧用户最敏感的 V2 消息读模型上。三处合起来覆盖了「会话级」「消息级」「产物级」三类持久化读取的损坏容错。
- 回归证据：新增 `services/agent-gateway/src/__tests__/message/message-v2-row-tolerance.test.ts`（4 用例：合法行 try 变体与原函数结果一致、损坏 message.data 原函数抛错而 try 变体返回 null+告警、损坏 part.data 同理、混合行过滤后只丢损坏项保留其余）共 4/4 通过；既有 `message-v2-projectors` / `message-v2-single-write-path` / `message-v2-compat-regressions` 共 23 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（message-v2-schema.ts + message-store-v2.ts + 新测试）ESLint 干净。

### 0.91 技能注册表已安装/缓存列表行级 JSON 解析容错（防单条损坏行让 /skills/installed 与 /skills/search 整列 500）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/skills.ts` 的 `rowToInstalledSkill`（`manifest_json` / `granted_permissions_json`）与 `parseCachedSkillEntry`（`entry_json`）都直接 `JSON.parse` 持久化列且无容错。两条用户高频列表经路 `rows.map(...)`——`/skills/installed`（`rows.map(rowToInstalledSkill)`）与 `/skills/search`（经 `listCachedRegistrySourceSkills` 的 `rows.map(parseCachedSkillEntry)`）——只要**单条**已安装技能 / 缓存条目的列不是合法 JSON（崩溃半写、磁盘错误、手改 DB、半截同步写入），整列就会抛错 500，用户**所有**已安装技能 / 缓存搜索结果全部不可见。与 §0.89（会话存储）/ §0.90（V2 消息读模型）/ §0.15（artifacts 索引）完全同型的「单点损坏升级为整列失败」缺口，skills 是独立子系统故单列。
- 加固：新增 `tryRowToInstalledSkill` / `tryParseCachedSkillEntry`——包裹原函数，解析失败返回 `null` 并 `console.warn`（保留原函数供写入 / 单行回写路径使用）。`/skills/installed` 与 `listCachedRegistrySourceSkills` 改用 `rows.flatMap(...)` **跳过**损坏行、保留其余；`/skills/:skillId` 详情经路对损坏缓存行降级为「缓存未命中」（继续走 builtin / marketplace 兜底）而非抛错。`latest_version_check_json` 本就已是 try 包裹（损坏留空待后台覆盖），保持不动。
- 与既有韧性的关系：与 §0.89 / §0.90 / §0.15 同属「单条持久化行损坏不得升级为整列读取失败」不变量；本项把它补到 gateway 侧 skills 子系统的两条用户列表经路。至此「会话级 / 消息级 / 产物级 / 技能级」四类持久化读取的损坏容错均已就绪。
- 回归证据：`services/agent-gateway/src/__tests__/routes/skills-routes.test.ts` 新增 2 用例（`/skills/installed` 含一条损坏 `manifest_json` 行时返回 200 且只跳过该行、`/skills/search` 含一条损坏 `entry_json` 缓存条目时返回 200 且只跳过该条），与既有 9 用例共 11/11 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（skills.ts + skills-routes.test.ts）ESLint 干净。

### 0.92 工作流模板列表行级 JSON 解析容错（防单条损坏模板让 /workflows/templates 整列 500）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/workflows.ts` 的 `GET /workflows/templates` 用 `rows.map(...)` 把每行的 `metadata_json` / `nodes_json` / `edges_json` 三列 `JSON.parse`，整段包在一个 try/catch 里——只要**单条**模板的某列不是合法 JSON（崩溃半写、磁盘错误、手改 DB、半截同步写入），catch 就会让**整个列表**返回 500（`工作流模板数据已损坏，暂时无法读取。`），用户**所有**工作流模板（含完好的）全部不可见。这是与 §0.89（会话存储）/ §0.90（V2 消息读模型）/ §0.91（技能列表）完全同型的「单点损坏升级为整列失败」缺口，只是这里用的是「全有或全无」的整体 try/catch，比逐行 throw 更隐蔽。
- 加固：抽出 `tryTemplateRowToView(row)`——解析失败返回 `null` 并 `console.warn`（带模板 id 便于定位）；列表经路改用 `rows.flatMap(...)` **跳过**损坏行、保留其余，并在 workflow 步骤里记录 `skipped` 计数。`PUT /workflows/templates/:id` 的单行 `metadata_json` / `nodes_json` / `edges_json` 解析**保持原样不降级**：编辑路径只触及被编辑的那一条模板，且把损坏的 nodes/edges 静默降级为 `[]` 会是破坏性的（等于清空用户的工作流），宁可让该条编辑显式失败也不静默吞掉。删除原本只在整体 catch 里用到、现已无引用的 `templateCorrupted` 文案。
- 与既有韧性的关系：与 §0.89 / §0.90 / §0.91 / §0.15 同属「单条持久化行损坏不得升级为整列读取失败」不变量；本项把它补到 gateway 侧 workflow 模板列表这条用户经路。至此「会话级 / 消息级 / 产物级 / 技能级 / 工作流模板级」五类持久化列表读取的损坏容错均已就绪。
- 回归证据：`services/agent-gateway/src/__tests__/routes/workflow-routes.test.ts` 把原「模板 JSON 损坏返回 500」用例改写为「跳过 JSON 损坏的单条模板而不是整列 500」（seed 一条完好 + 一条 `metadata_json` 损坏，断言 200 且结果含完好模板、不含损坏模板），与既有 PATCH 404 / DELETE 跨用户 404 共 3/3 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（workflows.ts + workflow-routes.test.ts）ESLint 干净。

### 0.93 共享会话未应答提问列表行级 JSON 解析容错（防单条损坏 questions_json 让 /sessions/shared-with-me/:id 整列 500）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/session-shared-read-routes.ts` 的 `mapQuestionRequestRow` 直接 `JSON.parse(row.questions_json)` 且无容错，被 `listSharedPendingQuestionRequests` 经 `.map(mapQuestionRequestRow)` 用于共享会话详情（`GET /sessions/shared-with-me/:sessionId` 的 `pendingQuestions`）。只要**单条**未应答提问的 `questions_json` 不是合法 JSON（崩溃半写、磁盘错误、手改 DB），整列就会抛错 500，协作者看不到该会话的**任何**待办提问与详情。尤为不对称的是：同文件、同经路的兄弟函数 `mapPermissionRequestRow`（权限请求列表）**已经**用 `flatMap` + null 跳过损坏行，唯独提问列表漏了这层保护。与 §0.89（会话存储）/ §0.90（V2 消息读模型）/ §0.91（技能列表）/ §0.92（工作流模板列表）完全同型的「单点损坏升级为整列失败」缺口。
- 加固：`mapQuestionRequestRow` 改为先 try 解析 `questions_json`，失败即 `console.warn` 并返回 `null`（与兄弟 `mapPermissionRequestRow` 的签名/语义对齐）；`listSharedPendingQuestionRequests` 由 `.map(...)` 改为 `.flatMap(...)` 跳过返回 `null` 的损坏行、保留其余。单条提问应答经路（`/questions/reply` 内的 `JSON.parse(questionRequest.questions_json)`）只作用于用户正在应答的那一条，且其 `parseQuestionResumePayload` 已是 try 包裹，保持不变（损坏即不恢复，显式失败比静默改写更安全）。
- 与既有韧性的关系：与 §0.89/§0.90/§0.91/§0.92/§0.15 同属「单条持久化行损坏不得升级为整列读取失败」不变量；本项补齐了 gateway 共享会话只读经路里与已保护的权限列表并列、却被遗漏的提问列表。至此「会话级 / 消息级 / 产物级 / 技能级 / 工作流模板级 / 共享提问级」六类持久化列表读取的损坏容错均已就绪，且同经路的权限/提问两条列表对称保护。
- 回归证据：`services/agent-gateway/src/__tests__/session/session-shared-read-routes.test.ts` 新增 1 用例（详情经路含一条损坏 `questions_json` + 一条正常提问时返回 200 且 `pendingQuestions` 只含正常项、跳过损坏项），与既有 5 用例共 6/6 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（session-shared-read-routes.ts + session-shared-read-routes.test.ts）ESLint 干净。

### 0.94 session_list 工具行级运行时协调容错（防单个会话 reconcile 抛错让整张会话列表失败）（2026-05-30 续）

- 问题：`services/agent-gateway/src/session/session-manager-tools.ts` 的 `runSessionListTool`（LLM 可调用的 `session_list` 工具）用 `Promise.all(limited.map(...))` 为每个会话拼一行，行内 `await loadSessionRuntimeStatus(...)` → `reconcileSessionRuntime`（内部做 DB 写 + `reconcileResumedTaskChildSession` → `taskManager.loadOrCreate` / `finalizeChildTaskRun`，均可能抛错）。`Promise.all` 无 per-row try/catch：**任意一个**会话的运行时协调抛错（损坏的 task 元数据、并发写竞争、子任务终结失败等）都会让整个 `Promise.all` reject，使 `session_list` 工具整体失败、agent 看到空列表——一个坏会话连累用户的**全部**会话不可列。与批处理版 `reconcileAllSessionRuntimes`（per-candidate try/catch 收集 `failedSessionIds`）形成非对称：批处理有韧性，工具路径没有。
- 加固：把行构造包进 per-row try/catch。正常路径不变（真实 message count + 协调后的 `runtime.status`）；协调或消息读取抛错时降级该行——message count 显示 `?`、status 回退到持久化的 `session.state_status` 列（一定可读，无需再查运行时），并 `console.warn` 记录被降级的 sessionId。这样单个坏会话只丢自己的实时状态、其余照常列出，与 `reconcileAllSessionRuntimes` 的「收集失败项而非整体中断」语义对齐。单会话工具 `runSessionInfoTool` 不在此列：它只作用于一个会话，抛错仅影响该次调用、无列表级放大，保持显式失败。
- 与既有韧性的关系：前序 §0.89-§0.93 收口的是「单条持久化行 JSON 损坏不得让整列读取失败」（数据解析层）；本项把同一「单点失败不得升级为整列失败」不变量补到 `Promise.all` 批量**运行时协调**这一层（执行层），并修正了与批处理 reconciler 之间的韧性非对称。与 §0.12（DAG 失败传播）、§0.72（进程级兜底）同属「单点失败隔离」族。
- 回归证据：新增 `services/agent-gateway/src/__tests__/session/session-list-tool-resilience.test.ts`（2 用例：单会话 reconcile 抛错时工具仍 resolve、该行降级为 `| ? |` + 持久 `state_status` 且 `console.warn` 被调用；协调正常时返回真实 message count + 协调后的 status）共 2/2 通过（连跑 3 次稳定）。`@openAwork/agent-gateway typecheck` 通过；改动文件（session-manager-tools.ts + 新测试）ESLint 干净。

### 0.95 快照树 preview/restore 文件读取行级容错（防单个不可读文件让整批 Promise.all 失败或恢复后审计 500）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/snapshot-tree-routes.ts` 的模块内 `readWorkspaceFile` 在遇到非 `ENOENT` 的 fs 错误（`EACCES` / `EISDIR` / `EIO` / `ELOOP` 等）时会 `throw`。该函数被三个恢复路由（`/restore/to-tree`、`/restore/cherry-pick`、跨会话 restore）的 9 处 `Promise.all(targetFiles.map(...))` 调用，用于 preview 阶段算 diff、apply 阶段读 before/after 状态写审计。`Promise.all` 语义下**任意一个**文件不可读就会 reject 整批：preview 模式下整个多文件预览失败（用户看不到任何 diff）；更糟的是 apply 模式下 `restoreSelective` **已经把文件恢复落盘**之后，after-state 读取若抛错会让整个请求 500，让调用方误以为恢复失败而重试，而实际工作区已被改写。这些读取只服务 diff/审计展示，git 恢复本身（`restoreSelective`）并不依赖它们。
- 加固：在唯一收敛点 `readWorkspaceFile` 把非 ENOENT 错误也降级为「文件缺失」（`{ content: '', exists: false }`，与 ENOENT 同形）并 `console.warn` 记录 errno 与路径，而非 `throw`。这样单个不可读文件只让自己那行 diff 退化为「空内容/缺失」，不再 reject 整批——preview 仍返回其余文件、apply 的 after-state 审计不再在恢复已落盘后翻车。路径校验失败（`validateWorkspacePath` 返回空）本就已返回缺失态，保持不变；真正的恢复失败仍由 `restoreSelective` 的独立 try/catch 上报 `restore_failed`。
- 与既有韧性的关系：与 §0.94（`session_list` 工具 per-row 容错）同属「`Promise.all` 批量执行中单点失败不得升级为整批失败」不变量，这次补到快照恢复的文件读取批上；且额外消除了「副作用已发生后才在只读审计阶段抛错」这一更危险的形态。与 §0.89-§0.93（数据解析层行级容错）合起来覆盖了「解析层 + 执行层」两类单点失败隔离。
- 回归证据：在既有 `services/agent-gateway/src/__tests__/routes/snapshot-tree-routes.test.ts` 的 `node:fs` mock 上加 per-path errno 注入缝，新增 1 用例（preview 时 `locked.ts` 以 `EACCES` 抛错，请求仍 200、两个文件都在结果里、坏文件 `currentExists=false`、不触发 `restoreSelective`），与既有 17 用例共 18/18 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（snapshot-tree-routes.ts + 测试）ESLint 干净。

### 0.96 /sessions HTTP 响应行级运行时协调 + 恢复提问列表容错（防单个会话 reconcile 抛错或损坏 questions_json 让整张会话/恢复响应 500）（2026-05-30 续）

- 问题（两处，同一 `services/agent-gateway/src/routes/sessions.ts`）：
  1. `reconcileSessionRuntimeForResponse` 经 `reconcileSessionRuntimeRowsForResponse` 的 `Promise.all(sessions.map(...))` 被 **8 条路由**复用（含主 `GET /sessions` 列表、descendants、删除前快照、recovery 等）。行内 `reconcileSessionRuntime` 做 DB 写 + `finalizeChildTaskRun`，可能抛错；`Promise.all` 无 per-row 容错，单个会话协调失败即整批 reject、整张会话/恢复响应 500。这是 §0.94（`session_list` 工具）的 **HTTP API 孪生**——同一执行层缺口，只是出口换成 REST。
  2. `mapRecoveryQuestionRequestRow` 直接 `JSON.parse(row.questions_json)` 无容错，经 `listRecoveryQuestionRequests` 的 `.map(...)` 被 recovery / status 读模型复用——单条损坏 `questions_json` 即让整张恢复响应 500（§0.89-§0.93 持久化行损坏类）。
- 加固：
  1. `reconcileSessionRuntimeForResponse` 把 `reconcileSessionRuntime` 调用包进 try/catch，抛错时沿用已加载的持久行（其 `state_status`）+ `console.warn`，与批处理版 `reconcileAllSessionRuntimes`「收集失败项而非整体中断」对齐。改一处函数体即覆盖全部 8 条调用路由。
  2. `mapRecoveryQuestionRequestRow` 解析失败返回 `null` + `console.warn`，调用点改 `flatMap` 跳过损坏行。
- 与既有韧性的关系：把 §0.94（LLM 工具路径的运行时协调隔离）补到 `/sessions` REST 出口；把 §0.93（共享会话提问列表行级容错）补到 recovery/status 读模型的恢复提问列表。两类缺口（执行层 `Promise.all` 单点失败、数据层单行 JSON 损坏）在用户最高频的会话列表/恢复路径上一并收口。
- 回归证据：`services/agent-gateway/src/__tests__/routes/sessions-error-routes.test.ts` 新增 1 用例（`GET /sessions/:id/recovery` 在一条 `questions_json` 损坏时返回 200 且只跳过损坏项），与既有 9 用例共 10/10 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（sessions.ts + sessions-error-routes.test.ts）ESLint 干净。

### 0.97 团队运行时任务投影行级容错（防单个会话任务图加载抛错让整张团队运行时面板 500）（2026-05-30 续）

- 问题：`services/agent-gateway/src/routes/team.ts` 的两条团队运行时面板路由——`GET /team/workspaces/:teamWorkspaceId/runtime`（经 `buildWorkspaceRuntimeTaskGroups`）与 `GET /team/runtime`（内联 `runtimeTaskGroupsPromise`）——都用 `Promise.all(sessions.map(...))` 为每个会话调用 `buildMergedSessionTaskProjection`，而后者内部 `taskManager.loadOrCreate` 从磁盘读任务图，硬 I/O 错误（EACCES/EIO/损坏目录等，非 ENOENT/损坏 JSON 那两类已被 `load` 降级）会抛出。`Promise.all` 无 per-session try/catch：任意一个会话的任务图加载抛错都会 reject 整批，使整张团队运行时面板（成员、消息、handoff、诊断全都在同一响应里）500——一个坏会话连累整个团队工作台不可用。与 §0.94（session_list 工具）/§0.96（/sessions HTTP）同属「`Promise.all` 批量执行层单点失败拖垮整批」缺口。
- 加固：两处 per-session 回调各包一层 try/catch，`buildMergedSessionTaskProjection` 抛错时降级该会话为空任务组（`{ sessionIds:[id], tasks:[], updatedAt:0, workspacePath }`）+ `console.warn`，其余会话照常投影。面板其余区块（sessions 行、members、handoffs 等）本就不依赖任务投影，故坏会话只丢自己的任务组、整张面板仍可用。`sessions.ts` 内对 `buildMergedSessionTaskProjection` 的单次调用（会话详情/状态读模型）不在此列：单会话路由抛错只影响该次请求、无批量放大，保持显式失败。
- 与既有韧性的关系：与 §0.94（LLM session_list 工具）/§0.95（快照恢复文件读取）/§0.96（/sessions HTTP 响应）同属「单点失败不得升级为整批失败」不变量（执行层）；本项把它补到团队运行时面板这条多会话聚合路径。至此该不变量覆盖 LLM 工具、快照恢复、会话 HTTP API、团队运行时面板四类 `Promise.all` 批量路径。
- 回归证据：新增 `services/agent-gateway/src/__tests__/team/team-runtime-task-projection-resilience.test.ts`（1 用例：partial-mock `./sessions.js` 使某「投毒」会话的 `buildMergedSessionTaskProjection` 抛错，断言 `GET /team/workspaces/:id/runtime` 仍 200、两个会话都在 `sessions` 列表、`runtimeTaskGroups` 仍返回、`console.warn` 被调用）通过；既有 `team-runtime-routes`（20 用例）回归通过。`@openAwork/agent-gateway typecheck` 通过；本轮改动文件（team.ts 的两处 try/catch + 新测试）ESLint 干净（team.ts 顶部另有用户在制的未使用 import 报 2 处 lint，与本改动无关、属既有未完成工作，未触碰）。

### 0.98 batch 工具子调用执行行级容错（防单个子工具抛错让整批 Promise.all reject、丢失其余结果）（2026-05-31 续）

- 问题：`services/agent-gateway/src/tools/tool-sandbox.ts` 的 `batch` 工具用 `Promise.all(selectedToolCalls.map(async ... => sandbox.execute(subRequest, ...)))` 并行执行 N 个子工具调用。`sandbox.execute` 是一个庞大的递归分派器，在最终 `registry.execute` 的 try/catch **之前**就有多处抛错面：权限检查、`transitionToolToRunning`（写 message_v2 投影，DB 写可抛）、内联的 edit/multiEdit/skill 分支等。子调用回调里只对返回的 `{isError:true}` 做了处理，却没有 try/catch 包裹 `await sandbox.execute(...)` 本身——任意一个子工具在这些前置阶段**抛错**（而非返回错误结果），整个 `Promise.all` 就会 reject，使 `batch` 工具整体失败、其余已成功/未完成的子调用结果全部丢失。这恰好摧毁 batch 工具「聚合 N 个结果」的根本语义，与 §0.94-§0.97 同属执行层「单点失败拖垮整批」。
- 加固：把 `await sandbox.execute(...)` 包进 per-sub-call try/catch。抛错时降级为该 index 的错误结果（`status:'error'`、`isError:true`、`output` 记录 `threw: <message>`）、更新 `subToolStates[index]` 并照常 `onProgress` 推进、`console.warn` 记录，然后 `return` 错误结果而非让异常冒泡。这样单个子工具抛错只占据自己那一格，其余子工具照常完成、整批照常返回（`isError` 聚合为 true 但不 reject），与 batch 既有的「无效条目 / 禁用工具 / 超额丢弃」错误格保持同构。
- 与既有韧性的关系：§0.94（session_list 工具）、§0.95（快照恢复文件读取）、§0.96（/sessions HTTP 响应行级协调）、§0.97（团队运行时任务投影）收口的都是「批处理中单点失败不得拖垮整批」；本项把同一不变量补到 LLM 最常用的 `batch` 并行工具自身的子调用层——这是该不变量在工具执行链上的最内层。
- 回归证据：新增 `services/agent-gateway/src/__tests__/tools/batch-tool-resilience.test.ts`（1 用例：mock `transitionToolToRunning` 让 index-0 子调用在 execute 中途抛错，断言 batch 仍返回 `total=2`、index-0 降级为含 `threw` 的错误结果、index-1 正常完成、整批 `isError=true` 但未 reject、好的子工具确实执行）通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（tool-sandbox.ts + 新测试）ESLint 干净。

### 0.99 会话快照恢复预览文件读取行级容错（防单个不可读文件让整批 Promise.all 失败、但 apply 路径保持 fail-fast 不丢备份）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/sessions.ts` 的 `readWorkspaceContentForPreview` 对非 ENOENT 读错误（EACCES/EISDIR/EIO/ELOOP）会 re-throw。它在 `buildSnapshotRestorePreviewState` 的 `Promise.all(snapshot.files.map(...))` 里被逐文件调用（`POST /sessions/:id/restore/preview` validate-only 预览返回 diff/hash 校验）。单个不可读文件即 reject 整批、500 整张恢复预览——与 §0.95（快照树预览）同型，但在 sessions.ts 这条独立的会话级恢复路径上。
- 关键差异（为何不能照搬 §0.95 无条件降级）：同一对 preview builder（`buildSnapshotRestorePreviewState` / `buildBackupRestorePreviewState`）既被 validate-only 预览路由调用，也被 `restore/apply` 写入路由调用。在 apply 路径里，`readWorkspaceContentForPreview` 读到的 `currentContent` 会喂给 before-write 备份（`captureBeforeWriteBackup` 仅在 `currentExists` 时触发）。若在 apply 路径把「不可读但存在」的文件静默当作「缺失」，会跳过备份直接用快照 `targetContent` 覆盖它——丢失可回滚备份，是真实的数据安全回退。
- 加固：给 `readWorkspaceContentForPreview` 加 `tolerateUnreadable?: boolean`，并经两个 builder 透传。仅在两个 validate-only 预览路由调用处置 `tolerateUnreadable: true`（不可读降级为「缺失」+ `console.warn`，`validPath` 仍为真，`canRestore` 不受影响——它本就只看 `validPath`/路径合法性）；`restore/apply` 路由的 builder 调用保持默认 `false`（fail-fast，宁可显式报错也不无备份覆盖）。preview 与 apply 共用 builder 但容错语义按路由分流。
- 与既有韧性的关系：与 §0.95（快照树 preview/restore 文件读取容错）同型，把「单个不可读文件不得让整批预览 500」补到会话级快照恢复预览；同时通过 apply 路径的 fail-fast 显式保留了「写入前必须有备份」这一更强的数据安全不变量，是对 §0.95 同类修复的安全细化（preview 容错、apply 不容错）。
- 回归证据：`services/agent-gateway/src/__tests__/routes/sessions-error-routes.test.ts` 新增 1 用例（快照含一个正常文件 + 一个路径处为目录的文件 → 读取 EISDIR，`POST /restore/preview` 返回 200、`fileCount=2`、不可读文件降级为缺失而非整列 500），与既有 10 用例共 11/11 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（sessions.ts + sessions-error-routes.test.ts）ESLint 干净。

### 0.100 handoff watcher 派发循环行级容错（防单条 handoff 派发抛错中断整轮扫描、饿死队列其余 pending）（2026-05-31 续）

- 问题：`services/agent-gateway/src/handoff/runner/watcher.ts` 的 `tickOnce` 是团队五层链路（a→b→c→pm1→pm2）的核心派发循环：`for (const record of pending)` 逐条 `claimHandoff` → `resolveMemberModelForHandoff` / `resolveMemberSystemPrompt` / `resolveMemberCapabilities` → `createTeamSession` → `startHandoff` → `scheduleHandoffTask`。循环体**没有 per-record try/catch**。`claimHandoff` 成功后，后续任一步抛错（损坏 payload、JSON 解析、子 session 创建时 SQLite 错误等）都会冒泡出整个 `for`，**中断本轮扫描**——队列里其余 pending handoff 全部得不到处理（饿死），且刚被 claim 的这条停在 `claimed` 态、要等 recovery tick 超时回收才会重试。timer 回调本身已被 §（watcher-timer-isolation）隔离不会变成 unhandled rejection，但"单条毒丸饿死整队"这一层没有覆盖。与 §0.94（session_list）/§0.98（batch 工具）同属执行层「单点失败拖垮整批」，但落在团队主派发链路上、影响面最大。
- 加固：把循环体整体包进 per-record try/catch。`claimHandoff` 返回 falsy（已被别处抢占）或 `startHandoff` 失败仍走原有 `skipped += 1; continue` 语义；新增的 catch 捕获派发过程中的**抛错**，`skipped += 1` 并 `console.error` 记录该 handoff id，然后继续扫描下一条。被 claim 后抛错的记录会停在 `claimed`/`running` 态，由 recovery tick（`reclaimAbandonedHandoffs`，按心跳超时回收并按 maxRetry 重试/置 failed）兜底重新 pending，不会静默丢失。`reconcilePendingPm2QualityReviews` 仍在循环外照常执行。
- 与既有韧性的关系：§0.94/§0.97/§0.98/§0.99 把「单点失败隔离」补到 session_list 工具、团队运行时面板、batch 工具、快照恢复预览；本项把它补到团队**派发循环**——核心链路 a→b→c→pm1→pm2 的引擎。与 recovery tick 的崩溃恢复语义对齐（claimed/running 超时回收），形成「派发时跳过坏条 + 恢复时回收重试」的闭环。
- 回归证据：`services/agent-gateway/src/__tests__/handoff/handoff-watcher.test.ts` 新增 1 用例（partial-mock `createTeamSession` 让某个毒丸 handoff 的子 session 创建抛错；断言 `tickOnce` 不 reject、两条健康 handoff 仍 claim 到 `running`、毒丸条被 skip 且未进入 `running`），与既有 13 用例共 14/14 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（watcher.ts + handoff-watcher.test.ts）ESLint 干净。

### 0.101 handoff watcher pm2 评审协调 + 恢复事件循环行级容错（防单条 pm2 评审或单条恢复记录抛错中断整轮 tick）（2026-05-31 续）

- 问题：`services/agent-gateway/src/handoff/runner/watcher.ts` 里两处 per-record 循环仍缺隔离。其一 `reconcilePendingPm2QualityReviews`（在 `tickOnce` 末尾调用）逐条 `await reconcilePm2QualityReview(...)`，而该函数自身的顶层 catch 处理器还会做 `markPm2QualityReviewRetryableFailure` / `sqliteGet` / 审计写入等可能再抛错的工作——即它**会 reject**。循环无 per-candidate try/catch：一条 pm2 评审协调抛错就会中断整轮 pm2 评审扫描，饿死其余 running pm2，并因为它在 `tickOnce` 尾部、直接让整个 tick reject。其二 `recoveryTick` 的两个 per-id 循环（`reclaimedIds` / `failedIds`）逐条 `getHandoffById` + 发事件 / 记 incident，单条读取或发布抛错就会跳过其余记录的事件/incident 发射（reclaim/fail 状态本身已由 `reclaimAbandonedHandoffs` 原子提交，故仅是通知缺失，但仍违反 per-record 隔离不变量）。
- 加固：`reconcilePendingPm2QualityReviews` 每个 candidate 包 try/catch，抛错时 `console.error` 跳过该条继续本轮；`recoveryTick` 两个循环各包 per-id try/catch，单条失败只丢自己的事件/incident、不连累其余。三处都让"单条坏记录"无法升级为"整轮中断"。
- 与既有韧性的关系：紧接 §0.100（同文件 `tickOnce` 派发循环 per-record 隔离）把同一不变量补齐到 watcher 的另外两条 per-record 循环；至此 handoff watcher 的派发 / pm2 评审协调 / 崩溃恢复三条循环全部 per-record 隔离。与 §0.94–§0.100 同属执行层「单点失败不得拖垮整批」族。
- 回归证据：新增 `services/agent-gateway/src/__tests__/handoff/watcher-pm2-review-resilience.test.ts`（partial-mock `reconcilePm2QualityReview` 让一条 poison pm2 handoff 抛错、另一条正常，断言 `tickOnce` 仍 resolve 且两条 pm2 都被访问到）共 1/1 通过；既有 `handoff-watcher.test.ts` 14 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（watcher.ts + 新测试）ESLint 干净。

### 0.102 启动期默认工作流模板播种行级容错（防单个用户播种抛错跳过其余用户、甚至中断网关启动）（2026-05-31 续）

- 问题：`services/agent-gateway/src/runtime/default-workflow-templates.ts` 的 `ensureDefaultWorkflowTemplatesForAllUsers` 查出全部用户后，逐个 `ensureDefaultWorkflowTemplates(user.id)`（内部对每个 seed 做 `INSERT` / `UPDATE`）。这个循环没有 per-user try/catch：单个用户的写入抛错（约束冲突、已存在的损坏行、磁盘错误）会跳过其后**所有**用户的默认模板播种。更严重的是，它在 `services/agent-gateway/src/index.ts` 的 `gateway.seed-default-workflow-templates` 启动步骤里被**裸调用**（不像相邻的 reconcile / watcher 步骤那样包了 step 级 try/catch），所以一次播种抛错会直接**中断整个网关启动**、锁死全部用户。
- 加固：双层修复。其一 `ensureDefaultWorkflowTemplatesForAllUsers` 给每个用户包 try/catch，抛错时 `console.warn` 跳过该用户、继续为其余用户播种。其二 `index.ts` 启动步骤补上 step 级 try/catch（与相邻步骤一致），即便外层 `SELECT id FROM users` 这类查询抛错也只 `bootLogger.fail` 并继续启动，而非让整个 boot 崩溃。
- 与既有韧性的关系：把「单点失败不得拖垮整批」从运行时循环（§0.94–§0.101）延伸到**启动期** for-each 播种，并补齐了启动序列里这一步缺失的 step 级兜底（与同文件其余 boot step 的 try/catch 约定对齐）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/runtime/default-workflow-templates-resilience.test.ts`（mock `db.js`，让 poison 用户的 `sqliteRun` 抛错、healthy 用户正常，断言函数不抛出、healthy 用户仍被播种、poison 用户被跳过且 `console.warn` 被调用）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（default-workflow-templates.ts + index.ts + 新测试）ESLint 干净。

### 0.103 安装技能版本检查后台扫描行级容错（防单个技能写入抛错让整轮 Promise.all reject、饿死其余技能）（2026-05-31 续）

- 问题：`services/agent-gateway/src/skill/skill-update-checker.ts` 的 `checkInstalledSkillUpdates`（启动后 30min 起、由 background scheduler 周期触发）把每个 GitHub 安装技能的版本探测交给 `pMapConcurrent`，而其 runner 是 `results[i] = await worker(...)`、**无 per-item try/catch**。worker 末尾有一个**未保护**的 `sqliteRun(UPDATE installed_skills ...)`：一旦该写入对某条技能抛错（DB 锁、磁盘错误、约束冲突），或 `checkOneRow` 出现预期外抛错，整个 `Promise.all(runners)` 就会 reject、**中止整轮版本检查扫描**，饿死其余所有技能的刷新。`fetchTextWithTimeout` 本身已 try/catch 兜底，所以真正暴露面是写入与意外抛错。与 §0.94–§0.102「单点失败不得拖垮整批」同族，但落在**后台网络扫描**这一类。
- 加固：把 worker 整个 body 包进 try/catch——单条技能在 `checkOneRow` / 版本比较 / `sqliteRun` 任一步抛错时，`summary.errors += 1` 计入并 `console.warn`，然后继续，让本轮其余技能照常刷新。`pMapConcurrent` 的并发 runner 因此不再因单条记录而整体 reject。
- 与既有韧性的关系：把 per-record 隔离不变量补到「后台周期网络扫描」这一类（§0.94 工具列表 / §0.95 快照树 / §0.96 会话 HTTP / §0.97 团队面板 / §0.98 batch / §0.99 快照恢复预览 / §0.100 派发循环 / §0.101 pm2 评审+恢复 / §0.102 启动播种之后）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/skill/skill-update-checker-resilience.test.ts`（mock `db.js`，让 poison 技能的 `UPDATE` 抛错、healthy 技能正常，断言扫描不 reject、healthy 技能仍被写入、错误被计数）共 1/1 通过；既有 `skill-update-checker.test.ts` 11 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（skill-update-checker.ts + 新测试）ESLint 干净。

### 0.104 自动抽取记忆 upsert 行级写入容错（防单个候选写入抛错中断其余候选、并修正回传计数虚报）（2026-05-31 续）

- 问题：`services/agent-gateway/src/memory/memory-store.ts` 的 `upsertExtractedMemories` 把去重后的候选分成 `toCreate` / `toUpdate` 两个数组，分别逐条 `createMemory` / `updateMemory`（都是**未保护**的 `sqliteRun` 写入）。两个循环都没有 per-candidate try/catch：单条候选写入抛错（DB 锁、磁盘错误、约束冲突）会中断其后所有候选的落库。更糟的是函数 `return { created: result.toCreate.length, updated: result.toUpdate.length, ... }` 用的是**计划数组长度**而非实际成功数——即便外层（stream/inbound 完成钩子已 try/catch）吞掉异常，回传给前端 `/memories/extract` 与抽取日志的 `created`/`updated` 也会**虚报**从未发生的写入。调用方（`memory-runtime.ts`、`routes/memories.ts`）都消费这两个计数。
- 加固：两个循环各包 per-candidate try/catch，用独立累加器 `created` / `updated` 只在**实际写入成功**后自增，失败时 `console.warn` 跳过该条；`return` 改用真实累加值。这样单条坏候选既不饿死其余候选，也不会让回传计数虚高。
- 与既有韧性的关系：把 per-record 隔离不变量补到「自动抽取记忆落库」这一写入批处理（§0.94–§0.103 之后），并额外修正了「计数应反映实际成功而非计划数」这一正确性问题。
- 回归证据：新增 `services/agent-gateway/src/__tests__/memory/upsert-extracted-memories-resilience.test.ts`（mock `db.js`，让 poison key 的 INSERT 抛错、其余正常，断言函数不抛出、healthy 候选仍写入、`created` 只计实际成功数 2 而非计划数 3）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（memory-store.ts + 新测试）ESLint 干净。

### 0.105 启动期默认技能播种 + 系统技能同步的 per-user 行级容错（防单用户写入抛错饿死其余用户、甚至中断网关启动）（2026-05-31 续）

- 问题：技能侧有两处 boot-time per-user 批处理与 §0.102（默认工作流模板）同型缺口。其一 `services/agent-gateway/src/skill/default-skills.ts` 的 `ensureDefaultInstalledSkillsForAllUsers` 遍历全部用户、逐个 `ensureDefaultInstalledSkills`（内部对每个内置技能做未保护 `sqliteRun`），循环无 per-user try/catch；且它在 `index.ts` 的 `gateway.seed-default-skills` 步骤里**裸调用**（无 step 级兜底），单用户写入抛错既会跳过其后所有用户、又会中断网关启动。其二 `services/agent-gateway/src/skill/system-skills.ts` 的 `syncSystemSkillsForAllUsers` 同样遍历用户、逐个 `syncSystemSkillsForUser`（DELETE/INSERT/UPDATE + 一次 existing-rows SELECT，均可能抛错），循环亦无 per-user 隔离；它在 boot **以及** background scheduler 周期任务两条路径上运行，单用户失败会饿死其余用户的系统技能同步。
- 加固：两个 for-each-user 循环各包 per-user try/catch，单用户抛错时 `console.warn` 跳过、继续其余用户；`syncSystemSkillsForAllUsers` 的聚合计数只累加成功用户、保持诚实。`index.ts` 的 `gateway.seed-default-skills` 步骤补上 step 级 try/catch（与相邻 `gateway.sync-system-skills` 步骤一致），即便外层 `SELECT id FROM users` 抛错也只 `bootLogger.fail` 并继续启动。
- 与既有韧性的关系：把 §0.102 确立的「启动期 per-user for-each 不得因单点失败而整体中断 / 中断 boot」不变量补齐到技能侧两处同型批处理（默认技能播种 + 系统技能同步），同时覆盖了后者的 background scheduler 周期路径。
- 回归证据：新增 `services/agent-gateway/src/__tests__/skill/default-skills-resilience.test.ts`（mock `db.js`，poison 用户写入抛错，断言 healthy 用户仍被播种、函数不抛出）与 `services/agent-gateway/src/__tests__/skill/system-skills-sync-resilience.test.ts`（poison 用户 existing-rows 查询抛错，断言 healthy 用户仍被同步、聚合计数诚实、不 reject）各 1/1 通过；既有 `system-skills.test.ts` 5 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（default-skills.ts + system-skills.ts + index.ts + 两个新测试）ESLint 干净。

### 0.106 命令循环状态文件清理 best-effort 化（防单个状态文件删除抛错中断循环 finalization、让会话卡在 running）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/command-loop-runtime.ts` 的 `clearPersistedLoopState` 在循环 finalization 中途被调用——紧接其后就是改写 session metadata 清除 active-loop 标记。它先删 per-session 状态文件、再删 legacy 状态文件，全部用未保护的 `unlinkSync`。一旦某个状态文件 `unlinkSync` 抛错（陈旧文件上的 EACCES / EBUSY / EPERM / EISDIR），就会中断 finalization 的其余步骤——既漏删其余（本可删除的）状态文件，又跳过后续清除 active-loop 标记的 metadata 写入，**让会话永远卡在「循环运行中」**。状态文件清理本是 advisory（陈旧文件会在下次运行时被重新检测 / 覆盖），不该让一次删除失败升级为 finalization 中断。
- 加固：抽出 `safeUnlinkLoopStateFile`（`existsSync` + `unlinkSync` 包 try/catch，失败 `console.warn` 跳过），`clearPersistedLoopState` 与 `clearLegacyLoopStateFiles` 的所有删除点改用它。单个文件删不掉只丢自己、循环与 finalization 继续推进。
- 与既有韧性的关系：与 §0.94–§0.105「单点失败不得拖垮整批」同族，但落在「best-effort 清理副作用不得中断主流程 finalization」这一类（与 §0.100/§0.101 watcher finalization 的隔离思路一致）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/routes/command-loop-state-cleanup-resilience.test.ts`（把 per-session 状态路径造成一个目录使 `unlinkSync` 抛 EISDIR，断言 `clearPersistedLoopState` 不抛出、legacy 状态文件仍被清理、不可删目录被安全跳过）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（command-loop-runtime.ts + 新测试）ESLint 干净。

### 0.107 多代理 DAG 事件分发 per-subscriber 容错（防单个订阅者抛错中断其余订阅者、并冒泡进编排循环）（2026-05-31 续）

- 问题：`packages/multi-agent/src/dag.ts` 的 `DAGRunner.emit` 把一个 DAG 事件扇出给全部订阅者，原实现 `for (const h of handlers) h(event)` **无 per-handler try/catch**。单个订阅者抛错（典型：半开 SSE/WS socket 的 write 抛错，或有 bug 的 listener）既会中断对其余订阅者的投递，又会**冒泡回调用 `emit` 的编排循环**——而 `executeDAG` 内多处调用 `emit`（尤其是终态 `dag_completed`、审批门的 `node_failed`），所以一个坏订阅者足以让整轮 DAG 执行抛错。与 §0.94–§0.106「单点失败不得拖垮整批」同族，且与 LSP 诊断分发 / session run-event 分发 / team-events / mcp-catalog 已修过的 per-subscriber 隔离完全同型——`emit` 是 multi-agent 包里漏掉的最后一处。
- 加固：`emit` 对快照后的订阅者集合逐个 `h(event)` 包 try/catch，单个抛错 `console.warn` 隔离、继续投递其余；快照（`[...handlers]`）确保中途自解绑的 handler 不会移动迭代位置。
- 回归证据：新增 `packages/multi-agent/src/dag-emit-resilience.test.ts`（注册一个抛错订阅者 + 一个正常订阅者，断言 `emit` 不向调用方抛出、正常订阅者仍收到事件、warn 被调用）共 1/1 通过；既有 `orchestrator-cancel-approval` / `orchestrator-failure-propagation` 等 4 用例回归通过。`@openAwork/multi-agent typecheck` 通过；改动文件（dag.ts + 新测试）ESLint 干净。

### 0.108 渠道入站 webhook 批量派发 per-message 容错（防单条消息回调抛错跳过同批后续消息）（2026-05-31 续）

- 问题：消息渠道里 Telegram 早已确立「notify 回调抛错绝不能中断消息循环」的不变量并用 `safeNotify` 包裹，但 WhatsApp / QQ 两个渠道仍直接 `this.notify(...)`。其中 WhatsApp 的 `handleWebhookEvent` 走 `entry → changes → messages` 三层嵌套批量循环，单个 webhook 负载可携带多条消息——任一条的 notify 同步抛错（典型：下游 `notifyChannel`/订阅过滤同步抛错、或 auto-reply 入口的同步异常）会**跳过同批其后所有消息**，造成静默丢消息。QQ 虽是单事件单消息（影响较小），但同样未遵守该不变量。
- 加固：给 WhatsApp / QQ 各加 `safeNotify`（try/catch + `console.warn`），把入站消息派发点从 `this.notify` 改为 `this.safeNotify`，与 Telegram 的既有写法对齐。WhatsApp 嵌套批量循环里单条消息派发抛错只丢自己、其余消息照常投递。
- 与既有韧性的关系：把 §0.94–§0.107「单点失败不得拖垮整批」+ Telegram 长轮询既有的 `safeNotify` 不变量补齐到 WhatsApp / QQ 入站路径；至此全部消息渠道的入站派发都对回调抛错隔离。
- 回归证据：新增 `services/agent-gateway/src/__tests__/channels/whatsapp-webhook-notify-resilience.test.ts`（构造两条消息的 webhook 负载，让第一条派发抛错，断言 `handleWebhookEvent` 不抛出、第二条仍被投递、warn 被调用）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（whatsapp.ts + qq.ts + 新测试）ESLint 干净。

### 0.109 启动期陈旧终端 reconcile 的 per-row 行级容错（防单行 UPDATE 抛错饿死其余 ghost 终端、并修正回传计数虚报）（2026-05-31 续）

- 问题：`services/agent-gateway/src/session/session-terminal-registry.ts` 的 `reconcileStaleRunningTerminalsAtBoot` 在网关重启后把所有仍标记 `running` 的终端行翻成 `stale`（否则 UI 会显示上个进程残留的「幽灵终端」）。原实现对每行做**未保护**的 `sqliteRun(UPDATE ...)`，循环无 per-row try/catch：单行写入抛错（DB 锁、磁盘错误）会中断其余行的处理，让剩下的 ghost 终端永远卡在 `running`。且函数 `return rows.length` 用的是**查询到的行数**而非实际成功翻转数，调用方（boot 步骤日志 `staleCount`）会因此虚报。与 §0.104（记忆 upsert 计数虚报）同型的双重缺陷。
- 加固：per-row 包 try/catch，单行抛错 `console.warn` 跳过、继续其余行；用独立累加器 `staleCount` 只在实际 `UPDATE` 成功后自增，`return` 改用真实成功数。boot 步骤本已有 step 级 try/catch（防崩溃），本次补的是「单行失败不得饿死其余行」+「计数诚实」。
- 与既有韧性的关系：把 §0.102/§0.105 的「启动期 per-row/per-user 批处理隔离」+ §0.104 的「计数应反映实际成功」不变量补齐到终端 reconcile 这处 boot 清理。
- 回归证据：新增 `services/agent-gateway/src/__tests__/session/session-terminal-boot-reconcile-resilience.test.ts`（mock `db.js`，让中间一行的 `UPDATE` 抛错，断言函数不抛出、两侧健康行仍被翻成 stale、返回实际成功数 2 而非计划数 3）共 1/1 通过；既有 `session-terminal-registry.test.ts` 14 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（session-terminal-registry.ts + 新测试）ESLint 干净。

### 0.110 团队 pause-all / resume-all 控制信号扇出 per-handoff 容错（防单条 handoff 抛错让已提交的暂停/恢复 500、并漏发汇总事件）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/team-handoffs.ts` 的 `POST /team/sessions/:id/pause-all` 与 `resume-all` 先用 `pauseTeamRuntimeTree` / `resumeTeamRuntimeTree` **原子提交**整棵子树的暂停/恢复状态，随后再用一个 `for` 循环逐条 handoff 拉记录（`getHandoff`）并扇出控制信号（`injectControlSignal`）+ 调度器事件（`publishSchedulerControlEvent`）。这个循环没有 per-handoff try/catch：单条 handoff 的 `getHandoff`（SQLite 读）抛错会中断整个循环，**跳过其后的汇总 `scheduler.all-paused` / `all-resumed` 事件 + 审计日志 + HTTP 200 回复**——结果是一次「已经生效」的暂停/恢复反而返回 500，前端拿不到终态通知、其余 handoff 也收不到控制信号。`injectControlSignal` 自身已 try/catch、`publishTeamEvent` 也隔离监听器，所以真正裸露的throw面是循环里的 `getHandoff`。
- 加固：把两个循环的 per-handoff 循环体各包一层 try/catch，单条抛错 `console.warn` 跳过、继续其余 handoff，保证循环后的汇总事件 + 审计 + 回复一定执行。子树状态已在循环前原子提交，被跳过的 handoff 只是少一次控制信号注入（recovery / 重试路径仍可感知），绝不回滚已提交的暂停/恢复。
- 与既有韧性的关系：与 §0.94–§0.109「单点失败不得拖垮整批」同族，落在「副作用扇出循环不得让已提交的主操作 500」这一类（与 §0.101 recoveryTick 事件发射、§0.106 finalization 清理同思路）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/team/team-handoffs-pause-all-resilience.test.ts`（partial-mock handoff-store 让其中一条已暂停 handoff 的 `getHandoff` 抛错，断言 pause-all 仍返回 200、仍发出汇总 `scheduler.all-paused` 事件、健康 handoff 仍收到 `pause_signal`、子树暂停已提交）共 1/1 通过；既有 `team-handoffs-routes.test.ts` 22 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（team-handoffs.ts + 新测试）ESLint 干净。

### 0.111 技能注册源 GitHub frontmatter 抓取 per-file 容错（防单个文件 body 读取抛错丢掉整个 source 的技能目录）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/skills.ts` 的 `fetchGitHubSkills` 把某个注册源下发现的每个 `SKILL.md` 通过 `Promise.all(skillFiles.map(buildGitHubFrontmatterSkillEntry))` 并行构建成 `SkillEntry`。`buildGitHubFrontmatterSkillEntry` 的契约是「失败返回 `undefined`」（`!manifestUrl` / `!mdRes?.ok` 都走 undefined），但它在 fetch 成功 **之后** 的 `await mdRes.text()` 是**未保护**的——body 读取可能在 ok 响应后仍 reject（读到一半连接重置、chunked 传输损坏）。这一 reject 会 sink 整个 source 的 `Promise.all`，而 `fetchGitHubSkills` 外层 catch 随即把**该 source 的全部技能**当失败丢弃（退回缓存或空），只因其中一个文件的 body 读崩了。
- 加固：把 `mdRes.text()` 包进 try/catch，读取失败时按函数既有契约 `return undefined`（该文件被 `.filter(item => item !== undefined)` 自然剔除），其余文件照常构建。单个文件的网络抖动不再连累同 source 的其他技能。
- 与既有韧性的关系：与 §0.103（技能版本检查后台扫描 per-row）、§0.94–§0.110「单点失败不得拖垮整批」同族，落在「注册源目录抓取的 per-file 隔离」这一类；与 `fetchSkillText` 等既有超时护栏互补（那些防挂起，这里防单文件 reject 扩散）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/skill/github-skills-fetch-resilience.test.ts`（用 `directSkillFiles` 源直通 `buildGitHubFrontmatterSkillEntry`，mock fetch 让 poison 文件的 `text()` reject、健康文件正常 200，断言健康技能仍返回、poison 文件无条目）共 1/1 通过；既有 `skills-routes.test.ts` 11 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（skills.ts + 新测试）ESLint 干净。

### 0.112 review 聚合子 handoff payload 解析 per-child 容错（防单个损坏子 payload 让某 pm2 评审永久无法聚合）（2026-05-31 续）

- 问题：`services/agent-gateway/src/handoff/workflow/review-aggregator.ts` 的 `checkAllChildrenCompleted`（由 `pm2-quality-review-reconciler` 在**每个 watcher tick** 调用，line 133 的 `.filter` + line 192）读取 pm2 handoff 的 `dispatchedHandoffIds`、加载全部子 handoff 行，再 `children.map(...)` 映射成 `HandoffRecord`。外层 `result_json` 解析已 try/catch，但 map 内的 per-child `JSON.parse(c.payload_json || '{}')` 是**未保护**的：单个子 handoff 的 `payload_json` 损坏（崩溃半写、磁盘错误、手改 DB）会抛掉整个 `.map()`。更糟的是——即便有 §0.101 的 per-candidate tick 守卫挡住「拖垮整轮」，该 pm2 的评审仍会**永久无法聚合**（每个 reconcile 都在同一坏行上重抛），子任务全部完成却卡在 review 阶段不前进。
- 加固：抽出 `parseChildPayloadJson`（`!json → null`，`JSON.parse` 包 try/catch，失败 `console.warn` 降级为 `null`），per-child 映射改用它。单个子 payload 损坏只把该子记录的 `payload` 降级为 null，其余子记录照常映射、`allDone` 判定与 review 聚合继续推进。
- 与既有韧性的关系：与 store 层的 `parsePayload`（handoff-store / inbound-store）、§0.111（注册源 per-file）、§0.94–§0.111「单点失败不得拖垮整批」同族；补的是 review 聚合读路径上最后一处裸 per-child `JSON.parse`，与 §0.101 的 tick 级守卫互补（那个防整轮中断，这个防单个 pm2 永久卡死）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/handoff/review-aggregator-child-payload-resilience.test.ts`（in-memory DB 播种一个 pm2 handoff + 两个子 handoff，其一 `payload_json` 为非法 JSON，断言 `checkAllChildrenCompleted` 不抛出、两个子记录都返回、坏 payload 降级为 null、健康 payload 正常解析、`allDone` 为 true）共 1/1 通过；既有 `watcher-pm2-review-resilience.test.ts` 回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（review-aggregator.ts + 新测试）ESLint 干净。

### 0.113 团队运行时手动 remediation 的 quality-review-pending per-candidate 容错（防单个候选 reconcile 抛错中断整轮 + 500 手动修复接口）（2026-05-31 续）

- 问题：`services/agent-gateway/src/team/team-runtime-remediation-policy.ts` 的 `runPendingQualityReviewRemediation`（`runTeamRuntimeRemediation('quality-review-pending')` 的实现，由 `POST /team/runtime/remediate` 手动触发）逐个候选 `await reconcilePm2QualityReview(...)`，**无 per-candidate try/catch**。§0.101 已证明该函数会 **reject**（其自身 catch 里有 SQLite + 审计写，可能再抛），watcher 的镜像循环 `reconcilePendingPm2QualityReviews` 当时正是为此被包了 per-candidate 守卫；同文件的 stale-runtime 循环（line 89）也早已 per-candidate 隔离——唯独这个 pending-quality-review 循环漏了。单个候选 reconcile 抛错会中断整轮 remediation：饿死其余候选、跳过调用方 `team.ts` 的 `runtime_remediation` 审计日志、并把已生效部分结果丢掉、给前端「手动修复」按钮回 500。
- 加固：把 `reconcilePm2QualityReview` 调用包进 try/catch，抛错时把该候选计入 `failedSessionIds`（与 `applyPendingQualityReviewOutcome` 的 `'failed'` 出参一致）+ `console.warn` 跳过、`continue` 继续其余候选。整轮 remediation 始终 resolve，审计/汇总计数照常返回。
- 与既有韧性的关系：与 §0.101（watcher tick per-candidate）、§0.110（pause-all per-handoff）、§0.94–§0.112「单点失败不得拖垮整批」同族；把同一不变量补齐到手动 remediation 这条对称路径——至此 `reconcilePm2QualityReview` 的两个批量调用点（watcher 自动 tick + 手动 remediate 路由）都已 per-candidate 隔离。
- 回归证据：新增 `services/agent-gateway/src/__tests__/team/team-runtime-remediation-resilience.test.ts`（mock reconciler 让两个候选中靠前的一个 reject、另一个正常 completed，断言 `runTeamRuntimeRemediation('quality-review-pending')` 不 reject、健康候选仍被处理、poison 候选计入 `failedSessionIds`、`completedCount` 为 1、warn 被调用）共 1/1 通过；既有 `team-runtime-routes.test.ts` 20 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（team-runtime-remediation-policy.ts + 新测试）ESLint 干净。

### 0.114 已安装技能 manifest 扫描 per-row 容错（防单个损坏 manifest 让 `skill` 工具按名解析全面失效）（2026-05-31 续）

- 问题：`services/agent-gateway/src/skill/skill-tools.ts` 的 `findInstalledSkill`（由 `skill` 工具的 `execute` 调用）以 `ORDER BY updated_at DESC` 扫描该用户**全部**启用的 installed_skills，并对每行 `parseManifest(row.manifest_json)` 做**未保护**的 `JSON.parse`。单行 manifest 损坏（崩溃半写、磁盘错误、手改 DB）会抛掉整个扫描循环——而因为按最近更新倒序遍历，一条损坏 manifest 会让 `skill` 工具**对任何名字都无法解析**（不只是那条坏的），等于整个 skill 工具不可用。同文件 `findCachedSkillEntry` 的 `JSON.parse(row.entry_json)`（单行、影响较小）也是裸露的。
- 加固：新增 tolerant 的 `tryParseManifest`（`JSON.parse` 包 try/catch，失败 `console.warn` 返回 null），扫描循环改用它并 `if (!manifest) continue` 跳过坏行；`findCachedSkillEntry` 的缓存解析同样包 try/catch，损坏时降级为「无缓存命中」（调用方回退到 builtin / manifest 内容）。删除已无引用的旧 `parseManifest`。
- 与既有韧性的关系：与 store 层 `parseJsonColumn`（sqlite-session-store）、§0.111（注册源 per-file）、§0.112（review 子 payload per-child）、§0.94–§0.113「单点失败不得拖垮整批」同族；补的是 `skill` 工具读路径上两处裸 `JSON.parse`，其中 installed_skills 扫描是高爆炸半径项（一条坏行废掉整工具）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/skill/skill-tools-installed-manifest-resilience.test.ts`（mock `db.js` 让 installed_skills 查询先返回一条损坏 manifest 行、再返回健康匹配行，断言 `skill` 工具 `execute` 不抛出、仍按名解析到健康技能并渲染其内容、warn 被调用）共 1/1 通过；既有 `skill-tools-effective.test.ts` 11 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（skill-tools.ts + 新测试）ESLint 干净。

### 0.115 auxiliary LLM 配置解析 user_settings JSON 容错（防单条损坏 provider 设置抛错废掉全部团队 handoff + 短路 env 兜底）（2026-05-31 续）

- 问题：`services/agent-gateway/src/provider/auxiliary-llm-config.ts` 的 `resolveAuxiliaryLlmConfig` 读取 `user_settings` 的 `providers` 与 `active_selection` 两行后做**未保护**的 `JSON.parse`。这是 reception-orchestrator / pm1 / pm2 runner / 质量评审 reconciler / settings / workflows 共用的辅助 LLM 凭据解析入口。单行设置损坏（崩溃半写、磁盘错误、手改 DB）会直接抛出——不仅让当下调用方失败，更关键的是**短路了函数尾部的 `AI_API_*` 环境变量兜底**：一个本可用 env 凭据正常跑的用户，会仅仅因为某条存储设置损坏就再也无法发起任何团队 handoff（reception 改写 / pm1 规划 / pm2 派发 / 质量评审全断）。
- 加固：抽出 tolerant 的 `parseUserSettingValue(value, key)`（空值返回 undefined；`JSON.parse` 包 try/catch，失败 `console.warn` 后返回 undefined，与「该行未配置」语义一致），两处读取改用它。损坏行不再抛错，解析继续沿 fast → active → env 优先级链推进，env 兜底得以保留。
- 与既有韧性的关系：与 §0.114（installed_skills manifest per-row）、sqlite-session-store 的 `parseJsonColumn`、§0.94–§0.114「单点失败不得拖垮整批 / 损坏行降级而非抛错」同族；这里的特别之处是「损坏行不得短路同函数内的兜底链」——与 §0.106（清理副作用不得中断 finalization）思路一致。
- 回归证据：在既有 `services/agent-gateway/src/__tests__/provider/auxiliary-llm-config.test.ts` 新增用例（`sqliteGet` 返回 `{ value: '{not valid json' }`、无 user provider、设置 `AI_API_*` env，断言 `resolveAuxiliaryLlmConfig` 不抛出且回退到 env 凭据）；该文件 7 用例（6 既有 + 1 新）全部通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（auxiliary-llm-config.ts + 该测试）ESLint 干净。

### 0.116 provider catalog 解析 user_settings JSON 容错（防单条损坏 provider 设置抛错硬失败主聊天流的每一轮）（2026-05-31 续）

- 问题：`services/agent-gateway/src/provider/provider-catalog.ts` 的 `loadRawSettings` 读取 `user_settings` 的 `providers` 与 `active_selection` 两行后做**未保护**的 `JSON.parse`。这是 §0.115（auxiliary LLM 配置）的高爆炸半径同胞：`loadRawSettings` 喂给 `getCatalog`，而 `getCatalog` 位于**主聊天流热路径**（`stream.ts` → `getFastProvider` / `getProviderForSelection`）。单行 provider 设置损坏（崩溃半写、磁盘错误、手改 DB）会直接抛出，**硬失败该用户的每一轮聊天**（不只是团队链路）。
- 加固：抽出 tolerant 的 `parseStoredSettingValue(value, key)`（空值返回 null；`JSON.parse` 包 try/catch，失败 `console.warn` 后返回 null），两处读取改用它。损坏行降级为 null——与「该行缺失」完全同路径，`getCatalog` 随即构造一个默认 `ProviderManagerImpl()`（再 `syncFromModelsDev` 拉内置 catalog），聊天流照常推进。
- 与既有韧性的关系：与 §0.115（auxiliary LLM 配置 user_settings 容错）、§0.114（installed_skills manifest per-row）、sqlite-session-store 的 `parseJsonColumn`、§0.94–§0.115「损坏行降级而非抛错」同族；settings.ts 读 provider 行早已走 tolerant 的 `parseStoredJson`，本次补齐的是 catalog 缓存构建这条更热的读路径。
- 回归证据：新增 `services/agent-gateway/src/__tests__/provider/provider-catalog-corrupt-settings-resilience.test.ts`（mock `db.js` 让两行设置都为损坏 JSON、stub `ProviderManagerImpl` 保持离线，断言 `getCatalog` 不抛出、降级为无参默认 manager、warn 被调用）共 1/1 通过；既有 `provider-catalog-retention.test.ts` 2 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（provider-catalog.ts + 新测试）ESLint 干净。

### 0.117 settings file-patterns 读取 user_settings JSON 容错（防单条损坏行 500 掉 GET /settings/file-patterns）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/settings.ts` 的 `GET /settings/file-patterns` 读取 `user_settings` 的 `file_patterns` 行后做**未保护**的 `JSON.parse(row.value) as string[]`——这是 settings.ts 里**唯一**一处裸 `JSON.parse`（`workers` / `plugin_settings` / `mcp_servers` 等同类读取早已各自包 try/catch，文件顶部也有 tolerant 的 `parseStoredJson`）。单行 `file_patterns` 损坏（崩溃半写、磁盘错误、手改 DB）会直接抛出、500 掉该路由，且旧实现的 `as string[]` 盲转还会把非数组/含非字符串项的 payload 透传给前端。
- 加固：改用文件已有的 `parseStoredJson`（失败返回 null），再 `Array.isArray` + `filter(typeof === 'string')` 收敛为纯字符串数组。损坏行降级为空列表、非法形状被过滤，路由稳定回 200。
- 与既有韧性的关系：与 §0.115 / §0.116（user_settings provider 配置容错）、§0.114（installed_skills manifest per-row）、§0.94–§0.116「损坏行降级而非抛错」同族；这是 settings.ts 读路径上最后一处未对齐的裸 `JSON.parse`。
- 回归证据：新增 `services/agent-gateway/src/__tests__/routes/settings-file-patterns-resilience.test.ts`（① 播种损坏 `file_patterns` 行，断言 GET 返回 200 + `patterns: []` 而非 500；② 播种含非字符串项的合法数组，断言只返回字符串项）共 2/2 通过；既有 `settings-error-routes.test.ts` 4 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（settings.ts + 新测试）ESLint 干净。

### 0.118 产物（artifact）store 列表 metadata/diff 解析 per-row 容错（防单条损坏行 500 掉整份产物 / 版本历史列表）（2026-05-31 续）

- 问题：`services/agent-gateway/src/session/artifact-content-store.ts` 的 `rowToArtifactRecord` / `rowToArtifactVersionRecord` 分别对 `metadata_json` / `diff_json` 做**未保护**的 `JSON.parse`。这两个映射函数被 `listArtifactsBySession` / `listImageWorkbenchArtifacts` / `listArtifactVersions` 三处经 `rows.map(...)` 使用——单行产物的 `metadata_json` 或单个版本的 `diff_json` 损坏（崩溃半写、磁盘错误、手改 DB）会抛掉整个 `.map()`，让**整份产物列表 / 版本历史**不可读（图片工作台画廊、会话产物面板、版本对比全 500），而不只是那一条坏行。
- 加固：`parseMetadata` 损坏时降级为 `{}`（并校验解析结果是非数组对象）、`parseDiff` 损坏时降级为 `[]`（并校验为数组），均 `console.warn` 记录。坏行仍可列出（只是丢失其注解 / diff），其余行照常加载。
- 与既有韧性的关系：与 §0.117（settings file-patterns）、§0.114（installed_skills manifest per-row）、`tryTemplateRowToView`（workflows 列表）/ `mapRecoveryQuestionRequestRow`（sessions 恢复列表）等 §0.89 起的「列表型 `rows.map` 读路径单行损坏不得拖垮整份列表」同族；补的是产物 store 这两处裸 `JSON.parse`。
- 回归证据：新增 `services/agent-gateway/src/__tests__/session/artifact-content-store-resilience.test.ts`（① 播种两个产物、损坏其一的 `metadata_json`，断言 `listArtifactsBySession` 不抛出、仍返回两条、坏行 metadata 降级为 `{}`；② 产物建两版、损坏一个版本的 `diff_json`，断言 `listArtifactVersions` 不抛出、仍返回全部版本、坏行 diff 降级为 `[]`）共 2/2 通过；既有 `artifacts-routes.test.ts` 3 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（artifact-content-store.ts + 新测试）ESLint 干净。

### 0.119 capabilities 已安装技能 manifest per-row 容错（防单条损坏 manifest 让整份「已安装技能」能力目录消失）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/capabilities.ts` 的 `listCapabilitiesForUser` 用 `json_group_array(manifest_json)` 读出该用户全部启用的 installed_skills，然后在一个 IIFE 里对每条 `manifest_json` 做 `JSON.parse`。内层 per-manifest 解析裹在**外层 try** 内——单条 manifest 损坏（崩溃半写、磁盘错误、手改 DB）会让外层 catch 直接 `return []`，使该用户**整份「已安装技能」能力目录消失**（既喂给模型的 `buildCapabilityContext`，也供 `/capabilities` 路由），而不只是那条坏的。与 §0.114（`skill` 工具 `findInstalledSkill` 扫描）是同一张表上的同型缺口的另一处读路径。
- 加固：把内层 `manifests.map(...)` 改为 `flatMap` + per-row try/catch，单条 manifest 解析失败 `console.warn` 跳过（返回 `[]`），其余技能照常进入能力目录；外层 group-array 解析仍保留防御性 catch（来源是 SQLite `json_group_array`，本就恒合法）。
- 与既有韧性的关系：与 §0.114（installed_skills manifest 扫描 per-row）、§0.118（产物 store 列表 per-row）、§0.89 起的「列表型读路径单行损坏不得拖垮整份结果」同族；补齐 installed_skills 表第二处（能力目录）读路径。
- 回归证据：新增 `services/agent-gateway/src/__tests__/routes/capabilities-installed-manifest-resilience.test.ts`（in-memory DB 播种一条健康 + 一条损坏的启用 installed_skills，断言 `listCapabilitiesForUser` 不抛出、健康技能仍出现在能力目录、损坏行无描述符、warn 被调用）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（capabilities.ts + 新测试）ESLint 干净。

### 0.120 待回答问题列表 questions_json per-row 容错（防单条损坏问题行 500 掉整会话的待回答问题列表）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/questions.ts` 的 `GET /sessions/:id/questions/pending` 读出该会话全部 `status='pending'` 的 question_requests，然后 `rows.map(... JSON.parse(row.questions_json) ...)` 直接映射，**无 per-row try/catch**。单行 `questions_json` 损坏（崩溃半写、磁盘错误、手改 DB）会抛掉整个 `.map()`、500 掉该会话**整份待回答问题列表**（前端 AskUserQuestion 恢复面板一条都拿不到），而不只是那条坏行。同型缺口在姊妹读路径 `mapRecoveryQuestionRequestRow`（sessions.ts 恢复列表）、`mapQuestionRequestRow`（session-shared-read-routes.ts 共享会话）早已加固，唯独这条主列表路由漏了。
- 加固：抽出 per-row tolerant 的 `mapPendingQuestionRequestRow`（`JSON.parse(questions_json)` 包 try/catch，失败 `console.warn` 返回 null），列表路由改为 `.map(mapPendingQuestionRequestRow).filter(非 null)`。单行损坏只丢该问题、其余待回答问题照常返回。reply 路径的单行 `JSON.parse`（针对已定位的单条请求）与两处 payload 解析本就 guarded，未受影响。
- 与既有韧性的关系：与 §0.118（产物 store 列表）、§0.119（capabilities manifest）、§0.89 起的「列表型 `rows.map` 读路径单行损坏不得拖垮整份列表」完全同族；补齐 question_requests 表三处读路径里最后一处未对齐的裸 `JSON.parse`。
- 回归证据：新增 `services/agent-gateway/src/__tests__/routes/questions-pending-list-resilience.test.ts`（mock db 层让 pending 列表查询返回一条健康 + 一条 `questions_json` 损坏行，断言 GET 返回 200、只列健康问题 `q-good`、warn 被调用）共 1/1 通过；既有 `questions-reply-route.test.ts` 4 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（questions.ts + 新测试）ESLint 干净。

### 0.121 opkg CLI 网关调用墙钟超时（防 gateway 半开连接让 opkg install/remove/push 永久挂起）（2026-05-31 续）

- 问题：`services/agent-gateway/src/cli/opkg-gateway.ts` 的两处 `fetch`（`gatewayFetch` 走 install/remove，`pushSkill` 走 push 上传）**没有任何墙钟超时**。这是 gateway 包里最后一处无界网络调用——其余 `fetch` 都已带 deadline（工具执行路径走 ToolRegistry 30s 超时信号、settings 版本检查 `AbortSignal.timeout(5000)`、channel-http / skill 抓取 / addUrl 各自带超时；image-generation 刻意不加隐式超时是其既定的长任务设计且有测试钉死）。gateway 若半开 / 挂起，`opkg install` / `remove` / `push` 会无限期卡住，永不返回。
- 加固：新增 `resolveTimeoutMs`（读 `OPKG_REQUEST_TIMEOUT_MS` / `OPKG_PUSH_TIMEOUT_MS` env，缺省 30s / 120s，非正值=显式关闭）+ `timeoutSignal`（`AbortSignal.timeout`），两处 `fetch` 各带 deadline；`describeFetchError` 把 `TimeoutError` 翻成清晰的「opkg ... timed out」错误而非裸 abort。push 因要上传技能包给更长的 120s 默认值。
- 与既有韧性的关系：与 §0.x 系列「上游 / 网络调用必须有墙钟超时，半开连接不得无限期占用」同族（workflow-llm 60s、context addUrl、mcp-oauth、settings 版本检查等）；补齐 gateway 包里最后一处裸 `fetch`。
- 回归证据：新增 `services/agent-gateway/src/__tests__/cli/opkg-gateway-timeout.test.ts`（`OPKG_REQUEST_TIMEOUT_MS=50`、mock fetch 挂起直到自身超时信号 abort 并按 `TimeoutError` reject，断言 `installSkill` 以 `/timed out/` 报错）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（opkg-gateway.ts + 新测试）ESLint 干净。

### 0.122 repo_clone git 子进程超时/中断的 SIGKILL 升级（防网络 pack 拉取卡死时 git 忽略 SIGTERM 永久挂起）（2026-05-31 续）

- 问题：`services/agent-gateway/src/tools/repo-clone-tools.ts` 的 `defaultGitRunner`（`repo_clone` 工具的实际 git 执行器）在超时 / abort 时**只发 SIGTERM**。SIGTERM 只是请求——一个卡在网络 pack 协商里的 `git clone`（或不把信号转发给 `git-remote-https` 子进程的 git）可以忽略它继续阻塞，使 promise 越过 deadline 仍 pending，整个工具执行窗口被该 clone 卡死。姊妹 `shadow-git-store.ts` 早已在超时用 SIGKILL，`bash-tools` 也确立了「SIGTERM → 宽限期 → SIGKILL」不变量，唯独这条 git 执行器只停在 SIGTERM。
- 加固：新增 `SIGKILL_GRACE_MS`（3s，与 bash-tools 对齐）。超时 / abort 触发 SIGTERM 后启动 `forceKillAfterGrace`，宽限期内子进程未退出则强制 SIGKILL；`killTimer.unref()` 不拖住事件循环；统一 `cleanup()` 在 close / error 时清掉超时定时器、kill 定时器与 abort 监听器，杜绝双触发与泄漏。
- 与既有韧性的关系：与 §0.121（opkg 网络超时）、shadow-git 的 SIGKILL 超时、bash-tools / persistent-terminals 的 SIGTERM→SIGKILL 升级同族；把「子进程超时必须能被强制结束、不得依赖被杀进程自愿退出」补齐到 repo_clone 这条对外网络 git 路径。
- 回归证据：新增 `services/agent-gateway/src/__tests__/tools/repo-clone-sigkill-escalation.test.ts`（mock `node:child_process.spawn` 返回一个**忽略 SIGTERM、仅 SIGKILL 才 close** 的假 git 子进程，用 fake timers 推进：deadline → 只收到 SIGTERM 且未 settle，再过宽限期 → 收到 SIGKILL 并最终 settle）共 1/1 通过；既有 `repo-clone-tools.test.ts` 26 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（repo-clone-tools.ts + 新测试）ESLint 干净。

### 0.123 codesearch 响应体内存上限（防 Exa 端点超大/流式响应在 30s 窗口内 OOM 网关）（2026-05-31 续）

- 问题：`services/agent-gateway/src/tools/codesearch-tools.ts` 的 `codesearch` 工具对 Exa code-search 端点（`https://mcp.exa.ai/mcp`）的响应直接 `await response.text()`（成功体与错误体两处），**无字节上限**。工具 30s 超时只约束墙钟、不约束内存——一个快速或超大的 SSE 流可在窗口内把整个响应缓冲进内存、OOM 网关（与 §0.85 webfetch / §0.86 skill 内容同型的内存无界读）。
- 加固：两处读取改用 `readResponseTextWithLimit`（`infra/http-body-limit.ts`），缺省上限 8MB，`OPENAWORK_CODESEARCH_MAX_BYTES` 可覆盖、0 关闭；超 `content-length` 直接拒、流式超限即 abort 底层 socket。错误体读取再包 `.catch(() => '')`，避免读错误体本身抛出盖掉原始状态码信息。
- 与既有韧性的关系：与 §0.85（webfetch 响应体上限）、§0.86（skill 内容/版本检查上限）、§0.121（opkg fetch 墙钟超时）同族——「外部内容 fetch 既要有墙钟超时、也要有内存字节上限」；补齐 codesearch 这处遗漏的内存维度（它本就有 30s 墙钟，缺的是字节上限）。
- 回归证据：新增 `services/agent-gateway/src/__tests__/tools/codesearch-body-limit.test.ts`（`OPENAWORK_CODESEARCH_MAX_BYTES=64`、mock fetch 返回远超上限的 200 响应体，断言工具以 `/response body too large/` 报错而非缓冲）共 1/1 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（codesearch-tools.ts + 新测试）ESLint 干净。

### 0.124 用户自定义注册源快照 `.json()` 响应体内存上限（防恶意/异常注册源流式 JSON 撑爆网关内存）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/skills.ts` 的 `fetchRegistrySourceSnapshot` 拉取用户自定义技能注册源的 `${source.url}/skills/search.json` 后直接 `await response.json()`，**无字节上限**。`source.url` 完全由用户经注册源 upsert 接口提供（schema 仅校验非空字符串、连 URL 格式都不强制），所以这是比 §0.123 更强的内存-DoS 向量：用户挂一个行为异常/恶意的注册源，其 `/skills/search.json` 在 8s fetch 墙钟内流式吐出数 GB JSON，即可 OOM 网关。`fetchWithTimeout` 只约束墙钟、不约束内存。
- 加固：在共享 `infra/http-body-limit.ts` 新增 `readResponseJsonWithLimit<T>`（复用 `readResponseTextWithLimit` 的字节上限执行 + 解析），`fetchRegistrySourceSnapshot` 改用它，缺省上限 16MB、`OPENAWORK_REGISTRY_SNAPSHOT_MAX_BYTES` 可覆盖、0 关闭；超 `content-length` 直接拒、流式超限即 abort socket。
- 与既有韧性的关系：与 §0.85（webfetch）、§0.86（skill 内容/版本检查）、§0.123（codesearch）同族「外部内容 fetch 既要墙钟超时、也要内存字节上限」；本轮把字节上限推广到用户可控 URL 的 JSON 读取，并把「读 JSON 也限界」沉淀为共享 helper 供后续复用。
- 回归证据：在既有 `services/agent-gateway/src/__tests__/infra/http-body-limit.test.ts` 增 `readResponseJsonWithLimit` 三例（正常解析、超限拒绝且不缓冲整 body、限界内非法 JSON 抛 `SyntaxError`），全文件 11 用例（8 既有 + 3 新）通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（http-body-limit.ts + skills.ts + 该测试）ESLint 干净。

### 0.125 技能详情/抓取路径 `mdRes.text()` 与 GitHub/marketplace 列表 `.json()` 响应体内存上限（防用户可控 manifestUrl 流式响应撑爆网关）（2026-05-31 续）

- 问题：§0.124 只补了 `fetchRegistrySourceSnapshot` 一处，`services/agent-gateway/src/routes/skills.ts` 仍有 7 处外部内容读取无字节上限。其中最关键的是 `GET /skills/:skillId` 缓存命中分支：`entry.manifestUrl` 是 `normalizeSkillEntry` 从用户自定义注册源 search 响应里**原样 spread 持久化**进 `registry_source_skill_cache.entry_json` 的，因此完全用户可控；详情路由 `fetchWithTimeout(entry.manifestUrl)` 后 `await mdRes.text()` 无上限——与 §0.124 同型的用户可控内存-DoS 向量（恶意注册源把某条目的 manifestUrl 指向一个流式吐 GB 的端点）。另有 `buildGitHubFrontmatterSkillEntry`、reception 安装详情、GitHub 详情这 3 处 `mdRes.text()`，以及 GitHub code-search / contents / Claude marketplace 这 3 处 `.json()`：URL 虽是硬编码 github.com/anthropic，但同样应限界以保持一致、并防上游异常超大响应。
- 加固：新增 `resolveSkillManifestMaxBytes`（缺省 5MB，`OPENAWORK_SKILL_MANIFEST_MAX_BYTES` 覆盖）与 `resolveGithubListingMaxBytes`（缺省 16MB，`OPENAWORK_GITHUB_LISTING_MAX_BYTES` 覆盖）。4 处 SKILL.md 文本读取改用 `readResponseTextWithLimit`、3 处列表 JSON 读取改用 `readResponseJsonWithLimit`。`skills.ts` 现已**零裸 `.text()`/`.json()` 读取**（10 处全部限界）。超限抛出后，详情路由原有 try/catch 自然降级为「缓存条目（readme 空）」而非 500。
- 与既有韧性的关系：把 §0.124 的字节上限不变量推广到 `skills.ts` 的全部外部内容读取路径；与 §0.85/§0.86/§0.123 同族。
- 回归证据：在既有 `services/agent-gateway/src/__tests__/routes/skills-routes.test.ts` 增 1 例（`OPENAWORK_SKILL_MANIFEST_MAX_BYTES=64`、播种一条带用户可控 `manifestUrl` 的缓存技能、mock manifest fetch 返回 50KB 超限体，断言 `GET /skills/:skillId` 返回 200 且降级为缓存 `readme:''` 而非缓冲/500），全文件 12 用例（11 既有 + 1 新）通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（skills.ts + 该测试）ESLint 干净。

### 0.126 图片生成/编辑上游响应体内存上限（防用户配置 apiBaseUrl 中转流式响应撑爆网关）（2026-05-31 续）

- 问题：`services/agent-gateway/src/image-generation/openai-image-generation.ts` 的 `generateImageWithOpenAi` / `editImageWithOpenAi` 各有两处响应体读取（成功体 `await response.json()`、错误体 `await response.text()`），**无字节上限**。`apiBaseUrl` 是用户在「提供商」里配置的图片生成端点（可填任意中转 / 自建网关），所以这是 §0.124/§0.125 同型的用户可控内存-DoS 向量：一个行为异常 / 恶意的中转可在请求窗口内流式吐出无界字节、OOM 网关。该模块刻意不加隐式墙钟超时（长任务设计、有测试钉死），墙钟维度由调用方 signal 负责，但**内存维度此前完全无界**。
- 加固：新增 `resolveImageResponseMaxBytes`（`OPENAWORK_IMAGE_RESPONSE_MAX_BYTES`，缺省 64MB、0 关闭——图片是 base64，4K 合法体积可达数 MB，故上限给得宽但仍有限），四处读取改用共享 `readResponseTextWithLimit` / `readResponseJsonWithLimit`。错误体读取保留 `.catch(() => 'Unknown error')`，避免读错误体本身抛出盖掉上游状态码信息。
- 与既有韧性的关系：与 §0.85 / §0.86 / §0.123（codesearch）/ §0.124（注册源快照）/ §0.125（技能 manifest/列表）同族「外部内容 fetch 既要墙钟超时、也要内存字节上限」；本轮把内存上限补到图片生成这条用户可控 URL 的最后一处无界读，至此 gateway 内所有外部内容读取（webfetch / skill / codesearch / 注册源 / GitHub / marketplace / 图片）在内存维度均已限界。
- 回归证据：在既有 `services/agent-gateway/src/__tests__/image-generation/openai-image-generation.test.ts` 增一例（`OPENAWORK_IMAGE_RESPONSE_MAX_BYTES=64`、mock fetch 返回 10 万字节的 200 响应体，断言 `generateImageWithOpenAi` 以 `/response body too large/` 报错而非缓冲），全文件 5 用例（4 既有 + 1 新）通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（openai-image-generation.ts + 该测试）ESLint 干净。

### 0.127 工作区上下文文件（rule / AGENTS.md / README）注入读取内存上限（防超大工作区文件每轮撑爆网关内存与上游请求）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/stream.ts` 的 `buildWorkspaceContext` 在**每一轮**对话都会读取项目 rule 文件（`.cursor/rules` / `.github/instructions` / `.claude/rules` / `.github/copilot-instructions.md`）、`AGENTS.md` / `CRUSH.md` / `CLAUDE.md` / `GEMINI.md`、根 `README.md`，并把内容**原样拼进 system prompt**。这些读取（rule 文件的 `fsp.readFile`、`readFileIfExists` 喂 AGENTS/README）**全部无字节上限**——一个病态的多 MB rule/README/AGENTS 文件（工作区路径用户可控）会每轮同时撑爆网关内存与发往上游的请求体。`look_at`（stat 守卫）与工作区搜索（`MAX_SEARCH_FILE_BYTES`）早已限界，唯独这条热路径上的上下文注入读取漏了。
- 加固：新增 `readContextFileWithinLimit`（先 `fsp.stat`，超 `OPENAWORK_CONTEXT_FILE_MAX_BYTES`（缺省 1MB）的文件在读入内存**前**就跳过并 `console.warn`，stat/读取失败均降级为 null），rule 文件读取与 `readFileIfExists` 两处改用它。超限文件被静默跳过、其余上下文照常注入，prompt-cache 前缀不受影响。
- 与既有韧性的关系：与 §0.85/§0.86/§0.123–§0.126「外部内容读取必须有内存上限」同族，但维度是**本地工作区文件**：把 `look_at`（§ 既有 stat 守卫）、workspace 搜索（`MAX_SEARCH_FILE_BYTES`）已有的「读文件前先 stat 限界」补齐到 stream 上下文注入这条每轮必经的热路径。
- 回归证据：新增 `services/agent-gateway/src/__tests__/routes/stream-context-file-limit.test.ts`（① `OPENAWORK_CONTEXT_FILE_MAX_BYTES=128` + 播种 50KB `AGENTS.md` 与小 `README.md`，断言超限 AGENTS 被跳过、小 README 仍注入；② 1MB 上限内的正常 `AGENTS.md` 仍正常注入，确保守卫不误伤）共 2/2 通过；既有 `stream-error-contracts.test.ts` 4 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（stream.ts + 新测试）ESLint 干净。

### 0.128 findPrometheusPlans 计划文件 stat 的 per-file 隔离（防单个计划文件 TOCTOU 消失让 Sisyphus 误判「无计划」）（2026-05-31 续）

- 问题：`services/agent-gateway/src/session/boulder-state.ts` 的 `findPrometheusPlans` 先 `readdir` 列出 `.sisyphus/plans/*.md`，再在 `Promise.all(mdFiles.map(... fsp.stat ...))` 里逐个 `stat` 以按 mtime 排序。该 `stat` **无 per-file 守卫**：某个计划文件在 `readdir` 与 `stat` 之间消失（TOCTOU——并发 `/plan` 编辑、git checkout、手动清理）或瞬时不可读，会让整个 `Promise.all` reject；外层 catch 把它吞成 `[]`，于是 Sisyphus orchestrator 的 start-work 流程会**误判「未找到计划」**（并可能据此重复创建计划），而真实原因只是其中一个文件刚好消失。
- 加固：把每个 `fsp.stat` 包进 try/catch，失败返回 null、随后 `.filter` 掉；坏文件被丢弃、其余计划照常返回并排序。整个 `findPrometheusPlans` 不再因单个文件消失而清空结果。
- 与既有韧性的关系：与 §0.95（restore preview per-file）、§0.111（注册源 per-file）、§0.118（产物 store per-row）、§0.128 之前各处「批量 `Promise.all` 单元素失败不得拖垮整批」同族；补的是 Sisyphus 计划发现这条编排热路径上的 stat 扇出。
- 回归证据：新增 `services/agent-gateway/src/__tests__/session/boulder-state-find-plans-resilience.test.ts`（mock `node:fs` 让 `readdir` 返回两个计划 + 一个 .txt、`stat` 对其中一个 .md 抛 ENOENT，断言 `findPrometheusPlans` 不抛出、跳过消失文件、仍返回健康计划；另一例断言全部可 stat 时按 mtime 倒序）共 2/2 通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（boulder-state.ts + 新测试）ESLint 干净。

### 0.129 SSH 文件预览 `readFile` 内存上限（防用户指定远端大文件经 SFTP 全量缓冲撑爆网关）（2026-05-31 续）

- 问题：`packages/agent-core/src/ssh/ssh-connection-manager.ts` 的 `readFile`（由 `GET /ssh/file` 路由调用、`remotePath` 用户可控）直接 `sftp.readFile(remotePath, {encoding:'utf8'}, cb)` 把**整个远端文件缓冲进内存**，再硬编码 `truncated: false`，**无任何字节上限**。同文件的 `execCommand` 早已用 `SSH_EXEC_MAX_OUTPUT_BYTES`（16MB）+ `stdoutTruncated` 截断守卫，`SSHFilePreview.truncated` 字段也早已预留——唯独 `readFile` 这条预览路径没接上。预览一个多 GB 的远端文件即可 OOM 网关；且因 ssh2 在回调前就已缓冲完，读后再截断无法挽回。
- 加固：在 `sftp.readFile` 之前先 `sftp.stat`（廉价、同样走 `withSftpTimeout` 墙钟）取大小，超 `resolveSshReadMaxBytes()`（缺省 16MB、`OPENAWORK_SSH_READ_MAX_BYTES` 可覆盖、<=0 关闭）即在读入内存**前**抛错，镜像 `look_at` 工具的「先 stat 再读」守卫。`stat` 不可用的注入/旧客户端则跳过守卫、降级为原有行为而非直接失败。阈值用 per-call resolver（而非模块加载期 IIFE）求值，保证 env 覆盖在运行时与测试注入下都生效。
- 与既有韧性的关系：与 §0.127（工作区上下文文件）、`look_at`（stat 守卫）、`SSH_EXEC_MAX_OUTPUT_BYTES`（exec 输出截断）同族「读文件/读输出前必须有内存上限」；补齐 SSH 子系统里 exec 已限界、file-preview 仍裸读的最后一处。
- 回归证据：新增 `packages/agent-core/src/ssh/ssh-read-file-size-limit.test.ts`（① `OPENAWORK_SSH_READ_MAX_BYTES=64` + 假 SFTP 的 `stat` 报 10000 字节，断言 `readFile` 在读取前 reject 且**从不调用** `sftp.readFile`；② 上限内文件正常预览）共 2/2 通过；既有 `ssh-sftp-timeout.test.ts` 2 用例回归通过。`@openAwork/agent-core typecheck` 通过；改动文件（ssh-connection-manager.ts + 新测试）ESLint 干净。

### 0.130 流式上游 idle 看门狗关闭源迭代器的健壮化（防 onStall 后 return() 抛错/挂起逃逸出生成器废掉 STREAM_STALL 兜底）（2026-05-31 续）

- 问题：`services/agent-gateway/src/v2-runtime/upstream/stream-runner.ts` 的 `withStreamIdleWatchdog` 在 inter-chunk idle 超时分支里 `onStall()`（abort 上游）后**裸 `await iterator.return?.(undefined)`**。但 `onStall` 已 abort 上游，AI SDK 的源迭代器此刻调用 `return()`（或那条被丢弃、仍 pending 的 `next()`）很可能**以 abort 错误 reject**；个别行为异常的 adapter 还可能 `return()` 永不 settle。裸 `await` 两种后果都坏：reject 会把异常抛出本生成器、逃逸 `runUpstreamStream` 的 `for await`，从而**跳过循环后稳定的 `STREAM_STALL` 错误块与 `return result`**（上游 stall 被误报成一个原始 abort 异常）；hang 则**重新挂起**看门狗本要兜住的这一轮。
- 加固：抽出 `closeIteratorSafely(iterator)`——把 `iterator.return(undefined)` 包进 try/catch 吞掉 reject，并与一条 `ITERATOR_CLOSE_TIMEOUT_MS`（5s，`unref`）截断赛跑，保证关闭既不抛也不会无限挂起；idle 分支改为 `await closeIteratorSafely(iterator)`。无论源迭代器关闭时 reject 还是 hang，看门狗都优雅结束，调用方照常产出 `STREAM_STALL` 504 块并 `return result`。
- 与既有韧性的关系：与 §0.121–§0.122（上游/子进程墙钟超时与 SIGKILL 升级）、§0.106（清理副作用不得中断 finalization）同族「兜底/清理路径自身不得抛错或挂起」；这里专补 idle 看门狗 stall 分支的 teardown 健壮性，确保 stall→STREAM_STALL 这条降级链不被关闭副作用截断。
- 回归证据：在既有 `services/agent-gateway/src/__tests__/v2-runtime/stream-idle-watchdog.test.ts` 新增两例（① 源 `return()` 在 onStall 后 reject —— 断言迭代不抛、仍只产出首块、`onStall` 调用一次；② 源 `return()` 自身永不 settle —— 用 fake timers 推过 5s 关闭截断，断言迭代仍结束），全文件 5 用例（3 既有 + 2 新）通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（stream-runner.ts + 该测试）ESLint 干净。

### 0.131 runUpstreamGenerate 非流式上游调用内置墙钟超时（防 connects-but-hangs 半开 socket 让单发上游调用永久挂起）（2026-05-31 续）

- 问题：`services/agent-gateway/src/v2-runtime/upstream/run-upstream-generate.ts` 的 `runUpstreamGenerate`（会话标题、压缩、look_at、workflow、skill-recommend、provider 自检等所有非流式单发上游调用的共享入口）只把调用方的 `signal` 透传给 AI SDK `generateText`，而 `generateText` **本身没有任何墙钟 deadline**；调用方的 request-scoped signal 只在客户端断开时触发，**不**覆盖「上游 TCP 连上但永不回包」的半开场景。其流式姊妹 `runUpstreamStream` 早有 idle 看门狗（`DEFAULT_STREAM_IDLE_TIMEOUT_MS`）兜底，非流式路径却没有等价下限。当前每个调用方恰好各自包了超时（compaction 120s / title 15s / connectivity 20s / look_at / skill-recommend 各自 controller），但这是**脆弱且未写明的约定**——任何未来或健忘的调用方都会让一次非流式上游调用在半开 socket 上永久挂起。
- 加固：给 `runUpstreamGenerate` 增加**内置**墙钟兜底——新增可选 `timeoutMs` 入参与 `resolveUpstreamGenerateTimeoutMs()`（缺省 180s、`OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS` 可覆盖、`<=0` 显式关闭），用 `AbortController` + `AbortSignal.any` 与调用方 signal 合并：谁先触发谁生效。默认值刻意取大（180s），保证永不抢先于各调用方更紧的 deadline，只兜底「忘记设超时」的情形；超时抛出可识别的 `upstream generate timeout (<ms>)`。
- 与既有韧性的关系：与 §0.121（opkg fetch 墙钟）、`runUpstreamStream` idle 看门狗、compaction/memory/title/connectivity 各自超时同族「每个上游调用都必须有墙钟下限、半开连接不得无限期占用」；把这条下限从「每个调用方各自负责」收敛为「共享入口自带兜底」，消除脆弱约定。
- 回归证据：新增 `services/agent-gateway/src/__tests__/v2-runtime/run-upstream-generate-timeout.test.ts`（mock `ai` 的 `generateText` 挂起直到 abortSignal 触发、stub provider 工厂：① `OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS=50` + 无调用方 signal，断言以 `/upstream generate timeout/` 报错；② `timeoutMs=0` 显式关闭时不 arm 定时器、`generateText` 收到的 `abortSignal` 为 undefined 且 120ms 内不结算）共 2/2 通过；既有 `provider-connectivity-test.test.ts` 7 用例（一个真实调用方）回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（run-upstream-generate.ts + 新测试）ESLint + Prettier 干净。

### 0.132 WebSocket 入站帧 maxPayload 上限（防认证后客户端推 100 MiB 帧放大网关内存）（2026-05-31 续）

- 问题：`services/agent-gateway/src/index.ts` 的 `await app.register(websocket)` 不传任何 options，`@fastify/websocket@11.2.0` 在 noServer 模式下用 `ws@8.19.0` 的 `WebSocket.Server` 默认 `maxPayload = 100 MiB`。而 HTTP 请求体受 Fastify ~1 MiB 默认上限约束，WS 这条路径却没有等价上限。三个 WS handler（`/sessions/:id/stream` 的 `stream-routes-plugin.ts:292`、`/team/events` 的 `team-events.ts:130`、`/lsp/events`）都会先把整帧缓冲下来再 `raw.toString()` + `JSON.parse(...)`——一个**已认证**客户端可以反复推 100 MiB 帧直接灌进这些解析器，放大网关内存压力（认证后内存-DoS 向量，与 §0.124/§0.125 的「用户可控读取必须限界」同源，但维度是 WS 入站帧而非 HTTP 响应体）。
- 加固：新增 `services/agent-gateway/src/infra/ws-payload-limit.ts` 的 `resolveWsMaxPayloadBytes()`（缺省 `DEFAULT_WS_MAX_PAYLOAD_BYTES = 16 MiB`、`OPENAWORK_WS_MAX_PAYLOAD_BYTES` 可覆盖、`<=0`/非有限值还原 ws 不限上限即关闭），复用既有 `resolveHttpBodyLimitBytes` 的 env-switch 语义；`index.ts` 改为 `await app.register(websocket, { options: { maxPayload: resolveWsMaxPayloadBytes() } })`。16 MiB 对最大的合法帧（`/stream` 多图 `inputParts`，每 `imageUrl` ≤ 500_000 字符 + ≤ 32768 字符 message）留足余量，同时把滥用上限从 100 MiB 砍掉约 6 倍。`ws` 对超限帧以关闭码 1009（message too big）拒收，只在 `maxPayload > 0` 时启用（与 resolver 的「0=关闭」语义吻合）。
- 与既有韧性的关系：与 §0.85/§0.86/§0.123–§0.127（外部内容读取既要墙钟超时也要内存字节上限）同族「任何可由外部输入触发的读取/缓冲都必须有界」；这次补的维度是 WS 入站帧——此前所有 HTTP 出站读取已限界、HTTP 入站体有 Fastify 上限，唯独 WS 入站帧沿用 ws 的 100 MiB 默认无界。
- 回归证据：新增 `services/agent-gateway/src/__tests__/infra/ws-payload-limit.test.ts`（6 用例：resolver 缺省 16 MiB、正整数覆盖向下取整、`0`/`-5`/非数字均回落 0=关闭、空白回落缺省；以及按 `index.ts` 同款 `{ options: { maxPayload } }` 注册真实 `@fastify/websocket` 后——合法小帧正常 echo、超限帧触发关闭码 1009）全部通过；既有 `team-events-routes`、`lsp-events-watchdog` WS 套件（共 6 用例）回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（index.ts + ws-payload-limit.ts + 新测试）ESLint 干净。

### 0.133 team-runtime 健康遥测去重 map 过期清扫（防 lastHealthSignatureByUser / lastHealthTrackedAtByUser 按 userId 无界增长）（2026-05-31 续）

- 问题：`services/agent-gateway/src/team/team-runtime-telemetry.ts` 用两张模块级 map（`lastHealthSignatureByUser` / `lastHealthTrackedAtByUser`）对 `trackTeamRuntimeHealth` 做 5 分钟去重（`HEALTH_TRACK_DEDUPE_MS`）。两者都以 `userId` 为 key，而该函数由前端轮询的 `GET /team/runtime` 端点驱动（`routes/team.ts:1364`）——任何曾打开过团队运行面板的用户都会留下一条永久条目。关键观察与 §0.67 同型：某个 key 只在写入后的 5 分钟窗口内有意义（超过窗口的旧条目永远不会再命中 `now - lastAt < HEALTH_TRACK_DEDUPE_MS` 去重判断），因此过期条目是纯泄漏——只增不用；长期运行 + 用户基数大时，map 随历史用户总数单调增长，而非活跃用户数。
- 加固：新增按写入次数摊销的过期清扫（与 §0.67 `lastIncidentAuditAtBySignature` 同款）。`sweepExpiredHealthDedupe(now)` 遍历删除所有 `now - at >= HEALTH_TRACK_DEDUPE_MS` 的条目（两张 map 同步删除，保持 lockstep）；在每次成功 track 并落 dedupe 后 `healthWritesSinceSweep += 1`，达到 `DEFAULT_HEALTH_SWEEP_INTERVAL=256` 次写入触发一次 O(n) 扫描（摊销，避免每写都全扫）。清扫后 map 规模被「单个 5 分钟窗口内出现的不同用户数」上界限制，而非随进程寿命单调增长。失败路径不污染去重状态的既有语义（telemetry track 抛错时不写 dedupe、允许后续重试）保持不变。新增测试钩子 `__setHealthSweepIntervalForTesting` / `__healthDedupeSizeForTesting`，`__reset...` 同步清零计数并复位间隔。
- 与既有韧性的关系：与 §0.67（runtime incident 审计去重 map 过期清扫）/ §0.69 / §0.70（按高基数 / 外部输入键控的 TTL 缓存过期清扫 + 容量上限）/ §0.36–§0.42 / §0.54–§0.57（只增表保留）同属「任何随外部输入增长的内存 / 存储结构都必须有界」一类；本项把同一摊销清扫不变量补到团队健康遥测这条剩余的 `userId` 键控去重 map。
- 回归证据：新增 2 个用例（`team-runtime-telemetry.test.ts`，注入 stub sink + 小 sweep 间隔 + `vi.spyOn(Date,'now')` 基于真实 epoch 基准）：（a）「3 个不同用户在 base 时刻写入后，推进到 5 分钟窗口外的第 4 次写入触发 sweep，3 个旧条目被清除、只剩新写入的 1 条」/（b）「同窗口内 2 次写入触发 sweep 但都未过期、不误删任何条目」；既有 5 用例（incident 转换、窗口内去重、alert reopened、track 失败不污染去重并允许重试、alert track 失败不抛）回归通过，共 7/7。`@openAwork/agent-gateway typecheck` 通过；改动文件（team-runtime-telemetry.ts + 测试）ESLint 干净。

### 0.134 命令循环收尾（finalizeLoopExecution）抛错韧性（防 fire-and-forget 循环收尾失败既成未捕获 rejection、又把会话永久卡在「运行中循环」）（2026-05-31 续）

- 问题：`services/agent-gateway/src/routes/command-loop-runtime.ts` 的 `scheduleLoopExecution` 用 `setTimeout(...)` 内 `void runLoopExecution(...).finally(cleanup)` 把循环执行 fire-and-forget 出去（由 `/commands` 路由的 Ralph/ULW 循环触发）。`RalphLoopImpl.run` 内部已 `try/catch` 吞掉迭代回调异常、永不 reject；但 `runLoopExecution` 紧接着 `await finalizeLoopExecution(config, result)`，而 `finalizeLoopExecution` 全程做文件系统 + SQLite 写（`taskManager.loadOrCreate` / `save`、`writePersistedLoopState`、`sqliteRun` 改 session metadata、`appendSessionMessage`）且**无任何内部 try/catch**。任一写抛错（任务图存储离线、SQLITE_BUSY、磁盘错误）都会：(1) 让这个 fire-and-forget promise reject——`.finally()` 会原样重抛、且启动处没有 `.catch()`，于是升级为 unhandled rejection（项目明令禁止）；(2) 在清除 session 的 active-loop 元数据标记**之前**中断收尾，于是会话永久停留在「正在运行循环」状态，前端显示一个跑不完的循环。
- 加固：`runLoopExecution` 把 `loop.run` 与 `finalizeLoopExecution` 分别包 try/catch——`loop.run` 这层是面向「未来回归」的防御（当前它不 reject），`finalizeLoopExecution` 这层是真实兜底；两条 catch 都记 `console.warn` 并调用新增的 `safeClearActiveLoopState(config)` 做降级清理：best-effort 清持久化循环状态 + 清 session 上的 active-loop 标记（仅当标记仍指向本 taskId 时），且该函数自身两段都吞错，绝不二次抛出。启动处再加 `.catch()` 末位兜底（理论上不会触发，但 fire-and-forget 启动绝不能漏 unhandled rejection），`.finally()` 的 `activeLoopExecutions` 清理保持不变。
- 与既有韧性的关系：与 §0.24（cron 递归重排 `.then` 漏 onRejected）/ §0.25（agent-core schedule `runTask` 无 catch）/ §0.26（handoff watcher 后台 tick）/ §0.27（stream 心跳 timer）同属「fire-and-forget / 后台路径的异常必须就地隔离、不得升级为 unhandled rejection」一类；同时与 §0.106（`clearPersistedLoopState` 单文件 unlink 抛错不中断收尾）互补——那条保证收尾内部单步不被文件抛错打断，本条保证整段收尾抛错时会话不被永久卡死。
- 回归证据：新增 `services/agent-gateway/src/__tests__/routes/command-loop-finalize-resilience.test.ts`（1 用例：注入 `loadOrCreate` 必抛的 taskManager 驱动真实 `scheduleLoopExecution`→`finalizeLoopExecution` 抛错路径，断言 session 的 `activeLoopKind` 标记被降级清理清除、且全程无 `unhandledRejection` 逃逸）通过；既有 `command-loop-worktree-timeout`、`command-loop-state-cleanup-resilience` 回归通过（3 文件 3 用例）。`@openAwork/agent-gateway typecheck` 通过；改动文件（command-loop-runtime.ts + 新测试）ESLint 干净。

### 0.135 团队指令栈文件注入读取内存上限（防用户可控工作区的超大 architecture.md / project-memory.md / lessons-learned.md 每轮撑爆网关内存与上游请求）（2026-05-31 续）

- 问题：`services/agent-gateway/src/team/team-instruction-stack.ts` 的 `buildTeamInstructionStack` 是团队会话**每一轮**都会调用的 7 层指令栈拼装器（接线于 `routes/stream.ts:2274`、`routes/stream-runtime.ts:169`、`routes/team-phase-a.ts:404`）。它经 `readWorkspaceFile → readFileSafe` 读取工作区里的 `architecture.md`、`.agentdocs/project-memory.md`、`.agentdocs/lessons-learned.md` 并**原样拼进 stable system prompt**。`readFileSafe` 虽做了 `stat`/`isFile` 与 try/catch，却**没有任何字节上限**——而 `workspaceRoot` 是用户可控路径，一个病态的多 MB `architecture.md` / `project-memory.md` 会每轮同时撑爆网关内存与发往上游的请求体。模块里的 `SOFT_TOKEN_LIMIT=24K` 只是**事后**在文本拼好后加一段警告，并不在读入内存前拦截。§0.127 收口的是 `stream.ts::buildWorkspaceContext` 那个独立读取器（rule 文件 / AGENTS / README），本模块是**另一条**每轮必经的工作区文件读取热路径，仍裸读。
- 加固：给 `readFileSafe` 加「先 `stat` 后读」的字节上限——超 `resolveTeamInstructionFileMaxBytes()`（缺省 1MB，复用 §0.127 的 `OPENAWORK_CONTEXT_FILE_MAX_BYTES` 同一开关让运维只调一个值，`<=0` 关闭守卫）的文件在读入内存**前**就跳过并 `console.warn`，返回 null。该层被静默跳过、指令栈其余各层照常拼装（graceful degradation），`layers.*` 标志位如实反映该层未载入。
- 与既有韧性的关系：与 §0.127（stream 上下文文件读取上限）同族同维度（本地工作区文件读取必有内存上限），把同一不变量补到团队指令栈这条 §0.127 未覆盖的每轮读取路径；与 §0.85/§0.86/§0.123–§0.126（外部内容 fetch 内存上限）共属「任何读入内存的内容都必须有字节上界」。
- 回归证据：新增 `services/agent-gateway/src/__tests__/team/team-instruction-stack-file-limit.test.ts`（3 用例：① `OPENAWORK_CONTEXT_FILE_MAX_BYTES=128` + 播种 50KB `architecture.md` 与小 `project-memory.md`，断言超限 architecture 被跳过、小 project-memory 仍注入、warn 命中；② 1MB 上限内的正常 `architecture.md` 仍注入，守卫不误伤；③ 上限设 0 时禁用守卫、超大文件仍读取）全部通过；`@openAwork/agent-gateway typecheck` 通过；改动文件（team-instruction-stack.ts + 新测试）ESLint 干净。

### 0.136 d 层派发子 handoff 数量上限（防 PM1 生成的 tasks.md 失控 fan-out 撑爆 PID/FD/DB/LLM 预算）（2026-05-31 续）

- 问题：`services/agent-gateway/src/handoff/runner/pm2-runner.ts` 的 d 层派发对 `parseAllTasks(tasks.md)` 解析出的**每一条**任务行调用 `createHandoff` 创建一个子 handoff（→ 子 session）。`tasks.md` 由上游 LLM（PM1 产物链）生成、属不可信内容——一个失控 / 恶意的计划列出成百上千条 `- [ ] T00N` 行时，会无上限地 fan-out 子 handoff，进而派生大量子 session、耗尽宿主 PID / FD、撑大 DB 行与下游 LLM 预算。代码里第 327 行注释写着「上限检查（D50 全局并发上限）」，但 `_maxParallel` / `_effectiveParallel` 都是下划线前缀的**死变量**——D50 上限从未真正被强制执行。`buildDispatchPackages` 也没有任何任务数上界。
- 加固：给纯函数 `buildDispatchPackages`（`handoff/capability/dispatch-package.ts`）新增可选 `maxPackages` 入参——超过上限时只取文档顺序的前 N 条（`slice` 在 reviewer dependsOn 计算**之前**执行，保证被保留任务的依赖前缀完整、不引用被丢弃的任务）。pm2-runner 新增 `resolveMaxDispatchPackages()`（缺省 50、`OPENAWORK_TEAM_MAX_DISPATCH_PACKAGES` 可调、`<=0`/非法值关闭上限），把它透传给 `buildDispatchPackages`；当 `tasks.length > packages.length`（发生截断）时写一条 `pm2-dispatch-packages-capped` runtime incident 留痕（含解析任务数 / 实际派发数 / 上限），便于运维发现「计划过大被截断」。
- 与既有韧性的关系：与 §0.66（持久终端每会话并发上限）、§0.34（cron 槽位回收）、§0.52–§0.57（发送缓冲 / 只增表保留上界）同属「每一类可由外部 / 上游输入触发而无界增长的资源都必须有上限」一类；这次补的是「d 层按 LLM 生成任务数 fan-out 子 handoff」这一维度——把注释里早已声明却从未落地的 D50 并发上限真正实现。
- 回归证据：`dispatch-package.test.ts` 新增 1 个用例（10 条任务 + `maxPackages=3` 只派发 T001/T002/T003；`maxPackages=0` 与不传时全部 10 条派发，确认关闭语义与默认不截断），该文件 12 用例全过；既有 `pm2-runner.test.ts` 2 用例回归通过。`@openAwork/agent-gateway typecheck` 通过；改动文件（dispatch-package.ts + pm2-runner.ts + 测试）ESLint 干净。

### 0.137 过期但仍 pending 的反向消息行全局过期清扫（防被放弃 session 的孤儿 inbound 行永久泄漏到 session 删除）（2026-05-31 续）

- 问题：`services/agent-gateway/src/handoff/store/inbound-store.ts` 的 `session_inbound_messages` 行经状态机走 pending → consumed/expired。`pending → expired` 的过期转移此前**只**发生在 `consumePendingInboundMessage` / `listPendingInboundMessages` 这两条**按 session**的惰性路径上——它们在被调用时先把该 session 自己过期的 pending 行标 expired。而 §0.40 族的摊销保留裁剪（`pruneTerminalInboundMessages`）只 DELETE `state IN ('consumed','expired')` 的终态行。于是一个被放弃的 session（handoff 失败/取消后再无人轮询、也无人列举其 inbound）留下的「已过 `expires_at` 但仍 pending」的行会永远停在 pending：既不会被任何读路径命中（读都带 `expires_at >= now` 过滤），也不满足终态行 DELETE 条件——纯泄漏，直到 session 删除 CASCADE 才被清。长期运行 + 反向消息频繁但 session 频繁夭折的部署会让该表无界堆积。
- 加固：在 `pruneTerminalInboundMessages` 的 DELETE **之前**增加一次**全局**（不限 session）过期转移：把所有 `state='pending' AND expires_at IS NOT NULL AND expires_at < now` 的行统一标记为 `expired`，使这些孤儿行进入终态、从而能被既有保留窗口回收。永不过期的类型（cancel/pause/resume，`expires_at IS NULL`）与尚未过期的 pending（`expires_at` 在未来）都不受影响，读路径语义不变。复用既有摊销调度（每 `SESSION_INBOUND_PRUNE_CHECK_INTERVAL=100` 次插入触发一次），无额外写放大。
- 与既有韧性的关系：与 §0.36 / §0.40 / §0.54–§0.57（只增表保留裁剪）/ §0.67 / §0.70 / §0.133（按 key 的去重 map 过期清扫）同属「任何随外部输入增长的存储结构都必须有界回收」一类；本项补的是「有 TTL 却只在 per-session 惰性路径转终态、孤儿行因此绕过保留裁剪」这一形态——TTL 行的常见隐患正是「过期转移依赖被读到、无人读则永不转终态」。
- 回归证据：新增 1 个用例（`inbound-store-retention.test.ts`）：播种一条过期 pending 孤儿行（`expires_at` 已过 + `created_at` 远超保留窗口）、一条永不过期 pending（`cancel_signal`，`expires_at IS NULL`）、一条未来过期 pending（`expires_at` 在未来）；触发裁剪后断言孤儿行被全局转 expired 并按保留窗口 DELETE、永不过期 pending 保留、未来过期 pending 仍为 pending（未被误转）。既有 2 用例（终态行保留窗口裁剪、retention<=0 关闭）回归通过，共 3/3；`inbound-store.test.ts` 12 用例（consume/list/幂等/优先级）回归通过。`@openAwork/agent-gateway typecheck` 通过；本项改动文件（inbound-store.ts 的 prune 区 + 测试）ESLint 干净（注：同文件 `resolveClarificationEscalationRequest` 的 2 处 `no-unnecessary-type-assertion` 告警属脏工作区中他人进行中的重构，非本项改动，未触碰）。

### 0.138 团队通知 store 的 readEventKeys 滚动清扫（防长驻团队页 readEventKeys 集合无界增长 + unreadCount 漂移）（2026-05-31 续）

- 问题：前端 `apps/web/src/stores/team/team-events.ts` 的 `useTeamNotificationStore` 在 `appendNotificationEvents` 里把 `events` 缓冲裁到最近 100 条（`.slice(-100)`），但返回的 `readEventKeys`（标记已读的事件 key 集合）**原样不动**。于是在长期驻留的团队运行页上，被挤出 100 条窗口的事件其 key 永远留在 `readEventKeys` 里——该 `Set` 只增不减，是与后端去重 map 泄漏（§0.67 / §0.133）同族的**前端内存泄漏**。附带一个隐性 bug：当一条**未读**事件被挤出窗口时，旧实现用 `unreadCount + unreadDelta` 增量累加，从不随事件移除回收，导致 badge 计数随时间虚高漂移、与实际存活缓冲不一致。
- 加固：`appendNotificationEvents` 在 `.slice(-100)` 后，把 `readEventKeys` 收敛为「仍存活于缓冲中的事件 key」（按成员资格判定而非相对大小——60 个已读 key vs 100 条新未读事件时，size 判据会漏剪），并用与 `markEventRead` 同口径的方式从存活缓冲重算 `unreadCount`（存活且 key 不在已读集合 = 未读）。同时修正 `mergeRuntime` / `push` 两个 action——它们此前只回传 `events` + `unreadCount`、把算好的 `readEventKeys` 丢弃，导致裁剪不生效；现一并回传 `next.readEventKeys`。
- 与既有韧性的关系：与 §0.67 / §0.133（按高基数维度键控的去重 map 过期清扫）/ §0.69 / §0.70（TTL 缓存容量上限）同属「任何随外部输入增长的内存结构都必须有界」一类；本项把该不变量补到**前端层**的通知已读集合，直接呼应目标里「各个层级」的网络/状态健壮性。
- 回归证据：新增 1 个用例（`team-events.test.ts`）：推 60 条并全部标记已读（events=60、readEventKeys=60、unreadCount=0），再推 100 条未读新事件挤出全部旧事件；断言 events 封顶 100、readEventKeys 被清空（旧已读 key 全部随事件挤出而清除、不再无界增长）、unreadCount=100（与存活缓冲一致、无虚高漂移）、且 readEventKeys 中每个 key 都对应一条仍存活的事件。既有 10 用例（退避/关闭策略/hydrate/读生命周期/handoff 摘要等）回归通过，共 11/11。`@openAwork/web typecheck` 通过；apps/web lint 当前阶段为 no-op（脚本占位），改动文件经 tsc 校验干净。

### 0.139 前端团队 HTTP 读取墙钟超时（防 connects-but-hangs 半开连接让团队工作区/运行时快照 hook 永久卡在 loading 无法重连）（2026-05-31 续）

- 问题：`packages/web-client/src/team/team.ts` 的全部结构化 result 读取器（`getRuntimeResult` / `getWorkspaceSnapshotResult` / `listWorkspacesResult` / `getWorkspaceResult` / 共享会话详情 / 在线状态等）与各 mutation 都直接 `await fetch(...)`，浏览器 `fetch` **没有任何内建墙钟超时**。一个「接受连接却永不响应」的上游（半开 socket、卡死代理、过载网关）会让该 Promise 永久 pending。对团队读模型尤其有害：`use-team-workspace-snapshot-state` / 运行时快照这些轮询 hook **只在请求 settle（成功或 reject）时**才安排下一次指数退避重试——请求一旦挂起，hook 就永远停在 `loading`，既不报错也不重连，UI 卡死且无自愈。这是后端 §0.131（runUpstreamGenerate 墙钟）/ §0.121（opkg fetch 墙钟）在前端层的镜像缺口。
- 加固：在共享 `packages/web-client/src/gateway/http.ts` 新增 `fetchWithTimeout`（缺省 20s `DEFAULT_FETCH_TIMEOUT_MS`、`AbortController` 实现、与调用方 `signal` 合并：谁先触发谁生效、`timeoutMs<=0` 关闭、无 `AbortController` 环境优雅降级为裸 fetch），并把 `team.ts` 全部 36 处 `fetch(` 改走它。result 读取器既有的 `catch` 已把任何 throw 映射为 `{ ok: false, retryable: true }`，因此超时 abort 会**自然流入既有的指数退避重试**，无需改 hook。
- 与既有韧性的关系：与后端 §0.121 / §0.131「每个上游/网络调用都必须有墙钟下限、半开连接不得无限期占用」同族，落到前端 HTTP 层；与前端 team-events WS 客户端（指数退避 + 离线检测 + 认证失败停连，已有）互补，补齐 REST 读取这条此前完全无墙钟的路径。
- 回归证据：新增 `packages/web-client/src/gateway/http-timeout.test.ts`（6 用例：正常透传、挂起请求 30ms 超时 abort 不永久 pending、调用方 signal 先触发、已 abort 的 signal 立即生效、`timeoutMs<=0` 不 arm 定时器且不注入 signal、默认常量 20s）；`team.test.ts` 新增 1 用例（fake timers 模拟半开 fetch，推进过 20s 墙钟后断言 `getWorkspaceSnapshotResult` 落入 `{ ok:false, retryable:true }` 而非永久 pending），既有 17 用例回归通过共 18/18；`web-client` 全量 203 用例通过；`@openAwork/web-client` typecheck 通过；本项改动文件（http.ts + http-timeout.test.ts + team.test.ts）ESLint 干净（注：`team.ts` 报一处 `SharedSessionCommentRecord` 未使用导入，属脏工作区中他人未提交重构——其改了 `createSharedSessionComment` 返回类型为 `SharedSessionCommentActionResult` 而遗留旧导入，非本项 fetch 替换所致，未触碰）。

### 0.140 MCP OAuth code-exchange 墙钟超时（防上游 token 端点 connects-but-hangs 让 /mcp/oauth/callback 处理器与用户浏览器标签页永久挂起）（2026-05-31 续）

- 问题：`packages/mcp-client/src/oauth.ts` 的 `runOAuthCodeExchange` 驱动 MCP SDK 的 `auth()` 向上游 token 端点 POST（用 code + PKCE verifier 换 token），但 SDK 没有任何内建墙钟超时。一个接受连接却永不响应的 token 端点（半开 socket、停滞代理）会让该 Promise 永久 pending；而网关的 `GET /mcp/oauth/callback`（`services/agent-gateway/src/routes/mcp-oauth.ts`）直接 `await finalizeOAuthFromCallback(...)`（→ `runOAuthCodeExchange`）且无任何 deadline——于是 fastify 回调处理器与用户那个等待跳转结果的浏览器标签页都会无限挂起。与前端 §0.139、上游 §0.131、MCP 握手 `connectWithTimeout`（同文件邻居）同族「外部网络调用必须有墙钟上限」。
- 加固：把整个换取流程（动态 `import` SDK + `auth()` 往返）`Promise.race` 到一个 30s 墙钟（`OAUTH_CODE_EXCHANGE_TIMEOUT_MS`，复用既有 `MCPTimeoutError`）。定时器**同步**起在动态 import 之前，因此连「模块加载停滞」也被覆盖；超时即 reject `MCPTimeoutError`，回调路由已有的 catch 把它映射为 500（用户可重试，待定的 PKCE verifier / oauthState 由调用方保留、重试复用同一 redirect 签发态）。`finally` 清理定时器。
- 与既有韧性的关系：与 §0.139（前端团队 HTTP 读取墙钟）/ §0.131（上游 generate 墙钟）/ MCP `connectWithTimeout`（握手墙钟）/ channel-http（渠道发送墙钟）同属「任何 connects-but-hangs 的外部调用都必须被墙钟转成可恢复错误」一类；本项补的是 MCP OAuth 服务端换取这条此前漏网的网络往返。
- 回归证据：新增 `packages/mcp-client/src/oauth.test.ts`（4 用例：正常透传 AUTHORIZED、SDK 返回 REDIRECT 透传、token 端点挂起经 fake timers 推进过 30s 抛 `MCPTimeoutError`（不永久 pending）、SDK 非超时错误原样抛出）；mcp-client 全量 12 用例通过（连测 3 次稳定）；`@openAwork/mcp-client` 与 `@openAwork/agent-gateway` typecheck 均通过；改动文件 ESLint 干净。

### 0.141 团队 inbound/handoff/phase-a/workflows 客户端墙钟超时 + abort 文案归一（把 §0.139 的 fetch 墙钟补齐到剩余四个 team-\* 前端客户端，并修复超时 abort 文案泄漏到 UI）（2026-05-31 续）

- 问题：§0.139 给 `packages/web-client/src/team/team.ts` 的全部 `fetch` 加了 `fetchWithTimeout` 墙钟，但**同目录另外四个 team-\* 客户端**——`team-inbound.ts`（反向消息提交：user_input/cancel/pause/resume 信号）、`team-handoffs.ts`（handoff 只读 + cancel/pause/resume/review 控制）、`team-phase-a.ts`（constitution/persona/user-memory/force-apply/指令栈预览）、`team-workflows.ts`（工作流 CRUD）——共 26 处仍是裸 `fetch`，无任何墙钟。它们同样支撑实时团队 UI：一个 connects-but-hangs 的上游会让对应调用永久 pending，反向消息提交 / handoff 控制 / 配置读写按钮一直转圈无法恢复。与 §0.139 完全同型，只是 sibling 文件漏网。
- 二级问题（测试暴露）：`fetchWithTimeout` 超时是通过 abort 底层请求实现的，会抛出 `AbortError`（message 形如 'The operation was aborted' / 'aborted'）。而各 team-\* 的网络错误归一器只认 `isGenericFetchErrorMessage` 里固定的几条浏览器原生文案（'Failed to fetch' 等），**不认 abort**——于是墙钟超时的原始 'aborted' 字符串会直接泄漏到 UI 文案，而不是收敛成「网络异常，……失败。」。
- 加固：（1）四个 team-\* 客户端全部 26 处 `fetch(` 改走共享 `fetchWithTimeout`（缺省 20s，与 §0.139 同一旋钮）；各文件既有的 catch→HttpError/`{ok:false}`/null 归一不变，超时 abort 自然流入既有路径。（2）把 `isGenericFetchErrorMessage`（被 ~30 个资源客户端共用的中心 helper）扩展为同时识别 abort 类文案（`/\babort/i`），一处收口让所有消费方把墙钟超时映射为各自的友好本地化网络文案，而非泄漏裸 abort 串；真实后端失败走结构化 `HttpError`、不经此路径，故子串匹配安全。
- 与既有韧性的关系：§0.139（team.ts fetch 墙钟）的直接延伸 + 收口，同属「浏览器 fetch 无内建超时，connects-but-hangs 必须有墙钟兜底」一类；本项把该不变量补齐到剩余全部 team 前端客户端，并修掉超时文案的 UX 泄漏。
- 回归证据：`team-inbound.test.ts` 新增 1 用例（fake timers 模拟半开 fetch，推进过 20s 后断言 submit settle/reject 而非永久 pending，且文案为「网络异常，提交团队反向消息失败。」）；`http-timeout.test.ts` 新增 `isGenericFetchErrorMessage` 3 用例（识别原生网络文案、识别各 runtime 的 abort 文案、不误判真实业务文案）；web-client 全量 207 用例通过（含既有 203）。`@openAwork/web-client` typecheck 通过；改动文件（http.ts + 4 个 team-\* 客户端 + 2 个测试）ESLint 干净。

### 0.142 auth.logout 墙钟超时 + 吞错（防 connects-but-hangs 的 /auth/logout 让登出流程永久挂起 / 网络错误中断本地清理）（2026-05-31 续）

- 问题：`packages/web-client/src/gateway/auth.ts` 的 `logout` 是 auth 模块里唯一**既无墙钟超时、又无错误守卫**的网络调用——其同胞 `login` / `refreshAccessToken` 都用 `AbortSignal.timeout(...)` + `normalizeAuthError(...)` 双重护栏。`logout` 直接裸 `await fetch('/auth/logout')`：一个 connects-but-hangs 的端点（半开 socket、停滞代理）会让该 promise 永久 pending，任何 `await logout()` 的登出流程被无限卡住；而一个瞬时网络 throw 会直接 reject 到调用方，可能中断本地 token 清理（登出本应无条件在本地完成）。
- 加固：给 `logout` 加 `AbortSignal.timeout`（默认 10s，参数可覆盖）并用 `try/catch` 吞掉一切失败（超时 / 网络 / 非 2xx）。语义上 logout 是**尽力而为的服务端撤销**——access token 自身会过期，漏掉一次撤销是可自愈的轻微降级，绝不能让它阻断或拖垮本地登出。与 §0.139 / §0.141（前端 fetch 墙钟）同族，补齐 auth 模块这条遗漏的网络路径。
- 回归证据：新增 3 个用例（`auth.test.ts`）：（a）成功时不抛错且只发一次请求、（b）网络异常时吞错 resolve（本地登出仍可继续）、（c）请求挂起时用短真实超时（`AbortSignal.timeout` 不受 vitest fake timers 驱动）验证墙钟到点后 settle 而非永久 pending。既有 4 个 auth 用例回归通过，web-client 全量 210/210；`@openAwork/web-client` typecheck 通过；改动文件 ESLint 干净。

### 0.143 GatewayWebSocketClient onclose 合成终态事件（防服务端静默关闭 WS 让聊天 UI spinner 永久挂起）（2026-05-31 续）

- 问题：`packages/web-client/src/gateway/gateway-ws.ts` 的 `GatewayWebSocketClient.connect` 只装了 `onopen` / `onmessage` / `onerror`，**没有 `onclose`**。浏览器只有在收到终态 `done` / `error` chunk 或 `onerror` 时才会让消费者（聊天 UI）落到终态；但服务端**静默关闭**（网关重启、代理 idle-drop、1001 going-away）只触发 `onclose`、不一定先发 `onerror`，也没有前置终态 chunk——消费者因此永远停在非终态，聊天 UI 的 loading spinner 无限挂起。其同胞 `GatewaySSEClient` 在每条错误 / done / 解析失败路径都会 `close()`，WS 端却缺了「静默关闭」这一路的兜底。
- 加固：新增 `onclose` 处理器，在「无前置终态 chunk」时发出一次合成 `WS_CLOSED` 终态错误，让消费者从 spinner 解脱。用三重守卫确保只在该发时发一次：（1）`terminalDispatched` 标志——收到 `done` / `error`（含合成 close 错误）后置位，clean shutdown 不重复发；（2）`manualClose` 标志——`disconnect()` 主动关闭前置位，调用方主动断开不发错；（3）socket 身份比对（`this.ws !== ws`）——被后续 `connect()` 取代的旧 socket 关闭被忽略，不污染新连接。`connect()` 起始处重置前两个标志，保证每条新连接独立计算。
- 与既有韧性的关系：与 §0.138（前端 team-events WS 重连/清扫）、§0.139/§0.141/§0.142（前端 fetch / logout 墙钟）同族，都是「前端网络层必须在异常断开时把消费者推到确定的终态、而不是无限等待」。本项补齐 chat stream WS 这条「服务端静默关闭」的盲区。
- 回归证据：新增 4 个用例（`gateway-ws.test.ts`）：（a）静默关闭发一次 `WS_CLOSED` 且二次 onclose 去重、（b）收到 `done` 后再关闭不重复发错、（c）`disconnect()` 触发的关闭不发合成错误、（d）被后续 `connect()` 取代的旧 socket 关闭不影响新连接、新连接静默关闭仍正常发错。既有 4 个 gateway-ws 用例回归通过，web-client 全量 214/214；`@openAwork/web-client` typecheck 通过；改动文件 ESLint 干净。

### 0.144 team-init 步骤执行并发守卫（防 double-click / 客户端重试让同一初始化步骤重复执行 → 重复 LLM 调用 / 重复副作用写入）（2026-05-31 续）

- 问题：`services/agent-gateway/src/team/init/team-init-runner.ts` 的 `runTeamInitStep` 只用 DB 状态拦 `not_applicable` / `done`，**不拦 `running`**。确认执行路由 `POST /team/sessions/:id/init/steps/:key/confirm` 无任何再入保护：double-click、客户端在响应前重试、或两个标签页，会在第一个 confirm settle 前再发一个。两个调用都读到非 `done` 状态、都翻成 `running`、都执行——`understand-architecture` 步骤会**重复消耗 LLM 额度**，`bind-tools-per-layer` / `scaffold-memory` 会**重复写入副作用**（这些步骤 await 最长 60s 的 LLM 调用，并发窗口很宽）。纯 DB 状态读无法关闭这个竞态：两次读在任一写之前交错。
- 加固：新增进程内 in-flight `Set`，按 `(userId, sessionId, stepKey)` 键控，第二个并发调用直接 no-op 返回 `step-already-running`（镜像网关既有的 `inFlightPm2QualityReviews` / `inFlightStreamRequests` 单例模式）。在 `finally` 中释放——成功/失败/抛错都释放，进程崩溃则随退出自然清除，绝不像持久化锁那样把步骤永久卡死。选 in-process Set 而非 DB 时间戳 staleness 守卫，是因为 `confirmedAt` 在重试间被保留（不是可靠的 run-start 标记），且 Set 能确定性关闭 DB 状态读关不掉的并发读窗口。与 §0.1（fire-and-forget 重入）/ §0.20 族（in-flight 去重）同类。
- 回归证据：新增 1 个用例（`team-init.test.ts`）：两个并发 confirm 同一步骤 → 恰好一个 `ok`、一个 `step-already-running`；守卫释放后第三次 confirm 在 `done` 上短路。既有 6 个 team-init 用例回归通过，共 7/7；`@openAwork/agent-gateway` typecheck 通过；改动文件 ESLint 干净。

### 0.145 reception→pm1 自动编排并发守卫（防无 idempotency-key 的并发 user_input 越过 active-handoff TOCTOU 窗口 → 创建两条并行 pm1 链路）（2026-05-31 续）

- 问题：`services/agent-gateway/src/handoff/runner/reception-orchestrator.ts` 的 `orchestrateReceptionInput` 用 `hasActiveHandoffFor`（DB 读）防"一次输入触发多条并行 c 链路"，但该检查与最终的 `createHandoff(reception→pm1)` 之间隔着**两次 LLM 往返**（router 最长 3s + interaction-agent 改写最长 60s）。inbound 路由把这次编排作为 `void (async () => {...})()` fire-and-forget 触发，且只有在带 `clientIdempotencyKey` 时 `!result.reused` 才去重。两条无共享 idempotency-key 的 `user_input`（快速双发 / 两个标签页）会都通过 active-handoff 检查（彼时谁都还没建 handoff）、都 `createHandoff(reception→pm1)`——派生两条并行 pm1 链路，正是该守卫想阻止的。纯 DB 状态读关不掉这个窗口（两次读在任一写之前交错）。
- 加固：加进程内 in-flight `Set`（键 `userId::receptionSessionId`，镜像既有 `inFlightPm2QualityReviews`），在 active-handoff 检查之后、两次 LLM 调用之前同步占用；第二个并发调用确定性地命中守卫、返回 `orchestration-in-flight`（写与 active-handoff 相同的 fallback ack），绝不越窗建第二条 handoff。把原函数体抽到私有 `runReceptionOrchestrationBody`，公开入口在 `try/finally` 里占用/释放守卫，`finally` 释放确保崩溃不会把 session 永久锁死。与 §0.144（team-init 步骤并发守卫）同族。
- 回归证据：新增 1 个用例（`reception-orchestrator.test.ts`）：两次并发 `orchestrateReceptionInput` 同一 reception 会话 → 恰好一个被 in-flight 守卫挡下（`orchestration-in-flight`），两者都不会并行越过 active-handoff 检查去 createHandoff。既有 2 个用例（active-handoff 跳过、无 LLM 配置）回归通过，共 3/3；`@openAwork/agent-gateway` typecheck 通过；改动文件 ESLint 干净。

### 0.146 团队子会话删除级联（按 team_parent_session_id 列）（防 DELETE /sessions/:id 只删 reception 根、孤立 pm1/pm2/executor 子会话与其 CASCADE 数据）（2026-05-31 续）

- 问题：团队子会话（pm1/pm2/executor/reviewer）由 `createTeamSession` 创建，父子关系**只**写在 `sessions.team_parent_session_id` 列上——该列 `TEXT DEFAULT NULL`，**无 FK、无 ON DELETE CASCADE**，且 `createTeamSession` 从不写 `metadata.parentSessionId`。而 `DELETE /sessions/:id` 的删除树构建器 `buildSessionDeletionRows`（以及 `collectDescendantSessionIds`）**只**跟 `metadata.parentSessionId`。于是删除一个 reception 根会话时，只删根行本身，其下经 `team_parent_session_id` 关联的所有团队子会话被**孤立**——连同它们经 FK CASCADE 链接的 `message_v2` / `handoff_records` / `session_inbound_messages` 等行一起，永久滞留在库里（按会话数单调泄漏，且 UI 再也看不到、无法回收）。
- 加固：在删除路径上让树构建跟随**两条**父链接。`buildSessionDeletionRows` 现在按 `metadata.parentSessionId` **与** `team_parent_session_id` 列两者建子节点索引（抽出 `linkChild` helper，带自指与空值守卫），并把 `SessionRow` 接口补上可选 `team_parent_session_id`、把 DELETE 路径的 `SELECT` 补上该列投影（其余 SELECT 不动，保持最小改动面）。这样删除 reception 根会把整棵团队子树纳入删除集，孤立行不再产生。
- 回归证据：`sessions-error-routes.test.ts` 新增 1 用例：seed reception 根 + 经 `team_parent_session_id` 列（非 metadata）两层关联的 pm1/pm2，`DELETE /sessions/根` 后断言 `deletedSessionIds` 含全部三层、且库中三行全部消失（无孤立残留）。该套件 12/12、delete-recovery 套件回归通过（共 17/17）；gateway typecheck、改动文件 ESLint 干净。

### 0.147 移动端 WS 客户端 onclose 合成终态事件（防服务端静默关闭 / 重连预算耗尽让移动端聊天 UI 永久挂死）（2026-05-31 续）

- 问题：`apps/mobile/src/hooks/useGatewayClient.ts` 的 `MobileGatewayClient` 设了 `onopen`/`onmessage`/`onerror`，`onclose` 仅在「非干净关闭且仍有重连预算」时重连，**没有任何终态事件兜底**。两种情形会让消费方永久卡在非终态：（a）服务端中途**干净**关闭（1001 going-away / 网关重启，`wasClean=true`）——不触发重连分支；（b）非干净关闭但重连预算（`maxReconnectAttempts=5`）**耗尽**。移动端不会 re-attach 到在途 run，于是 `onDone`/`onError` 永不触发，聊天 UI spinner 永久挂死。这是 §0.143（web 端 GatewayWebSocketClient onclose）在移动端层的同形缺口。
- 加固：新增 per-turn `terminalDispatched` 标志（`done`/`error`/`onerror`/合成 `WS_CLOSED` 时置位，`connect`/`send` 开启新一轮时复位）。`onclose` 先判定是否要重连（非干净 + 有预算 + `currentSessionId` 非空），要则 `return`；否则在「未交付过终态 且 handlers 仍在」时合成恰好一次 `onError('WS_CLOSED', …)` 让 UI 收尾。`disconnect()` 清空 `handlers`/`currentSessionId`，故迟到的 onclose 既不重连也不发错。重连判定额外加 `currentSessionId !== null` 守卫，杜绝 disconnect 后的迟到 close 复活 socket。
- 回归证据：`gateway-client.test.ts` 新增 4 用例：服务端干净关闭发一次 `WS_CLOSED`（且不重连）、收到 `done` 后再关闭不重复发错、重连预算耗尽后（open 前反复失败关闭，共 1+5 个 socket）合成一次 `WS_CLOSED`、`disconnect()` 后迟到关闭静默不重连。既有 5 个韧性用例回归通过，移动端全量 19/19；`@openAwork/mobile` typecheck 与 ESLint 干净。

### 0.148 团队 handoff 在途心跳保活（防 pm1/pm2 非流式 runner 的子会话 last_heartbeat=NULL 被崩溃恢复 5s 内误回收 → 重复派发 / 重复 LLM 花费）（2026-05-31 续）

- 问题：崩溃恢复 `reclaimAbandonedHandoffs` 的 stale 判定是 `s.last_heartbeat IS NULL OR s.last_heartbeat < cutoff`——**NULL 即视为立即超时**。而 `touchSessionHeartbeat` 只在流式路径（`stream-model-round` 的 executor/reviewer）被调用；pm1（artifact-chain）与 pm2 走非流式 `requestWorkflowLlmCompletion`，它们由 `createTeamSession` 新建的子会话 `last_heartbeat` 恒为 NULL。watcher 默认开启、恢复 tick 每 5s 跑一次，于是一个**刚 start、还在跑**的 pm1/pm2 `running` handoff 会在数秒内被退回 `pending`、重新 claim → 再建一个子 session、再跑一遍非流式 LLM，直到撞 `maxRetry` 改判 `failed`。即「健康在途任务被恢复机制误杀 + 重复派发 + 重复 LLM 花费」。
- 加固（watcher 单一执行链路上补心跳，不动 reclaim 语义）：(1) `scheduleHandoffTask` 的 `run` wrapper 起始同步 `touchSessionHeartbeat(toSessionId)`，并起一个 `staleMs/3`（下限 1s）的心跳泵 `setInterval`（`unref` + `finally` 清理），覆盖 pm1/executor/reviewer 整个在途执行；(2) pm2 在自身 `run` 返回后仍 `running`（等 e/f/g 子链路），由 `reconcilePendingPm2QualityReviews` 每个 tick 对其 `to_session_id` 补一次心跳。真正的进程/ watcher 崩溃会让这些 tick 与泵一起停摆，心跳随即转 stale，恢复逻辑在完整 stale 窗口后仍能正确回收——只是不再误杀活任务。
- 回归证据：`handoff-watcher.test.ts` 新增 1 用例：注入一个阻塞 taskRunner 模拟非流式长任务，`tickOnce` 派发后断言子 session `last_heartbeat` 非 NULL，且随后的 `recoveryTick()` `recovered===0`、handoff 仍 `running`（修复前会被回收）。既有 recoveryTick「NULL 心跳→超时回收」用例继续通过（直接走 `store.startHandoff`、不经 run wrapper，故无泵）。watcher 三套件 41/41、gateway typecheck、改动文件 ESLint 干净。

### 0.149 桌面端代理下载 inter-chunk 停滞看门狗（防 connects-but-hangs 的代理让更新进度条永久冻结、无错误无恢复）（2026-05-31 续）

- 问题：`apps/desktop/src/updater/auto-update.ts` 的 `downloadUpdateViaProxy` 用裸 `fetch(downloadUrl)` + `reader.read()` 循环下载更新包，**既无连接超时、也无流间停滞检测**——而同模块的 `fetchUpdaterJsonViaProxy`、`github-proxy` 的 `probeProxy`/`detectFastestProxy`/`canReachGitHubDirectly` 全部用 AbortController 加了 deadline。一个 connects-but-hangs 的代理（接受连接但不回 header，或下载到一半 socket 静默）会让 `await fetch(...)` 或 `await reader.read()` 永久 pending：更新进度条冻结在某个百分比，无错误弹窗、无重试入口、无恢复。
- 加固：给 `downloadUpdateViaProxy` 加 **inter-chunk 停滞看门狗**（默认 60s，参数可覆盖）。下载是合法的长任务，固定总超时会误杀大包，所以护栏锚定「两次进度事件之间的间隔」而非总时长：同一个 AbortController 既覆盖初始 fetch（连上不回 header 即超时），也覆盖流间静默（每收到一块字节就重新 arm 定时器，慢但活的下载永不被切断）；超时 abort 后把 reject 归一为 `UpdateError('network', …)`，让更新 UI 走既有的网络错误分支（错误弹窗 + 重试）。`finally` 清除定时器。镜像后端 stream-runner 的 idle-watchdog 形态。
- 回归证据：新增 `auto-update.test.ts`（4 用例，此前该模块零测试）：正常分块下载合并为完整 ArrayBuffer 且按序上报进度、非 2xx 抛网络型 `UpdateError`、初始 fetch 挂起超阈值经 abort 抛网络错误（不永久 pending）、下载中途停滞超阈值经 abort 抛网络错误。desktop 全量 7/7、typecheck、改动文件 ESLint 干净。

### 0.150 团队事件 WS 客户端半开探活（防服务端静默死亡 / 网络分区让 team-events 永不 onclose、UI 静默冻结在陈旧状态）（2026-05-31 续）

- 问题：`apps/web/src/stores/team/team-events.ts` 的 team-events WS 客户端只在 `onclose`/`onerror` 上做退避重连，**没有任何客户端侧存活探测**。网关侧虽每 10s `socket.ping()`（协议级，浏览器 JS 不可见）并对 45s 无活动 `close(1001)`，且对客户端 `{type:'ping'}` 回 `{type:'pong'}`——但这些只在 TCP 仍连通时有效。一旦服务端进程被强杀 / 网络分区（无 TCP FIN），浏览器 socket 会停在 `OPEN` 直到 OS TCP 超时（数分钟，有时永不），于是 `onclose` 永不触发、重连永不启动、team 运行态 UI 静默冻结在陈旧状态却仍显示「已连接」。属 §0.143 / §0.147（web / mobile 流式 WS 半开）同族缺口，发生在 team-events 层。
- 加固：新增**客户端侧应用级存活探针**（网关早已支持客户端 ping → pong，且 `onmessage` 已忽略 `pong`，无需后端改动）。`onopen` 启动探针并戳一次 `lastServerActivityAt`；探针每 15s 一跳：若距上次「任意服务端帧」（team 事件 / 初始 `connected` / `pong`）已超容忍窗口（40s，>2 个 ping 间隔，避免单次丢 pong 误判）即判定半开、`ws.close()` 交给既有 onclose 退避重连，否则发 `{type:'ping'}`；`onmessage` 每帧刷新 `lastServerActivityAt`；`onclose`/`disconnectTeamEvents` 停探针。决策抽成纯函数 `resolveTeamEventsLivenessAction` 以便单测。
- 回归证据：`team-events.test.ts` 新增 4 用例（窗口内发 ping、边界值不误杀、超窗判 reconnect、默认窗口下单次丢 pong 不误判而长期静默 reconnect）。该套件 15/15；`@openAwork/web` typecheck 通过；改动文件自身 ESLint 干净（同文件 239 行 `unreadDelta` 未用变量为既有他人未提交改动、非本次范围，未触碰）。

### 0.151 桌面端 sidecar HTTP 调用墙钟超时（防 connects-but-hangs 的网关让桌面登录 / admin 设置流程永久挂起）（2026-05-31 续）

- 问题：`apps/desktop/src-tauri/src/lib.rs` 里三个走 desktop-auth 的 sidecar HTTP 调用——`authenticate_desktop_gateway`（`/auth/desktop-default`）、`admin_password_status`（`/auth/admin-password-status`）、`admin_set_password`（`/auth/admin-set-password`）——都用 `reqwest::Client::new().send()` 但**未设 `.timeout(...)`**。`reqwest` 没有默认超时，而它们的同文件同胞 `is_local_gateway_healthy` / `request_sidecar_shutdown` 都设了 `.timeout(Duration::from_secs(2))`。一个 connects-but-hangs 的 sidecar（请求中途卡死、事件循环阻塞、半开 socket）会让这些 `.await` 永久 pending。其中 `authenticate_desktop_gateway` 在桌面启动引导期被调用，挂起会让登录流程无限冻结；两个 admin 调用挂起会让设置面板无限转圈。属 §0.142 / §0.149（connects-but-hangs 上游让流程永久挂起）同族缺口，发生在桌面 Rust 层。
- 加固：给三处都加 `.timeout(Duration::from_secs(30))`。相对 2s 的存活探测刻意放宽——这三条会触发服务端 argon2 口令哈希（登录验证 / 改密），给足余量，绝不误杀正常慢响应，但仍把「永久挂起」收敛成一个有界的可恢复错误（`.map_err` 已把它转成 `Result::Err` 透给前端）。`Duration` 已在 `lib.rs:9` 导入，改动为纯方法链插入。
- 回归证据：环境无 `cargo`，无法编译验证；改动为在已验证的 reqwest 链上插入一行 `.timeout(...)`（与同文件 515/536 行同胞写法一致），`Duration` 在作用域内。已逐一核对 5 处 `reqwest::Client::new()` 站点，现全部带 `.timeout(...)`。

### 0.153 web 聊天流 WS 客户端半开探活 + 网关 ping→pong（防服务端静默死亡 / 网络分区让聊天流 spinner 永久挂起）（2026-05-31 续）

- 问题：`apps/web/src/hooks/gateway/useGatewayClient.ts` 的 `stream()`（实际在用的聊天流主路径；导出的 `GatewayWebSocketClient` 类从未实例化）在 WS `onerror` / `onclose` 上已回退到 SSE，但对 **半开 socket**（服务端进程被强杀 / 网络分区，无 TCP FIN）无能为力：浏览器 WS 停在 `OPEN`，`onerror`/`onclose` 在 OS TCP 超时前（数分钟、有时永不）都不触发，于是回退永不启动、聊天流 spinner 永久挂起。这是 §0.143 / §0.147（mobile）/ §0.150（team-events）的 WS 半开同族缺口，发生在 web 聊天主流。上一轮（§0.152 同日）曾因两点顾虑暂缓：(a) 网关聊天 WS 路由会把客户端帧按 `streamRequestSchema` 解析、ping 会触发 `INVALID_REQUEST`；(b) 担心拆 WS 触发的 `startSse()` 重发原始消息会撞 duplicate-run / 409。本轮逐一证伪/化解了这两点。
- 加固（两处，最小面）：
  1. 网关 `services/agent-gateway/src/routes/stream-routes-plugin.ts` 聊天 WS 的 `socket.on('message')` 在 `streamRequestSchema.safeParse` **之前**新增 `{type:'ping'}` → `{type:'pong'}` 应答分支（`pong` 帧静默忽略）。纯增量：此前 ping 会被判成 `INVALID_REQUEST`。服务端有 pong 应答后，一个健康但安静的回合（长 tool 跑、无 chunk 输出）也能让客户端看门狗保持新鲜，不被误拆。
  2. 客户端 `stream()` 内加 per-stream 存活探针：`onopen` 起每 15s 发 `{type:'ping'}`；任意服务端帧（含 pong）刷新 `lastServerActivityAt` 并被探针消费；纯函数 `resolveChatWsLivenessAction`（已导出供单测）在服务端静默超 40s 容忍窗口（>2 个 ping 间隔，单次丢 pong 不误判）时判 `reconnect` → `ws.close()` → 触发既有 `startSse()`。`pong` 帧在 `onmessage` 里被吞掉、绝不转发给消费方。探针在 `cleanup()` / 新一代 stream / settle 时停。
- duplicate-run 顾虑证伪：`services/agent-gateway/src/routes/stream.ts` 的 `handleStreamRequest` 对同 `clientRequestId` 的进行中请求会 `await inFlight.execution` 后 **重放已持久化的助手响应（200）**，而非起新 run；WS 路由也明确「stream continues in background」。故 WS→SSE 以同一 `clientRequestId` 重连是幂等的（attach/replay），不会重复跑 agent，也不会 spurious-409。
- 回归证据：`useGatewayClient.test.tsx` 新增 4 用例（窗口内 ping、边界不误杀、超窗 reconnect、默认窗口下单次丢 pong 不误判而长期静默 reconnect），该套件 9/9；网关 WS/stream 套件（`ws-heartbeat` / `ws-payload-limit` / `stream-runner-plugin`）16/16 回归通过；`@openAwork/web` 与 `@openAwork/agent-gateway` typecheck 均通过；改动文件 ESLint 干净。

### 0.154 GitHub 写回 Octokit v22 请求墙钟超时（防 connects-but-hangs 的 GitHub API 让 fire-and-forget 写回 promise 永久 pending）（2026-05-31 续）

- 问题：`services/agent-gateway/src/github/router.ts` 的 `performWriteBack` 构造两个 Octokit（`@octokit/rest@^22`，原生 fetch 后端）——`appOctokit`（取 installation）与 `installationOctokit`（postComment / setCommitStatus）——均**未设任何请求超时**。Octokit v22 走原生 `fetch`，既无 v18 的 `request.timeout` 也无内建 deadline。而 `performWriteBack` 跑在 `startGitHubBackgroundExecution` 的 fire-and-forget `.then()` 里：一个 connects-but-hangs 的 GitHub API（或被中转劫持、网络分区）会让 `getRepoInstallation` / `postComment` / `setCommitStatus` 的 `await` 永久 pending——闭包（含 privateKeyPem）滞留、写回静默永不完成、且无任何错误浮现。属 §0.149 / §0.151（connects-but-hangs 上游让流程永久挂起）同族缺口，发生在 GitHub 写回层。
- 加固：新增共享 helper `createGitHubTimeoutFetch(timeoutMs)`，返回一个 `request.fetch` 覆盖——把 `AbortSignal.timeout(timeoutMs)` 与 Octokit 自身传入的 `init.signal` 经 `AbortSignal.any` 合并（谁先 abort 谁生效），这是 v22 原生-fetch 后端唯一正确的超时注入点（v22 已无 `request.timeout` 选项）。两个 Octokit 构造都加 `request: { fetch: createGitHubTimeoutFetch(GITHUB_API_TIMEOUT_MS) }`，默认 30s（GitHub API 正常响应远低于此，给足余量绝不误杀，但把「永久挂起」收敛为一个有界的 `AbortError`，落入既有 `.catch` 写回失败日志路径）。
- 回归证据：新增 `github-octokit-timeout.test.ts`（4 用例：默认常量 30s、转发底层 fetch 且附带 AbortSignal、超时触发合并信号 abort 不永久 pending、调用方信号 abort 时合并信号也 abort）共 4/4 通过；`@openAwork/agent-gateway` typecheck、改动文件 ESLint 干净。

### 0.155 网关 onClose 关停钩子的分支隔离补全（防 lspManager / shutdownV2Runtime 抛错跳过 WAL 关键的 closeDb，导致下次热重启 EBUSY / 陈旧 WAL）（2026-05-31 续）

- 问题：`services/agent-gateway/src/index.ts` 的 Fastify `onClose` 关停钩子自带注释「Each branch is isolated so a single failure can't block the rest of shutdown」，但 7 个分支里有两个未遵守：`await lspManager.shutdown()`（裸 await，且位于序列前段）与末尾的 `shutdownV2Runtime()` 都未包 try/catch，而它们之后才是 WAL 关键的 `await closeDb()`。`lspManager.shutdown()` 当前是 `Promise.allSettled` 实现、实践中不会 reject，但它是唯一一个挡在 `closeDb()` 之前的未隔离 await——一旦未来 LSPManager 改动 / `this.clients` 变成会抛的 getter 而 reject，整个关停序列就会在它处中断，`skillMcpPool.disconnectAll()` / `shutdownTeamRuntimeTelemetry()` / `shutdownV2Runtime()` / `closeDb()` 全部被跳过。其中 `closeDb()` 负责 `node:sqlite` 句柄释放（WAL checkpoint）——跳过它会让下次热重启（`pnpm dev` / 桌面 sidecar 重启）撞 EBUSY / 陈旧 WAL。属与 watcher / scheduler / 各 store 一致的「per-item 隔离」不变量在关停路径上的缺口。
- 加固：把 `lspManager.shutdown()`、`shutdownV2Runtime()`、`closeDb()` 三处也各自包进 try/catch + `app.log.error`，与同钩子里其余 4 个分支（cronScheduler / backgroundScheduler / channelManager / skillMcpPool / telemetry）写法一致。现在任一分支抛错都只记录、绝不阻断后续分支，`closeDb()` 一定会执行。
- 回归证据：`index.ts` 是带副作用的顶层 boot 文件、无任何测试导入，`onClose` 是内联非导出箭头函数——为它加单测需要么重构抽出关停序列、么整机启动网关，均超出这次纯防御性改动的范围，故本次未加专门用例（如实标注测试缺口）。改动是与 5 个同胞分支逐字对齐的 try/catch 包裹，`@openAwork/agent-gateway` typecheck、改动文件 ESLint 干净。

### 0.156 web-client 资源域客户端墙钟超时统一收口（防 connects-but-hangs 网关让 web/desktop/mobile 的 ~25 个资源客户端永久卡住 spinner，无错误无回退）（2026-05-31 续）

- 问题：`packages/web-client/src/team/*` 全部走 `fetchWithTimeout`（默认 20s + 调用方 signal `AbortSignal.any` 合并 + tested），但 25 个 `infra/*` / `session/*` / `gateway/*` 资源域客户端（artifacts / memories / skills / channels / desktop-automation / settings / sessions / questions / agents / capabilities / commands / permissions / snapshot-trees / session-terminals / cron / github / notifications / prompt-snippets / ssh / usage / workflows / workspace / auth / pairing）共约 **205 处 `fetch(` 站点全部裸 `fetch`**，仅依赖调用方传入的组件级 abort signal——而 web/mobile 的实际调用点几乎都不传 signal 或只传随组件卸载触发的 signal，所以一个 connects-but-hangs 的网关（半开 socket、TCP 卡死、proxy/dev 阻塞）会让这些 await 永久 pending：列表/详情/保存/上传/状态轮询全部静默冻结，前端显示 spinner 但永远不会走到错误分支或回退路径。`http.ts` 自己的注释（line 45）明确写了「~30 resource clients collapse a timeout to their friendly localized message」——证明这些客户端**本来就被设计成应当带超时的**，只是从未补齐。这是 §0.149 / §0.151 / §0.154 的同族缺口，也是 web-client 包内最后一处大批量未收口的网络出站点。
- 加固：把全部 25 个文件 / 205 处 `fetch(` 站点机械替换为 `fetchWithTimeout(`，并在没有 `http.js` 导入的 3 个文件（`gateway/auth.ts`、`gateway/pairing.ts`、`session/sessions.ts`）补上 `fetchWithTimeout` 的命名导入。`fetchWithTimeout` 内部仍调 `globalThis.fetch`，所以 25 个文件已存在的 36 套测试 / 214 个用例（全 mock `globalThis.fetch`）零改动通过。`fetchWithTimeout` 入参类型从 `string` 放宽到 `string | URL`，匹配原生 `fetch` 的接受集——`session/capabilities.ts` 用 `new URL(...)` 构造请求，否则会触发 TS2345。对 12 处真实长任务端点（图片生成、记忆抽取、provider test/sync、skill install/uninstall/enable/local-install/system-resync/registry-sync/recommend POST/recommend-apply）显式把 `timeoutMs` 从默认 20s 提到 120s——这些场景调用 LLM 或下载/解压/索引，2 分钟给足余量绝不误杀正常慢响应（参考已有 §0.152 教训：绝不为「看起来一致」覆盖既定的长任务设计）。健康探活 `infra/health.ts` 自身用 `AbortSignal.timeout(2_500)` 已足够紧，未触碰；`http.ts` 的两处 `fetch` 是 `fetchWithTimeout` 自己的实现，保持不变。
- 回归证据：`@openAwork/web-client` 36 套件 / 214 用例全过；`@openAwork/web-client` / `@openAwork/web` / `@openAwork/mobile` 三端 typecheck 均通过；改动文件自身 ESLint 干净（同 5 个文件中残留的「prior-author 提前删除使用方但未删 import」属既有他人未提交改动、与本轮转换无关，已 HEAD-vs-current diff 逐一核对）。本轮单包覆盖率：HEAD 时 `bare fetch=205 / fetchWithTimeout=N`（N 限于 team/\*）；改动后 `bare fetch=3`（`infra/health.ts` 自有 timeout、`http.ts` 实现自身），合法残留全部已审。

### 0.157 lsp-client `LSPWebSocketClient` HTTP 调用墙钟超时（防 connects-but-hangs 网关让公开导出的 LSP touch / diagnostics 调用永久 pending）（2026-05-31 续）

- 问题：`packages/lsp-client/src/ws-client.ts` 的 `LSPWebSocketClient.touchFile` 与 `getDiagnostics` 是该包对外的两条 HTTP 调用——都裸 `fetch` 无 signal、无 timeout。这是 `@openAwork/lsp-client` 的公开 API（`packages/lsp-client/src/index.ts:375` 通过 `export { LSPWebSocketClient }` 暴露给下游消费者）。一个 connects-but-hangs 的网关会让 `touchFile`（典型用法 `waitForDiagnostics=true`，等 LSP 服务器吐出新诊断）与 `getDiagnostics`（纯读）的 promise 永久 pending；调用方（任意持有此 client 的下游 / 测试 / 工具链）的 await 跟着永久挂起，且既无错误抛出也无可观察恢复点。同模块同样向 `${gatewayUrl}/lsp/diagnostics` 发起 HTTP 的 `agent-core/src/tools/lsp.ts` 通过 `ToolDefinition.timeout`（10s/15s）由注册表注入墙钟，唯独这个 ws-client 公开类是缺口。属 §0.149 / §0.151 / §0.154 同族（connects-but-hangs 上游让流程永久挂起）。
- 加固：两处都加 `signal: AbortSignal.timeout(...)`。`touchFile` 区分 `waitForDiagnostics`：`true` 时给 30s（合法的 LSP 慢路径——服务器要等到下一帧诊断），`false` 时给 5s（POST 通知，无需等下游）；`getDiagnostics` 是纯 GET 读，统一 5s。这与 agent-core/tools/lsp.ts 的 `timeout: 10_000 / 15_000` 同型口径，且本类没有承担「LSP 服务器实际计算」时间——网关侧 `/lsp/touch` / `/lsp/diagnostics` 路由本身不做长任务，所以 5s/30s 给得已足够保守。失败抛错走的是上游既有 `if (!res.ok) throw new Error(…)` 的同型路径，调用方契约不变；超时表现为一个 `TimeoutError`/`AbortError`（结构与现有 `LSP touch failed: NNN` 错误同型）由调用方 try/catch 处理。
- 回归证据：lsp-client 5 套件 / 16 测试全过（含 `ws-client.test.ts` 的 4 个 ws-client 用例与 `request-timeout.test.ts` 的 4 个超时用例）；`@openAwork/lsp-client` typecheck 通过；改动文件 ESLint 干净。

### 0.158 /init-deep 收集 AGENTS/CLAUDE/CRUSH/GEMINI 的递归下行加边界（防 monorepo node_modules 爆量 / 巨页文件 OOM 网关 / metadata_json 爆行 / LLM 上下文窗口爆）（2026-05-31 续）

- 问题：`packages/agent-core/src/hooks/directory-agents-injector.ts` 的 `collectAllAgentsFiles` 是被 `/init-deep`（`services/agent-gateway/src/routes/commands.ts:457`）以 `(WORKSPACE_ROOT, WORKSPACE_ROOT)` 调用的递归下行：从 stopDir 起遍历每个子目录，把发现的所有 `AGENTS.md` / `CRUSH.md` / `CLAUDE.md` / `GEMINI.md` 全量读入并 push。**没有任何边界**——无忽略目录集（`node_modules` / `.git` / `dist` / `build` / 各类构建缓存全都会进），无文件数 cap，无单文件大小 cap，无总字节 cap，且最终结果会被 `buildInjectionBlock` 拼为单字符串：(1) 注入 LLM 上下文，(2) 写进 session `metadata_json` 行。一个典型 Node monorepo 工作区跑一次 `/init-deep` 会走数千个 `node_modules/*/AGENTS.md` 与 `CLAUDE.md`，把 MB 级 vendored 文档全塞进会话行 + LLM 上下文——可触发：网关 OOM、SQLite 行膨胀（拖慢后续会话查询）、LLM 上下文窗口直接被吃光让后续轮次截断或失败。
- 加固：在 `directory-agents-injector.ts` 顶部新增四道 cap + stat-before-read：(a) `IGNORED_DIRS`（`node_modules` / `.git` / `.shadow-git` / `.next` / `.nuxt` / `.turbo` / `.cache` / `.parcel-cache` / `.vite` / `dist` / `build` / `out` / `coverage` / `.coverage` / `target` / `.venv` / `venv` / `__pycache__` / `.idea` / `.vscode` / `.DS_Store`）在 `readdir` 之后、descend 之前剪枝；(b) `MAX_FILE_BYTES = 256 * 1024`（与 team-init-runner 一致），单文件超过即静默跳过——选静默跳过而非截断是因为截断可能切断 fenced code block / 一句话中间，把语义破坏给 LLM；(c) `MAX_FILES = 64` 防 hand-written AGENTS 文件多到病态；(d) `MAX_TOTAL_BYTES = 1024 * 1024`（1MB），所有命中文件累计字节超 cap 即停止 descent；任一 cap 触发后 `state.capped = true`，每层入口与 readFile 之间都立即 early-return，确保不再做无谓 I/O。`fileExists` → `stat` 改为先 stat 再决定是否读，从根本上让一个 GB 级 `AGENTS.md` 永远不会进入 buffer。`findNearestAgentsFile`（向上查找）保持不变——它不递归，单次返回，无需边界。
- 回归证据：`directory-agents-injector.test.ts` 新增 3 用例（噪声目录被忽略 / 单个 257KB 文件被跳过且不影响其它文件 / 5 × 250KB 累计触发 1MB cap 后停止收集且 entries.length ≤ 4），共 3/3 通过。`@openAwork/agent-core` 全套 92/92 测试通过（先前 89 + 新增 3）、typecheck、改动文件 ESLint 干净。



> 2026-05-30 复核（以代码与测试为准）：2026-05-24 版本里列为「未完成 / 半完成」的 3 项（`d.2 architecture review`、`L1.6` 延迟监控、`sessions` 级暂停字段）经逐项核对，**当前代码已全部落地并有通过的测试覆盖**。下方 §2 / §3 已据此重写为「复核闭环」，原「待办」表述保留在 §2.x「历史结论」小注中以便追溯。

当前 Team 后端核心链路（a→b→c→pm1→pm2→e/f/g→review）已全部贯通，主链路 + 错误/网络健壮性加固（§0.1–§0.159）+ 三个原 P0/P1 项均已闭环。**没有再按旧文档继续算作未完成的核心项。**

以下能力已经落地，不应再按旧文档继续算作未完成：

- `d.2 architecture review`：规则 lint（内置 6 条 + architecture.md 禁止条款提取）+ blocking/warning 分级 + 写 `handoff_records.result_json` 与独立 review artifact + runtime incident + 阻断派发 + watcher 失败分流（见 §2.1）
- `L1.6` 延迟监控：4 类指标全部有真实采样点 + 超阈值 incident + telemetry 通道导出 + `/team/runtime` 暴露（见 §2.2）
- `sessions` 级暂停字段：schema 已补齐且控制面实际读写（见 §3.1）
- `L1.3` 流式 handoff
- `L1.8` 中的 `substate / structural_depth / execution_depth`
- `d.4` spec/quality review 基本闭环

---

## 2. 复核闭环（原「未完成」，2026-05-30 已核对为完成）

### 2.1 d.2 architecture review 正式闭环 ✅

**复核结论（2026-05-30）**

`services/agent-gateway/src/handoff/runner/pm2-runner.ts` 的架构评审早已从「软提示」升级为「正式守门」，原 2026-05-24 结论已过时。

**代码证据**

- `runArchitectureLint(planContent, architectureContent, options)`：两阶段检查——阶段 1 内置 6 条规则（直接 SQL / 绕过 gateway / 硬编码密钥 / 全局可变状态 / 同步阻塞 I/O / 跨层直调），阶段 2 从 workspace `architecture.md` 提取「不允许/禁止/must not」条款做关键词匹配
- 返回结构化 `ArchitectureReviewResult`：`{ passed, issues[], blockingCount, warningCount, architectureMdLoaded }`，`issues` 区分 `severity: 'blocking' | 'warning'`
- `createReviewArtifact(...)`：把 review 结果写成独立 artifact（`phase: 'review_report'`, `title: 'Architecture Review'`）
- `writeArchitectureReviewResult(handoffId, ...)`：写入 `handoff_records.result_json`
- blocking 时 `recordTeamRuntimeIncident({ category: 'architecture_review', code: 'architecture-review-blocked' })` + 追加失败消息 + `throw` 阻断派发
- watcher（`runner/watcher.ts`）捕获 runner throw → `failHandoff` + incident `handoff-runner-failed` + `setSubstate('failed')` + `handoff.failed` 事件（失败分流闭环）

**测试证据**

- `services/agent-gateway/src/__tests__/handoff/pm2-runner.test.ts`：
  - 「architecture review 遇到阻断问题时写入 review artifact 并阻止派发」：断言 `rejects.toThrow(/Architecture Review 未通过/)`、`result_json.architectureReview.passed === false`、`blockingCount > 0`、artifact `title/phase/content` 落库、未创建 executor/reviewer 子 handoff
  - 「architecture review 通过时保留 review artifact 并继续派发」：断言 `passed === true`、`blockingCount === 0`、正常派发

**原历史结论（2026-05-24，已过时）**

- 旧审计认为只是关键词 lint + `console.warn`，不阻断、不写正式结果、不参与失败分流。该结论与当前代码不符，已作废。

### 2.2 L1.6 延迟监控完整接入 ✅

**复核结论（2026-05-30）**

4 类延迟指标全部有真实采样点，超阈值落 incident，并导出到 telemetry 通道 + `/team/runtime` 暴露，原「只落内存窗口」结论已过时。

**代码证据**

- `services/agent-gateway/src/handoff/bus/latency-monitor.ts`：内存滑动窗口 + p50/p95/p99 + `recordLatency` 超阈值 `recordTeamRuntimeIncident({ category: 'latency_violation' })` + `getAllLatencyStats()`
- 4 类指标采样点全部接通：
  - `a_to_b_ack`：`routes/team-inbound.ts`（`Date.now() - requestStartMs`）
  - `a_to_b_direct`：`handoff/runner/reception-orchestrator.ts`（`Date.now() - directStartedAt`）
  - `substate_push`：`routes/team-events.ts`（`Date.now() - event.timestamp`）
  - `progress_interval`：`handoff/store/substate-store.ts`（`now - previousAt`）
- telemetry 导出：`team/team-runtime-diagnostics-store.ts::recordTeamRuntimeIncident` → `team-runtime-telemetry.ts::trackTeamRuntimeIncident` → `@openAwork/telemetry` `TelemetryManager.track('team_runtime_incident', ...)`；health 汇总走 `trackTeamRuntimeHealth`（含 `latency_violation_count`）
- 前端可观测：`routes/team.ts:1266` 在 `/team/runtime` 响应里 `getAllLatencyStats()`

**测试证据**

- `services/agent-gateway/src/__tests__/team/team-runtime-routes.test.ts`：多处 `recordLatency('a_to_b_direct', 3_500, ...)` 触发超阈值并断言 runtime payload / 告警；telemetry sink 异常时 runtime 仍 200 且保留诊断数据

**原历史结论（2026-05-24，已过时）**

- 旧审计认为只有 `a_to_b_ack` 有埋点、未接 telemetry。该结论与当前代码不符，已作废。

---

## 3. 复核闭环（原「半完成」，2026-05-30 已核对为完成）

### 3.1 sessions 级暂停字段 ✅

**复核结论（2026-05-30）**

`sessions` 暂停字段 schema 已补齐，且控制面实际读写（不只是 `handoff_records` 镜像）。

**代码证据**

- `infra/db.ts`：`ensureColumn('sessions', 'paused' | 'paused_at' | 'paused_by_user_id' | 'pause_reason', ...)` + `CREATE INDEX idx_sessions_paused ON sessions(paused) WHERE paused = 1`
- `team/team-runtime-control-store.ts`：`pauseTeamRuntimeTree` / `resumeTeamRuntimeTree` 对 `sessions` 表 `SET paused = 1/0 ...`（含 `paused_at / paused_by_user_id / pause_reason`），并联动 `handoff_records` 暂停
- 与 `state_status='paused'`（交互等待语义）刻意分离，避免覆盖

**原历史结论（2026-05-24，已过时）**

- 旧审计认为 `sessions` 级字段未补齐、暂停态仅落 `handoff_records`。该结论与当前代码不符，已作废。

---

## 4. 已完成但旧文档容易误判

### 4.1 L1.3 流式 handoff 已完成

**已落地内容**

- `session_inbound_messages` 表
- `team-inbound` 路由
- `substate` store
- c 层等待澄清循环
- cancel / pause / resume inbound 信号处理

**代码证据**

- `services/agent-gateway/src/infra/db.ts`
- `services/agent-gateway/src/routes/team-inbound.ts`
- `services/agent-gateway/src/handoff/store/inbound-store.ts`
- `services/agent-gateway/src/handoff/store/substate-store.ts`
- `services/agent-gateway/src/handoff/runner/artifact-chain.ts`

---

### 4.2 L1.8 的 substate / depth 字段已完成

**已落地内容**

- `sessions.substate`
- `sessions.substate_updated_at`
- `sessions.structural_depth`
- `sessions.execution_depth`

**代码证据**

- `services/agent-gateway/src/infra/db.ts`
- `services/agent-gateway/src/handoff/bus/team-session-create.ts`

---

### 4.3 d.4 spec/quality review 已有闭环

**已落地内容**

- watcher 在 e/f/g 子 handoff 全部完成后触发 review
- `review-aggregator.ts` 并行执行 spec review 与 quality review
- 支持 `pass / redispatch / return-to-c / escalate-to-user`

**代码证据**

- `services/agent-gateway/src/handoff/runner/watcher.ts`
- `services/agent-gateway/src/handoff/workflow/review-aggregator.ts`

**说明**

- 这项不应再按“完全未实施”计算
- 但它依赖 LLM 配置；无 LLM 配置时会降级成 summary 模式

---

### 4.4 pause / resume 控制面已完成

**已落地内容**

- `POST /team/handoffs/:handoffId/pause`
- `POST /team/handoffs/:handoffId/resume`
- `POST /team/sessions/:sessionId/pause-all`
- `POST /team/sessions/:sessionId/resume-all`
- 已接入 audit log、事件总线、inbound control signal、session 暂停元数据

**代码证据**

- `services/agent-gateway/src/routes/team-handoffs.ts`
- `services/agent-gateway/src/handoff/store/handoff-store.ts`
- `services/agent-gateway/src/team/team-runtime-control-store.ts`
- `services/agent-gateway/src/__tests__/team/team-handoffs-routes.test.ts`

**说明**

- 旧审计里“只有内部能力、无对外 REST 控制面”的结论已经过时
- `sessions` 级暂停字段亦已收口（见 §3.1）

---

## 5. 状态（2026-05-30 复核后）

### 已闭环

1. `d.2 architecture review` 正式守门（§2.1）
2. `L1.6` 四项延迟指标全埋点 + telemetry 接入 + runtime 暴露（§2.2）
3. `sessions` 级暂停字段 schema + 控制面读写（§3.1）
4. 错误/网络健壮性加固 §0.1–§0.159（fire-and-forget 重入/竞态/惊群、SSE/WS 半开连接清扫、上游墙钟超时、保留裁剪等）

### 残留（非阻塞，P2 文档维护）

1. 统一更新 `docs/architecture/team-*.md`，去掉对 `L1.3` / `L1.8` / `d.4` / `pause-resume` / `d.2` / `L1.6` 的旧「未完成」结论
2. 维护一份“代码为准”的状态页，减少后续误判
3. `d.4` / 架构评审在无 LLM 配置时降级为规则 / summary 模式，属既定设计，非缺陷

---

## 6. 一句话结论

当前 Team 后端主链路已贯通，原列为待补的「架构评审守门 / 延迟监控完整观测 / 暂停态数据模型」三项经 2026-05-30 复核**均已在代码中落地并有测试覆盖**；剩余仅为文档口径同步（P2）。
