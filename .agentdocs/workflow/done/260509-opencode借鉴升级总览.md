# 260509 — opencode 借鉴升级总览（已归档）

> **状态**：✅ 已归档 2026-05-09 — P0 / P1 / P2 / P3 八份子工作流全部完成或显式推迟决议，详见下方各 Phase。本文已移入 `done/`，剩余推迟项的状态在 [Deferred Items Tracker](#deferred-items-tracker) 段维护。

## Final Status (2026-05-09)

- **agent-gateway 测试**：335 → **472**（+137）
- **agent-core 测试**：新增 14 项（searchMultiProvider 套件）
- **新增源码模块**：`compaction-prompt.ts` / `cancel-descendant-streams.ts` / `repo-reference.ts` / `repo-clone-tools.ts` / `repo-overview-tools.ts` / `session-path-filter.ts` + `searchMultiProvider` 多 provider rollout 函数
- **修复的真实 bug**：(1) P1-SCOUT mutex 内存泄漏 + tool-sandbox 未注册新工具；(2) P3-DEVBROWSER skill prompt 引用 OpenAWork 不存在的 API 误导 LLM；(3) P0 GPT-5 reasoning_effort 上游 400；(4) P0 `server_is_overloaded` 不被识别为可重试

## Deferred Items Tracker

按"价值 / 工程量"复审后，下列项**显式不在本批落地**，触发条件请见各项注解：

| Phase | 推迟项 | 理由 | 触发条件 |
|---|---|---|---|
| P1-CANCEL | UI: 取消原因（reason）显示 | 纯 UX 增强，需先扩展 SSE event payload | 用户反馈"看不到为什么停了" |
| P1-SCOUT | UI: web/desktop repo_clone / repo_overview 工具结果卡片 | 不影响功能，只影响视觉呈现 | UI 升级批次一并做 |
| P2-WEBSEARCH | settings UI: 多 provider 配置 + rolloutMode 开关 | core 层已 OK，缺前端入口 | settings 页面整体改造时 |
| P2-DEADCODE | `/remove-deadcode` slash command | 工程量大（LSP 集成 + 命令注册 + UI），且与本批 schema 改动正交 | 单独立 workflow |
| P3-WARP | session warping 阶段 0–2 | OpenAWork 单 instance 模型与 opencode multi-instance 不同，详见 ADR | 阶段 0：≥3 用户反馈；阶段 2：.NET Wave 3 |
| P3-PATH | apps/web sidebar "仅当前目录"开关 | 后端已落，前端已有 workspace 分组，再加开关增量小 | API/CLI 客户端反馈需要时 |

## 原计划 / 历史记录



## Task Overview

对照 `temp/opencode` (主线 2026-05-08 之前) 与 `temp/oh-my-opencode` (v3.0.1) 的近一到三个月更新，识别出 14 项对 OpenAWork 主仓库有借鉴价值的优化，按 P0–P3 划分子工作流，独立推进。本文档是入口与 DAG 协调中心。

## Current Analysis

- **opencode** 近一个月在 provider 兼容性 (GPT-5 / Gemini-3 / Anthropic 4.5)、会话压缩 (anchored summary)、子任务取消、工具排序、scout agent + repo_clone 等方向有大量迭代。
- **oh-my-opencode** 自 2026-01-25 起停在 v3.0.1，主要价值集中在 `delegate_task` schema 对齐、`/remove-deadcode` slash command、dev-browser SKILL.md。
- OpenAWork 主仓库与上述代码大量同源，但近 1–3 个月若干新修复 / 新工具尚未吸收，且已知存在如 GPT-5.1/5.2 reasoning 400 错误、`server_is_overloaded` 不重试、prompt cache 命中率受工具顺序波动影响等可观察问题。

## Solution Design

按"小步快跑 + 风险隔离"原则把 14 项优化拆为 9 份子工作流：

| 组别 | 子工作流 | 主题 | 估时 |
|---|---|---|---|
| **P0** | [260509-p0-provider兼容性修复批](260509-p0-provider兼容性修复批.md) | GPT-5 reasoning + Gemini thinking + overloaded retry + 工具排序 + reasoning 空 text 保留（5 项打包） | 半 ~ 1 天 |
| **P1** | [260509-p1-compaction锚点摘要升级](260509-p1-compaction锚点摘要升级.md) | 锚点摘要模板 + summary/tail 顺序 + 工具输出二次截断 + 受保护工具 | 1–2 天 |
| **P1** | [260509-p1-子任务取消正确传播](260509-p1-子任务取消正确传播.md) | task tool 父会话 abort 必须 await 子会话取消 | 半天 |
| **P1** | [260509-p1-scout-agent与repo研究工具](260509-p1-scout-agent与repo研究工具.md) | `repo_clone` / `repo_overview` 工具 + scout 内置 agent + 仓库引用解析 | 2–3 天 |
| **P2** | [260509-p2-并行websearch-rollout](260509-p2-并行websearch-rollout.md) | websearch 多 provider 并行 race，DDG rate-limit 容错 | 1 天 |
| **P2** | [260509-p2-task工具schema与slashcommand补齐](260509-p2-task工具schema与slashcommand补齐.md) | delegate_task schema 对齐 (`session_id`/`command`) + `/remove-deadcode` slash command | 半天 |
| **P3** | [260509-p3-session-warping评估](260509-p3-session-warping评估.md) | 会话跨 workspace warping 设计调研（不直接实现） | 1 天调研 |
| **P3** | [260509-p3-会话路径过滤与devbrowser-skill](260509-p3-会话路径过滤与devbrowser-skill.md) | 按当前目录过滤会话 + dev-browser SKILL.md 内置 | 1 天 |

## Complexity Assessment

- 原子步骤 14+ 项 → +2
- 并行流：是（provider / compaction / scout / websearch 互不阻塞） → +2
- 涉及模块 ≥3（`services/agent-gateway`、`packages/agent-core`、`apps/web`） → +1
- 单步 >5 min：是（scout 2–3 天、compaction 1–2 天） → +1
- 需持久化供后续 review → +1
- OpenCode 可用：否 → 0
- **合计：7 → Full orchestration**
- **Routing rationale**：14 项优化任务跨多个独立模块，并行价值高且需持续追踪，分子工作流独立维护

## Dependency DAG

```
P0 provider 修复批 ──┐
                    ├──► (互相独立，可任意顺序并行)
P1 compaction      ──┤
P1 子任务取消        ──┤
P1 scout agent     ──┤
P2 并行 websearch   ──┘
                    ▲
                    │ 不阻塞
P2 task schema     ──┐
P2 /remove-deadcode──┤
P3 路径过滤         ──┤
P3 dev-browser     ──┘

P3 session warping ──► 单独评估，不进入实施阶段
```

无强制阻塞依赖。建议执行顺序：**P0 → P1 任意一项 → P1 其余 / P2 / P3 按容量并行**。

## Implementation Phases

### Phase 0: P0 修复批 ✅ (已完成 2026-05-09)
- [x] T-P0-A: GPT-5 reasoning_effort 子型号分级（`provider-options.ts` clamp + 20 项测试）
- [x] T-P0-B: Gemini-3 / 2.5 thinkingLevel/Budget 对齐（`provider-options.ts` 重写 + 19 项测试）
- [x] T-P0-C: `server_is_overloaded` 重试白名单（`retry-classify.ts` 显式分支 + 4 项回归测试）
- [x] T-P0-D: 工具列表确定性排序（`stream-runner.ts` `sortToolsByName` + 6 项测试）
- [x] T-P0-E: Anthropic adaptive thinking 空 text 保留（已存在于 `unified-message-bridge.ts:144-151`，含测试覆盖）

集成验证：typecheck 通过 + agent-gateway 全量 335/335 vitest 通过。

### Phase 1: P1 核心稳定性
- [x] T-P1-COMPACT: compaction 锚点摘要 ✅（2026-05-09 完成；S3/S4/S5 早已就位，新增 S1+S2 锚点 prompt）
- [x] T-P1-CANCEL: 子任务取消传播修复 ✅（2026-05-09 完成核心，UI reason 推到下批）
- [x] T-P1-SCOUT: scout agent + repo_clone + repo_overview ✅（2026-05-09 完成 backend 全部，UI 卡片推迟）

### Phase 2: P2 体验增强
- [x] T-P2-WEBSEARCH: 多 provider 并行 race ✅（2026-05-09 完成 core 层 — `searchMultiProvider` + first-success/merge/sequential 三档 + canonical URL 去重 + 14 项单元，settings UI 推迟）
- [x] T-P2-DELEGATE: delegate_task schema 对齐 ✅（2026-05-09 完成 — session_id 重命名早就到位，新增 command 字段为 reserved no-op + 15 项 schema 测试，OpenAWork slash command 为 server action 模型与 opencode 模板模型不同）
- [ ] T-P2-DEADCODE: `/remove-deadcode` slash command（推迟，独立工作流）

### Phase 3: P3 长尾 / 评估
- [x] T-P3-WARP: session warping 设计调研 ✅（2026-05-09 产出 ADR；结论：**阶段 0（仅切换 workingDirectory, 2–3 天）推荐但不在本批落实施**；阶段 1/2 推迟 — OpenAWork 单 instance 没有 sync 层，opencode 的 `owner_id` 价值不适用）
- [x] T-P3-PATH: 会话按目录过滤 ✅（2026-05-09 完成后端 — `/sessions?path=&includeDescendants=` + `session-path-filter.ts` 纯函数 + 18 项单元覆盖 `/a` vs `/abc` 安全前缀；前端 sidebar 开关推迟到 UI 升级批次）
- [x] T-P3-DEVBROWSER: dev-browser SKILL.md 内置 ✅（2026-05-09 完成 — 关键发现 v1 prompt 是 oh-my-opencode 逐字拷贝引用了 OpenAWork 不存在的 API 会误导 LLM；rewrite 为 v2.0.0 对齐真实 `desktop_automation` 单 action 表面 + 18 项单元含反回归 token 黑名单）

## Verification Strategy

每个子工作流自包含验证（typecheck / vitest / 手工跑一轮 stream）。本总览仅在所有子工作流完成后做一次"集成回归"：

- `pnpm --filter @openAwork/agent-gateway typecheck`
- `pnpm --filter @openAwork/agent-gateway run test:unit`
- `pnpm --dir apps/web exec tsc --noEmit`
- 桌面端 sidecar build dry-run
- 手工 1 轮含 thinking + tool calls 的会话压缩闭环

## Source References

- opencode commits（关键集合）：
  - `40d5ea1cf` scout + repo_clone + repo_overview
  - `574b2c217` + `811954880` 锚点 compaction + tail 顺序
  - `75d141b57` 子任务取消
  - `83bb21648` 工具排序
  - `233fc5b91` 空 text 保留 reasoning
  - `1cf8123bc` GPT-5 reasoning 分级
  - `c36ab3f93` Gemini thinking
  - `25ecf0af6` overloaded retry
  - `a43d3e0e1` 并行 websearch
  - `22a4a9df8` + `3c4b4d5fa` session warping
  - `9209c0437` 路径过滤
- oh-my-opencode：
  - `14f450b` delegate_task schema 同步
  - `212baa6` /remove-deadcode
  - `bccc943` dev-browser skill

## Notes

- 不接受任何会破坏 .NET 10 gateway 双轨迁移现状的改动；P0/P1 改动应优先落 TS 端，再评估 .NET 对齐切片。
- session warping 仅做调研，避免和 Wave 2 sessions/event_log 改动冲突。
- 所有子工作流完成后再统一更新 `index.md`、写一条 Architecture Decision 记录"opencode 借鉴第一轮收口"。
