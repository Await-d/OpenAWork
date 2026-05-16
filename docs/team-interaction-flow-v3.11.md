# Team 完整交互流程图（v3.11 已拍板版）

> ⚠️ **v3.12 修订提示（2026-05-16）**：本文档基于 v3.11 的"原子 handoff + 一个 LLM 干所有事"设计绘制。v3.12 已修订关键架构：
>
> - **D24 增加 3 个 escape hatch**（详见 `team-architecture-l1-baseline.md` L1.4）
> - **handoff 协议从原子升级为流式 + 子状态机 + 双向消息通道**（L1.3）
> - **b 层和 d 层强制拆分为"规则代码 + 多 LLM agent"**（L1.2）
> - **Phase A 剥离 SOUL，只验证 constitution 编辑假设**（`team-architecture-phase-a-decisions.md`）
>
> 本流程图保留作为讨论历史。**最新设计以 L1 基线为准**。
>
> ---
>
> 文档目的：把 `team-architecture-spec-kit-borrowing-discussion.md` v3.11 中**全部 56 项已拍板决策**落到一张可视的端到端流程图，便于团队对齐与 Phase A 设计稿引用。
>
> 创建时间：2026-05-15（v3.6）→ 更新：2026-05-15（v3.11）
> 关联文档：`docs/team-architecture-spec-kit-borrowing-discussion.md` v3.11
>
> 已拍板决策（23 项）：
>
> - **D11+D12** 五层架构（a/b/c/d/e-g）
> - **D24** 跨层禁止直连，强制走 handoff
> - **D34** 双存储记忆（user_memory DB + project-memory git）
> - **D29** B1+B2 失败恢复（结构化反馈 + 硬上限兜底）
> - **D18** 双深度限制（结构 4 + 执行 2）
> - **D40** BackgroundTaskScheduler 抽象 + InProcessScheduler MVP
> - **D41** C2+C3 记忆生效模式（默认静默 + 立即生效按钮）
> - **D42** 团队级运行管控 + 一键暂停
> - **D43** 工具能力门控（hybrid：能力类别 + 工具白名单分两层）
> - **D28** e/f/g 有限并行（e/f 并行，g 等两者完成）
> - **D44** 各层提示词风格基调（5 层 5 维度，含 b 主动建议）
> - **D45** 架构规范 architecture.md（仓库级 10 类 + 3 check 点 + 初始化流程）
> - **D46** 动态编制（e 最少 2 并行可配上限，f/g 固定）
> - **D47** 每层 LM 模型用户前端可配
> - **D48** 注入栈自动压缩（达阈值触发，规范类不压）
> - **D49** 进度展示（各层状态 + 进度条 + 预估时间）
> - **D50** 全局并发上限（双层限制 + FIFO 可调序 + 自动降级）
> - **D51** 崩溃恢复（心跳+超时 / 自动重试 1 次 / 保留产物）
> - **D52** 并发修改（memory 追加无锁 + constitution 乐观锁 / 写入时检测）
> - **D53** 优雅降级（三级降级可配 / fallback 模型 / 标注+可重跑）
> - **D54** 学习闭环（高频失败沉淀 / lessons-learned.md / d 提议+用户确认）
> - **D55** 跨 team memory（project-memory + lessons = 仓库级 git）
> - **D56** 架构版本演进（新 session 立即生效 + 迁移建议不强制）
>
> 注入栈（7 层）：AGENTS → architecture → constitution → project-memory → lessons-learned → user_memory → SOUL

---

## 1. 主流程图（端到端 a→g）

```
                              ┌────────────────┐
                              │     a. 用户     │
                              └─────────┬──────┘
                                        │ 同步对话（持续可中断、可加问题）
                                        ▼
   ╔══════════════════════════════════════════════════════════════════╗
   ║  b. 接待 Agent  ★ 长驻前台 + 后台调度器 双角色 ★  [D11]                ║
   ║                                                                  ║
   ║  ┌──────────────────────────┐    ┌───────────────────────────┐   ║
   ║  │ 前台对话（同步）          │    │ 后台任务清单（追踪下游）   │   ║
   ║  │ · currentTurn             │    │ activeTasks[]:            │   ║
   ║  │ · userId / conversationId │    │  - taskId-1 / planning    │   ║
   ║  │ · userMemory frozen       │    │  - taskId-2 / dispatching │   ║
   ║  │                           │    │    3/5                    │   ║
   ║  └───────────────────────────┘    └───────────────────────────┘   ║
   ║                                                                  ║
   ║  ╭─ system prompt 注入栈 [7 层，D34+D45+D54+D55] ────────────╮  ║
   ║  │ 1. AGENTS.md           （engineering, 仓库级 git）        │  ║
   ║  │ 2. architecture.md     （架构规范, 仓库级 git, D45）      │  ║
   ║  │ 3. constitution.md     （team 级 DB, spec-kit）           │  ║
   ║  │ 4. project-memory.md   （仓库级 git, frozen, D55）        │  ║
   ║  │ 5. lessons-learned.md  （仓库级 git, D54）       ⓪默认C2 │  ║
   ║  │ 6. user_memory_md      （users DB, frozen）      静默写入 │  ║
   ║  │ 7. reception SOUL.md   （角色级, D44 5维度）              │  ║
   ║  ╰─────────────────────────────────────────────────────────────╯  ║
   ║                                                                  ║
   ║  路由决策（intent_state）：                                       ║
   ║   ┌──── ask ────┐  ┌──── plan / implement ────┐                  ║
   ║   ▼ 直答         │  ▼ 创建后台任务            │                   ║
   ║   返回 a          │  scheduler.schedule(input)  │ [D40]            ║
   ║                  │  立即返回"已开始处理"        │                   ║
   ╚══════════╪══════════════════════════════════════╪═══════════════╝
              │                                      │
              │ 推送通道 [D32]                      │
              │ 🔴阻塞 / 🟡信息 / 🟢静默             │
              ▲                                      │
              │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
              │            异步边界 [D24 跨层禁止直连，强制 handoff]
              │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
              │                                      ▼
              │              createHandoff(b→c)
              │                                      │
              │                                      ▼
              │     ┌──────────────────────────────────────────────┐
              │     │  c. PM1 / 任务规划  [structural_depth=1, D18] │
              │     │                                              │
              │     │  注入栈：AGENTS + constitution + memory      │
              │     │         + pm1 SOUL                           │
              │     │                                              │
              │     │  spec-kit 多步精炼：                          │
              │     │   ┌──────┐  ┌────────┐  ┌──────┐  ┌──────┐  │
              │     │   │ spec │→│clarify │→│ plan │→ │tasks │  │
              │     │   └──┬───┘  └───┬────┘  └──┬───┘  └──┬───┘  │
              │     │      │         │ [NEEDS CLARIFICATION]      │
              │     │      │         └─→ 异步推 b → b 推 a (问回)│──┐
              │     │      │                                    │  │
              │     │      ▼ 产物 [③ Artifacts]                 │  │
              │     │   spec.md / plan.md / tasks.md            │  │
              │     │   （带 [P] [US1] 标记）                   │  │
              │     └──────────────┬─────────────────────────┘  │
              │                    │ handoff(c→d) payload:      │
              │                    │  {goal, context, toolsets, │
              │                    │   role, artifactRefs,      │
              │                    │   taskMarkers,             │
              │                    │   retryPolicy…}            │
              │                    ▼                            │
              │  ┌─────────────────────────────────────────────┐│
              │  │  d. PM2 / 开发管控 ★ 双思想桥接 ★            ││
              │  │     [structural_depth=2, D18]                ││
              │  │                                              ││
              │  │  ① Constitution Check 门禁 [D9 + D29 B3]     ││
              │  │     ┌─────────────────────────────────┐      ││
              │  │     │ 违反原则？                       │      ││
              │  │     │  ├ 否 → 继续 ↓                  │      ││
              │  │     │  └ 是 → 退回 c                  │      ││
              │  │     │   ├ 附"具体违反原则 + 修改建议" │      ││
              │  │     │   │ [D29 B2]                    │      ││
              │  │     │   ├ escalation_round++          │      ││
              │  │     │   └ if escalation_round ≥ 2:    │      ││
              │  │     │      升级到用户 🔴 阻塞 [D29 B1]│      ││
              │  │     │      两个动作：                 │      ││
              │  │     │      [修宪法] [改需求]          │      ││
              │  │     │      （不提供"强制跳过"）       │      ││
              │  │     └─────────────────────────────────┘      ││
              │  │                                              ││
              │  │  ② 拆 dispatch_packages                       ││
              │  │     （[P] 标记 → 推导并行）                   ││
              │  │                                              ││
              │  │  ③ 多路 handoff(d→e/f/g) 并行派发             ││
              │  └─────────┬────────────────────────────────────┘│
              │            │                                    │
              │   ┌────────┴────────┬──────────────────┐       │
              │   ▼                 ▼                  ▼       │
              │ ┌─────────┐      ┌─────────┐      ┌─────────┐  │
              │ │ e 开发  │      │ f 测试  │      │ g 评审  │  │
              │ │[depth=3]│      │[depth=3]│      │[depth=3]│  │
              │ │ patch   │      │ tests   │      │ review  │  │
              │ │         │      │         │      │ notes   │  │
              │ │ 可 delegate                                 │ │
              │ │ subagent [exec_depth=1]                     │ │
              │ │ ▼ 不可再深 [D18 上限=2]                     │ │
              │ └────┬────┘      └────┬────┘      └────┬────┘  │
              │      │                │                │       │
              │      └────────────────┴────────────────┘       │
              │                       │ 结果回写              │
              │                       ▼                       │
              │  ┌───────────────────────────────────────────┐│
              │  │  d. 双重 review                           ││
              │  │   - spec review（对齐 spec）              ││
              │  │   - quality review（对齐 constitution）    ││
              │  │                                           ││
              │  │  失败分流 [D29 B3]：                       ││
              │  │   ├ 实现型失败 → 重派 e/f/g               ││
              │  │   │  （次数 ≥ 3 → 升级 c）                ││
              │  │   ├ 规划型失败 → 退回 c 重规划            ││
              │  │   └ 累计 escalation_round ≥ 2             ││
              │  │     → 升级用户 🔴                         ││
              │  └────────────┬──────────────────────────────┘│
              │               │ review 通过                  │
              │               ▼                              │
              │       ┌───────────────────┐                  │
              │       │  c. 整合产物      │                  │
              │       │ review_report.md  │                  │
              │       └────────┬──────────┘                  │
              │                │ subscribe 触发              │
              └────────────────┘ 推回 b → 推 a 🟡 信息性 ────┘
```

---

## 2. 视图 2：暂停 / 取消 协议（D42 + D33）

```
用户操作（顶部 TeamStatusBar 一键 / TaskDetailDrawer 单任务）
   │
   ├──→ 暂停 [D42]                       ├──→ 取消 [D33]
   │     ├ scheduler.pauseAll(reception) │     ├ scheduler.cancel(taskId)
   │     │  或 scheduler.pause(taskId)   │     │
   │     ▼                               │     ▼
   │   sessions.paused=1                 │   handoff.cancel_requested=1
   │   handoff_records.paused=1          │   handoff.state='cancelled'
   │   paused_at=now                     │   级联标记所有子 session
   │   paused_by_user_id=...             │
   │     │                               │     │
   │     ▼                               │     ▼
   │   watcher 跳过 paused=1 handoff     │   各层 agent 在 LLM 调用前
   │   各层 agent 在 LLM 调用前检查      │   检查 cancel_requested：
   │   paused：                          │   ├ 是 → 立即停止
   │   ├ 是 → 不调 LLM，等恢复           │   │     写 result="cancelled"
   │   └ 否 → 正常调                     │   │     产物保留（spec/plan）
   │                                     │   │     代码不自动回滚
   │   ★ a-b 同步对话不受影响 ★          │   │
   │                                     │
   │  ↓ 用户点击 "恢复"                  │  ↓ cancelled 不可恢复
   │  ↓ scheduler.resumeAll/resume       │     需重新 schedule 新任务
   │  ↓ 检查 paused_at > 1h ?            │
   │  ├ 是 → 弹 ResumeStaleDialog        │
   │  │    "上下文可能过期"              │
   │  └ 否 → paused=0, watcher 正常推进  │
```

**关键不变量**：

- pause 与 cancel 是**互补不冲突**的操作（D42 vs D33）
- pause 不影响 a-b 同步对话（b 长驻前台原则）
- 24h 内 force_apply 上限 5 次（D41 配套，防滥用）

---

## 3. 视图 3：记忆写入双路径（D41 C2+C3 混合）

```
agent 在 session 中调 memoryTool.add(target, content)
   │
   ▼
1. 过 13 条威胁模式扫描 [D39]
   ← prompt injection / 凭据外泄 / 持久化攻击
   │ 失败 → 拒绝写入
   ▼
2. 立即落盘
   （users.user_memory_md / team_workspaces.project_memory_md）✓
   │
   ├──── ⓪ 默认 C2 静默路径 ─────────────────────┐
   │     ├ 当前 session prompt 不变（frozen 保留） │
   │     ├ prefix cache 保护                       │
   │     ├ 渲染 <MemoryWriteBadge>                 │
   │     │  "✓ 已记住，下次会话生效"              │
   │     └ 下次新 session 启动时才生效              │
   │                                                │
   └──── ① 用户点击 <ForceApplyButton> ────────────┤
         ▼                                          │
       <ForceApplyDialog>                           │
       "将重新加载，本轮成本+"                      │
         ▼ 确认 + 检查 force_apply_count < 5/24h    │
       C3 立即生效路径：                             │
         ├ session.cache_invalidated=1              │
         ├ force_apply_count++                      │
         ├ force_apply_last_at=now                  │
         ├ 下轮 LM 调用：                           │
         │   - 重读所有 memory                      │
         │   - 重新拼接 system prompt               │
         │   - 破坏 prefix cache（成本 ×10）         │
         └ 渲染 <MemoryAppliedBadge>                │
            "✓ 偏好已即时生效"                     │
                                                    │
         ★ 注意：99% 时间走 C2，frozen snapshot 不破坏（D35）
```

---

## 4. 视图 4：e/f/g 开发团队生命周期时序图

> **核心命题**：e/f/g 自己只管"在能力范围内干活"，**所有"什么时候开始 / 什么时候停 / 干完算不算数 / 失败重不重来"全部由 d 决定**。
>
> 一句话：**d 拍板，Scheduler 操控，Handoff 协议传话，Session 字段记账，Watcher 推动状态。**

### 4.1 七阶段时序图

```
 时间 ↓     a 用户       b 接待        d (PM2)        Scheduler        Watcher          e/f/g
 ─────    ───────     ───────      ────────      ─────────        ───────         ─────────

 ┌─ 1. 创建阶段 ──────────────────────────────────────────────────────────────────────┐
 │                                                                                     │
 │                                d 拆 dispatch_packages                              │
 │                                ([P] 标记 → 推导并行)                               │
 │                                ↓                                                    │
 │                                createHandoff(d→e/f/g) × N                          │
 │                                ↓ 写 handoff_records:                                │
 │                                  state='pending'                                    │
 │                                  payload={goal, context,                            │
 │                                          toolsets, role,                            │
 │                                          artifactRefs,                              │
 │                                          taskMarkers}                               │
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─ 2. 接管阶段 [Watcher 守护进程] ────────────────────────────────────────────────────┐
 │                                                                                     │
 │                                                              轮询 pending           │
 │                                                              ↓ claim                │
 │                                                              ↓ state='claimed'      │
 │                                                              ↓ 创建子 session:      │
 │                                                                parent_session_id=d  │
 │                                                                role_layer='execution'│
 │                                                                structural_depth=3   │
 │                                                                execution_depth=0    │
 │                                                              ↓ payload → 首条消息   │
 │                                                              ↓ state='running'      │
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─ 3. 执行阶段 [e/f/g 自主] ──────────────────────────────────────────────────────────┐
 │                                                                                     │
 │                                                                              LLM 调用│
 │                                                                              ┌─────│
 │                                                                              │ 调用前
 │                                                                              │ 必检：│
 │                                                                              │ paused?│
 │                                                                              │ cancel?│
 │                                                                              └─────│
 │                                                                              ↓     │
 │                                                                              · 写 patch
 │                                                                              · 跑测试
 │                                                                              · 写 review
 │                                                                              · 可 delegate
 │                                                                                subagent
 │                                                                                (上限   │
 │                                                                                 exec=2)│
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─ 4. 暂停阶段 [可选 · D42] ──────────────────── 详见视图 2 ─────────────────────────┐
 │                                                                                     │
 │  [一键暂停] →  b                                                                    │
 │              scheduler.pauseAll(reception)                                          │
 │              或 scheduler.pause(taskId)                                             │
 │              ↓                                                                      │
 │                                                  paused=1                           │
 │                                                  paused_at=now                      │
 │                                                  paused_by_user_id                  │
 │                                                              ↓ 跳过 paused=1        │
 │                                                                              ↓ 下轮  │
 │                                                                              检查→停 │
 │  [恢复]   →  b                                                                      │
 │              scheduler.resumeAll                                                    │
 │              ↓                                                                      │
 │                                                  paused=0                           │
 │                                                  staleWarning?                      │
 │                                                  (paused_at>1h)                     │
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─ 5. 取消阶段 [可选 · D33] ──────────────────── 详见视图 2 ─────────────────────────┐
 │                                                                                     │
 │  [取消]   →  b   →    scheduler.cancel(taskId)                                      │
 │                       ↓                                                             │
 │                                cancel_requested=1                                   │
 │                                state='cancelled'                                    │
 │                                级联到子 session                                     │
 │                                                                              ↓ 立即停│
 │                                                                              产物保留│
 │                                                                              代码不回滚│
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─ 6. 结果回写阶段 ───────────────────────────────────────────────────────────────────┐
 │                                                                                     │
 │                                                                              ✓ 完成 │
 │                                                                              ↓     │
 │                                                                              写 result_json
 │                                                                              state='completed'
 │                                d 收集所有                ←──────────────────       │
 │                                子任务结果                                           │
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─ 7. 审判阶段 [d 双重 review · D29 B3] ──────────────────────────────────────────────┐
 │                                                                                     │
 │                                d:                                                  │
 │                                · spec review (对齐 spec)                           │
 │                                · quality review (对齐 constitution)                │
 │                                ↓                                                    │
 │                                ┌─ 通过 ──→ c 整合 → b 推 a 🟡                       │
 │                                │                                                    │
 │                                ├─ 实现型失败 ──→ 回到阶段 1（重派 e/f/g）          │
 │                                │   if 重派次数 ≥ 3 → 升级 c                         │
 │                                │                                                    │
 │                                ├─ 规划型失败 ──→ 退回 c 重规划                      │
 │                                │   escalation_round++                               │
 │                                │   附"违反原则 + 修改建议" [D29 B2]                 │
 │                                │                                                    │
 │                                └─ escalation_round ≥ 2 ──→ 升级用户 🔴 [D29 B1]    │
 │                                    动作选项：[修宪法] [改需求]                      │
 │                                    （不提供"强制跳过"）                              │
 │                                                                                     │
 └─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 e/f/g 自身能做与不能做

| 能做 ✅                                       | 不能做 ❌                                                 |
| --------------------------------------------- | --------------------------------------------------------- |
| 在自己 toolset 范围内调用工具                 | 直接接受用户消息（必须经 b→c→d，D24）                     |
| 调用 LLM 写代码 / 测试 / review               | 跨层调用 d 的兄弟节点（必须经 d 协调）                    |
| delegate 1 层 subagent（execution_depth → 1） | 再起 subagent（execution_depth ≤ 2 上限，D18）            |
| 写 result_json 回 handoff_records             | 修改自己或他人的 sessions 表（只有 Watcher/Scheduler 写） |
| 读 user_memory + project_memory               | 写 project_memory（只读，避免污染长期记忆）               |
| 在 LLM 调用前检查 paused / cancel_requested   | 忽略 pause/cancel 强行执行                                |

### 4.3 e/f/g 的"身份证"（schema 速查）

```sql
-- e/f/g session 在 sessions 表中的标识
sessions:
  id                = e/f/g 自己的 session id
  parent_session_id = d 的 session id              ← 我爹是 d
  role_layer        = 'execution'                  ← 我是干活的
  intent_state      = 'implement'                  ← 任务意图
  structural_depth  = 3                            ← 第 4 层（D18 上限 4）
  execution_depth   ≤ 2                            ← 我能再叫 1 层 subagent
  paused            = 0/1                          ← D42 暂停
  cache_invalidated = 0/1                          ← D41 force apply 触发
```

```sql
-- e/f/g 的"任务派遣单"在 handoff_records 表中
handoff_records:
  id                = handoff record id
  source_session_id = d 的 session id
  target_session_id = e/f/g 的 session id（claim 后回填）
  source_layer      = 'pm2'
  target_layer      = 'execution'
  state             = pending → claimed → running → completed/failed/cancelled
  payload_json      = {goal, context, toolsets, role,
                       artifactRefs, taskMarkers, retryPolicy}
  result_json       = {…}                          ← 完成后回写
  paused            = 0/1                          ← D42
  cancel_requested  = 0/1                          ← D33
  escalation_round  = N                            ← D29 升级计数
  retry_count       = N
```

### 4.4 控制流权责矩阵

| 控制点             | 谁决定              | 谁执行              | 数据落点                     |
| ------------------ | ------------------- | ------------------- | ---------------------------- |
| 创建 e/f/g session | d                   | Scheduler + Watcher | sessions + handoff_records   |
| 暂停 e/f/g         | 用户 → b            | Scheduler           | paused 字段                  |
| 取消 e/f/g         | 用户 → b            | Scheduler           | cancel_requested             |
| 何时停止 LLM 调用  | e/f/g 自检          | e/f/g 自己          | 读 paused / cancel_requested |
| 任务是否合格       | d（双重 review）    | d                   | review_report.md             |
| 失败后重试还是升级 | d（按 D29 B3 规则） | d → Scheduler       | escalation_round             |
| 把结果回写         | e/f/g               | e/f/g 自己          | result_json                  |
| 把结果传给 c       | d（review 通过后）  | d                   | c 收到 handoff               |

### 4.5 关键不变量（验证清单）

1. **e/f/g 永远不直接和用户对话**（D24 强制约束）
2. **e/f/g 的生命周期完全由 d 控制**（创建 / 重派 / 升级 / 完成都是 d 决策）
3. **暂停/取消都经过 Scheduler**（不允许 e/f/g 自己进入"paused"状态）
4. **execution_depth ≤ 2**（防递归爆炸，D18 上限）
5. **失败有兜底**（escalation_round ≥ 2 必升级用户，避免死循环）
6. **结果回写格式固定**（payload_json / result_json 双向结构化）

### 4.6 与其他视图的关系

| 视图                    | 关系       | 重点                             |
| ----------------------- | ---------- | -------------------------------- |
| 主流程图（§1）          | 父图       | e/f/g 在五层架构中的位置         |
| 视图 2 暂停/取消（§2）  | 横切关注点 | e/f/g 在阶段 4-5 的状态机        |
| 视图 3 记忆双路径（§3） | 横切关注点 | e/f/g 只读 project_memory，不写  |
| **本视图 4**            | 主图细化   | **e/f/g 七阶段生命周期完整时序** |

---

## 5. 视图 5：崩溃恢复 + 优雅降级（D51 + D53，v3.9 新增）

```
┌─ 崩溃恢复 [D51] ─────────────────────────────────────────────────────┐
│                                                                       │
│  正常运行时：                                                         │
│    每个 running session 每 30s 写 last_heartbeat                      │
│                                                                       │
│  检测死亡（双保险）：                                                 │
│    ├ 心跳超时：last_heartbeat < now - 60s → 疑似死亡                  │
│    └ 任务超时：claimed_at > 30 分钟未完成 → 兜底死亡                  │
│                                                                       │
│  恢复流程：                                                           │
│    Watcher 检测到死亡 session                                         │
│    ├ crash_retry_count < 1                                            │
│    │   → 自动重试（静默）                                             │
│    │   → state='pending' 重新 claim                                   │
│    │   → crash_retry_count++                                          │
│    │   → 从头重跑但保留已有 artifact（e 可读上次产物）                │
│    │                                                                   │
│    └ crash_retry_count >= 1                                           │
│        → 标记 state='failed'                                          │
│        → 走 D29 B3 失败分流（d 决定重派/升级）                        │
│        → 推送 🔴 阻塞性通知                                           │
│                                                                       │
│  ★ 90% 崩溃（网络抖动/OOM）被静默恢复，用户无感知 ★                  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

┌─ 优雅降级 [D53] ─────────────────────────────────────────────────────┐
│                                                                       │
│  三级降级（用户可配"暂停等我决定"覆盖自动切换）：                     │
│                                                                       │
│  Level 1: 重试                                                        │
│    主模型返回 503/429/timeout                                         │
│    → 重试 N 次（指数退避）                                            │
│    → 仍失败 ↓                                                         │
│                                                                       │
│  Level 2: 切换 fallback 模型                                          │
│    → 自动切换到配置的 fallback（系统预设 + 用户可覆盖, D47）          │
│    → 产物标注 "⚠️ 由备用模型生成"                                     │
│    → 仍失败 ↓                                                         │
│                                                                       │
│  Level 3: 通知用户                                                    │
│    → 推送 🔴 阻塞性："[层名] 主备模型均不可用"                        │
│    → 暂停该层等待用户决策                                             │
│    → 用户选项：[换模型] [稍后重试] [取消任务]                         │
│                                                                       │
│  降级产物处理：                                                       │
│    → 标注 "⚠️ 由备用模型生成，质量可能有差异"                         │
│    → 提供 "用主模型重跑" 按钮（等主模型恢复后）                       │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 6. 23 项已拍板在流程中的位置速查

| 决策                    | 在主流程中的体现                                       | 视图                      |
| ----------------------- | ------------------------------------------------------ | ------------------------- |
| **D11+D12** 五层架构    | a → b → c → d → e/f/g 五个独立节点框                   | 主图 + 视图 4             |
| **D24** 禁止跨层直连    | 异步边界横线 + "强制 handoff"标注                      | 主图 + 视图 4             |
| **D34** 双存储记忆      | 注入栈第 4-6 行（project-memory git + user_memory DB） | 主图 + 视图 3             |
| **D29** review 失败 B3  | d 内 Constitution Check 门禁 + 失败分流 + 阶段 7 审判  | 主图 + 视图 4             |
| **D18** 双深度限制      | 各层 `structural_depth=N` + e 的 `exec_depth`          | 主图 + 视图 4             |
| **D40** Scheduler       | b 的 `scheduler.schedule()` 入口                       | 主图 + 视图 4             |
| **D41** memory C2/C3    | frozen snapshot + ForceApply 按钮                      | 视图 3                    |
| **D42** 暂停            | 一键暂停/恢复级联                                      | 视图 2 + 视图 4           |
| **D43** 工具门控        | 各层 required/allowed/forbidden 能力类别               | 视图 4（4.2 能做/不能做） |
| **D28** e/f/g 有限并行  | e/f 并行，g 等两者完成                                 | 视图 4（阶段 1 派发）     |
| **D44** 提示词风格      | 7 层注入栈 + 各层 SOUL 5 维度                          | 主图（注入栈框）          |
| **D45** architecture.md | 注入栈第 2 位 + d architecture review                  | 主图 + 视图 4（阶段 7）   |
| **D46** 动态编制        | e 最少 2 并行（用户可配上限），f/g 固定                | 视图 4（阶段 1）          |
| **D47** 每层模型可配    | 用户前端配置各层 provider + model                      | 主图（各层节点）          |
| **D48** 注入栈压缩      | 达阈值自动压缩（规范类不压）                           | 主图（注入栈框）          |
| **D49** 进度展示        | TeamStatusBar + 进度条 + 预估时间                      | 主图（b 后台任务清单）    |
| **D50** 并发上限        | 双层限制 + FIFO 可调序 + 自动降级                      | 视图 4（阶段 1 派发）     |
| **D51** 崩溃恢复        | 心跳+超时 / 自动重试 1 次 / 保留产物                   | **视图 5**                |
| **D52** 并发修改        | memory 追加无锁 + constitution 乐观锁                  | 视图 3（写入路径）        |
| **D53** 优雅降级        | 三级降级 + fallback + 标注+可重跑                      | **视图 5**                |
| **D54** 学习闭环        | lessons-learned.md（注入栈第 5 位）+ d 提议            | 主图（注入栈框）          |
| **D55** 仓库级共享      | project-memory + lessons = git 文件                    | 主图（注入栈框）          |
| **D56** 架构版本演进    | 新 session 立即生效 + 迁移建议                         | 视图 4（阶段 7 review）   |

---

## 7. 关键不变量（看图时验证）

1. **a → b 永远是同步的**（图中"持续可中断"+ 无异步边界横线）
2. **b → 下游永远是异步的**（异步边界横线 + scheduler 抽象）
3. **任何跨层调用都标注了 handoff**（D24 强制约束可视化）
4. **失败有兜底**（escalation_round ≥ 2 升级用户，避免死循环）
5. **暂停不影响 a-b 对话**（视图 2 末尾 ★ 标注）
6. **frozen snapshot 99% 时间不破坏**（视图 3 默认 C2 路径）

---

## 8. 数据层 schema 全景（v3.9 已拍板汇总）

为方便 Phase A 设计稿引用，把 23 项决策触发的所有 schema 改动汇总到此：

```sql
-- D34 + D55: 双存储记忆（project-memory 移为 git 文件，DB 只保留 user_memory）
ALTER TABLE users ADD COLUMN user_memory_md TEXT DEFAULT '';
-- 注意：team_workspaces.project_memory_md 不再需要（D55 移为仓库根 git 文件）

-- spec-kit: 团队宪法
ALTER TABLE team_workspaces ADD COLUMN constitution_md TEXT;

-- D52: 并发修改乐观锁
ALTER TABLE team_workspaces ADD COLUMN constitution_version INTEGER DEFAULT 0;

-- D11+D12 + D18: session 状态机 + 双深度
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN handoff_state TEXT;        -- pending/running/completed/failed
ALTER TABLE sessions ADD COLUMN role_layer TEXT;           -- reception/pm1/pm2/execution
ALTER TABLE sessions ADD COLUMN intent_state TEXT;         -- ask/plan/implement/investigate
ALTER TABLE sessions ADD COLUMN structural_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN execution_depth INTEGER NOT NULL DEFAULT 0;

-- D41: C2+C3 记忆生效模式
ALTER TABLE sessions ADD COLUMN cache_invalidated INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN force_apply_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN force_apply_last_at INTEGER;

-- D42: 团队级运行管控 + 一键暂停
ALTER TABLE sessions ADD COLUMN paused INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN paused_at INTEGER;
ALTER TABLE sessions ADD COLUMN paused_by_user_id TEXT;
ALTER TABLE sessions ADD COLUMN pause_reason TEXT;

-- D51: 崩溃恢复心跳
ALTER TABLE sessions ADD COLUMN last_heartbeat INTEGER;

-- D24: handoff 协议
CREATE TABLE handoff_records (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  target_session_id TEXT,
  source_layer TEXT NOT NULL,
  target_layer TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_text TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER
);

-- D29: handoff 升级计数
ALTER TABLE handoff_records ADD COLUMN escalation_round INTEGER DEFAULT 0;

-- D33: handoff 取消
ALTER TABLE handoff_records ADD COLUMN cancel_requested INTEGER DEFAULT 0;
ALTER TABLE handoff_records ADD COLUMN cancel_reason TEXT;

-- D42: handoff 暂停（与 sessions 表镜像）
ALTER TABLE handoff_records ADD COLUMN paused INTEGER DEFAULT 0;
ALTER TABLE handoff_records ADD COLUMN paused_at INTEGER;

-- D51: 崩溃恢复重试计数
ALTER TABLE handoff_records ADD COLUMN crash_retry_count INTEGER DEFAULT 0;

-- 索引
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_sessions_handoff ON sessions(handoff_state)
  WHERE handoff_state IS NOT NULL;
CREATE INDEX idx_sessions_paused ON sessions(paused) WHERE paused = 1;
CREATE INDEX idx_handoff_state ON handoff_records(state);
CREATE INDEX idx_handoff_source ON handoff_records(source_session_id);

-- 仓库级 git 文件（不在 DB 中，由 git 管理）
-- /AGENTS.md              (工程纪律)
-- /architecture.md        (D45 架构规范)
-- /project-memory.md      (D55 项目事实，原 DB 字段移出)
-- /lessons-learned.md     (D54 学习闭环产物)
```

---

## 9. BackgroundTaskScheduler 接口全景（D40 + D42）

```ts
interface BackgroundTaskScheduler {
  // ===== D40 核心方法 =====
  schedule(input: ScheduleInput): Promise<ScheduledTask>;
  getStatus(taskId: string): Promise<BackgroundTaskStatus>;
  cancel(taskId: string, reason: string): Promise<void>;
  listActive(receptionSessionId: string): Promise<BackgroundTask[]>;
  subscribe(taskId: string, listener: TaskProgressListener): Unsubscribe;

  // ===== D42 暂停方法（v3.6 新增）=====
  pause(taskId: string, reason?: string): Promise<void>;
  resume(taskId: string): Promise<{ resumed: true; staleWarning?: boolean }>;
  pauseAll(receptionSessionId: string, reason?: string): Promise<{ pausedCount: number }>;
  resumeAll(receptionSessionId: string): Promise<{ resumedCount: number; staleCount: number }>;
}

interface ScheduleInput {
  // 必需
  receptionSessionId: string;
  intent: string;
  payload: HandoffPayload;

  // 可选（接口先扩展，MVP 可不实现）
  priority?: 'high' | 'normal' | 'low';
  scheduledAt?: number;
  deadline?: number;
  retryPolicy?: RetryPolicy;
  idempotencyKey?: string;
  parentTaskId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}
```

---

## 10. 前端组件清单（v3.9 完整）

| 组件                     | 位置                | 触发决策     | 职责                                             |
| ------------------------ | ------------------- | ------------ | ------------------------------------------------ |
| `<MemoryWriteBadge>`     | 对话流中插入        | D41 C2       | "✓ 已记住，下次会话生效"                         |
| `<ForceApplyButton>`     | 侧边栏 / 设置面板   | D41 C3       | 触发立即生效                                     |
| `<ForceApplyDialog>`     | Modal               | D41 C3       | 确认对话框（含成本提示）                         |
| `<MemoryAppliedBadge>`   | 对话流中插入        | D41 C3       | "✓ 偏好已即时生效"                               |
| `<TeamStatusBar>`        | 顶部常驻            | D42 + D49    | 显示 N 个活跃任务 + 一键暂停/恢复 + 各层运行状态 |
| `<TaskDetailDrawer>`     | 侧边滑出            | D42 + D50    | 单 task 详情 + 暂停/恢复/取消 + 优先级拖拽       |
| `<PauseConfirmDialog>`   | Modal               | D42          | "将暂停 N 个任务，确认?"                         |
| `<ResumeStaleDialog>`    | Modal               | D42 + D51    | 暂停 > 1h 时警告"上下文可能过期"                 |
| `<SuggestionBar>`        | 对话流末尾          | D44 b 维度 5 | 2-3 个主动建议（文字 + 按钮）                    |
| `<SuggestionButton>`     | SuggestionBar 内    | D44 b 维度 5 | 单个可点击建议按钮                               |
| `<TaskProgressBar>`      | TeamStatusBar 内    | D49          | 整体任务进度条（completed/total）                |
| `<EstimatedTimeLabel>`   | TaskDetailDrawer 内 | D49          | 预估完成时间                                     |
| `<LayerStatusIndicator>` | TeamStatusBar 内    | D49          | 各层级（b/c/d/e/f/g）当前阶段指示                |
| `<DegradedBadge>`        | 对话流/产物标注     | D53          | "⚠️ 由备用模型生成" + 重跑按钮                   |
| `<ModelFailureDialog>`   | Modal               | D53 Level 3  | 主备模型均不可用时用户决策                       |
| `<LessonProposalToast>`  | Toast 通知          | D54          | d 提议"要不要记住这个教训？"                     |
| `<ArchInitWizard>`       | 引导流程            | D45 初始化   | 新项目/老项目 architecture.md 初始化向导         |

---

## 11. 与主架构文档的关系

本文档是 `team-architecture-spec-kit-borrowing-discussion.md` v3.9 的**可视化伴生文档**：

| 角度     | 主文档                  | 本文档                     |
| -------- | ----------------------- | -------------------------- |
| 形态     | 长文 + 决策清单         | 流程图 + schema 速查       |
| 用途     | 讨论、评审、决策记录    | 对齐心智模型、Phase A 引用 |
| 维护     | 每次拍板新决策都更新    | 跟随主文档版本同步         |
| 阅读顺序 | 第 1 优先（理解为什么） | 第 2 优先（看清是什么样）  |

> **建议工作流**：在 Phase A 设计稿与后续 Phase 文档中，**用本文档替代长文引用**——只在需要查决策依据时回到主文档。

---

## 12. 后续动作

本文档定稿后下一步：

1. **启动 Phase A 设计稿**（`.agentdocs/workflow/260515-team-phase-a-设计.md`），范围：
   - 团队宪法 UI + 后端 API（`team_workspaces.constitution_md`）
   - 5 个内置 SOUL agent_personas
   - 三层指令栈实现（AGENTS + constitution + SOUL）
   - 双存储记忆字段 + 安全扫描（13 条威胁模式）
   - C2+C3 frozen snapshot 模式 + ForceApply 防滥用计数
2. **Phase A 不做**（保持范围聚焦）：
   - 不引入 session 状态机（留 Phase B）
   - 不引入 handoff 协议（留 Phase B）
   - 不引入 BackgroundTaskScheduler（留 Phase B）
   - 不引入 review 失败恢复（留 Phase B）
3. **若 Phase A 验证发现流程图与实际不一致** → 在本文档末尾追加"反思与调整"章节，不删除原图

---

> 本文档为 v3.6 即时快照。任何后续决策（D43+）触发的流程变化，应**先更新主架构文档**，再回到本文档同步流程图。
