# 定时任务契约收口实施现状

核查日期：2026-11-02。本文替代先前把设计稿当实现的总结，不代表新增 `/scheduled-tasks` API 已上线。

## 本轮完成范围

### T-20：共享 wire 与边界 schema

- `packages/shared/src/scheduled-tasks.ts` 描述现有 `/cron/jobs` 记录、视图、响应外壳与执行记录。
- `packages/shared/src/scheduled-tasks-validation.ts` 提供创建、PATCH、历史查询 Zod schema。
- 枚举、输入类型由 schema 推导，经 `packages/shared/src/index.ts` 对外导出。
- `shared` 仅保留契约，无随机 ID、当前时间、持久化默认记录或重复调度业务规则。
- Zod 与网关采用兼容的 `^3.25.76`，不额外引入 Zod 4 主版本。
- 时间采用 Unix 毫秒；历史摘要使用真实字段 `outputPreview`，不使用 snake_case 摘要字段。

### T-21：生产路由接线

- `cron/router.ts` 已实际消费共享创建、PATCH、历史查询 schema。
- `cron/types.ts` 的任务与执行记录、`cron/schedule-display.ts` 的视图均引用共享类型。
- 保留 `/cron/jobs`、jobs/job/history 响应外壳及 run 的 jobId/executionId。
- 保留原认证、归属检查、工具入口与请求工作流，不新建重复 API 或调度器。
- PATCH 不补默认值；未知字段剥离；所有权、标识、历史计数不可经请求改写。
- 新增有限数字校验，拒绝 JSON `1e309` 解析出的无穷大时间。
- 可执行性、时区、未来触发与投递一致性仍由网关 `schedule-validation.ts` 单点负责。

客户端 `packages/web-client/src/infra/cron.ts` 保留公开类型名，并派生共享字段与输入类型；不在浏览器引入运行时 schema。
历史选项仍使用 `includePreview`，转换为 HTTP `preview`。
2026-11-02 复查修复：读取投递词表保留真实 channel，浏览器创建/编辑仍为 none/session/desktop 子集；渠道任务显示只读“渠道回发”，启停不改写投递。历史 expired 显示灰色“已过期”。

### T-24：真实回归与文档纠偏

真实路由测试新增三类覆盖：

1. 非有限时间拒绝，避免错误时间成功落库。
2. 共享 PATCH 无默认值及未知不可写字段处理。
3. 真实 401、跨用户 404、所有权注入保护、渠道配置透传与既有响应外壳。

更新 `docs/api/scheduled-tasks-contract.md`，删除不存在的端点、错误响应模型及未实现规则声明。
本总结不再把类型里的 expired、设计中的触发引擎或 UI SSE 视为已实现功能。

### T-23：任务专用 SSE（已实现）

- 网关新增 `GET /cron/events`（`services/agent-gateway/src/routes/cron-events.ts`），事件源
  为 `cron/cron-events-bus.ts`，已在 `src/index.ts` 注册。
- 事件 `cron.jobs.changed`，载荷 `{ reason, jobId }`；`reason` 词表
  `created | updated | deleted | enabled | disabled | run_started | run_finished`。
  所有发布点都在对应数据库写入成功之后。握手发 `retry: 1000`，心跳每 25s。
- 前端 `apps/web/src/pages/misc/use-schedules-page.ts` 由 15 秒轮询改为 SSE 驱动：
  收到事件去抖（`SCHEDULES_EVENT_DEBOUNCE_MS` = 300ms）后静默 `reload(true)`；
  `EventSource.onerror` 时降级回 15 秒轮询，`onopen` 恢复后停止轮询；卸载 / 依赖变化
  时 `close()` 并清理定时器。首屏加载、动作后刷新、`reloadSeq` 防旧响应覆盖、静默失败
  不弹横幅、忙碌互斥、页面激活 + 文档可见门控均保留。
- 定向测试：`apps/web/src/pages/misc/use-schedules-page.test.ts`（含可控 `EventSource`
  替身，覆盖事件去抖、断连降级 → 恢复停轮询、卸载 `close()`、激活门控）与
  `SchedulesPage.test.tsx` 共 18 个用例通过，exit 0。
- 仍存边界：断连期间的变更依赖「恢复后重拉」补齐（连接成功即补一次）；本端点不做
  增量续传（无 `Last-Event-ID`），客户端一律整表重拉。

## 已取得验证证据

初始失败命令（在 `services/agent-gateway` 执行）：

`bunx vitest run src/__tests__/routes/cron-routes.test.ts`

结果：exit 1，2 失败、15 通过。真实路由接受非有限时间返回 201；共享草稿 strict 与生产 strip 语义不一致。

修复后定向回归命令（同一目录）：

`node ../../node_modules/vitest/vitest.mjs run src/__tests__/cron/schedule-validation.test.ts src/__tests__/cron/schedule-display.test.ts src/__tests__/cron/schedule-admin-tools.test.ts src/__tests__/routes/cron-routes.test.ts --silent=passed-only`

结果：exit 0，4 文件、55 测试全部通过，包括路由 18、工具 21、展示 4、配置校验 12。
修改文件定向 ESLint exit 0，IDE 诊断 0；共享契约两文件独立 strict TypeScript 检查 exit 0。
全包类型门禁、依赖锁同步与客户端测试由主协调串行汇总；不能用 Vitest 通过代替 TypeScript 验证。

## T-22～24 剩余差距

- T-22：已有独立 `CronScheduler`、`agent-handler` 与 `delivery`，本轮没有新增第二 trigger-engine。仍需验证真实渠道端到端与执行取消边界。
- T-23：已新增任务专用 SSE（`GET /cron/events`）与前端订阅 hook，UI 同步实时闭环；仍未验证反向代理（Nginx / 云 LB）长时间掐断后的恢复体验与多标签页并存表现。
- T-24：本轮补齐真实路由与契约回归、纠正文档；未证明所有旧客户端兼容、全部投递模式端到端或覆盖率阈值达标。
- `expired` 仅在共享状态词表中保留。现有调度器没有对应新终态生成；恢复过期 at 时停用，按具体路径决定是否记录 failed。
- 定时触发因在途或全局额度不足而跳过时，每任务每分钟最多记录一条 skipped；不是每 10 秒。
- 手动立即运行可忽略停用态，但同样受并发额度与单任务在途互斥限制，拒绝返回 409，不记录 skipped。
- 2026-11-02 已修复提前释放：默认 10 分钟超时及时记 failed，但全局/同任务占位直到底层 handler 真正 settle 才释放；stopAll/同实例恢复不能绕过。未实现 abort，永久挂起会保持隔离占位而非超额放行。
- 优先级队列、每任务可配 maxConcurrency 与强取消均未实现。
- 当前未强制非当前 kind 的调度字段为 null，也未强制所有 channel 请求都有完整渠道绑定；文档不得把期望约束写成当前保证。
- 单独 `/enable` 直接更新调度器，不具备 PATCH 完整一致性校验的同等保证。

## 兼容原则

本次不新增 API、不改路径、不新增 Date wire 或无约束 AgentConfig，不自动迁移既有任务数据。
未知 JSON 字段不会因序列化自动消失，新增枚举也不天然保证旧 UI 兼容；兼容性必须以真实消费与测试为准。
提交、PR 审批、合并及发布不在本轮授权范围，未据此声称完成。
