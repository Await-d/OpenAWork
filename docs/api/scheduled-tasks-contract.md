# 定时任务 API 契约

核查日期：2026-11-02。本文描述现有 `/cron/jobs` 与 `/cron/events`，不是新增 API 的设计稿。

## 契约来源与边界

- 共享类型：`packages/shared/src/scheduled-tasks.ts`。
- 共享 Zod 边界：`packages/shared/src/scheduled-tasks-validation.ts`，从共享包入口导出。
- 真实路由：`services/agent-gateway/src/cron/router.ts`。
- 调度可执行性与投递配置规则：网关 `cron/schedule-validation.ts`，不是 shared 业务逻辑。
- 时间统一为 Unix 毫秒数字或 `null`，不传输 `Date` 对象。
- 所有路由要求认证；列表仅返回自己的任务，按 ID 操作他人任务与不存在任务均返回 404。

## 已有端点与响应

| 方法与路径                    | 成功响应                                            |
| ----------------------------- | --------------------------------------------------- |
| `GET /cron/jobs`              | 200，`{ jobs: ScheduledTaskView[] }`                |
| `POST /cron/jobs`             | 201，`{ job: ScheduledTaskView }`                   |
| `PATCH /cron/jobs/:id`        | 200，`{ job: ScheduledTaskView \| null }`           |
| `DELETE /cron/jobs/:id`       | 204，无正文                                         |
| `POST /cron/jobs/:id/run`     | 202，`{ ok: true, jobId, executionId }`             |
| `POST /cron/jobs/:id/enable`  | 200，`{ ok: true, job: ScheduledTaskView \| null }` |
| `POST /cron/jobs/:id/disable` | 200，`{ ok: true, job: ScheduledTaskView \| null }` |
| `GET /cron/jobs/:id/history`  | 200，`{ history: ScheduledTaskExecution[] }`        |
| `GET /cron/events`            | 200，`text/event-stream`（任务专用 SSE，见下节）    |

没有 `/scheduled-tasks`、单任务 GET 详情、单次执行 GET 端点。
列表没有已实现的分页参数。

## 任务变更 SSE：`GET /cron/events`

真实路由：`services/agent-gateway/src/routes/cron-events.ts`（注册于 `src/index.ts`），
事件来源 `services/agent-gateway/src/cron/cron-events-bus.ts`。
前端消费：`apps/web/src/pages/misc/use-schedules-page.ts`。

- **鉴权**：JWT 走查询串 `?token=<jwt>`（`EventSource` 无法设自定义 header，与
  `/mcp/events`、`/sessions/:id/stream/sse` 同约定）。连接时校验一次；token 无效或缺失
  返回 `401 { error: '未授权或登录已失效。' }`（尚未写头，是普通 JSON 响应）。
- **用户级隔离**：连接建立后按 `userId` 过滤事件，订阅者看不到他人任务变更。
- **握手**：建立后先发 `retry: 1000\n\n`（客户端自动重连间隔 1000ms）。
- **心跳**：每 25s 发送注释行 `: keepalive\n\n`；`EventSource` 不会把它当作消息。
- **事件名**：`cron.jobs.changed`。
- **载荷**：`data: { reason, jobId }`，`jobId` 可为 `null`（表示整表可能变化）。
- **`reason` 词表（当前 9 值）**：`created | updated | deleted | enabled | disabled | run_started | run_finished | run_skipped | schedule_error`。
  发布时机（除注明外，均在数据库写入成功之后）：`POST /cron/jobs`→`created`；
  `PATCH /cron/jobs/:id`→`updated`；`DELETE /cron/jobs/:id`→`deleted`；`.../enable`→`enabled`；
  `.../disable`→`disabled`；调度器每次执行在登记执行记录后发 `run_started`、在终态落库后发
  `run_finished`（`finally` 的收尾持久化之后，是真实 settle 点，非超时包装处）；
  `delete_after_run` 的一次性任务在**删除成功后**追加一条 `deleted`；到点但被跳过
  （任务在途 / 并发已满，会落一条 `skipped` 执行记录）→ `run_skipped`；建臂失败
  （表达式非法/无解、一次性任务缺时刻，会落一条 `failed` 执行记录）→ `schedule_error`。
- **客户端不得依赖封闭词表**：词表可能扩展（客户端按**事件名**触发静默重拉，不应按
  `reason` 分支处理，也不应断言其属于某个固定集合）。
- **刻意不发布的一处**：网关启动装载时对已过期 `at` 任务的自动停用（`restoreJobs` →
  `upsertJob(at-disabled)`）**不发事件**——该路径只在启动阶段执行、此时客户端尚未连接，
  首屏 REST 已反映 `enabled:false` 的真实状态，补发无人接收。
- **载荷刻意精简**：只表达「有变化」，**不携带任务 / 执行状态**。客户端收到后必须
  **静默重拉既有 REST**（`GET /cron/jobs`），不得从事件直接拼状态——否则推送的旧快照
  可能覆盖客户端刚拉的新数据。
- **与轮询的关系**：任务页以 SSE 为首选通道（收到事件去抖约 300ms 后静默刷新）。当
  `EventSource` 触发 `error`（连接断开）时，前端**降级为 15 秒轮询**，避免代理静默掐断
  SSE 时界面永久停滞；**断连期间的变更由该降级轮询覆盖**。连接恢复（`open`）后立即停止
  轮询，并冲刷尚未落地的去抖事件。
- **已知边界**：无 `Last-Event-ID` 增量续传（事件不重放，靠「降级轮询 + 重连」保证最终一致）；
  代理长时间静默断连下的恢复体验未做真机验证。

## 创建与修改

创建必填 `name`、`prompt`、`schedule_kind`。
`name`、`prompt` 要求非空字符串；当前 schema 没有额外字符数上限，也不对字符串自动 trim。
`description` 不是支持的配置字段。

创建默认值：

- `schedule_at`、`schedule_every`、`schedule_expr`、`agent_id`、`model`、`working_folder`、`session_id`、`delivery_target`、`plugin_id`、`plugin_chat_id` 为 `null`。
- `schedule_tz: 'UTC'`、`delivery_mode: 'none'`、`enabled: true`、`delete_after_run: false`。

PATCH 所有可写字段均可选，**不注入创建默认值**，仅覆盖显式字段。
请求未知字段按既有 API 语义剥离，不使用严格拒绝模式。
`id`、`user_id`、`max_iterations`、计数与时间追踪字段不能由请求改写。
`max_iterations` 仅是历史存储列，不代表执行链路实现了迭代上限。

### 调度校验

- `schedule_kind` 为 `at | every | cron`。
- `at` 要求有限数字 `schedule_at`，创建与修改触发时间时必须在未来。
- `every` 要求整数 `schedule_every`，范围为 1000 至 2147483647 毫秒。
- `cron` 要求合法 5 段表达式、合法 IANA 时区，并在解析器的未来 8 年搜索窗口中有下一次触发。
- 显式提供非空 `schedule_expr` 时，路由还会验证其表达式语法，即使当前 kind 不是 cron。
- 当前不会强制将非当前 kind 的其他调度字段清为 `null`；建议调用方只提供相关字段。
- PATCH 只改名或停用既有过期 at 任务时允许保留过期时间；改变 kind、触发时间或显式 `enabled: true` 时重新要求未来时间。
- 独立 `/enable` 路由目前直接更新调度器，不等价于 PATCH 的完整配置校验。

### 投递配置

`delivery_mode` 的服务端词表为 `none | session | desktop | channel`。
`session` 需要 `delivery_target` 或 `session_id`，且不能与完整渠道绑定同时使用。
渠道绑定依据 `plugin_id` 与 `plugin_chat_id` 两者均为非空，不仅依据模式字符串；渠道执行由 agent 使用 `PluginSendMessage` 回发。
当前写入校验没有强制所有 `channel` 请求都具备这两项，也不强制其 `session_id` 为 null；不能把期望规则写成已实现保证。
浏览器创建/编辑仍仅支持 none/session/desktop；读取保留真实 channel，并显示只读“渠道回发”，启停不会重写渠道投递配置。

## 返回模型

任务记录保留 snake_case 原始字段：标识、归属、调度、prompt、agent/model/目录、投递配置、启停配置、`max_iterations`、`last_fired_at`、`fire_count`、`created_at`、`updated_at`。
视图额外提供 `scheduleKind`、`scheduleDisplay`、`fireCount`、`lastFiredAt`、`nextFireAt`、`status`、`running`、`lastExecution`。
`status` 只为 `enabled | disabled`；运行态用独立 `running`，避免运行时隐藏停用入口。

历史条目字段：

| 字段                        | 说明                                              |
| --------------------------- | ------------------------------------------------- |
| `id`、`job_id`              | 执行与任务标识                                    |
| `started_at`、`finished_at` | 毫秒时间，执行未结束时 finished_at 为 null        |
| `status`                    | 共享词表 running/completed/failed/skipped/expired |
| `error?`                    | 失败或跳过原因                                    |
| `session_id?`               | 本次执行会话，可查看完整现场                      |
| `outputPreview?`            | 按需生成的前 400 字符产出摘要，可能附省略号       |

历史响应不含必填 `user_id`、`created_at`，摘要字段是 **`outputPreview`**。
`expired` 当前只是共享兼容词表，不表示调度器已生成该终态；过期 at 的恢复处理是停用，必要时记录 failed。

## 历史查询

`GET /cron/jobs/:id/history?limit=20&preview=0`：

- `limit` 为整数，1～100，默认 100。
- `preview` 默认 true；字符串 `0`、`false`（大小写不敏感）关闭摘要，其余字符串为 true。
- 没有已实现的 `status` 过滤或 `include_preview` 参数。
- 浏览器 `CronHistoryOptions.includePreview` 是客户端选项，客户端转换为 HTTP `preview`，不是 wire 字段。
- 历史读取持久化表，而非仅调度器内存环形缓冲。

## 错误与立即运行

- 配置无效：400，`{ code: 'invalid_cron_job', error, issues }`。
- 任务不存在或不归当前用户：404，`{ code: 'cron_job_not_found', error }`。
- 手动运行被并发或在途互斥拒绝：409，`{ code: 'cron_job_busy', error, reason }`。
- `reason` 词表包含 missing/disabled/in-flight/busy；当前手动入口忽略 enabled，可运行停用任务，通常由在途或全局并发限制拒绝。
- 历史查询参数无效走通用参数解析错误，不保证使用上述 cron 配置错误外壳。

`OPENAWORK_CRON_MAX_CONCURRENT` 默认 3，最大 50；手动与定时触发都受该并发额度和单任务在途互斥约束。
定时触发被挡时每任务**每分钟最多记录一条 skipped**；手动被拒直接返回 409，不落 skipped，也不递增实际执行计数。

## 已知执行边界

现有 `CronScheduler`、`agent-handler`、`delivery` 分离调度、执行与投递，没有新增第二调度器。
默认 10 分钟墙钟超时及时将执行记为 failed，但不会提前释放占位；全局及单任务占位保持到 handler 真正成功或拒绝后才回收，stopAll/同实例恢复也不绕过。未实现强取消；永久挂起的 handler 会继续占用隔离位，需修复底层或重启进程恢复。
`delete_after_run` 当前在一次性任务的执行清理阶段处理，不应解读为所有周期任务成功后删除。
优先级队列、每任务可配并发与新的执行结果 SSE 本轮均未实现。
