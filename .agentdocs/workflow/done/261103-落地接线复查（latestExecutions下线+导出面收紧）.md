# 261103-落地接线复查（latestExecutions 下线 + 导出面收紧）

> 状态：✅ 已完成并归档（2026-11-03）。触发：用户要求「复查方案中的调整是否都完成了并接入使用了」→ 对定时任务页方案（261102 E 落地 + 之后各轮增补）做一次**落地 + 接线**审计：静态 4 维 + 运行时逐项触发，发现问题当场修掉。

## 复查方法

**静态（4 个维度，脚本已归档可复跑：`runtime/261102-定时任务页布局方案E落地/evidence/wiring-audit.mjs`）**

1. **孤儿文件**：`pages/misc/schedules/` 下每个模块是否真有生产引用（区分"仅测试引用"）；
2. **导出面**：每个 `export` 符号是否被定义文件之外引用；
3. **样式接线**：TSX 里的 `sch-*` 类名 ↔ CSS 选择器**双向**比对（用了没定义 / 定义了没用）；
4. **契约消费**：hook 返回值 vs 页面解构、视图 props 字段 vs 组件解构；
5. 补充：**动作调用覆盖**（6 个动作 + `busyJobId` 在每个视图里是否真有调用点）、**`data-*` 属性 ↔ CSS 属性选择器**双向比对。

**运行时（agent-browser + mock 网关，真实点击 / 原生 setter 派发 change）**
概览（KPI / 轨道 / 告警条与「立即重跑」）→ 视图切换（含偏好持久化与时间轴下的控件隐藏）→ 密度两档 → 内联历史 → 筛选与计数 → 动作链路（重跑 / 启停 / 改投递 / 投到会话选择器），以**网络请求**与 `agent-browser errors` 为证据。

## 发现与处理

| # | 发现 | 判定 | 处理 |
| --- | --- | --- | --- |
| 1 | `use-schedules-page` 的 `latestExecutions`（state + 接口字段 + `runReload` 里派生 + return 出去）**页面从不消费**，唯一消费者是它自己的测试 | **真问题：重构残留**。视图改成直接读 `job.lastExecution` 后，这份 map 成了无人消费的派生态，而测试还在「保护」它，肉眼看是绿的 | **整体下线**：删 state / 接口字段 / `runReload` 的派生与返回字段 / return 字段；测试断言改到真实数据路径（`jobs[0].lastExecution.status`） |
| 2 | 8 个符号「导出但全仓只有定义文件在用」：`ScheduleTone`、`ExecutionStatusDescriptor`、`ScheduleDayBucket`、`ScheduleDayGroup`、`SchedulesOverviewStats`、`SCHEDULE_DAY_BUCKETS`、`SchedulesClock`、`SessionOptionsResult` | 非功能性：多出来的公开面（用户看到的"调整"已接入，但模块边界不诚实） | 收回为模块私有（去掉 `export`），`tsc` 复验无「私有名被导出接口引用」问题 |
| 3 | 孤儿文件 / 类名↔样式 / 动作调用 / `data-*` 属性 / props 消费 | ✓ 全部健康 | 无需处理 |

修复后静态审计**四项全绿**：无孤儿文件、无未使用导出、**84 ↔ 84** 类名（无缺失、无死样式）、hook 22 个返回值全部被消费、6 个动作在视图内均有调用点、5 个 `data-*` 属性与 5 个 CSS 属性选择器一一对应。

## 运行时证据（本轮实测）

| 计划项 | 证据 |
| --- | --- |
| 概览 KPI×4 / 今日轨道 / 失败告警条 | KPI `6 条 / 5 条 / 1 次 / 1 条`；轨道 mark 1；告警条首行「⚠ 1 个任务最近一次执行失败」且含「立即重跑」 |
| 视图切换 + 偏好持久化 | 时间轴：6 条目 / 4 分组 / 消歧说明在位，排序与密度控件**隐藏**，`sessionStorage.viewMode='timeline'`；切回卡片后为 `'cards'` |
| 密度两档（D-02） | 紧凑：`data-density='compact'`、卡宽 **233px**、提示词 `clamp=1`，`sessionStorage.density='compact'` |
| 内联历史 | 5 条目 / 3 个「查看执行现场」/ 条数说明 / 产出摘要均在 |
| 筛选与计数 | 「最近失败」→ 1 张卡、计数「显示 1 / 6 条」 |
| 动作链路 | `POST /cron/jobs/job_weekly/run` 200（重跑落在**失败**任务上，语义正确）、`PATCH /cron/jobs/job_probe`（禁用、改投递）、「投到会话」弹层 4 条会话（含无标题兜底）→ 选中后再发一次 `PATCH` |
| 稳定性 | `agent-browser errors` 为空 |

## 门禁

`prettier --check` ✓ · `tsc --noEmit`（`pages/misc`）0 错 · `src/pages/misc/` 测试 **8 文件 67 用例** 通过。

## 沉淀

- **审计脚本已归档可复跑**：`runtime/261102-定时任务页布局方案E落地/evidence/wiring-audit.mjs`（`node` 直接运行；只改了页面族路径，可移植到其它页面做同样的「落地 + 接线」体检）。
- **教训：hook 里的「派生态」最容易变成无人消费的死状态**。重构把视图改为直接读原始字段后，原先给中间层准备的派生 map 就没人要了，而它自己的单测仍在保护它 —— 静态看起来是绿的。此类检查应成为重构收尾的固定动作（本次已把它写成脚本维度 D）。

## 遗留

无。
