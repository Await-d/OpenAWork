# 261103-handoff-store 拆分（请求键注册表 + 重试策略）

> 来源：`261102-移除omo耦合与提示词替换` 遗留表 L-1（`handoff/store/handoff-store.ts` 1316 行，处于项目规则的「1300–2000 行预警区」）。
> 项目规范（`AGENTS.md`）对该区间的要求是「主动评估拆分」——本任务据此执行。

## 一、拆分前的评估（为何只拆这两块）

`handoff-store.ts` 1316 行的结构：类型（:40-111）、重试常量与纯函数（:113-147）、payload 与行映射（:148-187）、review-disposition 纯助手（:188-337）、创建入参 + 请求键注册表 + 回合键解析（:338-547）、handoff 状态机与 DB 操作（:549-1316）。

按"**最小风险优先**"选择切面，只拆两块**纯代码**（不触 DB、不依赖其它业务模块）：

| # | 抽出内容 | 新文件 | 行数 | 依赖 |
| --- | --- | --- | --- | --- |
| 1 | 网关内部请求键形状注册表 + `isGatewayInternalRequestKey` | `handoff/store/gateway-internal-request-key.ts` | 147 | 无（纯数据 + 纯函数） |
| 2 | 失败重试策略（不可恢复原因前缀/子串、重试预算、退避计算） | `handoff/store/handoff-retry-policy.ts` | 41 | 无（纯常量 + 纯函数） |

**刻意未拆**（留给后续独立评估，避免一次性大手术）：
- `resolveSessionTurnClientRequestId`（含 DB 查询：`SELECT … FROM handoff_records`）——与状态机耦合较深；
- review-disposition 纯助手（≈150 行）——需要同时迁移 `ReviewDisposition*` 类型，涉及外部消费者（review-aggregator 等）；
- `parsePayload` / `mapRow` —— 被核心 DB 函数密集使用。

## 二、结果

| 文件 | 拆分前 | 拆分后 |
| --- | --- | --- |
| `handoff-store.ts` | 1316 行 | **1162 行**（**离开 1300 预警区**） |
| `gateway-internal-request-key.ts` | — | 147 行（新增） |
| `handoff-retry-policy.ts` | — | 40 行（新增） |

**兼容性**：`handoff-store.ts` 对两处保持**再导出**（`GATEWAY_INTERNAL_REQUEST_KEY_SHAPES` / `isGatewayInternalRequestKey` / `GatewayInternalRequestKeyShape` / `MAX_FAILED_HANDOFF_RETRY_COUNT` / `computeAutoRetryDelayMs` / `computeAutoRetryAvailableAtMs`），因此**所有既有 import 路径与调用点零改动**（含 `handoff/runner/{pm2-runner,pm2-quality-review-reconciler,watcher}.ts`、`session/stream-session-title.ts`、`routes/stream.ts`、`cron/schedule-admin-tools.ts`、`task/task-wake-budget.ts`、守卫脚本 `verification/verify-team-turn-rollback-internal-keys.ts`）。

同时按上一任务的教训处理了"纯再导出不绑定本地名字"：`handoff-store.ts` 内部仍在使用的 5 个符号走**顶部 `import`**，公面符号走 `export { … } from`。

## 三、门禁（含时点）

| 命令 | 结果 |
| --- | --- |
| `handoff-store` + `artifact-chain` + `dispatch-dependencies` + `handoff-scheduler` | **91 passed (4 files)**（09:34） |
| `planning-contract` + `completion-protocol-contract` | **18 passed (2 files)**（09:34） |
| `handoff-watcher` + `executor-runner-failure` | **2 files passed**（09:35） |
| `bun src/verification/verify-team-turn-rollback-internal-keys.ts`（请求键守卫脚本，源码扫描 builder 前缀登记） | **exit 0**（09:34） |
| `bun run --filter @openAwork/agent-gateway typecheck` | **0 error**（09:33） |
| `eslint` + `prettier --check`（3 文件） | **exit 0 / All matched use Prettier style** |

**重构前基线**：`handoff-store.test.ts`(45) + `artifact-chain.test.ts` → **66 passed**（09:29），与重构后同集合全绿对照。

## 四、风险与处置

| 风险 | 处置 |
| --- | --- |
| 拆分引入循环依赖 | 只拆**无依赖**的纯块；新文件不 import `handoff-store` |
| 既有消费者断链 | 保留再导出；由 8 个测试文件 + 守卫脚本覆盖 |
| 与并行工作流撞车 | 动手前确认 `handoff/` 目录当日内无活跃写入（最后写入 11-02 23:15；当日活跃区在 `infra/db.ts`、`routes/stream-runtime.ts`） |
| 大手术一次做完 | 只拆 2 块共 176 行（另新增 22 行 import 与再导出），其余切面登记在案 |

## 五、遗留

- 剩余可拆切面（review-disposition 助手 ≈150 行、`resolveSessionTurnClientRequestId` 的 DB 部分、`parsePayload`/`mapRow`）登记为后续候选；
- `handoff-store.ts` 现为 1162 行（低于预警阈值），若继续增长可再按上表切面续拆。
