# Team 架构思想借鉴讨论：spec-kit × hermes-agent 双源版

> ⚠️ **v3.12 重要变更（2026-05-16）+ 复查修订（v3.12.1）**：本文档因决策过度集中（56 项一次性拍板）导致信息密度低、修改成本高。已重组为分层决策结构。**新决策入口请见 [§13 v3.12 分层决策重组](#13-v312-分层决策重组2026-05-16)**。
>
> **v3.12.1 复查发现**（2026-05-16 同日）：v3.12 是基于"v3.10/v3.11 决策尚未实施"的假设写的，但**实际上 Phase A/B/C/D/E 都已经完成实施**。详见 `.agentdocs/workflow/done/260515-team-phase-{a,b,c}-实施方案.md` 与 `260516-team-phase-{d,e}-实施方案.md`。
>
> 因此分层决策文档（v1.1）的定位从"重新设计"修正为"复盘归档 + 增量改造"：
>
> - **L1 文档（v1.1）**：从"待拍板基线"改为"已实施现状对照 + 4 项需新增/改造的 review 重点"
> - **Phase A 决策（v1.1）**：从"启动前 review"改为"已完成 Phase A 复盘归档"
> - **L1.3 流式 handoff 设计稿（v1.1）**：从"Phase B 实施方案"改为"对现有 Phase B/C/D 的增量改造"（详见该文档 §0.A 差异分析）
>
> **本文档现状**：作为讨论历史 + 思想借鉴分析的归档文档保留。所有 v3.10 已拍板的 56 项决策保持原状，但**实际执行以分层决策文档（v1.1）为准**：
>
> - **L1 架构基线**（必须现在锁，9 项）→ `team-architecture-l1-baseline.md`
> - **L2 阶段触发**（每个 Phase 启动时拍板）→ `team-architecture-phase-{X}-decisions.md`
> - **L3 实施触发**（落地具体功能时拍板）→ 不进文档，进 PR 描述
> - **L4 运营触发**（上线后根据数据调整）→ 不进文档，进运营记录
>
> **本文档目的**：把对 GitHub `spec-kit`（Spec-Driven Development 工具包）和 `NousResearch/hermes-agent`（自进化多 Agent 工作系统）的深度分析结果，与 OpenAWork 当前 team 架构现状对齐，沉淀出一份"双源思想借鉴 + 五层架构演进"的讨论稿。本稿是讨论稿与思想分析归档，不是实施方案。
>
> 创建时间：2026-05-14（v1：仅 spec-kit），2026-05-14（v2：引入 hermes-agent 上层编排，重组为五层架构）
> 关联资料：
>
> - 原始仓库：`temp/spec-kit/`（克隆自 https://github.com/github/spec-kit）
> - 原始仓库：`temp/hermes-agent/`（克隆自 https://github.com/NousResearch/hermes-agent）
> - 既有 team 设计：`.agentdocs/workflow/260416-team-创建流程设计分析.md`、`.agentdocs/workflow/260416-team-创建实施方案.md`
> - 既有 team 收口：`.agentdocs/workflow/done/260415-team-page-收口方案.md`
> - **v3.12 分层决策**（新）：`team-architecture-l1-baseline.md` / `team-architecture-phase-a-decisions.md` / `team-architecture-deferred-decisions.md`

---

## 0. TL;DR

1. **OpenAWork 的团队架构需要五层角色**：a 用户 → b 接待 → c 任务规划 PM1 → d 开发团队管控 PM2 → e/f/g 开发团队（开发/测试/...）。**d 是双思想的桥接节点**：既要承接 hermes-agent 的"规划 → 子代理派发"，又要驱动 spec-kit 的"specify → plan → tasks → implement"。
2. **两个开源项目各占一段**：
   - **hermes-agent 思想覆盖 b/c/d**：会话即工作单元、handoff 状态机、prompt 分层、todo 持久化、delegate_task 子代理派发、AGENTS/SOUL/skills 三层指令注入、**双存储项目记忆**（USER.md / MEMORY.md）。
   - **spec-kit 思想覆盖 d/e/f/g**：constitution 长期约束、`[NEEDS CLARIFICATION]` 标记、Constitution Check 门禁、产物链（spec/plan/tasks）一等公民、四层模板栈。
3. **同步/异步双轨**（v3 新增）：a ↔ b 是**持续同步对话**，用户可一直聊天不被阻塞；b → c/d/e/f/g 是**异步后台执行**，下游通过 b 的推送通道汇报进度。这意味着 b 是**长驻前台对话 + 后台任务调度器**双角色。
4. **OpenAWork 当前的 team 是三层叠加的"未命名"概念**：产品层是 Team 工作台、数据层是按 workspace 隔离的会话协作单元、Agent 层是固定核心角色（planner/researcher/executor/reviewer）的多 Agent 编排；缺五层职责的清晰划分。
5. **核心借鉴七件套（v3 重组，对应 Section 5）**：① Team Constitution 团队宪法（spec-kit）② Team Workflow 工作流模板（spec-kit）③ Team Artifacts 产物链（spec-kit）④ Role Adapter Matrix 角色适配矩阵（spec-kit）⑤ Session State Machine 会话状态机（hermes）⑥ Handoff Protocol 交接协议（hermes）⑦ Project Memory 项目记忆（hermes，双存储 frozen snapshot）。
6. **不能直接照搬的部分**：
   - spec-kit 是单机 CLI、面向开发者写代码 → 需把 slash command 改成 OpenAWork 内部的 team workflow 模板
   - hermes-agent 全家桶式工具 + plugin + cron 体系过重 → 只取"会话/handoff/delegate/prompt 分层 + 双存储记忆"骨架，不照搬 skills/curator/profiles/8 个 memory provider
7. **建议落地路径**：以 `team_constitution` 字段（spec-kit）+ `handoff_state` 字段（hermes）+ 仓库级 `project-memory.md` / DB 级 `users.user_memory_md` 双存储（D55 修正）为最小切口，7 层注入栈（AGENTS → architecture → constitution → project-memory → lessons-learned → user_memory → SOUL）。

---

## 1. 背景与触发问题

OpenAWork 已经有：

- `/team` 页面 + `team_workspaces` / `team_members` / `team_tasks` / `team_messages` / `team_audit_logs` / `session_shares` 数据层
- 固定 4 角色（planner/researcher/executor/reviewer）+ 可选成员的 Agent 编排（`use-team-runtime-role-bindings.ts`）
- `interaction-agent rewrite` 与 `team-leader dispatch` 两条编排骨架
- Workflow / Skill / Artifact 三套独立子系统

但目前的 team 缺少：

- **长期约束的载体**：没有"这个 team 在做什么、坚持什么、不接受什么"的明文锚点
- **多步精炼流程**：用户提需求 → 直接 createThread，没有澄清/计划/任务化的中间产物
- **可复用工作流模板**：team-playbook 实质上是 workflow nodes/edges，不是"流程方法论"
- **团队级产物链**：spec / plan / tasks / report 等团队级 Markdown 没有被持久化为一等公民

spec-kit 恰好把这几件事做成了样板。所以本次讨论关心的不是"是否引入 SDD"，而是：

> **OpenAWork 的 team 该不该把 spec-kit 的方法论范式吸收成自己的一部分？吸收哪些？怎么本地化？**

---

## 2. spec-kit 核心思想提炼

### 2.1 一句话定位

> Specifications **become executable**, directly generating working implementations rather than just guiding them.

它颠覆的传统假设：**代码是 truth，文档是辅助**——spec-kit 把它反过来：**spec 是 truth，代码是 spec 的当前表达**。

### 2.2 七步工作流（核心范式）

```
constitution → specify → clarify → plan → tasks → analyze → implement
```

| 阶段         | 输入                        | 产物                                                                         | 关键约束                                                     |
| ------------ | --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| constitution | 项目原则                    | `.specify/memory/constitution.md`                                            | 不可协商原则、治理、修订规则                                 |
| specify      | 自然语言 what/why           | `spec.md` + `checklists/requirements.md`                                     | 不写 how；最多 3 个 `[NEEDS CLARIFICATION]`                  |
| clarify      | 初稿 spec                   | 写回 spec.md 的 `## Clarifications`                                          | 最多 5 个高影响问题，逐题问答                                |
| plan         | spec + constitution         | `plan.md` / `research.md` / `data-model.md` / `contracts/` / `quickstart.md` | Constitution Check gate；先研究 unknowns 再设计              |
| tasks        | plan 全套产物               | `tasks.md`                                                                   | 按 user story 分阶段；`[P]` 并行标记；测试优先；文件路径明确 |
| analyze      | spec/plan/tasks             | 只读分析报告                                                                 | constitution 冲突 = CRITICAL；不允许改文件                   |
| implement    | tasks + plan + constitution | 实际代码改动 + tasks.md 打勾                                                 | 先校验 checklist，再按依赖顺序执行                           |

### 2.3 四个底层机制

1. **Frontmatter `handoffs`**：把"下一步该走哪个命令"写死在模板里，形成隐式状态机。
2. **`[NEEDS CLARIFICATION]` / `[P]` / `[US1]` 等机器可解析标记**：是方法论语义，不是注释。
3. **Constitution Check 门禁**：plan / analyze 都把 `constitution.md` 当作不可协商基线。
4. **四层模板栈**：`overrides → presets → extensions → core`，运行时由 `common.sh` 自顶向下找第一个匹配，提供完整的可定制路径。

### 2.4 多 Agent 适配矩阵

通过 `IntegrationBase` 抽象类 + 子类覆盖（`MarkdownIntegration` / `TomlIntegration` / `YamlIntegration` / `SkillsIntegration`），把同一份方法论分发到 30+ 种 AI 客户端目录（`.claude/`、`.cursor/`、`.gemini/`、`.github/prompts/` …）。

**重要观察**：仓库里**没有**这些目录，它们是 `specify init` 在你项目里现场生成的。注册矩阵是**动态分发器**，不是静态文件夹。

### 2.5 它明确反对的做法

- "vibe coding every piece from scratch"——即兴 prompt → code 一把过
- 一次性 prompt 直接生成代码，缺中间产物可审、可回滚
- 在 specify 阶段讨论技术栈、API、目录结构（"how" 应该留到 plan）
- 对歧义"猜答案"，不显式标记 `[NEEDS CLARIFICATION]`
- speculative / "might need" 特性、future-proofing、过度抽象
- tasks 不按 story 拆、依赖乱串、文件路径不清
- 用模糊形容词当需求（fast / robust / intuitive 等不量化）

### 2.6 它对 AI 协作的根本假设

- AI 的强项是"机械翻译 + 结构化推理"，不是替代开发者的判断
- 人类负责意图、边界、审查和 gate；AI 负责把每个阶段产物机械生成出来
- 多步精炼优于一次成型——每一步都产出独立 Markdown 产物，可版本化、可回滚、可团队评审
- "技术栈无关"是核心实验目标——同一份 spec 可以生成多种实现

---

## 2B. hermes-agent 核心思想提炼

> 与 spec-kit 不同，hermes-agent（NousResearch）解决的是**上层编排问题**：用户进来怎么接、会话怎么路由、任务怎么拆、子代理怎么调度、跨平台怎么 handoff。它给我们提供 b/c/d 三层（接待 → PM1 → PM2）的灵感来源。

### 2B.1 一句话定位

> 一个会话不是聊天，而是**可路由、可接力、可拆分、可沉淀**的工作单元。

hermes-agent 的全部机制都围绕这句话展开：会话有状态机、有归属平台、有父子关系、有持久 todo、有可委派的子代理、有可跨平台 handoff 的接力点。

### 2B.2 核心抽象（六件套）

| 抽象                      | 文件位置                    | 作用                                                                                         |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| **Session State Machine** | `hermes_state.py`           | session 表 + parent_session_id + handoff_state，把对话当对象管理                             |
| **Prompt 分层**           | `agent/prompt_builder.py`   | identity → context → volatile 三段式 system prompt，AGENTS/SOUL/.cursorrules 可注入          |
| **Toolset 门控**          | `toolsets.py`               | 不同 agent 看到不同工具集合，能力分层而非全开                                                |
| **Todo 持久化**           | `tools/todo_tool.py`        | 会话态 todo（pending/in_progress/completed/cancelled），上下文压缩后会重新注入活跃任务       |
| **Delegate Subagent**     | `tools/delegate_tool.py`    | 子代理派发：goal/context/toolsets/role，支持并行 + 深度限制 + leaf/orchestrator 角色         |
| **Handoff State Machine** | `gateway/run.py` + `cli.py` | session 跨平台接力：pending → running → completed/failed，伪造 synthetic turn 触发新平台继续 |

### 2B.3 三种"任务粒度"的协作机制

hermes 同时存在三套机制，用在不同生命周期：

1. **`todo`（短期 / 会话内）**：当下要做的事情，存活在 session state，不持久化。
2. **`delegate_task`（中期 / 跨子代理）**：父 agent 把单元任务派给子代理，同步等待结果。
3. **`kanban`（长期 / 跨会话跨团队）**：板式协作 + 结构化 handoff，跨 session 复用。

> **关键洞察**：hermes 不是"一个大 agent 会很多工具"，而是"多种粒度的任务流互相嵌套"。这正好对应 OpenAWork 的 c/d 分工：c 用 plan + todo 做规划，d 用 delegate 做派发，团队级长任务用 kanban。

### 2B.4 计划与产物机制

hermes 的"计划"不是单一 plan 对象，而是一条链：

```
.hermes/plans/*.md           （长期产物 - 类 spec-kit plan.md）
        │
        ▼
session todo list            （活跃任务 - 类 spec-kit tasks.md）
        │
        ▼
delegate_task subagent       （执行单元 - 类 spec-kit implement）
        │
        ▼
patch / file ops / JSON      （结构化产物 - V4A patch / file_tools.py）
        │
        ▼
spec review + quality review （双重审查 - 类 spec-kit analyze）
```

skills 文档（`skills/software-development/`）规定了：

- `plan` 技能：要求只产出 markdown 计划，不执行
- `writing-plans` 技能：计划必须含 goal/assumptions/steps/files/tests/risks，任务粒度 2-5 分钟
- `subagent-driven-development` 技能：完整流水线（计划 → todo → 子代理执行 → 双重 review → 完成 todo）

### 2B.5 指令分层（与 spec-kit constitution 互补）

hermes 的 prompt 分三层注入：

| 层级         | 来源                                                 | 生命周期     | 类比                        |
| ------------ | ---------------------------------------------------- | ------------ | --------------------------- |
| **identity** | `SOUL.md` + 内置身份                                 | 长期、稳定   | 类 spec-kit constitution    |
| **context**  | `AGENTS.md` / `.hermes.md` / `.cursorrules` / skills | 项目级、可换 | 类 spec-kit 的 specs 上下文 |
| **volatile** | memory / USER.md / timestamp / session metadata      | 会话级、动态 | 类 LangChain memory         |

**关键启发**：spec-kit 只有 `constitution.md` 一个长期约束层，hermes 把它细分成三层（人格 + 项目 + 会话），更符合多团队/多场景需求。

### 2B.6 Handoff 机制（OpenAWork 当前完全没有）

这是 hermes 最独特的特性之一。一个 session 可以从一个平台/agent 转交到另一个平台/agent，**不丢失上下文**：

```
1. CLI 触发 /handoff <platform>
   → 写入 sessions.handoff_state = 'pending'

2. Gateway watcher 发现 pending
   → claim 成 'running'
   → 找目标平台 home channel
   → 重新绑定 session key 到原 session_id
   → 伪造 synthetic turn 触发 agent 继续

3. 完成后标记 'completed' / 'failed'
```

携带的状态：`session_id`、平台、`title`、session history、session key 归属、home channel 目标。

**对 OpenAWork 的启示**：这正是当前 b/c/d 之间最缺的通信范式。c 把任务交给 d、d 把任务交给 e/f/g，本质都是 handoff，但当前没有结构化机制——只有 metadata 黑盒。

### 2B.7 它明确反对的做法

- **不在一个 agent 里塞所有工具**：toolset 门控强制能力分层
- **不让 AI 自由忘记任务**：todo 在上下文压缩后会被重新注入，强制延续
- **不靠"prompt 工程师"硬编码角色**：用 prompt 分层 + skill 文档 + handoff 组合出角色
- **不让子代理无限递归**：`max_spawn_depth` 和 `max_concurrent_children` 限制
- **不直接写自然语言改文件**：file 操作走结构化 patch（V4A）

### 2B.8 它对 AI 协作的根本假设

- 一个会话 = 一个工作对象，需要状态机管理
- 工具能力 = 角色定义的核心，不是附属功能
- 任务 = 多种粒度共存（todo / delegate / kanban），不是单一 plan
- 跨平台/跨 agent = 用 handoff 显式表达，不靠 metadata 偷偷传递
- 指令 = 多层注入，identity / context / volatile 各自独立演化

---

## 2C. spec-kit × hermes-agent 思想互补关系

两者并不冲突，而是互补的两面：

| 维度       | spec-kit 强项                | hermes-agent 强项                               |
| ---------- | ---------------------------- | ----------------------------------------------- |
| 关注点     | 把"做什么"想清楚             | 把"谁来做、怎么接力"想清楚                      |
| 时间维度   | 一次性把流程跑通（线性七步） | 持续工作（多 session、跨平台、长期沉淀）        |
| 主体抽象   | 产物（spec/plan/tasks）      | 会话（session + handoff + todo）                |
| 长期约束   | constitution.md 单层         | identity/context/volatile 三层                  |
| 任务粒度   | 单一 tasks.md                | todo / delegate / kanban 三粒度                 |
| 跨主体协作 | 没有显式机制                 | handoff 状态机                                  |
| 工具能力   | 不强制约束                   | toolset 门控 + 子代理深度限制                   |
| 产物形态   | Markdown 一等公民            | Markdown plans + JSON todo + patch + transcript |

> **核心论断**：spec-kit 的方法论 + hermes 的编排 = OpenAWork 团队架构的完整骨架。
>
> spec-kit 告诉我们 e/f/g（开发团队）该怎么干活；hermes 告诉我们 b/c/d（接待 + 项目经理）该怎么把活分下去。

---

## 3. OpenAWork team 现状梳理（三层叠加）

为了避免后续讨论各自定义"team"，先把当前的真实形态拆开看。

### 3.1 第一层：产品层 — Team 工作台

入口：`apps/web/src/App.tsx` 的 `/team` 与 `/team/:teamWorkspaceId` 都指向 `TeamPage.tsx`。

`TeamPage` 当前承载：

- 工作区列表（`use-team-workspace-state.ts`）+ 自动跳转选中
- 参考数据 Provider（`team-runtime-reference-data.tsx`）
- 侧边栏 + Header + Tab 区域
- "新建会话"与"新建模板"两类弹窗
- 运行态聚合视图（成员/任务/消息/共享/审计/共享会话）

值得注意：`team-runtime-shell.tsx` 是一个更完整的 runtime 壳层候选（有 总览/会话/任务/上下文/时间线/产物/变更 七个 tab），但**并没有挂在 `/team` 路由上**——它目前是 shadow / candidate，由 `260415-team-page-收口方案.md` 留下。

**产品语义**：当前 `/team` 是"单用户的 Team 控制中心"，不是真正的多人协作面板。

### 3.2 第二层：数据层 — 按 workspace 隔离的会话协作单元

`services/agent-gateway/src/db.ts` 中相关表：

| 表                | 含义                                     |
| ----------------- | ---------------------------------------- |
| `team_workspaces` | 团队工作空间（含 `defaultWorkingRoot`）  |
| `team_members`    | **当前用户私有**的成员记录，不是组织成员 |
| `team_tasks`      | 团队任务                                 |
| `team_messages`   | 团队留言/讨论                            |
| `team_audit_logs` | 审计日志                                 |
| `session_shares`  | 会话共享授权                             |

`session-workspace-metadata.ts` 中的关键字段：

```ts
// session.metadata_json 内可包含：
{
  teamWorkspaceId: string;
  workingDirectory: string;
  teamDefinition?: PersistedTeamDefinition; // 由创建流程决定
}
```

**数据语义**：team 在数据层最接近"按 workspace 隔离的协作单元 + session metadata 携带的 team 快照"。**没有**：

- invites / membership / permission 体系
- 真正的团队组织模型（`team_members` 是用户私有记录）
- team 级别的技能/产物/工作流归属外键

### 3.3 第三层：Agent 编排层 — 固定核心角色的多 Agent 团队

- `packages/shared/src/index.ts` 固定 4 个核心角色及其 canonical agent 绑定（planner / researcher / executor / reviewer）。
- `apps/web/src/pages/team/runtime/use-team-runtime-role-bindings.ts` 从 `/agents` catalog 推导固定 4 个角色绑定。
- `services/agent-gateway/src/routes/team.ts` 的 `interaction-agent rewrite` 与 `team-leader dispatch` 提供编排骨架。
- `packages/multi-agent/src/team.ts` 是纯内存 `TeamStoreImpl`，做"成员/任务/消息状态管理"。
- `packages/multi-agent/src/dag.ts` + `orchestrator.ts` 提供 DAG 调度、依赖释放、重试、失败升级。
- `packages/agent-core/src/plan/` 已有计划状态机（plan / steps / tool calls / events）。

**Agent 语义**：team 在 Agent 层是"固定 4 角色 + 可选成员的多 Agent 编排单元"。

### 3.4 三层是怎么叠加的

```
                ┌──────────────────────────────┐
   产品层 ────► │  Team 工作台（单用户控制中心） │
                └──────────────────────────────┘
                             │
                             ▼
                ┌──────────────────────────────┐
   数据层 ────► │  workspace 隔离 + session   │
                │  metadata.teamDefinition 快照 │
                └──────────────────────────────┘
                             │
                             ▼
                ┌──────────────────────────────┐
   编排层 ────► │  4 角色 + optional members   │
                │  multi-agent DAG / plan FSM   │
                └──────────────────────────────┘
```

**总体判断**：当前 team 最接近"工作空间隔离单元 + 会话/共享/任务的协作壳"，并夹带"Agent 团队编排"语义；**还不是一个完整的"人的团队管理系统"**。

### 3.5 当前明显的"思想真空"

对照 spec-kit 的范式后，team 当前缺的不是表结构，而是几个**未被命名的抽象**：

1. **没有"团队宪法"**：没有承载长期约束、做事原则、不接受边界的字段或文件。
2. **没有"多步精炼流程"**：从用户提需求 → createThread 是一步到位，没有 specify/clarify/plan/tasks 的中间产物。
3. **没有"团队级产物链"**：`team-playbook` 模板实质是 workflow nodes/edges，不是"流程方法论"；spec/plan/tasks 等文档不是一等公民。
4. **没有"工作流模板栈"**：当前模板只能整模板替换，无法做 overrides / presets / extensions 的分层定制。
5. **没有"AI 客户端适配矩阵"**：固定 4 角色绑定 + provider 默认值是硬编码的，缺一个把同一份团队方法论分发给不同 Agent 实现（claude-code / codex / gemini …）的注册器。

### 3.6 hermes-agent 视角下额外缺口

引入 hermes-agent 视角后，又能看到几个之前被掩盖的缺口：

6. **没有 session 状态机**：当前 session 只有 `state_status='idle'/...`，没有 `parent_session_id`、`handoff_state`、`role` 等字段；session 是数据，不是工作对象。
7. **没有 handoff 协议**：c→d、d→e/f/g 的派发是隐式的（metadata + agent dispatch），没有结构化 pending → running → completed 的状态机，也无法跨平台/跨用户接力。
8. **没有 toolset 门控**：所有 agent 看到同一套工具（受 skill 安装影响，但不受角色约束）；planner 能用 hash-edit、reviewer 能 spawn 子任务，能力边界模糊。
9. **没有 todo 持久化**：plan/任务在会话上下文里飘，上下文压缩后丢失；不像 hermes 的 `todo_tool.py` 会在压缩后重新注入。
10. **没有指令分层**：`AGENTS.md` 是仓库级，但缺会话级的 `SOUL.md`/identity 注入；prompt 是单体拼接，不是 identity/context/volatile 三层。

---

## 3B. 五层团队架构定义（a / b / c / d / e-g）

> 这是本次讨论的**核心命题**：把 OpenAWork 的多 Agent 团队明确划分为五个层次，每一层有独立的职责、产物、上下游接口。

### 3B.0 同步/异步双轨语义（v3 新增）

五层之间不是同一种通信模式：

```
┌─────────────────────────────────────────────────────────────┐
│  a ↔ b：同步对话（持续可中断、随时可加问题）                │
│  b → c/d/e/f/g：异步执行（非阻塞、后台跑、完成后回写）      │
└─────────────────────────────────────────────────────────────┘
```

- **a 与 b 之间是持续在线对话**：用户提需求后**不需要等待**下游 c/d/e/f/g 跑完才能继续聊天
- **b 与下游是异步任务关系**：b 创建后台任务 → 立即给用户回"已开始处理" → 任务跑完后通过推送通知用户
- **下游完全基于 handoff 状态机**：c/d/e/f/g 互相也是异步派发，只在状态变化时回写结果

这一条约束**根本性改变了 b 的定位**：

| 视角         | v1 定义（被替换）          | v3 定义                                    |
| ------------ | -------------------------- | ------------------------------------------ |
| b 的角色     | 路由 + 转发，转给 c 后退场 | **长驻前台对话 + 后台任务调度器**双角色    |
| b 的状态     | 单一会话状态               | 前台对话状态 + 后台任务清单                |
| b 的对话模式 | 单一（接收→转发）          | 三种：新需求模式 / 闲聊查询模式 / 推送模式 |

### 3B.1 整体拓扑（v3 同步/异步双轨）

```
   ┌────────────┐
   │  a. 用户    │ ◄─────────────────────────────────────┐
   └─────┬──────┘                                        │
         │ 同步对话（持续）                              │
         ▼                                               │
   ┌──────────────────────────────────────────────┐     │
   │  b. 接待 Agent（长驻前台 + 后台调度器）       │     │
   │  · 意图识别                                  │     │
   │  · 简单问答直答                              │     │
   │  · 复杂请求 → 创建后台任务 → 立即返回        │     │
   │  · 持续陪聊（用户可随时再问、再加需求）      │     │
   │  · 后台进度推送通道                          │     │
   └──┬─────────────────────────────────┬─────────┘     │
      │ 直答返回                        │ 推送通知       │
      └─── (回 a) ◄────────────┐        │                │
                               │        │ 创建后台任务   │ 推送
                               │        ▼                │
                               │   ════════════════════════════
                               │            ▼ 异步边界 ▼
                               │   ════════════════════════════
                               │        │
                               │        ▼  (与 a-b 对话并行)
                               │   ┌───────────────────┐
                               │   │ c. PM1 任务规划   │
                               │   └─────────┬─────────┘
                               │             │ handoff
                               │             ▼
                               │   ┌───────────────────┐
                               │   │ d. PM2 开发管控   │
                               │   │  ★ 桥接节点 ★    │
                               │   └─────────┬─────────┘
                               │             │ delegate
                               │             ▼
                               │   ┌────┬────┬────────┐
                               │   │ e  │ f  │  g     │
                               │   │开发│测试│ 评审   │
                               │   └─┬──┴─┬──┴───┬────┘
                               │     └────┴──────┘
                               │            │ 结果回写
                               │            ▼
                               │   ┌───────────────────┐
                               │   │ d. review 门禁    │
                               │   └─────────┬─────────┘
                               │             │ 通过
                               │             ▼
                               │   ┌───────────────────┐
                               │   │ c. 整合产物       │
                               │   └─────────┬─────────┘
                               │             │ 任务完成
                               │             ▼
                               └────────  推送回 b
```

**关键边界**：

- **同步边界**（a ↔ b）：用户与 b 永远在线对话，b 不会卡死等下游
- **异步边界**（b ↔ c/d/e/f/g）：所有下游层基于 handoff 状态机后台跑
- **回写路径**：下游有进展时，状态变更 → b 检测/订阅 → 选择性推送给 a

### 3B.2 五层职责矩阵（v3 同步/异步标注）

| 层        | 角色名       | 输入                           | 主要产物                              | 状态机                                  | 通信模式                       | 思想来源          |
| --------- | ------------ | ------------------------------ | ------------------------------------- | --------------------------------------- | ------------------------------ | ----------------- |
| **a**     | 用户         | (none)                         | 自然语言请求                          | (n/a)                                   | **同步**（与 b）               | (n/a)             |
| **b**     | 接待 Agent   | 用户原始消息 + 后台任务事件    | `RequestEnvelope` + 推送消息          | session.intent_state + b 的后台任务清单 | **同步前台 + 异步调度**        | hermes-agent      |
| **c**     | PM1 任务规划 | RequestEnvelope（来自 b 派发） | `plan.md` + `tasks.md`                | session.plan_state + handoff_state      | **异步**（接收 b、回写 b）     | hermes + spec-kit |
| **d**     | PM2 开发管控 | plan + tasks + constitution    | `dispatch_packages` + `review_report` | session.dispatch_state + handoff_state  | **异步**（接收 c、派发 e/f/g） | hermes + spec-kit |
| **e/f/g** | 开发团队     | dispatch_package               | patch / test / docs                   | task.status + handoff_state             | **异步**（接收 d、回写 d）     | spec-kit          |

### 3B.3 b 的双角色与三种对话模式

`b` 同时维护两种状态：

```
┌─────────────────────────────────────────────┐
│ b 的内部状态                                │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐    │
│ │ ① 前台对话状态（与 a 同步）          │    │
│ │ · 当前 turn                          │    │
│ │ · 短期记忆                           │    │
│ │ · 用户意图栈                         │    │
│ └─────────────────────────────────────┘    │
│ ┌─────────────────────────────────────┐    │
│ │ ② 后台任务清单（异步追踪下游）       │    │
│ │ · taskId-1: c 阶段 plan 中           │    │
│ │ · taskId-2: d 阶段派发中（3/5 完成）│    │
│ │ · taskId-3: 完成等待用户验收         │    │
│ └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**b 的三类对话模式**：

| 模式              | 触发                                   | 行为                                |
| ----------------- | -------------------------------------- | ----------------------------------- |
| **新需求模式**    | 用户提新请求                           | 创建后台任务 → 立即返回"已开始处理" |
| **闲聊/查询模式** | 用户问"现在什么状态" / 闲聊 / 简单问答 | 不创建后台任务，仅回答              |
| **推送模式**      | 后台任务有进展（完成/失败/需澄清）     | 主动 push 消息到 a 的对话流         |

**异步推送的三种优先级**：

```
🔴 阻塞性（需用户立即处理）
   · c 的 [NEEDS CLARIFICATION] 必须用户回答
   · d 的 Constitution Check 失败需用户决策
   · e/f/g 多次 review 失败需要用户介入

🟡 信息性（不阻塞但要告知）
   · c 完成 plan，可选择立即查看或继续后台跑
   · d 派发完成，e/f/g 开始执行
   · review 通过

🟢 静默性（仅记到任务清单，不打断对话）
   · 单个 dispatch_package 完成
   · 中间步骤进展（如 e 完成第 3/8 个 task）
```

**多个后台任务并行**：用户可在 b 这里连续提交多个请求，每个独立后台跑：

```
用户：实现 A 功能      → 创建 taskId-1（c→d→e/f/g 跑起来）
b：好的已开始
用户：再给我写个 README → 创建 taskId-2（c→d→e 跑起来）
b：好的已开始
用户：刚才 A 那个怎么样了？ → b 查询 taskId-1 状态汇报
b：A 的 plan 已经写完，d 正在派发，预计还要 2 分钟
```

> **关键设计**：b 不需要"切换会话"，所有后台任务都挂在同一个 a-b 对话里。用户与 b 的对话是**单一时间轴**，但下游有**多条并行任务流**。

### 3B.4 d 是为什么是双思想桥接节点

d 同时承担两件事：

**向上（消费 c 的产物）**：用 spec-kit 的 Constitution Check 校验 plan 是否违反团队宪法，确保任务包合规。

**向下（派发给 e/f/g）**：用 hermes-agent 的 delegate_task 范式把每个任务包装成 `{ goal, context, toolsets, role }` 子代理上下文。

这个双重身份决定了 d 是整个系统**最复杂、最关键**的一层——做不好会让上层规划与下层执行脱节，做好了能让两边的方法论互相增强。

### 3B.5 五层不是固定 5 个 agent

注意：五层是**职责分层**，不是"固定起 5 个 LLM 实例"。具体实现可以：

- **简单场景**：a → b →（b 直接执行），跳过 c/d/e-g。例如用户说"今天天气怎么样"。
- **轻量场景**：a → b → c →（c 自己出 plan 并执行），跳过 d/e-g。例如"帮我改个 typo"。
- **完整场景**：a → b → c → d → e/f/g 全链路。例如"实现 GitHub OAuth 登录"。

b 的核心职责之一就是**判断当前请求需要走到第几层**。这个判断本身就是 hermes-agent 的"复杂度 routing"思想。

### 3B.6 与 OpenAWork 现有 4 核心角色的关系

当前 OpenAWork 已有 4 核心角色（planner/researcher/executor/reviewer）。它们与五层的关系：

| 五层架构 | 当前 4 核心角色映射                           |
| -------- | --------------------------------------------- |
| b 接待   | 新增（当前不存在）                            |
| c PM1    | planner（升级，承担更多 spec 产物职责）       |
| d PM2    | 新增（当前 `team-leader dispatch` 是雏形）    |
| e 开发   | executor（保持）                              |
| f 测试   | 新增子角色（可由 reviewer 衍生）              |
| g 评审   | reviewer（保持）                              |
| 横向     | researcher（属于 c/d 的辅助能力，不独占一层） |

> **结论**：五层架构不是推翻现有 4 角色，而是把它们重新组织进更清晰的层次结构里。最大变化是**新增 b（接待）和 d（PM2）**。

---

## 3C. 完整端到端对话流程图（v3 合并自 team-conversation-flow-draft.md）

> 这一节是 v2 草稿 `team-conversation-flow-draft.md` 的合并产物。Section 3B 给出了五层"骨架拓扑"，本节给出**完整的端到端流转**——含 review 失败回路、Constitution Check 退回路径、回写到用户的链路。

### 3C.1 完整流程图（含分支与失败回路）

```
   ┌────────────┐
   │  a. 用户    │ ◄────────────────────────────────────┐
   └─────┬──────┘                                       │
         │ 多轮持续对话（同步）                         │
         ▼                                              │
   ┌──────────────────────────────────────────────┐     │
   │  b. 接待 Agent（长驻前台）                    │     │
   │  ① 意图识别                                  │     │
   │  ② 决定走第几层                              │     │
   │  ③ 持续陪聊（用户随时可问）                  │     │
   │  ④ 后台任务状态汇报（主动 / 被动）           │     │
   └──┬──────────────────────────────┬────────────┘     │
      │                              │                  │
      │ 简单问答直答                 │ 创建后台任务     │ 异步推送通知
      └──── (回 a) ◄─────┐           │ 立即返回         │（任务完成 / 失败 / 需确认）
                         │           │ "已开始处理"     │
                         │           ▼                  │
                         │   ════════════════════════════════════════
                         │            ▼ 异步边界 ▼
                         │   ════════════════════════════════════════
                         │           │
                         │           ▼  (后台任务，与 a-b 对话并行)
                         │   ┌───────────────────────────┐
                         │   │  c. PM1 / 任务规划         │
                         │   │  · specify  写 spec        │
                         │   │  · clarify  澄清回路       │
                         │   │  · plan     写 plan.md     │
                         │   │  · tasks    写 tasks.md    │
                         │   └────┬─────┬─────────────────┘
                         │        │     │
                         │ 需要澄清│     │ 计划就绪
                         │ (推 b)  │     ▼
                         │        │  ┌─────────────────────────┐
                         │        │  │  d. PM2 / 开发管控       │
                         │        │  │  · Constitution Check    │
                         │        │  │  · 拆 dispatch_packages  │
                         │        │  │  · 多路并行派发          │
                         │        │  └────┬────┬────────────────┘
                         │        │       │    │
                         │        │ 违反宪法 │ 派发就绪
                         │        │ (退 c) │  │
                         │        │       │    ▼
                         │        │       │  ┌───────┬───────┬───────┐
                         │        │       │  │ e开发 │ f测试 │ g评审 │
                         │        │       │  └───┬───┴───┬───┴───┬───┘
                         │        │       │      └───────┴───────┘
                         │        │       │             │ 结果回写
                         │        │       │             ▼
                         │        │       │  ┌──────────────────────┐
                         │        │       │  │  d. review 门禁       │
                         │        │       │  │  · spec review        │
                         │        │       │  │  · quality review     │
                         │        │       │  └──┬───────────────┬────┘
                         │        │       │     │               │
                         │        │       │ review 失败    review 通过
                         │        │       │     │               │
                         │        │       │     ▼               ▼
                         │        │       │  (重派 e/f/g)  ┌─────────────────────┐
                         │        │       │     或          │  c. 整合产物链        │
                         │        │       │  (退 c 重规划)  └───────┬─────────────┘
                         │        │       │                          │
                         │        │       └──────────────────────────┤
                         │        └──────────────────────────────────┤
                         │ 需要 a 澄清                                 │ 任务完成
                         │ 通过 b 异步推送                             │ 通过 b 异步推送
                         └─────────────────────────────────────────────┘
                                            │
                                            ▼
                                    (回到上方 b 推送通道)
```

### 3C.2 关键节点摘要

| 层             | 输入              | 主要决策权                                             | 主要产物                          |
| -------------- | ----------------- | ------------------------------------------------------ | --------------------------------- |
| **a** 用户     | —                 | 提需求、澄清、验收                                     | 自然语言请求                      |
| **b** 接待     | 用户消息          | **路由：直答 / 走 c / 紧急直派**；推送优先级；任务取消 | RequestEnvelope + 推送消息        |
| **c** PM1      | RequestEnvelope   | 何时澄清、何时收敛计划                                 | spec.md + plan.md + tasks.md      |
| **d** PM2      | spec/tasks + 宪法 | Constitution Check、派发拆分、review 通过/重派/回 c    | dispatch_packages + review_report |
| **e/f/g** 开发 | dispatch_package  | 怎么实现具体任务                                       | patch / 测试结果 / review notes   |

### 3C.3 流程中的 5 个关键决策分歧（v2 草稿 Q1-Q5）

下面 5 个决策已在 Section 9.4 决策清单中正式记录（D26-D30）。这里只列流程层面的选择含义：

#### Q1（D26）：b 是否允许"直答"绕过 c/d？

- **推荐 A**：是 → 用户体验好，但要定义"什么算简单问答"
- 备选 B：否 → 所有请求都走 c

#### Q2（D27）：c 的澄清回路是否经过 b？

- 备选 A：c 直接问 a
- **推荐 B**：c 通过 b 异步推送给 a（与同步/异步语义一致）

#### Q3（D28）：e/f/g 之间的依赖关系？

- 备选 A：完全并行
- 备选 B：串行 e → f → g
- **推荐 C**：有限并行（e/f 并行，g 等两者完成）

#### Q4（D29）：review 失败的恢复策略？

- 备选 A：永远 d 内部重派
- **推荐 B**：d 判断失败原因，分别走"d 重派"或"回 c 重规划"
- 备选 C：固定 d 重派 N 次后强制升级到 c

#### Q5（D30）：用户能否在中间任一步骤介入？

- 备选 A：全自动跑完，不能中间介入
- **推荐 B**：关键节点（c 完成 plan、d 派发前）暂停等用户确认
- 备选 C：用户可随时介入任一节点

### 3C.4 三种典型场景的实际路径

**场景 1：闲聊（"今天天气怎么样"）**

```
a → b → b 直答 → 回 a    # 总耗时 < 2s，无后台任务
```

**场景 2：轻量任务（"帮我改个 typo"）**

```
a → b → 创建后台任务 → "已开始" → 回 a（同步对话继续）
       │
       └─ b → c → 简单 plan → e → 完成 → 推送回 a
                                       (耗时 < 30s)
```

**场景 3：完整开发任务（"实现 GitHub OAuth 登录"）**

```
a → b → 创建后台任务 → "已开始" → 回 a（同步对话继续）
       │
       └─ b → c → spec/clarify/plan/tasks
              │       │
              │       ├─ [NEEDS CLARIFICATION] → 推送 b → 异步问 a → 回写 c
              │       │
              │       └─ tasks 就绪 → handoff → d
              │                              │
              │                              ├─ Constitution Check 失败 → 退 c 重规划
              │                              │
              │                              └─ 通过 → 拆 dispatch_packages → 并行派 e/f/g
              │                                                                │
              │                                                                ├─ e 写代码
              │                                                                ├─ f 写测试
              │                                                                └─ g 评审
              │                                                                │
              │                                                                ▼
              │                                                            d 双重 review
              │                                                                │
              │                                                                ├─ 失败 → 重派或回 c
              │                                                                │
              │                                                                └─ 通过 → 回 c 整合
              │                                                                          │
              │                                                                          ▼
              │                                                                       推送回 a
              │
              └─ 期间用户可随时问 b："那个 OAuth 怎么样了？"
                  b 查询当前阶段 → "正在 d 派发，已完成 3/5 任务"
```

### 3C.5 流程图与七件套的对应

| 流程节点               | 对应件套（见 Section 5）                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| b 创建后台任务         | ⑤ Session State Machine（创建子 session）+ ⑥ Handoff Protocol（b→c handoff） |
| c 写产物               | ② Workflow + ③ Artifacts                                                     |
| c 澄清回路             | `[NEEDS CLARIFICATION]` 标记（spec-kit）+ ⑥ Handoff（异步推送）              |
| d Constitution Check   | ① Constitution + Workflow gate                                               |
| d 拆 dispatch_packages | ⑥ Handoff Payload（goal/context/toolsets/role + artifactRefs）               |
| e/f/g 执行             | ④ Role Adapter Matrix                                                        |
| d 双重 review          | ① Constitution + ③ Artifacts (review_report)                                 |
| 全程持久化             | ⑤ Session State Machine（parent_session_id 形成 session 树）                 |
| 跨层取消               | ⑥ Handoff cancel 指令（v3 新增）                                             |

### 3C.6 b 的内部状态结构（v3 锁定）

```ts
interface ReceptionAgentState {
  // 前台对话（与 a 同步）
  conversationId: string;
  userId: string;
  currentTurn: Message[];

  // 后台任务清单（追踪下游异步进展）
  activeTasks: BackgroundTask[];
}

interface BackgroundTask {
  taskId: string;
  rootSessionId: string; // 派给 c 时创建的 session
  intent: string; // 简短描述："实现登录功能"
  currentStage:
    | 'pending'
    | 'planning'
    | 'dispatching'
    | 'executing'
    | 'reviewing'
    | 'completed'
    | 'failed'
    | 'needs_clarification';
  progress?: { done: number; total: number };
  needsUserAction?: 'clarify' | 'approve' | 'verify';
  startedAt: number;
  completedAt?: number;
}

interface PushFromBackground {
  taskId: string;
  intent: string; // 让用户想起是哪个任务
  level: 'blocking' | 'info' | 'silent';
  summary: string;
  actions?: Array<{
    // 可选的快捷按钮
    label: string;
    payload: unknown;
  }>;
}
```

---

## 4. 思想映射表（spec-kit + hermes-agent → 五层）

按"双源 → 五层"重组：每条机制标注**思想来源**（spec-kit / hermes / 双源）、**主要落点层**（b/c/d/e-g）、**借鉴强度**与**本地化方案**。

### 4.1 hermes-agent → b/c/d 上层编排映射

| hermes-agent 概念                                              | 落点层      | 借鉴强度       | 本地化方案                                                                                         |
| -------------------------------------------------------------- | ----------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Session State Machine（`parent_session_id` / `handoff_state`） | b/c/d       | **强烈**       | 扩展 `sessions` 表：增加 `parent_session_id`、`handoff_state`、`role_layer` 字段                   |
| Handoff 协议（pending → running → completed/failed）           | b→c→d→e/f/g | **强烈**       | 新增 `handoff_records` 表 + watcher，串联五层之间的派发                                            |
| Prompt 分层（identity / context / volatile）                   | b/c/d       | **强烈**       | b 的接待人格、c/d 的 PM 人格分别写成 `agent_personas` 表，注入时按层组合                           |
| Toolset 门控                                                   | c/d         | **建议**       | 每层声明可见 toolset：b 看 router-tools、c 看 plan-tools、d 看 dispatch-tools、e/f/g 看 exec-tools |
| Todo 持久化（压缩后再注入）                                    | c/d         | **建议**       | 把 `team_tasks` 升级为活跃 todo，纳入上下文压缩后的 re-injection 机制                              |
| `delegate_task` 子代理派发                                     | d → e/f/g   | **强烈**       | d 调用 delegate 派发到 e/f/g，每包传 `goal/context/toolsets/role` 四元组                           |
| 子代理深度限制（`max_spawn_depth`）                            | d           | **建议**       | 防止 PM2 无限拆分；硬上限 3 层                                                                     |
| `kanban` 长期任务板                                            | 跨 session  | **延后**       | Phase C 之后再考虑；MVP 不引入                                                                     |
| AGENTS/SOUL/.cursorrules 三层指令                              | b/c/d/e-g   | **强烈**       | 仓库级 AGENTS（保留）+ 团队级 constitution（spec-kit 借鉴）+ 角色级 SOUL（hermes 借鉴）            |
| V4A patch 结构化产物                                           | e/f/g       | **建议**       | 已部分实现（hash-edit）；继续强化结构化输出                                                        |
| `clarify` 工具                                                 | b/c         | **建议**       | b 阶段触发用户澄清，c 阶段触发 `[NEEDS CLARIFICATION]` 标记                                        |
| Cron / curator 学习闭环                                        | (any)       | **不建议照搬** | OpenAWork 已有 telemetry，不重复造                                                                 |
| 全家桶 skills/plugins/profiles                                 | —           | **不建议照搬** | 复杂度过高，违反"先小步"                                                                           |

### 4.2 spec-kit → c/d/e-f-g 方法论映射

| spec-kit 概念                 | 落点层        | 借鉴强度       | 本地化方案                                                               |
| ----------------------------- | ------------- | -------------- | ------------------------------------------------------------------------ |
| `constitution.md`             | d / 全局      | **强烈**       | `team_workspaces.constitution_md`，作为 d 阶段 Constitution Check 的输入 |
| 七步工作流                    | c → d → e/f/g | **建议但裁剪** | c 承担 specify/clarify/plan/tasks；d 承担 analyze；e/f/g 承担 implement  |
| `[NEEDS CLARIFICATION]` 标记  | c             | **强烈**       | c 输出的 plan.md / tasks.md 中沿用，前端高亮 + 阻塞门禁到 d              |
| `[P]` / `[US1]` 任务标记      | c → d         | **建议**       | c 在 tasks.md 标注，d 用其推导并行 dispatch                              |
| Constitution Check gate       | d             | **强烈**       | d 在派发前强制对齐 `team_constitution`，冲突即 CRITICAL                  |
| 四层模板栈                    | c             | **建议但延后** | Phase C 引入 overrides + core 两层；presets/extensions 延后              |
| Slash command 模板            | c             | **建议**       | 落到 team workflow 模板包：每个 step 一个 prompt + 产物声明              |
| 多 AI 客户端适配矩阵          | e/f/g         | **建议但裁剪** | 抽象 `TeamRoleAdapter`，同一角色可换不同 agent 实现                      |
| `handoffs` frontmatter        | c → d → e/f/g | **强烈**       | 与 hermes 的 handoff_state 合并：frontmatter 声明 next，DB 记状态        |
| 产物 Markdown 一等公民        | c → d         | **强烈**       | c 的 spec/plan/tasks、d 的 review_report 全部进 artifact 系统            |
| spec-kit 七步全照搬           | —             | **不建议**     | 在 OpenAWork 场景下过重；裁剪为五层 + 三粒度任务流                       |
| `specify init` 客户端目录分发 | —             | **不建议照搬** | SaaS 不存在客户端目录概念                                                |

### 4.3 双源融合点（最关键的 4 条）

这 4 条是两源思想的**化学反应点**——单独看任一源都不完整，融合后产生新能力：

| 融合机制           | spec-kit 部分                     | hermes 部分                                        | 融合产出                                                                                       |
| ------------------ | --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **结构化派发包**   | 任务标记 [P]/[US1] + 文件路径明确 | delegate_task 的 goal/context/toolsets/role 四元组 | d 输出的 `dispatch_package`：`{ goal, context, toolsets, role, [P], [US1], constitution_ref }` |
| **可审计 handoff** | handoffs frontmatter（声明 next） | handoff_state 状态机（pending/running/completed）  | 文档声明 + DB 状态 + 前端时间线三位一体                                                        |
| **三层指令栈**     | constitution.md 单层              | identity / context / volatile 三层                 | 全局 AGENTS.md（工程纪律）+ 团队 constitution.md（业务约束）+ 角色 SOUL.md（人格）             |
| **三粒度任务流**   | 单一 tasks.md                     | todo / delegate / kanban 三粒度                    | c 产 plan.md + tasks.md，d 拆 dispatch_package（同步 delegate），跨 session 长任务进 kanban    |

### 4.4 不能直接照搬的关键差异（双源版）

| 维度          | spec-kit               | hermes-agent                       | OpenAWork                                           |
| ------------- | ---------------------- | ---------------------------------- | --------------------------------------------------- |
| 形态          | 单机 CLI               | 单进程 Python agent                | 多端 SaaS（Web/Tauri/Mobile）                       |
| 受众          | 开发者本人             | 个人/团队（gateway 多平台）        | 多人协作 + 多 Agent                                 |
| 产物归属      | 文件系统 `.specify/`   | 文件系统 `.hermes/plans/` + SQLite | 数据库 + artifact 仓库 + session metadata           |
| 长期约束      | constitution.md 单文件 | SOUL.md + AGENTS.md + skills       | 三层栈：全局 AGENTS + 团队 constitution + 角色 SOUL |
| 任务粒度      | tasks.md 单层          | todo / delegate / kanban 三层      | 三粒度 + 跨层 handoff 状态机                        |
| 流程触发      | 用户敲 slash command   | CLI 命令 + IM 消息 + cron          | Web UI + IM channel + 定时任务                      |
| 多 Agent 协作 | 无显式机制             | delegate_task + handoff            | 五层 + handoff + delegate                           |

**结论**：两源都只能取"思想"和"骨架"，不能照搬实现细节。OpenAWork 的本地化目标是**把两源融合成五层架构**，而不是叠加成两套并行系统。

---

## 5. 架构提案：team 的"七件套"

基于上述双源映射，建议把 OpenAWork team 演进成一个由七个核心抽象构成的系统。前四件来自 spec-kit，⑤⑥ 来自 hermes-agent 的编排骨架，⑦ 来自 hermes-agent 的双存储记忆——合并起来等价于"团队级 SDD + 多 Agent 编排 + 长期记忆"的完整骨架。

```
        ┌────────────────────────┐  ┌────────────────────────┐
        │ ① Team Constitution    │  │ ⑤ Session State Machine│
        │   团队宪法（spec-kit）  │  │   会话状态机（hermes） │
        └─────────┬──────────────┘  └────────────┬───────────┘
                  │ 被 Plan 读取                 │ 被所有层使用
                  ▼                              ▼
        ┌────────────────────────┐  ┌────────────────────────┐
        │ ② Team Workflow        │  │ ⑥ Handoff Protocol     │
        │   工作流模板（spec-kit）│  │   交接协议（hermes）   │
        └─────────┬──────────────┘  └────────────┬───────────┘
                  │ 产出                         │ 驱动跨层流转
                  ▼                              │
        ┌────────────────────────┐               │
        │ ③ Team Artifacts       │◄──────────────┘
        │   阶段性产物链（spec-kit）│
        └─────────┬──────────────┘
                  │ 驱动
                  ▼
        ┌────────────────────────┐  ┌────────────────────────┐
        │ ④ Role Adapter Matrix  │  │ ⑦ Project Memory       │
        │   角色适配矩阵（spec-kit）│  │   双存储记忆（hermes） │
        └────────────────────────┘  └────────────────────────┘
                                              │
                                              ▼
                                     被所有层 prefetch 注入
```

### 5.1 ① Team Constitution（团队宪法）

**定位**：team 长期约束的统一锚点。回答"这个 team 在做什么、坚持什么、不接受什么"。

**形态**：

- 数据层：`team_workspaces` 表新增字段 `constitution_md TEXT`（或独立 `team_constitutions` 表，但 MVP 不必）
- 产物层：渲染为 `team-{id}/constitution.md`，纳入 artifact 系统
- 编辑入口：`/team` 页面新增"团队宪法"侧边 tab，支持 Markdown 编辑 + 版本历史

**典型内容（建议预置模板）**：

```md
# {{ teamName }} 团队宪法

## 核心原则

1. {{ principle1 }}
2. {{ principle2 }}

## 不接受的做法

- ...

## 工程约束

- 测试覆盖率门禁：>= 80%
- 安全要求：所有外部输入经 Zod 校验
- 性能要求：p95 < 200ms

## 治理

- 修订流程：...
- 评审权限：...
```

**双源指令分层**（融合 hermes-agent 三层栈 + D45 架构规范 + D54 学习闭环 + D55 仓库级共享）：

| 层级               | 来源                                       | 范围                          | 思想源                          | 注入顺序  |
| ------------------ | ------------------------------------------ | ----------------------------- | ------------------------------- | --------- |
| **engineering**    | 仓库 `AGENTS.md`                           | 仓库级（git）                 | OpenAWork 现有                  | 1（最先） |
| **architecture**   | 仓库 `architecture.md`                     | 仓库级（git）                 | D45 v3.8 新增                   | 2         |
| **context**        | `team_workspaces.constitution_md`          | 团队级（DB）                  | spec-kit                        | 3         |
| **memory:project** | 仓库 `project-memory.md`                   | 仓库级（git，frozen）         | D55 v3.9 修正（原 DB 字段移出） | 4         |
| **lessons**        | 仓库 `lessons-learned.md`                  | 仓库级（git）                 | D54 v3.9 新增                   | 5         |
| **memory:user**    | `users.user_memory_md`                     | 用户级（DB，frozen）          | hermes-agent + D34              | 6         |
| **identity**       | `SOUL.md`（含 D44 5 维度风格 frontmatter） | 角色级（每个 b/c/d/e-g 一个） | hermes-agent + D44              | 7（最后） |

> **关键设计**：spec-kit 的 constitution 只有团队级一层，hermes-agent 的指令分层把"角色人格"独立出来。OpenAWork 融合这两个思路并扩展为 **7 层**：仓库级（AGENTS + architecture + project-memory + lessons-learned）+ 团队级（constitution）+ 用户级（user_memory）+ 角色级（SOUL）。
>
> **注入顺序锁定**（D34 v3.1 + D45 v3.8 + D44 v3.8 + D54 v3.9 + D55 v3.9 联合）：从仓库级到角色级、从工程纪律到个人风格逐层细化，前面的层为后面的层提供基线，后面的层在基线上做角色化定制。
>
> **D55 修正**：`team_workspaces.project_memory_md` 字段不再需要——project-memory 改为仓库根 git 文件，所有 team 共享。

**关键约束**（来自 spec-kit 的 Constitution Check）：

- **plan 阶段必须读取**：team 任何 plan/tasks 生成都要把 constitution 喂给 LLM
- **冲突即 CRITICAL**：analyze 命令检测到 plan/tasks 与 constitution 冲突，直接标 CRITICAL
- **不可隐式覆盖**：要修改 constitution 必须显式走 "constitution update" 流程，不能在 plan 里悄悄绕过

### 5.2 ② Team Workflow（团队工作流模板）

**定位**：把"多步精炼"沉淀成可复用模板，类比 spec-kit 的 slash command 体系。

**形态**：扩展现有 `workflow_templates`：

```sql
ALTER TABLE workflow_templates ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
```

`metadata_json` 内承载 team-workflow 语义：

```json
{
  "teamWorkflow": {
    "steps": [
      {
        "id": "specify",
        "label": "需求规格",
        "promptTemplate": "...（包含 [NEEDS CLARIFICATION] 规则）",
        "produces": ["spec.md"],
        "handoffs": ["clarify", "plan"],
        "guardrails": ["不写 how", "最多 3 个 NEEDS CLARIFICATION"]
      },
      {
        "id": "clarify",
        "label": "澄清",
        "promptTemplate": "...（最多 5 问）",
        "produces": ["spec.md#Clarifications"],
        "handoffs": ["plan"]
      },
      {
        "id": "plan",
        "label": "技术计划",
        "requires": ["constitution.md", "spec.md"],
        "produces": ["plan.md"],
        "handoffs": ["tasks"],
        "gates": ["constitutionCheck"]
      },
      {
        "id": "tasks",
        "label": "任务拆解",
        "produces": ["tasks.md"],
        "handoffs": ["implement"]
      },
      {
        "id": "implement",
        "label": "执行",
        "produces": ["completedTasks"],
        "gates": ["checklistComplete"]
      }
    ],
    "defaultProvider": "claude-code",
    "defaultBindings": {
      "planner": "oracle",
      "researcher": "librarian",
      "executor": "hephaestus",
      "reviewer": "momus"
    }
  }
}
```

**裁剪原则**（不照搬 spec-kit 七步）：

- **MVP 三步**：`spec → plan → execute`
- **进阶五步**：`spec → clarify → plan → tasks → execute`
- **完整七步**：在团队明确需要 constitution 修订流和 analyze 门禁时再扩

**关键机制**：

- **handoffs**：每一步声明"下一步可能是什么"，前端 UI 据此渲染下一步按钮
- **requires**：声明这一步需要哪些前置产物，缺失时阻塞
- **gates**：声明门禁条件（constitutionCheck / checklistComplete 等）
- **promptTemplate**：作为发给 Agent 的核心提示词，参数化嵌入产物内容

### 5.3 ③ Team Artifacts（团队产物链）

**定位**：把 spec / plan / tasks 等阶段性 Markdown 沉淀为一等公民，可版本化、可检索、可团队评审。

**形态**：复用 `packages/artifacts/` 现有能力，扩展两个维度：

```ts
interface TeamArtifact extends Artifact {
  teamWorkspaceId: string;
  sessionId?: string; // 可选：关联到具体 session
  workflowStepId?: string; // 关联到 workflow 哪一步（spec/clarify/plan/...)
  phase: 'constitution' | 'spec' | 'clarify' | 'plan' | 'tasks' | 'analyze' | 'report';
  parentArtifactId?: string; // 多步精炼的上一步
}
```

**关键能力**：

1. **版本化**：每次 LLM 重新生成 → 新版本，旧版本保留可回滚
2. **链式追溯**：`spec → plan → tasks → implement` 形成 DAG，前端可视化
3. **跨 session 复用**：同一个 team 的 constitution/spec 可以被多个 session 引用
4. **机器可解析标记**：保留 `[NEEDS CLARIFICATION]` / `[P]` / `[US1]` 等语义标记，前端高亮 + 后端校验

**不重新造轮子**：

- 编辑 UI 复用 `ArtifactsPage` 与 `artifact-workbench.tsx`
- 版本回滚复用 `artifact-content-store.ts`
- 文件浏览复用 `artifact-record-list.tsx`

### 5.4 ④ Role Adapter Matrix（角色适配矩阵）

**定位**：把同一份团队方法论分发到不同 Agent 实现，类比 spec-kit 的 IntegrationBase 但裁剪到 OpenAWork 规模。

**问题动机**：现状是固定 4 角色绑定 + 硬编码 provider。但实际场景里：

- planner 角色可能想用 Oracle（推理重）也可能想用 Atlas（轻量）
- researcher 角色可能用 Librarian（远端代码搜索）也可能用 web-search agent
- executor 在 Tauri 桌面端可能直接调本地 Claude Code，在 Web 端走 gateway provider

**形态**：抽象 `TeamRoleAdapter` 接口：

```ts
interface TeamRoleAdapter {
  role: 'planner' | 'researcher' | 'executor' | 'reviewer' | string;
  agentImplKey: string; // 'oracle' / 'librarian' / 'hephaestus' / ...
  provider?: string; // 'claude-code' / 'gemini' / ...
  promptTransform?: (raw: string) => string;
  contextBuilder?: (artifacts: TeamArtifact[]) => string;
}

interface TeamRoleAdapterRegistry {
  resolve(role: string, ctx: TeamContext): TeamRoleAdapter;
  register(adapter: TeamRoleAdapter): void;
}
```

**与现状的连接**：

- 复用 `use-team-runtime-role-bindings.ts` 的 canonicalRole 推导
- 复用 `agent-catalog.ts` 的 agent 注册表
- 复用 `provider/` 模块的多 provider 能力

**裁剪原则**：

- **不照搬 30+ 客户端目录分发**：OpenAWork 是 SaaS / 服务端，不需要往用户硬盘写 `.claude/` 目录
- **MVP 只需 4 个内置 adapter**：planner / researcher / executor / reviewer 各一个默认实现
- **可扩展但不强制**：开放 `register()` API，让用户/团队后续自定义

### 5.5 ⑤ Session State Machine（会话状态机）★ hermes-agent 借鉴 ★

**定位**：把 session 从"数据"升级为"工作对象"，让 b/c/d/e-g 五层都围绕同一个会话生命周期协作。

**问题动机**：当前 `sessions` 表只有 `state_status='idle'/...`，没有：

- `parent_session_id`：会话谱系（多步精炼时一个 session 可以由另一个分裂出来）
- `handoff_state`：跨层接力的显式状态
- `role_layer`：当前 session 由哪一层（b/c/d/e-g）拥有
- `intent_state`：b 阶段识别出的意图分类（ask/plan/implement/...）

**形态**：扩展 `sessions` 表（不新建表，避免双 truth）：

```sql
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN handoff_state TEXT;       -- pending/running/completed/failed/null
ALTER TABLE sessions ADD COLUMN role_layer TEXT;          -- 'reception'/'pm1'/'pm2'/'execution'
ALTER TABLE sessions ADD COLUMN intent_state TEXT;        -- 'ask'/'plan'/'implement'/'investigate'

-- v3.6 新增：暂停字段（D42 拍板）
ALTER TABLE sessions ADD COLUMN paused INTEGER DEFAULT 0;          -- 0=运行中, 1=已暂停
ALTER TABLE sessions ADD COLUMN paused_at INTEGER;                 -- 暂停时间戳（用于"暂停>1h上下文过期"警告）
ALTER TABLE sessions ADD COLUMN paused_by_user_id TEXT;            -- 暂停发起者（审计）
ALTER TABLE sessions ADD COLUMN pause_reason TEXT;                 -- 可选：用户填写的暂停原因

-- 同样字段同步到 handoff_records，用于 watcher 跳过暂停的 handoff
ALTER TABLE handoff_records ADD COLUMN paused INTEGER DEFAULT 0;
ALTER TABLE handoff_records ADD COLUMN paused_at INTEGER;

CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_sessions_handoff ON sessions(handoff_state) WHERE handoff_state IS NOT NULL;
CREATE INDEX idx_sessions_paused ON sessions(paused) WHERE paused = 1;
```

**暂停语义**（D42 v3.6 新增）：

- **粒度**：支持单任务暂停 + 一键全团队暂停（同 receptionSessionId 下所有活跃任务）
- **LLM 处理**：等当前轮调用完成，下轮调用前检查 `paused` 标志后冻结，**不浪费已付成本**
- **a-b 同步对话不受影响**：暂停只影响下游 c/d/e/f/g 的 handoff 推进，b 长驻前台原则保留
- **超时**：永久暂停直到手动恢复；前端检测 `paused_at` 超过 1 小时时显示"上下文可能过期"警告
- **与 cancel 的区别**：cancel 销毁中间产物且不可恢复，pause 冻结状态可恢复
- **watcher 集成**：watcher 轮询 `pending` handoff 时跳过 `paused=1` 的记录

**状态转移**（对应五层）：

```
b 创建 session（role_layer='reception', intent_state=null）
   ↓ 接待识别意图
b 设置 intent_state='plan'，触发 handoff
   ↓
b 标记 handoff_state='pending'，target=c
   ↓ Watcher 接管
c 创建子 session（parent_session_id=b的id, role_layer='pm1'）
   ↓ b 的 handoff_state='completed'
c 输出 plan + tasks，再次 handoff
   ↓
d 创建子 session（parent_session_id=c的id, role_layer='pm2'）
   ↓ c 的 handoff_state='completed'
d 拆分 dispatch_packages，并行派发
   ↓
e/f/g 各自创建子 session（parent_session_id=d的id, role_layer='execution'）
```

**核心约束**：

- **不允许跨层直接通信**：b 不能直接调 e，必须经过 c → d
- **session 树可视化**：前端基于 `parent_session_id` 渲染树形时间线，让用户看到"完整的工作分形"
- **session 可暂停可恢复（D42 pause）**：任何一层暂停后，子 session 全部进入 `paused` 状态，等恢复后继续；**可取消不可恢复（D33 cancel）**：取消后子 session 标记 `cancelled`，产物保留但不可继续

**与 b 后台任务清单的关系**（v3 新增）：

b 的 `BackgroundTask[]` 不是新表，而是**对 session 树的索引视图**：

```
b 的 BackgroundTask.taskId
        ▼
  对应一个根 session（role_layer='reception'）
        ▼
  parent_session_id 链下挂 c/d/e/f/g 子 session
        ▼
  currentStage 由"最深活跃子 session.role_layer + handoff_state"投影计算
        ▼
  progress 由该 b 任务下所有 dispatch handoff 的 completed/total 计算
```

`BackgroundTask` 是 b 内存中维护的**派生状态**，每次推送或用户查询时按需从 session 树重算。这避免了"双 truth"问题——session 树是唯一权威。

### 5.6 ⑥ Handoff Protocol（交接协议）★ hermes-agent 借鉴 ★

**定位**：把"派发"从隐式 metadata 黑盒升级为显式状态机，串联五层之间的所有任务流转。

**问题动机**：当前 c→d、d→e/f/g 的派发是隐式的：

- 通过 session metadata 偷偷传递 teamDefinition
- 通过 `team-leader dispatch` 临时拼出 prompt 直接调 agent
- 没有重试、超时、降级、审计

引入显式 handoff 后，每一次跨层派发都是可观测的、可重放的、可追溯的。

**形态**：新增 `handoff_records` 表：

```sql
CREATE TABLE handoff_records (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  target_session_id TEXT,             -- 目标 session 创建后回填
  source_layer TEXT NOT NULL,         -- 'reception'/'pm1'/'pm2'
  target_layer TEXT NOT NULL,         -- 'pm1'/'pm2'/'execution'
  state TEXT NOT NULL,                -- 'pending'/'claimed'/'running'/'completed'/'failed'
  payload_json TEXT NOT NULL,         -- 派发包内容
  result_json TEXT,                   -- 完成后的结果
  error_text TEXT,                    -- 失败原因
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX idx_handoff_state ON handoff_records(state);
CREATE INDEX idx_handoff_source ON handoff_records(source_session_id);
```

**派发包标准结构**（融合 hermes 的 delegate_task 四元组 + spec-kit 的产物链）：

```ts
interface HandoffPayload {
  // 来自 hermes-agent delegate_task
  goal: string; // 这次派发要达成什么
  context: string; // 关键上下文（不是全量历史）
  toolsets: string[]; // 允许使用的工具集
  role: 'planner' | 'researcher' | 'executor' | 'reviewer' | string;

  // 来自 spec-kit
  artifactRefs: {
    constitution: string; // team_constitution artifact id
    spec?: string; // spec.md artifact id
    plan?: string; // plan.md artifact id
    tasks?: string; // tasks.md artifact id
    parentArtifact?: string; // 上一步产物
  };
  taskMarkers?: {
    parallel: boolean; // [P]
    userStory?: string; // [US1]
    needsClarification?: string[]; // [NEEDS CLARIFICATION] 列表
  };

  // OpenAWork 特有
  timeoutMs?: number;
  retryPolicy?: { maxRetries: number; backoffMs: number };
  successCriteria: string[]; // 验证派发完成的硬指标
}
```

**Watcher 机制**：

```
1. 上层 agent 调 createHandoff() → state='pending'
2. Watcher 轮询 pending → claim → state='claimed'
3. Watcher 创建目标 session（带 parent_session_id），role_layer 设置正确
4. Watcher 把 payload 注入新 session 的 first message
5. 目标 session 启动 → state='running'
6. 目标 session 完成 → 写 result_json → state='completed'
7. 上层 agent 拉取结果 → 决定下一步 handoff
```

**与 spec-kit handoffs frontmatter 的合体**：

spec-kit 在文档 frontmatter 里声明 `handoffs: [tasks, implement]`，是声明性的；hermes 的 handoff 是命令式状态机。OpenAWork 把两者合并：

- **声明层**：plan.md frontmatter 写 `handoffs: [tasks]` → 前端 UI 渲染"下一步"按钮
- **执行层**：用户点按钮 → 创建 handoff_record → Watcher 接管

**Cancel 指令支持**（v3 新增，对应同步/异步语义）：

由于 a-b 同步对话允许用户随时中止，handoff 协议必须支持**级联取消**：

```sql
-- 状态扩展
ALTER TABLE handoff_records ADD COLUMN cancel_requested INTEGER DEFAULT 0;
ALTER TABLE handoff_records ADD COLUMN cancel_reason TEXT;
-- state 增加新值：'cancelled'
```

**取消流程**：

```
1. 用户在 b 处说"算了不要了" → b 调 cancelTask(taskId)
2. b 找到该 task 对应的根 handoff_record
3. 递归遍历 session 树，对每个活跃子 session 的 handoff_record：
   - 若 state='pending' → 直接置为 'cancelled'
   - 若 state='claimed' / 'running' → 设置 cancel_requested=1，等目标 session 自己检查后退出
4. 各层 agent 在每次 LLM 调用前检查 cancel_requested 标志，若置位则：
   - 立即停止当前工作
   - 写入 result_json 标注 "cancelled by user"
   - 标记 handoff state='cancelled'
   - 清理任何已创建的临时资源
5. b 把"已取消"推送到 a，并从 BackgroundTask[] 中移除该任务
```

**取消时已完成产物的处理**（在 9.x 决策清单中需要拍板）：

- **保留**：spec/plan/tasks 等 markdown 仍留在 artifact 系统中（用户可参考）
- **不回滚**：e/f/g 已写入的代码 patch 不自动回滚（需要用户手动 git revert）
- **审计可见**：cancelled handoff 不删除，留作 audit log

**BackgroundTaskScheduler 接口（v3.4 新增，D40 = D3 拍板落地）**：

b 不直接调 `createHandoff`，而是通过 `BackgroundTaskScheduler` 抽象层间接派发。MVP 实现是 `InProcessScheduler`（直接转 createHandoff），但接口字段先扩展，未来替换为 Redis Streams / 独立 service / 持久化队列时无需破坏调用方。

```ts
// ============================================================
// BackgroundTaskScheduler 抽象接口
// ============================================================
interface BackgroundTaskScheduler {
  // 创建后台任务（b 接到复杂请求时调用）
  schedule(input: ScheduleInput): Promise<ScheduledTask>;

  // 查询任务状态（b 用来回答"那个任务怎么样了"）
  getStatus(taskId: string): Promise<BackgroundTaskStatus>;

  // 取消任务（D33 = b 有 cancel 权对应；级联取消子 session 树）
  cancel(taskId: string, reason: string): Promise<void>;

  // 列出某 session 下所有活跃后台任务（b 启动时恢复任务清单）
  listActive(receptionSessionId: string): Promise<BackgroundTask[]>;

  // 订阅进度变更（b 据此触发推送给 a；推送优先级见 9.5 D32）
  subscribe(taskId: string, listener: TaskProgressListener): Unsubscribe;

  // ============================================================
  // v3.6 新增：暂停/恢复（D42 拍板）
  // ============================================================

  // 暂停单个任务（用户在 task 详情抽屉中触发）
  // 行为：等当前 LLM 调用完成，下轮调用前检查 paused 标志后冻结
  // 不同于 cancel：不销毁中间产物、可恢复
  pause(taskId: string, reason?: string): Promise<void>;

  // 恢复单个任务
  // 行为：清除 paused 标志，下次 watcher 轮询时正常推进
  // 暂停 > 1h 时返回值含 staleWarning=true，UI 提示"上下文可能过期"
  resume(taskId: string): Promise<{ resumed: true; staleWarning?: boolean }>;

  // 一键暂停整个团队（用户在顶部状态栏触发）
  // 行为：暂停 receptionSessionId 下所有活跃后台任务
  // 注意：不暂停 a-b 同步对话（b 长驻前台原则）
  pauseAll(receptionSessionId: string, reason?: string): Promise<{ pausedCount: number }>;

  // 一键恢复整个团队
  resumeAll(receptionSessionId: string): Promise<{ resumedCount: number; staleCount: number }>;
}

// ============================================================
// 输入：创建后台任务
// ============================================================
interface ScheduleInput {
  // 必需字段
  receptionSessionId: string; // b 自己的 session id（任务归属）
  intent: string; // 简短描述："实现 GitHub OAuth 登录"
  payload: HandoffPayload; // 给 c 的派发包（见 5.6 HandoffPayload）

  // 可选字段（接口先扩展，MVP 可不实现，未来按需启用）
  priority?: 'high' | 'normal' | 'low'; // 调度优先级
  scheduledAt?: number; // 延迟执行时间戳（ms）；空则立即
  deadline?: number; // 超时硬截止时间戳（ms）
  retryPolicy?: RetryPolicy; // 失败重试策略（覆盖 handoff 默认）
  idempotencyKey?: string; // 幂等键（防止重复提交同需求）
  parentTaskId?: string; // 关联父任务（D31 合并到当前任务时使用）
  tags?: string[]; // 业务标签（如 'oauth' / 'urgent'）
  metadata?: Record<string, unknown>; // 透传元数据（不参与调度逻辑）
}

interface RetryPolicy {
  maxRetries: number; // 0 表示不重试
  backoffMs: number; // 初始退避
  backoffMultiplier?: number; // 指数退避系数（默认 1 = 固定）
  retryOn?: Array<'timeout' | 'failed' | 'cancelled'>; // 哪些状态触发重试
}

// ============================================================
// 输出：已调度任务
// ============================================================
interface ScheduledTask {
  taskId: string; // 任务唯一 id（b 后续用此跟踪）
  rootSessionId: string; // 由 scheduler 创建的 c 层 session id
  rootHandoffId: string; // b→c 的 handoff_record.id
  state: 'pending' | 'scheduled'; // pending=立即；scheduled=延迟
  createdAt: number;
  scheduledAt?: number; // 若有延迟，下次执行时间
  estimatedDurationMs?: number; // 估计耗时（基于 intent 类型经验值）
}

// ============================================================
// 状态查询返回值
// ============================================================
interface BackgroundTaskStatus extends BackgroundTask {
  // BackgroundTask（见 3C.6）的扩展查询视图
  currentSessionId: string; // 当前活跃子 session（最深处）
  currentLayer: 'reception' | 'pm1' | 'pm2' | 'execution';
  recentEvents: TaskEvent[]; // 最近 N 条事件流（用于 b 摘要）
  retriedCount: number; // 已重试次数（与 RetryPolicy 比对）
  escalationRound: number; // 已退回 c 次数（D29 兜底用）
}

interface TaskEvent {
  timestamp: number;
  type:
    | 'created'
    | 'claimed'
    | 'planning_started'
    | 'plan_ready'
    | 'dispatching'
    | 'execution_started'
    | 'review_started'
    | 'review_passed'
    | 'review_failed'
    | 'escalated_to_c'
    | 'escalated_to_user'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'retried';
  layer?: string;
  summary?: string; // 一行人话描述（用于 b 推送）
}

// ============================================================
// 进度订阅
// ============================================================
type TaskProgressListener = (event: TaskEvent) => void | Promise<void>;
type Unsubscribe = () => void;
```

**MVP 实现（v3.4）：`InProcessScheduler`**

```ts
class InProcessScheduler implements BackgroundTaskScheduler {
  // schedule = 直接转 createHandoff（等价 D1 行为，但走抽象层）
  // getStatus = 联合查询 sessions 树 + handoff_records + escalation_round
  // cancel = 调 5.6 cancel 协议级联取消
  // listActive = 按 receptionSessionId + handoff_state IS NOT NULL 查询
  // subscribe = 进程内 EventEmitter 订阅（gateway 单进程）
}
```

**升级路径预留**（不在 MVP 实现，但接口已支持）：

- 替换为 Redis Streams 队列：换 `RedisStreamsScheduler` 即可，b 调用方不变
- 加优先级 / 限流：MVP 忽略 `priority` / `scheduledAt`，未来按字段路由
- 加幂等：MVP 忽略 `idempotencyKey`，未来用 Redis SETNX 实现
- 加跨进程 subscribe：换为 Redis Pub/Sub 实现 listener 分发

**硬约束**（与 D24 同源）：

1. **scheduler 接口外不能直接调 `createHandoff(b→...)`** — 否则等于绕过 b 的任务清单，破坏 D24 "禁止跨层直连"
2. **scheduler 不持有业务逻辑** — 只是"创建+查询+取消+订阅"的薄壳，所有 handoff/session 树语义在 ⑤⑥ 件套里
3. **subscribe listener 必须幂等** — 同一事件可能被重放（重启恢复时）
4. **listActive 必须能从 DB 重建** — 不依赖内存状态，重启后 b 能恢复任务清单

### 5.7 ⑦ Project Memory（项目记忆）★ hermes-agent 借鉴 ★

**定位**：把"长期记忆"从 prompt 里飘忽的上下文升级为持久化的双存储工件，让 b/c/d 三层都能引用同一份历史共识。

**问题动机**：当前每次 session 都从零开始：

- 用户偏好（"我喜欢 Tailwind 不用 CSS-in-JS"）每次都要重说
- 项目惯例（"我们的测试都用 Vitest，不要 Jest"）每次都要解释
- 踩过的坑（"上次给 Postgres 用 ORM 出过问题"）只能靠用户记得

hermes-agent 用双存储 + frozen snapshot 的设计完美解决了这个问题。

**形态**：双存储字段（不引入新表）：

```sql
-- 用户画像（关于"用户是谁"）
ALTER TABLE users ADD COLUMN user_memory_md TEXT DEFAULT '';

-- 项目记忆（关于"团队/项目是什么"）
ALTER TABLE team_workspaces ADD COLUMN project_memory_md TEXT DEFAULT '';
```

**字段语义对照**：

| 字段                                | 存储内容                       | 字符上限 | 例子                                                                                       |
| ----------------------------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------ |
| `users.user_memory_md`              | 用户偏好、沟通风格、工作习惯   | 1375     | "偏好 Tailwind > CSS-in-JS；周末不接消息；commit 必带 scope"                               |
| `team_workspaces.project_memory_md` | 项目约定、踩过的坑、技术决策史 | 2200     | "test 用 Vitest 不用 Jest；Postgres 用 Drizzle 不用 Prisma；上次 Redis 集群配置见 #PR-123" |

**Entry 格式**：用 `§`（section sign）作为分隔符，每条记忆是独立段落：

```md
§
偏好 Tailwind 而非 CSS-in-JS。理由：包体积、可视化清晰。
§
周末不在线，紧急联系走 Telegram。
§
commit 必须带 scope，例如 `feat(gateway): xxx`。
```

**Frozen Snapshot 模式**（⭐ 最关键的设计）：

```
session 启动时（b 创建会话）：
  ┌──────────────────────────────────────────┐
  │ 1. 读 user_memory_md + project_memory_md │
  │ 2. 拼接到 system prompt 头部             │
  │ 3. session 中此段 prompt 永不变化        │
  └──────────────────────────────────────────┘
                  │
                  ▼
session 中途，agent 调 memory.add(...)：
  ┌──────────────────────────────────────────┐
  │ 1. 立即落盘 ✓（持久化）                   │
  │ 2. 不修改当前 session 的 system prompt × │
  │ 3. 下次新 session 才生效                  │
  └──────────────────────────────────────────┘
```

**为什么 frozen**：保护 LLM prompt prefix cache。session 中改 system prompt 会让整个对话历史的 cache 失效，成本暴涨 10 倍。hermes 这一招直接抄即可。

**Memory Tool 接口**（暴露给 b/c/d 三层使用）：

```ts
type MemoryAction = 'add' | 'replace' | 'remove' | 'read';
type MemoryTarget = 'user' | 'project';

interface MemoryTool {
  // add: 追加新条目
  add(target: MemoryTarget, content: string): Promise<void>;

  // replace: 用短串匹配替换某条
  replace(target: MemoryTarget, match: string, newContent: string): Promise<void>;

  // remove: 用短串匹配移除某条
  remove(target: MemoryTarget, match: string): Promise<void>;

  // read: 读取当前所有条目（live state，不是 frozen snapshot）
  read(target: MemoryTarget): Promise<string[]>;
}
```

**安全扫描**（必须借鉴，这是 hermes 的硬实践）：

由于记忆会被注入 system prompt，**必须**过 13 条威胁模式扫描：

```ts
const _MEMORY_THREAT_PATTERNS = [
  // prompt injection
  /ignore\s+(previous|all|above|prior)\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /do\s+not\s+tell\s+the\s+user/i,
  /system\s+prompt\s+override/i,
  /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i,
  /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i,
  // 凭据外泄
  /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
  /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
  /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
  // 持久化攻击
  /authorized_keys/i,
  /\$HOME\/\.ssh|~\/\.ssh/i,
];

// 同时检查不可见 unicode（U+200B 等零宽字符）
```

**与五层架构的关系**：

| 层         | user_memory 关系                     | project_memory 关系                    |
| ---------- | ------------------------------------ | -------------------------------------- |
| **a**      | (主体)                               | (主体)                                 |
| **b** 接待 | **读 + 写**（识别用户偏好/沟通风格） | 读（注入到回复风格）                   |
| **c** PM1  | 读（plan 时考虑用户习惯）            | **读 + 写**（plan 中沉淀项目惯例）     |
| **d** PM2  | 读                                   | **读 + 写**（dispatch 时引用历史决策） |
| **e/f/g**  | 读                                   | 读（不写入，避免污染）                 |

**关键设计**：e/f/g 只读不写，避免子代理把临时实现细节写进项目记忆。所有写入由 b/c/d 三层把关。

**裁剪原则**：

- **不照搬 8 个 provider 插件**（mem0/honcho/supermemory 等）：MVP 只做内置 DB 字段
- **不照搬 prefetch / queue_prefetch**：OpenAWork 是 SaaS，每次 session 启动直接读即可，不需要后台预取
- **不照搬 StreamingContextScrubber**：前端不直接 stream LLM raw output，不需要这一层
- **保留接口预留 provider**：未来想接外部记忆服务时，加 `MemoryProvider` 抽象即可

**生效模式：C2 默认静默 + C3 用户主动强制生效（v3.5 新增，D41 拍板落地）**

frozen snapshot 模式锁定后（D35），记忆写入有两种生效时机：

```
默认路径（C2 静默）：
  用户 / agent 写入 memory.add → 立即落盘 ✓ → 当前 session 不变 → 下次新 session 才生效

强制生效路径（C3 用户主动触发）：
  用户在 UI 点"立即生效"按钮 → 销毁当前 session 的 cache →
  当前 session 用最新 memory 重启（保留对话历史，但 system prompt 重新拼接） →
  当前 session 即时生效（成本：单次 +10x，破坏 prefix cache）
```

**为什么 C2 + C3 混合**（用户拍板理由）：

- **C2 是默认**：90% 场景下用户写偏好后不需要立即生效（"我喜欢 Tailwind"对当前调试登录功能的 session 无影响）
- **C3 是逃生通道**：10% 场景用户确实需要当场调整（如"我现在需要 c agent 用更简洁的回答"）——给用户**显式可控的开关**，不偷偷帮他决定

**C3 的页面强制生效操作要求**（用户原话："对于 C3 需要在页面强制生效操作"）：

```
UI 必须提供：
1. 「立即生效」按钮（明显位置，但不要默认醒目，避免误点）
2. 点击后弹出确认对话框：
   "这会重新加载当前对话的设置，可能略增加本轮响应成本。是否继续？"
   [取消] [确认立即生效]
3. 确认后执行：
   - 标记当前 session.cache_invalidated = true
   - 下一次 LLM 调用时，重新读 user_memory + project_memory + constitution + SOUL
   - 重新拼接 system prompt（破坏 prefix cache）
   - 在对话流中插入系统消息："✓ 偏好已即时生效"
4. 防滥用：单 session 24 小时内最多触发 5 次（防止用户高频破坏 cache）
```

**数据层连锁**：

```sql
-- sessions 表新增字段
ALTER TABLE sessions ADD COLUMN cache_invalidated INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN force_apply_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN force_apply_last_at INTEGER;
```

**前端组件清单**：

| 组件                   | 位置              | 职责                                        |
| ---------------------- | ----------------- | ------------------------------------------- |
| `<MemoryWriteBadge>`   | 对话流中插入      | C2 路径：写入后显示"✓ 已记住，下次会话生效" |
| `<ForceApplyButton>`   | 侧边栏 / 设置面板 | C3 路径：触发立即生效                       |
| `<ForceApplyDialog>`   | Modal             | C3 确认对话框（含成本提示）                 |
| `<MemoryAppliedBadge>` | 对话流中插入      | C3 完成后显示"✓ 偏好已即时生效"             |

**与 D35 frozen snapshot 决策的关系**：

D35 = "保护 prefix cache（默认 frozen）"是**正确且不变**的——C3 不是推翻 D35，而是**在 frozen 默认基础上提供用户可控的逃生口**。99% 时间 cache 仍被保护，只在用户显式触发时才破坏。这是"以默认行为优化常规路径，以显式开关支持例外路径"的标准模式。

### 5.8 七件套之间的关系

```
        ┌──────────────────────┐    ┌──────────────────────┐
        │ ① Constitution       │    │ ⑤ Session State M.   │
        │  （long-term truth）  │    │  （runtime backbone）│
        └──────────┬───────────┘    └──────────┬───────────┘
                   │                            │
                   │  被 plan/analyze 阶段读取  │ 所有层都基于
                   ▼                            ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │ ② Workflow Templates │◄───┤ ⑥ Handoff Protocol   │
        │  （process）          │    │  （cross-layer flow） │
        └──────────┬───────────┘    └──────────────────────┘
                   │ 每步产生
                   ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │ ③ Team Artifacts     │    │ ⑦ Project Memory     │
        │  （what was decided）│◄───┤  （long-term recall） │
        └──────────┬───────────┘    └──────────┬───────────┘
                   │ 驱动                       │ 注入到所有层
                   ▼                            ▼
        ┌──────────────────────────────────────────┐
        │ ④ Role Adapter Matrix                    │
        │  （who executes — LLM 调用统一出口）      │
        └──────────────────────────────────────────┘
```

**三条独立但互相耦合的链**：

- **方法论链**（spec-kit 主导）：① constitution → ② workflow → ③ artifacts → ④ role adapter
- **编排链**（hermes-agent 主导）：⑤ session state → ⑥ handoff → ④ role adapter
- **记忆链**（hermes-agent 主导）：⑦ project memory → frozen snapshot → 注入 ④ role adapter 的 prompt

三链在 ④ Role Adapter 处汇合：所有实际的 LLM 调用都通过 role adapter 出去——无论是 spec-kit 的"按 workflow step 调"，还是 hermes 的"按 handoff payload 调"，还是带着 frozen memory snapshot 的指令注入。

### 5.9 七件套到五层的落点矩阵

| 七件套 \ 五层    | a 用户 | b 接待                    | c PM1                       | d PM2                       | e/f/g 开发           |
| ---------------- | ------ | ------------------------- | --------------------------- | --------------------------- | -------------------- |
| ① Constitution   | —      | 间接（注入 prompt）       | 读                          | **读 + 强制 check**         | 读                   |
| ② Workflow       | —      | 路由用                    | **主用**                    | 读+派发                     | 读+执行 step         |
| ③ Artifacts      | —      | —                         | **产 spec/tasks**           | **产 dispatch/review**      | **产 patch/test**    |
| ④ Role Adapter   | —      | reception adapter         | planner adapter             | dispatch adapter            | exec/review adapter  |
| ⑤ Session State  | —      | 创建（root）              | 子 session                  | 子 session                  | 子 session           |
| ⑥ Handoff        | —      | b→c handoff + cancel 入口 | c→d handoff                 | **d→e/f/g 多路 handoff**    | 完成回写             |
| ⑦ Project Memory | (主体) | **读 user + 写 user**     | 读 user + **读/写 project** | 读 user + **读/写 project** | 只读 project（不写） |

**关键观察**：

- **d 仍是被使用最密集的一层**（5 个件套深度参与），桥接节点定位巩固
- **b 在 v3 多承担一项**：作为 ⑦ Project Memory 中 user_memory 的主要写入方（识别用户偏好/沟通风格）
- **c 在 v3 多承担一项**：作为 ⑦ Project Memory 中 project_memory 的主要写入方（沉淀团队约定）
- **e/f/g 严格只读 ⑦**：避免子代理把临时实现细节污染长期记忆

### 5.10 工具能力门控（D43，v3.7 新增）

**定位**：在 D16（toolset 门控）的基础上进一步细化——**架构层定能力类别（现在）+ 实施层定具体工具白名单（Phase B 落地时）**。

**为什么拆两层**：

- **能力类别是架构决策**，影响 D11+D12 五层定义、D24 跨层禁止直连——现在不定，Phase B 会反复返工
- **具体工具白名单是实施细节**，跟 `packages/agent-core/src/tools/` 真实工具集挂钩——等真实工具列表稳定后再定
- **类比**：spec-kit constitution 现在能定"测试覆盖率 ≥ 80%"原则，但不定具体跑哪个测试命令

**hybrid 策略**（C 方案）的两层关系：

```
┌─ 现在定（v3.7）─────────────────────────────────────┐
│  能力类别（capability tier）                          │
│  · required（必须有）                                 │
│  · allowed（可以有）                                  │
│  · forbidden（禁用）                                  │
└──────────────────┬───────────────────────────────────┘
                   │ 约束
                   ▼
┌─ Phase B 落地时定 ──────────────────────────────────┐
│  具体工具白名单（tool whitelist）                     │
│  · 具体工具名：hashEdit / grep / webSearch / ...     │
│  · 路径前缀限制：不能 **/node_modules/**             │
│  · API 颗粒度：是否暴露完整 API 还是只暴露 applyPatch│
└──────────────────────────────────────────────────────┘
```

#### 5.10.1 能力类别表（v3.7 锁定）

| 层         | 必须有（required）                                                                                                                          | 可以有（allowed）                                                                        | 禁用（forbidden）                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **a** 用户 | (n/a)                                                                                                                                       | (n/a)                                                                                    | (n/a)                                                                             |
| **b** 接待 | scheduler 操作（schedule/pause/resume/cancel/getStatus）<br>会话状态读取<br>用户记忆 R/W（D34）<br>推送工具                                 | 简单问答内置 LLM 调用<br>项目记忆只读                                                    | **写文件 / 跑测试**<br>**直接调下游**（必须经 `BackgroundTaskScheduler` 抽象）    |
| **c** PM1  | artifact 写入（spec/plan/tasks）<br>clarification 标记<br>constitution 读<br>项目记忆 R/W（D34）<br>c→d handoff                             | 研究类工具（web/librarian）<br>用户记忆只读                                              | **写代码 / 改文件**<br>**跨过 d 派 e/f/g**                                        |
| **d** PM2  | constitution 读 + Check 工具<br>dispatch_package 构造<br>d→e/f/g 多路 handoff<br>review 工具<br>escalation（退 c/升级用户）<br>项目记忆 R/W | 用户记忆只读                                                                             | **直接写代码**<br>**跨过 c 对 a 说话**                                            |
| **e** 开发 | 文件 R/W（hashEdit）<br>搜索（grep/glob）<br>LSP 诊断<br>artifact 读                                                                        | delegate 1 层 subagent（execution_depth=1，D18 上限=2）<br>测试运行<br>项目/用户记忆只读 | **写项目记忆**（D34，可通过 `result_json` 提议但 d 决策）<br>**跨过 d 对 c 说话** |
| **f** 测试 | 测试运行（vitest/playwright）<br>覆盖率工具<br>文件读取<br>**写 `tests/` / `fixtures/` / `mocks/` 目录**                                    | LSP 诊断                                                                                 | **写 `src/` 源码目录**（避免污染源码）<br>**写项目记忆**                          |
| **g** 评审 | 文件读取<br>constitution 读<br>静态分析（lint）<br>**`review_notes` 提交工具**（附加到 d 的 `result_json`）                                 | LSP 诊断                                                                                 | **修改代码**（review 应只读）<br>**写项目记忆**                                   |

#### 5.10.2 关键边界设计（4 项默认值）

> 以下 4 项为 v3.7 拍板时的默认值，**可在 Phase B 实施时根据真实场景调整**：

1. **f 测试层目录边界**：禁止写 `src/` 源码，但允许写 `tests/` / `fixtures/` / `mocks/` —— 修复测试时可能需要顺便改 fixture，过严会阻塞合理工作
2. **e 开发层提议项目记忆**：不允许直接写项目记忆，但允许通过 `result_json` 中的 `proposedMemoryEntries: string[]` **提议**写入，由 d review 时决定是否实际写入。这平衡了"避免污染"和"e 发现的有价值惯例不丢失"
3. **b 接待层下游访问**：精确化为"只能通过 `BackgroundTaskScheduler` 抽象间接触发下游"——D40 已锁定的 scheduler 是 b 的**唯一**下游入口，与 D24 同源约束
4. **g 评审层提交建议**：加 `review_notes` 工具，让 g 把建议附加到 d 的 `result_json`，不直接改代码——保持"评审只读"原则的同时让 g 的发现能影响后续决策

#### 5.10.3 与 D16 的关系

| 决策             | 范围                             | 状态                   |
| ---------------- | -------------------------------- | ---------------------- |
| **D16**          | "是否引入 toolset 门控"          | ✅ 已拍板 v3 推荐      |
| **D43**          | "门控的能力类别如何划分"         | ✅ 已拍板 v3.7（本节） |
| **Phase B 衍生** | "每个能力类别下的具体工具白名单" | 待 Phase B 落地时定    |

D16 决定了"要做"，D43 决定了"做成什么样"，Phase B 决定了"具体怎么做"。三者层层细化，不重复也不冲突。

#### 5.10.4 实施约束

- **类型层强制**：每个角色 SOUL（D17）的 frontmatter 应声明该角色的能力类别，由 `TeamRoleAdapter`（D6）在 LLM 调用前注入对应 toolset
- **拒绝时记录**：被禁用工具的调用尝试应记录到 audit log（不是静默失败），便于后期发现"约束过严"或"约束被绕过"
- **演化机制**：Phase B 实施后若发现某层的"forbidden"实际需要放开，必须通过修改 D43（而不是绕过）——保持架构一致性

---

### 5.11 提示词风格基调（D44，v3.8 新增）

**定位**：在 D17（角色级 SOUL）和 D34（注入栈）已锁定的基础上，进一步细化每层的"风格基调"。这是**架构层风格规范**，不是 SOUL 字面内容（具体措辞 Phase A 实施时定）。

**为什么单独成节**：D17 只规定"每层有 SOUL"，但没规定 SOUL 的"调性"——b 写得像 d 那样严肃 / d 写得像 b 那样松散都符合 D17，但破坏架构语义。D44 锁定每层基调风格，确保 5 层（b/c/d/e/f/g）相互区分。

#### 5.11.1 各层 4 维度基调表

| 层         | 维度 1（人格定位）                                                                                                 | 维度 2（风格特性）                                                                                         | 维度 3（处理粒度）                                                                                                     | 维度 4（协作模式）                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **b** 接待 | **B/C 切换**：个人助理（B）⇄ 项目协调员（C），按 user_memory 自动选 + 前端"接待风格"开关可覆盖                     | **D 用户可选透明度**：默认半透明，提供"展开详情"按钮看完整 session 树                                      | **E 翻译式单点澄清**：c 触发 [NEEDS CLARIFICATION] 时 b 用对话感重写 + 一次问一个                                      | **C 智能猜+兜底**：用户问"刚才那个怎么样了"时 b 智能猜（最近活跃 task） + 加一句"是说 X 那个吗？"确认               |
| **c** PM1  | **B 工程实用**：结构化但聚焦关键决策，不堆冗余（避免学术严谨 A / 极简 C / 叙事 D）                                 | **B 严格但克制标记**：高影响模糊点标 [NEEDS CLARIFICATION]（最多 3 个），低影响推断 + 注明假设             | **B 中等粒度**：每 task 30-60 分钟（与 D18 配合，每个 task ≈ 一次 e/f/g delegate）                                     | **D 按需调研**：简单任务被动消费 envelope；复杂任务主动调 librarian/explore subagent（execution_depth=1）           |
| **d** PM2  | **B 工程主管式**：严格但带简要理由（不像 A 法官冰冷，不像 C 协调员协商感过重）                                     | **C 字面+意图补充**：constitution 字面违反必退；意图违反附 warning 但放行（与 D29 B2 结构化反馈兼容）      | **D 启发式兜底**：失败分流默认按预设规则（实现型 vs 规划型），不明确时默认"实现型重派"（兜在 D29 B1 escalation_round） | **D 自适应详尽度**：dispatch_package 内容按 task 复杂度动态选（简单 50 字 / 标准 200 字 / 详尽 500 字）             |
| **e** 开发 | **架构跟随**（受 D45）：严格匹配 architecture.md 规范；发现规范不一致或缺漏时通过 `proposedMemoryEntries` 提议给 d | **B 限次自治**：测试失败时自己重试最多 3 次，仍失败写 result_json 报 d（与 D29 escalation_round 思路同构） | **B 偶尔委派**：仅在明显需要研究时委派 subagent（如调 librarian 查 API 文档）                                          | **A 强制 TDD**：先写测试再写实现，与 spec-kit 测试优先方法论一致                                                    |
| **f** 测试 | **D 智能补位**：先看 e 的覆盖率再补缺口（避免与 e 单元测试重复，专注集成 + E2E + 边界）                            | **B 复现+报告**：失败时尽力复现根本原因再报，给 d 决策完整信息（与 D29 B2 同构）                           | **D 自适应覆盖**：关键模块严格（如 auth/payment 接近 100%）；工具脚本宽松（关键路径即可）                              | **A 严格分工**：测试问题自修，发现实现 bug 写 result_json 报 d（不越权使用 g 的 review_notes）                      |
| **g** 评审 | **C 架构守门**：重点架构对齐（D45）+ constitution 合规；代码质量 e 自查 + f 已测，g 不重复审                       | **B 教练式**：找问题 + 给方案（建设性反馈），避免 A 法官冰冷 / C 严苛批判压抑                              | **D 按严重度分级**：严重→打回；中等→建议修；轻微→记录（与 D29 B3 失败分流同构）                                        | **C 看+引用**：可读 e/f result_json 综合判断，可引用 e/f 的某些决策做评审依据（与 D24 不冲突，因 g 不主动联系 e/f） |

#### 5.11.2 跨层共性约束

以下 5 项约束适用于所有 5 层（b/c/d/e/f/g）：

1. **提示词长度上限**：
   - SOUL.md ≤ 2000 字符
   - constitution.md ≤ 5000 字符
   - architecture.md ≤ 5000 字符（D45 借用）
   - project_memory_md ≤ 200 字符（D36）
   - user_memory_md ≤ 1375 字符（D36）

2. **占位符约定**：统一 `{{ var_name }}`（双花括号 + snake_case），与 spec-kit / hermes 通用习惯对齐

3. **语言**：system prompt 中文优先（与 AGENTS.md 强制中文交互一致），但保留 `[NEEDS CLARIFICATION]` / `[P]` / `[US1]` 等英文标记不变

4. **few-shot 策略**：SOUL 不带示例（保持紧凑）；具体角色提示词模板（c 的 spec、d 的 review、g 的 review_notes）允许带 1-2 个 few-shot

5. **结构化输出强制**：c/d/e/f/g 必须返回结构化产物（Markdown 或 JSON），b 可返回纯对话——这与 D40 result_json 结构互补

#### 5.11.3 与已锁定决策的关系

| 决策                | 关系                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| **D17 角色级 SOUL** | D44 是 D17 的细化——D17 决定"有 SOUL"，D44 决定"SOUL 写什么调性"              |
| **D34 注入栈**      | D44 不动注入顺序（仍是 AGENTS → constitution → memory → SOUL）               |
| **D29 失败恢复**    | d 维度 3"启发式兜底" + e 维度 2"限次自治"都依赖 D29 的 escalation_round 字段 |
| **D45 架构规范**    | e 维度 1"架构跟随"直接消费 D45 的 architecture.md                            |
| **D43 工具门控**    | f 维度 4"严格分工不越界" + g 维度 4"看+引用"都遵循 D43 的角色边界            |

#### 5.11.4 实施约束

- **每个 SOUL 必须包含 5 维度声明**：在 frontmatter 中明确该角色的人格定位 / 风格 / 粒度 / 协作模式 / 主动建议模式（b 层专属第 5 维度）
- **风格偏离监控**：Phase B 实施后若发现某层 LLM 输出偏离 D44 拍板风格，必须修改 SOUL 字面内容向 D44 对齐——而不是修改 D44
- **跨层一致性**：相邻层的风格不应过度相似（如 b 和 c 都用"严格"会失去层间差异性）

#### 5.11.5 b 层第 5 维度：主动建议（v3.8.1 新增）

**定位**：b 不只是被动应答，而是每次回复都附带"你可能还想做的事"——让用户知道还有哪些内容没想到可以直接使用。

**拍板结论**：**D 方案（A+C 融合）+ Z 展示形式**

**D 方案行为**：

- 默认每次回复末尾附 2-3 个建议（A 行为）
- 根据用户反馈频率自适应减少（C 行为）
- 用户连续忽略建议 3 次 → 自动降频到关键节点才带

**Z 展示形式**：文字描述 + 可点击按钮并存

```
✓ 已开始处理 OAuth 登录。你还可以：
  [① 同时让我写 README]  [② 查看当前 plan 草稿]  [③ 设置登录后跳转页]
```

**建议来源**（5 种推断渠道）：

| 来源            | 例子                                                          |
| --------------- | ------------------------------------------------------------- |
| 当前对话上下文  | 用户刚问了 OAuth → 建议"要不要加 refresh token"               |
| 项目状态        | 检测到没有 README → 建议"要不要生成 README"                   |
| 后台任务进展    | plan 刚完成 → 建议"要不要看 plan 草稿"                        |
| architecture.md | 检测到缺少某类规范 → 建议"要不要补充安全规范"                 |
| 历史模式        | 上次类似项目做完 OAuth 后都加了 RBAC → 建议"要不要加权限管理" |

**自适应降频规则**：

```
初始状态：每次回复都带建议（A 模式）
    │
    ├─ 用户点击建议按钮 → 维持当前频率
    ├─ 用户忽略建议（不点也不提）→ 计数器 +1
    │   └─ 连续忽略 ≥ 3 次 → 降频到"关键节点才带"（B 模式）
    │       关键节点 = 任务完成 / 阶段切换 / 后台任务状态变更
    │
    └─ 用户主动说"不要建议了" → 完全关闭（写入 user_memory）
       用户说"恢复建议" → 重新开启
```

**前端组件**：

| 组件                 | 职责                                     |
| -------------------- | ---------------------------------------- |
| `<SuggestionBar>`    | 对话流末尾渲染 2-3 个建议（文字 + 按钮） |
| `<SuggestionButton>` | 单个可点击建议按钮，点击即触发对应操作   |

**与 D41 user_memory 的关系**：用户的"建议偏好"（开启/关闭/降频状态）写入 `user_memory_md`，下次 session 启动时 b 读取并恢复。

---

### 5.12 架构规范 architecture.md（D45，v3.8 新增）

**定位**：仓库级独立文档，与 AGENTS.md 平行存在。专门承载"开发架构规范"，避免每个 e/f/g agent 各自写不一致的代码。

**为什么单独成节**：

- AGENTS.md 偏"工程纪律"（目录、命名、反模式）—— 不专注架构
- constitution.md 偏"业务约束"（覆盖率、性能、安全）—— 不专注架构
- 现有 plan.md 是"单次任务级"产物 —— 不适合"项目级架构规则"

D45 引入 `architecture.md` 填补这个真空，让 e/f/g 在写代码前明确知道"应该匹配什么模式"。

#### 5.12.1 文件位置与注入

```
仓库根/
├── AGENTS.md           （v1 已存在，工程纪律）
├── architecture.md     ★ D45 新增 ★（开发架构规范）
└── ...
```

**注入栈位置**（D34 顺序更新）：

```
1. AGENTS.md            (仓库级，工程纪律)
2. architecture.md      (仓库级，架构规范) ★ D45 插入此位 ★
3. constitution.md      (团队级，业务约束)
4. project_memory_md    (团队级，历史决策，frozen)
5. user_memory_md       (用户级，用户偏好，frozen)
6. SOUL.md              (角色级，人格 + 4 维度风格基调)
```

#### 5.12.2 内容结构（10 类全选）

architecture.md 必须包含以下 10 类内容：

| #   | 类别         | 内容示例                                                                                                   |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | **技术选型** | 必须用 `axios`（HTTP）/ 禁止用 `request`（已弃用）/ 状态管理统一 Zustand                                   |
| 2   | **设计模式** | 必须用依赖注入 / 禁止全局单例 / 错误处理用 Result type 不抛异常                                            |
| 3   | **命名规范** | 类 PascalCase / 函数 camelCase / 常量 UPPER_SNAKE_CASE / 文件 kebab-case                                   |
| 4   | **目录约定** | `apps/web/src/pages/` 放页面 / `packages/shared/` 放跨端类型 / `services/agent-gateway/src/routes/` 放路由 |
| 5   | **模块边界** | `apps/web` 不能依赖 `services/agent-gateway` / `packages/shared` 不能依赖任何业务包                        |
| 6   | **错误处理** | 自定义 `ApiError` 基类 / 禁止空 catch / Zod 在边界层校验                                                   |
| 7   | **测试要求** | 覆盖率 ≥ 80% / TDD 优先（与 D44 e 维度 4 协同）/ mock 用 MSW 不用 jest.mock                                |
| 8   | **性能规范** | p95 < 200ms / 单文件 ≤ 1500 行（与 AGENTS.md 协同）/ bundle size ≤ 500KB                                   |
| 9   | **安全规范** | 凭据走环境变量 / XSS 用 DOMPurify / CSRF 用 SameSite cookie                                                |
| 10  | **工程纪律** | commit 中文 + 中文 scope（与 AGENTS.md 协同）/ 禁止 `--no-verify` / PR 必须 lint 通过                      |

#### 5.12.3 三个 Check 点

architecture.md 不只是文档，配套 3 个强制 check 点：

```
┌─ Check 点 1：e SOUL 强制读 ──────────────────┐
│  e 的 SOUL.md frontmatter 必须声明：             │
│   "writingCode": { "mustReadArchitecture": true } │
│  TeamRoleAdapter（D6）在注入 prompt 前 verify    │
│  失败时拒绝调 LLM                                  │
│  严格度：硬阻断                                    │
└──────────────────────────────────────────────────┘

┌─ Check 点 2：d architecture review ────────────┐
│  与 Constitution Check（D9）并列在 d 层           │
│  d 在派发前 + review 时双重 check：               │
│   ① 派发前：plan 是否违反 architecture.md         │
│   ② review 时：实际代码是否对齐 architecture.md  │
│  失败时按 D29 B3 失败分流：                        │
│   - 字面违反 → 退回 c 重规划（escalation_round++）│
│   - 意图违反 → 附 warning 放行（D44 d 维度 2）   │
│  严格度：硬阻断（字面）+ 软警告（意图）           │
└──────────────────────────────────────────────────┘

┌─ Check 点 3：CI lint ──────────────────────────┐
│  ESLint 自定义规则反映 architecture.md           │
│  示例：                                          │
│   - no-restricted-imports（实施模块边界）        │
│   - 自定义 plugin 校验命名规范                    │
│   - 自定义 plugin 校验目录约定                    │
│  PR 阻塞：lint 失败 PR 不能合并                  │
│  严格度：硬阻断（自动化）                         │
└──────────────────────────────────────────────────┘
```

#### 5.12.4 数据层

D45 不引入新表（仓库级文档由 git 管理）：

```
仓库根/architecture.md           ← git 版本控制
└── 内容由项目维护者编辑
└── 注入栈第 2 位（所有 team session 共享）
```

**与 D34 双存储记忆的差异**：

| 维度     | architecture.md（D45）   | project_memory_md（D34）    |
| -------- | ------------------------ | --------------------------- |
| 范围     | 仓库级（所有 team 共享） | 团队级（单 team 独有）      |
| 性质     | 开发规范（应该怎么做）   | 历史决策（曾经怎么做）      |
| 维护者   | 项目维护者（codeowner）  | team 内 b/c/d 自动写入      |
| 修改频率 | 低（架构演进时改）       | 中（每个 session 都可能写） |
| 字符上限 | ≤ 5000 字符              | ≤ 200 字符                  |

#### 5.12.5 与 D43 工具门控的关系

D43（工具能力门控）和 D45（架构规范）互补不重叠：

| 决策    | 范围                     | 例                                                      |
| ------- | ------------------------ | ------------------------------------------------------- |
| **D43** | "能做什么"（工具层面）   | e 不能写项目记忆（forbidden）/ f 可以跑测试（required） |
| **D45** | "应该怎么做"（规范层面） | 如果 e 写代码，必须用 axios 不用 request                |

例如：D43 允许 e 写代码（required: 文件 R/W），但 D45 规定写代码时必须遵循 architecture.md 第 1 条"用 axios"。

#### 5.12.6 实施约束

- **必须存在**：仓库根没有 architecture.md 时，CI 应警告（不阻断，但提示）
- **必须可解析**：architecture.md 应使用清晰的 Markdown 章节结构（10 类各占一节），便于 ESLint plugin 解析
- **演化机制**：发现 architecture.md 与实际开发冲突时，必须修改 architecture.md（PR + review）—— 不能在代码中悄悄绕过
- **跨 team 共享**：因为 architecture.md 在仓库级，所有 team 看到的内容相同 —— 这是有意为之，避免每 team 各自定义破坏一致性

#### 5.12.7 初始化流程（v3.8.1 新增）

architecture.md 不是"等到写代码才需要"——它应该在**项目初始化阶段**就被创建。两种场景的触发时机：

**场景 A：新项目**

```
用户创建新项目 / 第一次提开发需求
    │
    ▼
b 检测到无 architecture.md
    │
    ▼
b 主动提问（D44 b 维度 5 主动建议）：
  "项目还没有架构规范。你想：
   ① 告诉我技术栈和规范偏好（我帮你生成）
   ② 让我根据你的项目目标自动推荐
   ③ 先跳过"
    │
    ├─ 分支 A：用户指定技术栈 ──────────────────────────┐
    │    用户："用 React + Tailwind + Zustand，            │
    │          后端 Fastify + Drizzle + SQLite"            │
    │    ▼                                                 │
    │    c 根据用户指定 → 生成 architecture.md 初稿        │
    │    （10 类全填，基于用户选型推导命名/目录/模式）     │
    │    ▼                                                 │
    │    b 推送初稿给用户确认                               │
    │                                                      │
    ├─ 分支 B：用户不指定，系统动态推断（可选）────────────┤
    │    用户："我想做一个 AI 聊天应用"                    │
    │    ▼                                                 │
    │    c 分析项目意图 → 推断合适的技术栈 + 规范：        │
    │      · 项目类型 → 推荐框架（"AI 聊天" → React + SSE）│
    │      · 推断设计模式（状态机 + 流式处理）             │
    │      · 推断目录约定（pages/chat + components/）      │
    │      · 推断测试策略（E2E 优先）                      │
    │    ▼                                                 │
    │    c 生成 architecture.md 初稿                        │
    │    （标注 ⚠️ "推断" vs ✅ "通用最佳实践"）           │
    │    ▼                                                 │
    │    b 推送给用户：                                     │
    │      "根据你的项目目标，推荐以下架构：               │
    │       [展示初稿，⚠️ 标注需确认的推断项]              │
    │       你可以逐条确认或修改。"                        │
    │                                                      │
    └─ 分支 C：跳过 ──────────────────────────────────────┘
         后续 d 的 architecture review 降级为"无规范"模式
         b 每次新 session 温和提醒一次（可关闭）
```

**场景 B：已有项目**

```
用户对已有项目启用 team 功能
    │
    ▼
b 检测到仓库已有代码但无 architecture.md
    │
    ▼
b 提问："检测到项目已有代码但没有架构规范文档。
        要不要我分析现有代码，帮你生成初版？"
    │
    ├─ 用户同意 → 触发"架构逆向工程"流程：
    │    c 调 explore subagent 扫描现有代码：
    │      · package.json → 提取技术选型
    │      · src/ 结构 → 推断目录约定
    │      · import 图 → 推断模块边界
    │      · 命名统计 → 推断命名规范
    │      · lint 配置 → 提取工程纪律
    │      · test 文件 → 提取测试策略
    │    ▼
    │    c 生成 architecture.md 初稿
    │    （标注"推断"vs"确认"）
    │    ▼
    │    b 推送给用户逐条确认/修改 → 落盘
    │
    └─ 用户拒绝 → 跳过（同分支 C）
```

**分支 B 动态推断的置信度标注**：

```markdown
## 1. 技术选型

✅ React 18+（通用最佳实践，置信度高）
✅ TypeScript strict（通用最佳实践）
⚠️ Zustand 状态管理（推断：聊天应用需要轻量全局状态，需确认）
⚠️ Fastify 后端（推断：AI 应用流式支持好，需确认）
❓ 数据库选型未确定（需要你告诉我：SQLite / Postgres / 其他？）
```

**关键约束**：

- **分支 B 是可选的**——用户可以选③跳过，不强制推断
- **推断不等于决策**——所有 ⚠️ 标注项必须用户确认后才写入正式 architecture.md
- **跳过后不阻断开发**——d 的 architecture review 降级为"无规范可对齐"模式（只做 Constitution Check）
- **温和提醒不骚扰**——b 每次新 session 提醒一次"建议补充架构规范"，用户可关闭（写入 user_memory）

**修改权限**：

| 操作           | 谁能做                       | 触发方式                      |
| -------------- | ---------------------------- | ----------------------------- |
| 首次创建       | 用户主导（b 辅助）           | 新项目初始化 / 老项目逆向工程 |
| 日常修改       | 项目维护者                   | PR + review                   |
| e/f/g 提议修改 | 通过 `proposedMemoryEntries` | e 发现规范与实际不一致时提议  |
| d 强制修改     | ❌ 不能                      | d 只能 check，不能改规范      |

---

## 6. 落地路径（分阶段）

不一次性引入全部七件套，按"价值密度 / 实现成本"和"五层架构成型顺序"排序分五阶段。每个阶段都能独立交付价值，**任何阶段验证不通过都可以停在当前阶段**——这本身就是 SDD 的精神：先验证，再扩张。

### 6.1 Phase A — 团队宪法 + 角色 SOUL（1-2 周）

**目标**：让 team 拥有"长期约束的明文锚点"，并让 b/c/d/e-g 五层各自有人格指令。建立**指令分层栈**。

**思想源**：spec-kit constitution + hermes-agent 三层 prompt 分层

**产出**：

- `team_workspaces.constitution_md TEXT` 字段（migration）
- `/team` 页面新增"团队宪法"侧边 tab
- `services/agent-gateway/src/routes/team.ts` 新增 `GET/PUT /team/workspaces/:id/constitution`
- 内置 3-5 个 constitution 模板
- 新增 `agent_personas` 表（key / role_layer / soul_md），承载 b/c/d/e-g 各层人格
- 内置 5 个 SOUL：reception / pm1 / pm2 / executor / reviewer
- 把"仓库 AGENTS + 团队 constitution + 角色 SOUL"三层指令注入所有 team session 的 system prompt

**不做**：

- 不引入 session state machine / handoff / workflow / artifact 链
- 不做 constitution 版本历史（用 git 追踪 markdown 文件足够）
- 不做修宪审批流（团队所有人可改）

**衡量价值**：

- team session 的输出质量是否更稳定
- 用户是否真的会编辑 constitution（不编辑说明这层抽象用不上）
- 五层人格是否让 agent 行为差异化更明显

### 6.2 Phase B — Session 状态机 + Handoff 协议（2-3 周）★ 五层骨架成型 ★

**目标**：把 session 升级为"工作对象"，建立 b/c/d/e-g 五层之间的结构化派发管道。**这是双思想第一次合体的 Phase**。

**思想源**：hermes-agent session + handoff 协议（主导）+ spec-kit handoffs frontmatter（辅助）

**产出**：

- `sessions` 表扩展 `parent_session_id` / `handoff_state` / `role_layer` / `intent_state` 字段
- 新增 `handoff_records` 表 + Watcher 守护进程
- `services/agent-gateway/src/handoff/` 模块：createHandoff / claimHandoff / completeHandoff
- 五层 session 创建 API：`/sessions?role_layer=reception` 等
- 前端"session 树"可视化：基于 `parent_session_id` 渲染时间线
- 把现有 `interaction-agent rewrite` 重构为 b→c handoff
- 把现有 `team-leader dispatch` 重构为 d→e/f/g 多路 handoff

**不做**：

- 不做完整 workflow 模板（c/d 暂时硬编码 prompt）
- 不引入 dispatch_package 标准结构（先用裸文本试跑）
- 不做跨平台 handoff（只支持同租户内的层间 handoff）

**衡量价值**：

- 五层 session 树是否能正确生成
- handoff 失败率（目标 < 5%）
- 用户是否能从前端"完整看到"一个请求被五层处理的全貌
- 现有功能（createThread / dispatch）是否被无缝替换

### 6.3 Phase C — c 层产物链：spec / plan / tasks（2-3 周）

**目标**：让 c（PM1）输出标准化的可审阅产物链，引入 spec-kit 的核心方法论。

**思想源**：spec-kit specify/clarify/plan/tasks（主导）+ hermes-agent writing-plans（辅助）

**产出**：

- `team_artifacts` 概念（复用现有 `artifacts/` 包，扩展 `phase` + `teamWorkspaceId` + `parentArtifactId` 字段）
- c 层三步向导：Spec 草稿 → Clarifications → Plan 生成 → Tasks 拆解
- 在 plan 阶段强制读取 constitution 做 Constitution Check
- `[NEEDS CLARIFICATION]` / `[P]` / `[US1]` 标记的前端高亮 + 阻塞门禁
- spec/plan/tasks 的 Markdown 模板（来自 spec-kit `templates/` 直接借鉴）
- c 输出的 plan/tasks 自动作为 b→c 完成的 handoff result

**不做**：

- 不做完整七步（analyze / implement 留给 d 层）
- 不引入四层模板栈
- 不做跨 team workflow 模板共享

**衡量价值**：

- 用户在多少比例的 session 里走多步精炼（< 30% 说明流程过重）
- 多步精炼 session 的最终交付质量是否高于直跑 session
- `[NEEDS CLARIFICATION]` 标记是否真的有人填写

### 6.4 Phase D — d 层结构化派发 + 双重 review（3-4 周）★ 双思想桥接成型 ★

**目标**：让 d（PM2）成为完整的"双思想桥接节点"——上承 c 的产物链，下启 e/f/g 的并行执行。

**思想源**：hermes-agent delegate_task + 双重 review（主导）+ spec-kit Constitution Check + analyze（辅助）

**产出**：

- `dispatch_package` 标准结构（goal/context/toolsets/role + artifactRefs + taskMarkers）
- d 层逻辑：解析 c 的 tasks.md → 拆 dispatch_packages → 多路并行 handoff 给 e/f/g
- Constitution Check 强制门禁：派发前必须确认 plan 不违反 constitution
- 收集 e/f/g 回写结果 → 自动触发 spec review（对齐 spec）+ quality review（对齐 constitution）
- review_report.md 作为 d 完成的 handoff result
- 引入 D18 A2 双深度限制：结构深度固定 4（schema 强制）、执行深度上限 2（subagent 防递归）
- toolset 门控：每层声明可见 toolset

**不做**：

- 不做 kanban 长任务板（hermes 的第三粒度任务流暂不引入）
- 不做完整 spec-kit `analyze` 命令（用 review 替代）
- 不做跨 team workflow 复用

**衡量价值**：

- d 派发的 dispatch_package 失败率（目标 < 10%）
- 双重 review 触发的修复迭代次数（< 2 次为健康）
- Constitution Check 命中冲突的频率
- e/f/g 并行执行的吞吐效率提升

### 6.5 Phase E — Workflow 模板栈 + Role Adapter 矩阵（4-6 周）

**目标**：把 Phase A-D 的"硬编码五层流程"抽象成可定制的模板栈与适配矩阵。

**思想源**：spec-kit 四层模板栈 + IntegrationBase 适配矩阵

**产出**：

- `workflow_templates.metadata_json.teamWorkflow` 完整 schema（见 5.2）
- 模板分发机制（先做 overrides + core 两层，presets/extensions 延后）
- `TeamRoleAdapter` 接口 + 5 个内置 adapter（reception/pm1/pm2/executor/reviewer）
- 模板编辑器（让团队 leader 自定义 step / promptTemplate / handoffs）
- 内置 5 个 workflow 包：
  - quick-ask（只走 a→b，跳过 c/d/e-g）
  - research-team（a→b→c→e/f/g，跳过 d，PM1 直派）
  - build-team（完整五层 a→b→c→d→e/f/g）
  - review-team（聚焦 d→reviewer 闭环）
  - spike-team（c→d→e 单线，无 review）

**不做**：

- 不照搬 spec-kit 的 30+ 客户端目录分发
- 不引入 presets / extensions 两层（等社区生态成熟再加）
- 不做完整 marketplace（先支持私有团队复用即可）
- 不引入 hermes 的 cron / curator / kanban 长任务

**衡量价值**：

- 自定义 workflow 模板的团队比例
- 跨 team 复用 workflow 的次数
- 不同 role adapter 切换 provider 的成功率

### 6.6 阶段依赖图

```
Phase A (constitution + SOUL)              ← 双源指令分层
   │
   ▼
Phase B (session state machine + handoff)  ← 五层骨架（hermes 主导）
   │
   ▼
Phase C (c 层产物链 spec/plan/tasks)        ← spec-kit 主导
   │
   ▼
Phase D (d 层 dispatch + 双重 review) ★    ← 双思想桥接成型
   │
   ▼
Phase E (workflow 模板栈 + role adapter)    ← 可定制化
```

每阶段后都设一个 retrospective 节点，确认是否继续推进。**Phase B 是结构最重要的一阶段**（五层骨架），**Phase D 是双思想合体最关键的一阶段**（spec-kit × hermes 在 d 层融合）。

### 6.7 阶段-件套-五层覆盖矩阵

| 阶段 \ 件套 | ① Constitution | ② Workflow | ③ Artifacts | ④ Role Adapter | ⑤ Session | ⑥ Handoff |
| ----------- | -------------- | ---------- | ----------- | -------------- | --------- | --------- |
| Phase A     | ✅ MVP         | —          | —           | —              | —         | —         |
| Phase B     | (用)           | —          | —           | —              | ✅ MVP    | ✅ MVP    |
| Phase C     | (用)           | (硬编码)   | ✅ MVP      | —              | (用)      | (用)      |
| Phase D     | ✅ check gate  | (硬编码)   | ✅ extend   | —              | (用)      | ✅ extend |
| Phase E     | (用)           | ✅ MVP     | (用)        | ✅ MVP         | (用)      | (用)      |

| 阶段 \ 五层 | a 用户 | b 接待  | c PM1   | d PM2   | e/f/g 开发 |
| ----------- | ------ | ------- | ------- | ------- | ---------- |
| Phase A     | —      | ✅ SOUL | ✅ SOUL | ✅ SOUL | ✅ SOUL    |
| Phase B     | (现状) | ✅ 新增 | ✅ 新增 | ✅ 重构 | ✅ 重构    |
| Phase C     | (现状) | (用)    | ✅ 强化 | (用)    | (用)       |
| Phase D     | (现状) | (用)    | (用)    | ✅ 强化 | (用)       |
| Phase E     | (现状) | (用)    | (用)    | (用)    | ✅ 强化    |

---

## 7. 风险与权衡

### 7.1 流程过重的风险

**风险**：spec-kit 是给开发者写代码用的，七步流程对软件工程是合理的；但 OpenAWork 的 team 场景可能更碎片化（一次性问答、轻量任务、临时协作），强制走多步精炼会过度笨重。

**缓解**：

- 多步精炼始终是**可选**，不是强制
- 默认 session 创建仍走单步直跑路径
- 用 UI 引导而非阻断：在创建 session 时给"快速模式 / 精炼模式"二选一
- Phase B 里观察实际使用率，低于 30% 直接砍掉

### 7.2 双 truth 风险

**风险**：constitution.md 写在数据库 vs 写在 git 仓库，二者可能漂移。

**缓解**：

- MVP 阶段只存数据库（`team_workspaces.constitution_md`），不与 git 同步
- 提供"导出为 .md 文件"功能，让用户自己决定是否纳入版本控制
- 如未来需要双向同步，再引入 git-backed storage（参考 spec-kit 的 `.specify/memory/`）

### 7.3 模板僵化风险

**风险**：把 workflow 写成模板后，团队会被模板锚定，失去临时调整能力。

**缓解**：

- 任何模板生成的 step 都允许跳过或覆写
- 不做"必须完成上一步才能下一步"的硬阻断（除了 Constitution Check）
- 提供"打破模板"按钮，记录打破原因到 audit log

### 7.4 与现有 multi-agent DAG 的关系

**风险**：team workflow 与 `packages/multi-agent/src/dag.ts` 的 DAG 编排可能职责重叠。

**澄清**：

| 抽象            | 职责                                        | 粒度                                  |
| --------------- | ------------------------------------------- | ------------------------------------- |
| Team Workflow   | 业务流程（spec → plan → tasks）             | 阶段级（每阶段对应多次 LLM 调用）     |
| Multi-agent DAG | Agent 间的执行依赖（parallel / sequential） | 任务级（每节点是一次工具/Agent 调用） |

**关系**：team workflow 的每个 step 内部，可以由 multi-agent DAG 来执行。两者是**嵌套关系**，不是替代关系。

### 7.5 与 `interaction-agent rewrite` / `team-leader dispatch` 的关系

**风险**：现有 team.ts 已有两条编排骨架，可能与 workflow 重复。

**澄清**：

- `interaction-agent rewrite` ≈ Phase B 的 specify/clarify 阶段（把用户原始输入精炼成结构化 spec）
- `team-leader dispatch` ≈ Phase C 的 role adapter 调度（把 spec 分发给合适的 agent）

**演进路径**：把这两个现有功能逐步重构进 workflow 框架，而不是并存。

### 7.6 反向风险：方法论传染

**风险**：把 spec-kit 的方法论引入 team 后，可能"反向污染"其他子系统（artifacts / skills / workflows），让整个产品变得过度方法论化。

**缓解**：

- team 是这个方法论的**唯一容器**，不向外扩散
- artifacts / skills / workflows 各自保持独立语义
- 任何"统一抽象"提案都要先证明跨域价值再引入

### 7.7 hermes 专项：handoff 状态机失效

**风险**：handoff watcher 是新引入的关键组件，一旦 watcher crash / 死锁 / 漏抓，五层都会卡住。

**缓解**：

- watcher 必须是**幂等**的：claim 用 SQL `UPDATE ... WHERE state='pending'` 原子操作
- 给 `handoff_records` 加 `claimed_at` + 超时回收（默认 60s 自动 unclaim）
- 提供 `/admin/handoffs` 路由人工干预
- Phase B 上线前必须有专门的 chaos test：随机 kill watcher，验证 session 恢复

### 7.8 hermes 专项：session 树爆炸

**风险**：`parent_session_id` + 子代理派发可能让 session 树指数增长，DB / 前端时间线都会被拖垮。

**缓解**：

- 硬上限 `max_spawn_depth = 3`（hermes 同款）
- 同一父 session 下并发子 session 上限 = 8
- 前端 session 树默认折叠到 3 层，超出走"展开按钮"
- DB 层加 `parent_session_id` + `created_at` 复合索引

### 7.9 hermes 专项：toolset 门控误伤

**风险**：把 toolset 按层硬绑死，可能让 c/d 在某些场景缺失必要工具（例如 c 想直接读文件确认现状）。

**缓解**：

- toolset 默认按层划分，但允许 admin 在团队级 override
- 提供"工具升级请求"流程：c 可以请求临时获得 e 的 toolset，但需要在 audit log 留痕
- 不在 MVP 引入复杂的 RBAC，先用粗粒度白名单

### 7.10 hermes 专项：指令分层栈维护成本

**风险**：identity / context / engineering 三层指令叠加后，调试 prompt 行为会变难——你不知道是哪一层在影响输出。

**缓解**：

- prompt 注入时为每段加显式 marker（如 `<!-- LAYER: identity -->`）
- 提供 prompt-trace 工具：可以查看任一 session 的最终拼接 prompt 与每层贡献
- Phase A 不引入 SOUL 编辑能力——先用 5 个内置 SOUL，等用户真的需要再开放

---

## 8. 待决事项 / 开放讨论

以下问题不在本稿范围内决定，需要后续单独讨论：

### 8.1 spec-kit 相关

1. **constitution 是否需要版本历史？** 是否需要类似 git 的 commit 历史，还是 markdown 文件 + 数据库版本号即可？
2. **多步精炼是否要支持"暂停 / 恢复"？** 用户可能 spec 写到一半离开，回来继续，这需要 draft 持久化。
3. **跨 team 的 workflow 模板怎么共享？** 是私有团队内复用，还是开放 marketplace？后者会引入审核 / 安全成本。
4. **role adapter 是否要支持人类成员？** 当前讨论默认 4 角色都是 AI agent，但实际场景可能 reviewer 是人类——需要扩展 adapter 抽象覆盖人类角色。
5. **Constitution Check 失败时的处理策略？** 自动阻断 / 警告但允许继续 / 走审批流？三种策略对应不同团队文化。
6. **是否需要"团队级 skill 沙箱"？** 当前 skill 是全局的，team 是否需要独立的 skill 安装和权限？这与现有 `skill-registry` 的设计有较大重叠。
7. **`team_members` 当前是用户私有记录，是否要重构成真正的组织成员模型？** 这影响 invites / permissions 设计，可能引入完整的 RBAC。

### 8.2 hermes-agent 相关

8. **session 树的展开/折叠默认策略？** 默认显示 3 层还是 1 层？深度任务父 session 是否需要实时摘要给用户？
9. **handoff 是否要支持跨用户？** 例如 c 把 session handoff 给团队 leader 审批后再下发——这会让 RBAC 提前进场。
10. **toolset 门控是用白名单还是黑名单？** 白名单更安全但配置成本高，黑名单更灵活但容易出事。
11. **identity SOUL 是否允许用户编辑？** 如果开放，会引入 prompt injection 风险；如果不开放，用户没有定制空间。
12. **跨平台 handoff（IM / Web 之间互转）何时引入？** 这是 hermes 的杀手特性，但 OpenAWork MVP 阶段可能不需要。
13. **dispatch_package 的 timeout 是固定值还是按 task 类型动态？** 固定值简单，动态值精准但需要训练数据。

### 8.3 双源融合相关

14. **handoffs frontmatter（spec-kit）和 handoff_records 表（hermes）的真相源**：当两者不一致时谁覆盖谁？
15. **identity（hermes SOUL）和 constitution（spec-kit）冲突时**：identity 是角色人格，constitution 是团队约束，谁优先级更高？
16. **dispatch_package 内的 artifactRefs 是引用还是快照？** 引用省空间但 artifact 后续被改会污染历史，快照可重放但占空间。

---

## 9. 决策清单（待团队确认）

### 9.1 spec-kit 系列

| 序号 | 决策项                             | 推荐选项                                            | 备选                              | 影响范围      |
| ---- | ---------------------------------- | --------------------------------------------------- | --------------------------------- | ------------- |
| D1   | 是否引入 team constitution？       | **是**（Phase A 启动）                              | 不引入，继续用 AGENTS.md          | 数据层 + UI   |
| D2   | constitution 存储位置？            | **数据库字段**（`team_workspaces.constitution_md`） | 独立表 / git-backed 文件          | 数据层        |
| D3   | 是否引入多步精炼流程？             | **可选启用**（Phase C）                             | 强制启用 / 不引入                 | 创建流程 + UI |
| D4   | 多步精炼步数？                     | **MVP 三步**（spec/plan/execute）                   | 五步 / 七步                       | Workflow 模板 |
| D5   | 是否引入 workflow 模板包？         | **是但延后到 Phase E**                              | 立即引入 / 永不引入               | 模板系统      |
| D6   | 是否引入 role adapter 矩阵？       | **是但延后到 Phase E**                              | 永远固定 4 角色硬编码             | Agent 编排    |
| D7   | 是否复用 `workflow_templates` 表？ | **是**（仅扩 metadata_json）                        | 新建 `team_workflow_templates` 表 | 数据层        |
| D8   | 是否复用 `artifacts` 系统？        | **是**（扩 phase + teamWorkspaceId）                | 新建 `team_artifacts` 表          | 产物系统      |
| D9   | Constitution Check 失败策略？      | **警告但允许继续** + audit log                      | 自动阻断 / 走审批                 | 工作流 gate   |
| D10  | 是否需要重构 `team_members`？      | **不在本次范围**（独立 RBAC 工程）                  | 顺手做                            | 组织模型      |

### 9.2 hermes-agent 系列

| 序号 | 决策项                            | 推荐选项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 备选                                                | 影响范围                      |
| ---- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| D11  | 是否引入 b（接待）层？            | **是**（Phase B 启动，新增 role）✅ **已拍板 v3.1**                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 不引入，c 自己做意图识别                            | session 路由 + 创建流         |
| D12  | 是否引入 d（PM2）层？             | **是**（Phase B 启动，重构 team-leader dispatch）✅ **已拍板 v3.1**                                                                                                                                                                                                                                                                                                                                                                                                                                  | 把 d 职责合并进 c                                   | 编排核心                      |
| D13  | session 状态机扩展位置？          | **扩展现有 `sessions` 表**                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 新建 `session_layers` 表                            | 数据层                        |
| D14  | handoff 协议存储位置？            | **新增 `handoff_records` 表**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 复用 metadata 字段                                  | 数据层                        |
| D15  | watcher 部署形态？                | **gateway 内进程内 watcher**                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 独立 service / SQS                                  | 部署                          |
| D16  | 是否引入 toolset 门控？           | **是**（Phase B 启动，按 5 层划分）— 细化见 D43 + Section 5.10                                                                                                                                                                                                                                                                                                                                                                                                                                       | 不引入，全部 agent 共享 toolset                     | Agent 能力管控                |
| D17  | 是否引入角色级 SOUL？             | **是但仅内置**（Phase A，5 个固定 SOUL）                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 不引入 / 完全开放编辑                               | prompt 分层                   |
| D18  | 子代理深度限制？                  | **A2 方案：结构深度 + 执行深度分开计算** ✅ **已拍板 v3.3**：① 结构深度（structural_depth）固定 4，对应 b=0/c=1/d=2/e-g=3，由 schema 强制不可破坏；② 执行深度（execution_depth）每角色独立计数，上限 2（subagent 还可再起 1 层但不能再深）                                                                                                                                                                                                                                                           | A1（统一 5 层）/ A3（保持 3 层禁止 e/f/g delegate） | 安全边界 + DAG 编排           |
| D19  | 是否引入 kanban 长任务板？        | **不引入**（MVP 不需要）                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase E 后再考虑                                    | 任务系统                      |
| D20  | 跨平台 handoff？                  | **不引入**（OpenAWork 不存在跨平台问题）                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 引入跨用户 handoff                                  | 协作模型                      |
| D43  | 工具能力门控的细化粒度？          | **C 方案：hybrid（架构层定能力类别 + 实施层定具体工具白名单）** ✅ **已拍板 v3.7**：① 现在定能力类别（required/allowed/forbidden 三级，见 Section 5.10.1 完整表）；② Phase B 实施时定具体工具白名单（如 `hashEdit` API 颗粒度、路径前缀限制）；③ 4 项默认边界（f 测试目录、e 提议项目记忆、b 仅经 scheduler、g 用 review_notes）见 5.10.2                                                                                                                                                            | A 全提前定 / B 全后面定                             | Agent 能力管控 + Phase B 落地 |
| D44  | 各层提示词风格基调                | **5 层 4 维度全部拍板** ✅ **已拍板 v3.8**：① b 接待 = B/C 切换 + D 用户可选透明 + E 翻译式单点 + C 智能猜兜底；② c PM1 = B 工程实用 + B 严格克制标记 + B 中等粒度 + D 按需调研；③ d PM2 = B 工程主管式 + C 字面+意图补充 + D 启发式兜底 + D 自适应详尽；④ e 开发 = 架构跟随（受 D45）+ B 限次自治 3 次 + B 偶尔委派 + A 强制 TDD；⑤ f 测试 = D 智能补位 + B 复现+报告 + D 自适应覆盖 + A 严格分工不越界；⑥ g 评审 = C 架构守门 + B 教练式 + D 按严重度分级 + C 看+引用。**完整细则见 Section 5.11** | 单一统一风格 / 完全 Phase A 自由发挥                | 提示词工程                    |
| D45  | 架构规范是否独立载体 + check 机制 | **A+B 组合：独立 architecture.md（仓库根）+ 3 个 check 点** ✅ **已拍板 v3.8**：① 独立文件 `architecture.md` 与 AGENTS.md 平行；② 注入栈插入第 2 位（D34 顺序更新）；③ 3 个 check 点：e SOUL 强制读 + d architecture review（与 Constitution Check 并列）+ CI lint；④ 10 类内容全选：技术选型/设计模式/命名/目录/模块边界/错误处理/测试/性能/安全/工程纪律。**完整细则见 Section 5.12**                                                                                                              | 写进 AGENTS.md / 团队级 / 不引入独立载体            | 架构规范 + 注入栈 + d review  |

### 9.3 双源融合系列

| 序号 | 决策项                                          | 推荐选项                                                                                                              | 备选                     | 影响范围              |
| ---- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------- |
| D21  | handoffs frontmatter vs DB 状态机的真相源？     | **DB 为权威**，frontmatter 仅用于 UI 渲染                                                                             | frontmatter 为权威       | 一致性                |
| D22  | identity SOUL vs team constitution 冲突优先级？ | **constitution > SOUL**（团队约束高于个人风格）                                                                       | SOUL > constitution      | prompt 拼接顺序       |
| D23  | dispatch_package 的 artifactRefs 形态？         | **引用 + 注入时快照内容**（混合）                                                                                     | 纯引用 / 纯快照          | 派发包大小 + 可重放性 |
| D24  | 跨层调用是否允许直连？                          | **禁止**（必须走 handoff）✅ **已拍板 v3.1**（无 escape hatch；现有 `team-leader dispatch` 必须完全废弃，不保留兼容） | 允许（performance 优化） | 架构纯度              |
| D25  | b（接待）层是否要走五层，还是直接答？           | **走 intent_state 判断**，简单 ask 直答                                                                               | 永远走全链路             | 用户体验              |

### 9.4 流程语义系列（v3 新增，对应 Section 3C 的 Q1-Q5）

| 序号 | 决策项                       | 推荐选项                                                                                                                                                                                                                                                         | 备选                            | 影响范围    |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------- |
| D26  | b 是否允许"直答"绕过 c/d？   | **是**（与 D25 一致：intent_state='ask' 直答）                                                                                                                                                                                                                   | 否，所有请求都走 c              | UX + 创建流 |
| D27  | c 的澄清回路是否经过 b？     | **经过 b 异步推送给 a**（与同步/异步语义一致）                                                                                                                                                                                                                   | c 直接问 a（破坏异步边界）      | 推送通道    |
| D28  | e/f/g 之间依赖关系？         | **C 有限并行**：e/f 并行，g 等两者完成 ✅ **已拍板 v3.8**                                                                                                                                                                                                        | 完全并行 / 串行 e→f→g           | DAG 编排    |
| D29  | review 失败的恢复策略？      | **B3 = B1 + B2 并存** ✅ **已拍板 v3.2**：① d 退回 c 时必须附"违反的具体原则 + 修改建议"（B2，提高 c 单次成功率）；② "d 退回 c 次数 ≥ 2"后强制升级到用户（B1，硬上限兜底）；③ 升级用户时只提供两个默认动作：**修改 constitution / 改原始需求**（不含"强制跳过"） | 永远 d 内部重派 / 单 B1 / 单 B2 | 错误恢复    |
| D30  | 用户能否在中间任一步骤介入？ | **关键节点暂停**（c 完成 plan、d 派发前），与同步对话语义一致                                                                                                                                                                                                    | 全自动 / 任一节点可介入         | UX + 状态机 |

### 9.5 同步/异步通信语义系列（v3 新增，对应 Section 3B.0）

| 序号 | 决策项                                                       | 推荐选项                                                                                                                                                                                                                                                                                                                                                                            | 备选                                                     | 影响范围      |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------- |
| D31  | 用户提新需求时，b 是开新后台任务还是合并到当前进行中的任务？ | **询问用户**："要不要并入当前任务"由用户决定                                                                                                                                                                                                                                                                                                                                        | 永远开新任务 / b 自动判断合并                            | 任务管理      |
| D32  | 后台任务的推送优先级如何排序？                               | **阻塞性立刻推**（澄清/失败），**信息性合并批量推**，**静默性仅记录**                                                                                                                                                                                                                                                                                                               | 全部立刻推 / 用户问到才说                                | 推送通道      |
| D33  | b 对下游任务有无中止/取消权？                                | **有**：b 发 cancel handoff，下游各层尊重并清理（见 5.6 cancel 协议）                                                                                                                                                                                                                                                                                                               | 只通知不能中止 / 必须前端 UI 取消                        | 编排控制      |
| D40  | b 的"创建后台任务"具体实现？                                 | **D3 方案**：MVP 用 `InProcessScheduler`（直接转 `createHandoff`），但抽象 `BackgroundTaskScheduler` 接口先行 ✅ **已拍板 v3.4**（接口字段先扩展不限定最小集，未来需要再扩）                                                                                                                                                                                                        | D1 紧耦合（b 直调 createHandoff）/ D2 立即上独立 service | 编排架构      |
| D42  | 是否引入团队级运行管控面板 + 一键暂停？                      | **A 方案：全引入**（推荐组合 B/A/D/A/A） ✅ **已拍板 v3.6**：① 粒度=B（全团队 + 单任务都支持，"管控所有"+"一键"两层兼顾）；② LLM 处理=A（等当前轮完成，下轮调用前检查 paused 标志，不浪费已付成本）；③ UI=D（顶部状态栏 + 单 task 详情抽屉）；④ 暂停时 a-b 持续=A（暂停只影响下游 c/d/e/f/g，b 长驻前台原则不破坏）；⑤ 超时=A（永久暂停直到手动恢复，配合"暂停 1h+"上下文过期警告） | 不引入 / 仅暴力 abort                                    | UX + 编排控制 |

### 9.6 项目记忆系列（v3 新增，对应 Section 5.7 ⑦ Project Memory）

| 序号 | 决策项                                                  | 推荐选项                                                                                                                                                                 | 备选                       | 影响范围        |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------- |
| D34  | 项目记忆双存储归属？                                    | **C 方案**：`users.user_memory_md` + `team_workspaces.project_memory_md` ✅ **已拍板 v3.1**（注入顺序锁定：AGENTS → constitution → project_memory → user_memory → SOUL） | A：每层独立 / B：全挂 team | 数据模型        |
| D35  | 记忆更新是否使用 frozen snapshot？                      | **是**（保护 prefix cache，session 内不变）                                                                                                                              | 实时更新（破坏 cache）     | 成本 + 性能     |
| D36  | 记忆字符上限？                                          | **MEMORY 2200 字符 / USER 1375 字符**（hermes 同款）                                                                                                                     | 不限 / token 计算          | 存储边界        |
| D37  | e/f/g 是否可以写入项目记忆？                            | **不能**（只读，避免实现细节污染长期记忆）                                                                                                                               | 可写但需 review            | 写入权限        |
| D38  | 是否引入外部 memory provider 插件（mem0 / honcho 等）？ | **MVP 不引入**，但接口预留 `MemoryProvider` 抽象                                                                                                                         | 引入 / 永远不引入          | 扩展性          |
| D39  | 记忆内容安全扫描的兜底策略？                            | **必须实现**（13 条威胁模式 + 不可见 unicode 检测）                                                                                                                      | 不扫描，信任输入           | 安全            |
| D41  | 记忆写入后的生效模式？                                  | **C2 + C3 混合**：默认 C2 静默写入（保护 prefix cache），UI 提供 C3"立即生效"按钮供用户主动触发 ✅ **已拍板 v3.5**（用户明确"对于 C3 需要在页面强制生效操作"）           | 单 C1 / 单 C2 / 单 C3      | UX + cache 策略 |

### 9.7 决策清单总览

56 项决策分 7 个序列：

| 序列                                | 决策范围                                                                          | 序号                             |
| ----------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| 9.1 spec-kit                        | 方法论引入                                                                        | D1-D10                           |
| 9.2 hermes-agent + 提示词/架构/运维 | 编排骨架 + 风格基调 + 架构规范 + 动态编制 + 模型选择 + 崩溃恢复 + 降级 + 版本演进 | D11-D20、D43-D47、D51、D53、D56  |
| 9.3 双源融合                        | 一致性与拼接                                                                      | D21-D25                          |
| 9.4 流程语义                        | 五层之间路径                                                                      | D26-D30                          |
| 9.5 同步/异步                       | a-b 通信模式 + 并发控制 + 进度展示                                                | D31-D33、D40、D42、D49、D50      |
| 9.6 项目记忆 + 学习                 | 双存储记忆 + 注入栈压缩 + 并发修改 + 学习闭环 + 跨 team 共享                      | D34-D39、D41、D48、D52、D54、D55 |

**最关键的 5 项决策**（其它都依赖这 5 项）：

1. **D11 + D12**（是否引入 b 接待层、d PM2 层）— 五层架构是否成立
2. **D24**（是否禁止跨层直连）— architecture 纯度
3. **D32**（推送优先级策略）— 用户体验决定项
4. **D34**（项目记忆双存储归属）— 数据模型起点
5. **D29**（review 失败恢复策略）— 决定系统是否会陷入死循环

### 9.8 已拍板决策（v3.10，2026-05-15）

**全部 56 项决策已锁定 ✅**（23 项显式拍板 + 33 项批量按推荐确认），可启动 Phase A 设计稿：

| 序号        | 决策                                     | 拍板结论                                                                                              | 触发的连锁修改                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D11+D12** | 引入 b 接待层 + d PM2 层                 | ✅ **A 方案：全引入**（Phase B 启动）                                                                 | 1) `apps/web/src/pages/team/runtime/use-team-runtime-role-bindings.ts` 必须从固定 4 角色重构为 5 角色（加 reception）；2) `services/agent-gateway/src/routes/team.ts` 的 `interaction-agent rewrite` 与 `team-leader dispatch` 必须重构为 b/d 层                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **D24**     | 跨层调用是否允许直连                     | ✅ **A 方案：禁止**（无 escape hatch）                                                                | 现有 `team-leader dispatch` 必须**完全废弃**，不能"先保留再迁移"——保留即允许直连。需在 Phase B 之前做好兼容方案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D34**     | 项目记忆双存储归属                       | ✅ **C 方案**：`users.user_memory_md` + `team_workspaces.project_memory_md`                           | 1) 双表 migration（user 表 + team_workspaces 表）；2) prompt 注入顺序锁定为：AGENTS → constitution → project_memory → user_memory → SOUL；3) 团队 A 和团队 B 看到的同一个 c agent 行为会因各自 user_memory 不同而不同（个性化，需对用户讲清楚）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D29**     | review / Constitution Check 失败恢复策略 | ✅ **B3 方案：B1 + B2 并存**                                                                          | 1) **B2 结构化反馈**：d 退回 c 时必须附"违反的具体原则 + 修改建议"，提高单次成功率；2) **B1 硬上限兜底**："d 退回 c 次数 ≥ 2"后强制升级到用户（推送 🔴 阻塞性消息）；3) **升级用户时只提供两个动作**：① 修改 constitution（违规规则可能本身需调整）② 改原始需求（需求可能与团队约束不兼容）——**不提供"强制跳过"动作**（避免约束被绕过失效）；4) handoff_records 表加 `escalation_round INTEGER DEFAULT 0` 字段记录退回次数；5) 升级 prompt 模板需在 Phase A 与 constitution 模板一同准备                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **D18**     | 子代理深度限制                           | ✅ **A2 方案：结构深度 + 执行深度分开计算**                                                           | 1) **结构深度** `structural_depth INTEGER NOT NULL DEFAULT 0`：固定 4 层（b=0/c=1/d=2/e-g=3），由 schema 强制不可破坏，超过即拒绝；2) **执行深度** `execution_depth INTEGER NOT NULL DEFAULT 0`：每角色独立计数，上限 2（subagent 还可再起 1 层但不能再深），用于 e/f/g 调研究员/编辑员等子代理；3) `sessions` 表新增两个字段；4) 前端可用两个维度区分颜色：结构深度对应"角色层"，执行深度对应"递归层"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **D40**     | b 的"创建后台任务"具体实现               | ✅ **D3 方案：MVP `InProcessScheduler` + 接口预留**（字段先扩展不限定最小集）                         | 1) 抽象接口 `BackgroundTaskScheduler`：`schedule` / `getStatus` / `cancel` / `listActive` / `subscribe` 五个核心方法（详见 5.6 末尾完整定义）；2) **MVP 实现** `InProcessScheduler`：`schedule` 直接转 `createHandoff(b→c)`，`subscribe` 用进程内 EventEmitter，`listActive` 从 DB 重建；3) **接口字段先扩展**：`ScheduleInput` 含 `priority` / `scheduledAt` / `deadline` / `retryPolicy` / `idempotencyKey` / `parentTaskId` / `tags` / `metadata`；4) **硬约束**：scheduler 接口外不能直接调 createHandoff，b→其它层必须经 scheduler；5) 升级路径预留：未来可换 `RedisStreamsScheduler` / `QueueScheduler` 不破坏调用方                                                                                                                                                                                                                                                                                                                                                          |
| **D41**     | 记忆写入后的生效模式                     | ✅ **C2 + C3 混合方案**（v3.5 新增，用户原话"对于 C3 需要在页面强制生效操作"）                        | 1) **默认 C2 静默写入**：保护 prefix cache，写入后当前 session 不变，下次新 session 才生效；2) **UI 提供 C3"立即生效"按钮**：用户主动触发后销毁当前 session cache，重新拼接 system prompt，**当前 session 即时生效**（成本：单次 +10x）；3) **页面强制生效要求**：明显但不醒目位置 + 确认对话框（提示成本）+ 完成后系统消息提示 + 单 session 24h 内最多 5 次（防滥用）；4) 数据层连锁：`sessions` 表新增 `cache_invalidated INTEGER DEFAULT 0` / `force_apply_count INTEGER DEFAULT 0` / `force_apply_last_at INTEGER` 三个字段；5) 前端组件清单：`<MemoryWriteBadge>` / `<ForceApplyButton>` / `<ForceApplyDialog>` / `<MemoryAppliedBadge>`；6) 与 D35 frozen snapshot 决策不冲突：99% 时间 cache 仍受保护，只在用户显式触发时才破坏                                                                                                                                                                                                                                              |
| **D42**     | 团队级运行管控 + 一键暂停                | ✅ **A 方案：全引入**（v3.6 新增，用户原话"页面可以直接管控所有团队运行状态，有一件暂停的功能"）      | 1) **粒度=B**：全团队 + 单任务都支持（"管控所有"+"一键"两层兼顾）；2) **LLM 处理=A**：等当前轮完成，下轮调用前检查 `paused` 标志，**不浪费已付成本**；3) **UI=D**：顶部状态栏（常驻一键暂停/恢复）+ 单 task 详情抽屉（独立暂停/恢复/取消）；4) **暂停时 a-b 持续=A**：暂停只影响下游 c/d/e/f/g，b 长驻前台原则不破坏；5) **超时=A**：永久暂停直到手动恢复，配合"暂停 1h+"上下文过期警告（前端 Modal）；6) **数据层连锁**：`sessions` 与 `handoff_records` 表均新增 `paused INTEGER DEFAULT 0` / `paused_at INTEGER` / `paused_by_user_id TEXT` / `pause_reason TEXT` 字段，加索引 `idx_sessions_paused`；7) `BackgroundTaskScheduler` 接口新增 4 个方法：`pause` / `resume` / `pauseAll` / `resumeAll`；8) **与 D33 cancel 协议互补**：cancel 销毁不可恢复，pause 冻结可恢复；9) 前端组件清单：`<TeamStatusBar>`（顶部）/ `<TaskDetailDrawer>`（侧边滑出）/ `<PauseConfirmDialog>` / `<ResumeStaleDialog>`（>1h 警告）                                                              |
| **D43**     | 工具能力门控的细化粒度                   | ✅ **C 方案：hybrid（架构层定能力类别 + 实施层定具体工具白名单）**（v3.7 新增，用户原话"同意推荐的"） | 1) **现在定能力类别**（required/allowed/forbidden 三级）：见 Section 5.10.1 完整表格，覆盖 a/b/c/d/e/f/g 全 7 种角色；2) **Phase B 实施时定具体工具白名单**：包括 `hashEdit` API 颗粒度、路径前缀限制（如禁 `**/node_modules/**`）、LSP 操作范围；3) **4 项默认边界**（v3.7 拍板，可后续调整）：① f 测试层禁止写 `src/` 但允许写 `tests/` / `fixtures/` / `mocks/`；② e 开发层不直接写项目记忆，但可通过 `result_json.proposedMemoryEntries` 提议由 d 决策；③ b 接待层只能通过 `BackgroundTaskScheduler` 抽象间接触发下游（与 D24 同源）；④ g 评审层加 `review_notes` 工具，建议附加到 d 的 `result_json` 不直接改代码；4) **类型层强制**：每个角色 SOUL（D17）frontmatter 声明能力类别，由 `TeamRoleAdapter`（D6）注入 toolset；5) **拒绝时记录**：被禁用工具的调用尝试写 audit log（不静默失败）；6) **演化机制**：发现"forbidden"需放开时必须修改 D43 而不是绕过；7) **与 D16 关系**：D16 = "门控存在"，D43 = "门控的能力类别如何划分"，Phase B = "具体工具白名单"——三者层层细化 |
| **D28**     | e/f/g 之间依赖关系                       | ✅ **C 有限并行**（v3.8 新增）：e/f 并行执行，g 等两者完成后才启动                                    | 1) e 开发 + f 测试并行跑（互不依赖）；2) g 评审等 e+f 都完成后才开始（需要完整代码 + 测试结果）；3) d 在 dispatch 时按此规则设置 handoff 依赖（task3 depends_on [task1, task2]）；4) 与 D18 双深度限制兼容（e/f/g 都在 structural_depth=3）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **D44**     | 各层提示词风格基调                       | ✅ **5 层 4 维度全部拍板**（v3.8 新增）：完整细则见 Section 5.11                                      | 1) b 接待 = B/C 切换（按 user_memory + 前端开关）+ D 用户可选透明 + E 翻译式单点 + C 智能猜兜底；2) c PM1 = B 工程实用 + B 严格克制标记 + B 中等粒度 + D 按需调研；3) d PM2 = B 工程主管式 + C 字面+意图补充 + D 启发式兜底 + D 自适应详尽；4) e 开发 = 架构跟随（受 D45）+ B 限次自治 3 次 + B 偶尔委派 + A 强制 TDD；5) f 测试 = D 智能补位 + B 复现+报告 + B 质量优先 + A 严格分工；6) g 评审 = C 架构守门 + B 教练式 + D 按严重度分级 + C 看+引用；7) 跨层共性：SOUL ≤ 2000 字符 / 占位符 `{{ var_name }}` / 中文优先 / SOUL 不带 few-shot / 结构化输出强制                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D45**     | 架构规范独立载体 + check 机制            | ✅ **A+B 组合：独立 architecture.md（仓库根）+ 3 个 check 点**（v3.8 新增）：完整细则见 Section 5.12  | 1) 独立文件 `architecture.md` 与 AGENTS.md 平行（仓库级）；2) 注入栈插入第 2 位（D34 顺序更新为 6 层：AGENTS → architecture → constitution → project_memory → user_memory → SOUL）；3) 3 个 check 点：e SOUL 强制读 + d architecture review（与 Constitution Check 并列）+ CI lint；4) 10 类内容全选：技术选型/设计模式/命名/目录/模块边界/错误处理/测试/性能/安全/工程纪律；5) 字符上限 ≤ 5000；6) 演化机制：修改 architecture.md 必须走 PR + review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **D46**     | 开发团队动态编制                         | ✅ **动态生成**（v3.9 新增）                                                                          | 1) e（开发）= 动态生成，默认最少 2 个并行，上限由用户前端配置；2) f（测试）= 固定存在（每次任务必有）；3) g（评审）= 固定存在（每次任务必有）；4) d 根据 tasks.md 的 task 数量和 [P] 标记决定 spawn 几个 e；5) 前端提供"最大并行开发者数"配置项（team 设置面板）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **D47**     | 每层 LM 模型选择                         | ✅ **用户前端可配**（v3.9 新增）                                                                      | 1) 前端 team 设置面板提供"各层模型配置"；2) 默认值由系统推荐（b 轻量 / d 推理重 / e 代码强）；3) 用户可覆盖任一层的 provider + model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **D48**     | 注入栈自动压缩                           | ✅ **达阈值自动压缩**（v3.9 新增）                                                                    | 1) 7 层注入栈总量达到阈值时触发压缩；2) 压缩优先级：lessons-learned > project-memory > user_memory > SOUL（越靠后越先压缩）；3) architecture.md / constitution.md / AGENTS.md 不压缩（规范类不可裁剪）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **D49**     | 进度展示方案                             | ✅ **各层状态 + 进度条 + 预估时间**（v3.9 新增）                                                      | 1) 前端展示各层级运行状态（b/c/d/e/f/g 当前阶段）；2) 整体任务进度条（基于 dispatch_packages completed/total）；3) 预估完成时间（基于历史同类任务平均耗时）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **D50**     | 全局并发上限                             | ✅ **双层限制 + FIFO 可调序 + 系统自动降级**（v3.9 新增）                                             | 1) 双层：任务数上限 + 单任务内 agent 数上限；2) 超出上限 FIFO 排队，用户可在前端拖拽调整优先级；3) 用户设上限 + 系统根据 provider rate limit 自动降级                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **D51**     | 崩溃恢复                                 | ✅ **心跳+超时 / 自动重试 1 次 / 从头重跑保留产物**（v3.9 新增）                                      | 1) 心跳（30s 写 `last_heartbeat`，60s 超时）+ 超时兜底（task 级 30 分钟上限）双保险；2) 自动重试 1 次（静默），仍失败走 D29 B3 失败分流；3) 从头重跑但保留已有 artifact（e 可读到上次产物避免重复）；4) `sessions.last_heartbeat INTEGER` + `handoff_records.crash_retry_count INTEGER DEFAULT 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D52**     | 并发修改                                 | ✅ **memory 追加无锁 + constitution/architecture 乐观锁 / 自动合并 / 写入时检测**（v3.9 新增）        | 1) memory 用 `§` 分隔追加（无锁，并发安全）；constitution/architecture 用乐观锁（version 字段）；2) 追加类字段两条都保留；覆盖类字段冲突时拒绝+重试；3) 写入时扫描已有条目检测语义冲突并提示；4) `team_workspaces.constitution_version INTEGER DEFAULT 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D53**     | 优雅降级                                 | ✅ **三级降级可配 / 系统预设+用户覆盖 fallback / 标注+可重跑**（v3.9 新增）                           | 1) 三级降级：重试 N 次 → 切换 fallback 模型 → 通知用户；用户可配"暂停等我决定"覆盖自动切换；2) 系统预设每层 fallback + 用户可覆盖（与 D47 对齐）；3) 降级产物标注"⚠️ 由备用模型生成" + 提供"用主模型重跑"按钮                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D54**     | 学习闭环                                 | ✅ **只学高频失败 / 独立 lessons-learned.md / d 提议+用户确认**（v3.9 新增）                          | 1) 只学失败模式 + 只沉淀高频重复（同类问题 ≥ 2 次）；2) 独立 `lessons-learned.md` 文件（仓库级 git），注入栈第 5 位；3) d 检测到重复失败模式 → 推送建议"要不要记住这个教训？" → 用户确认才写入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **D55**     | 跨 team memory                           | ✅ **project-memory + lessons = 仓库级 git 文件 / user_memory 保持用户级**（v3.9 新增）               | 1) `project-memory.md` 从 DB 字段移为仓库根 git 文件（所有 team 共享）；2) `lessons-learned.md` 同为仓库级 git 文件；3) `user_memory_md` 保持用户级 DB 字段（跨 team），矛盾由 D52 写入时检测处理；4) D34 修正：`team_workspaces.project_memory_md` 字段不再需要                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **D56**     | 架构版本演进                             | ✅ **新 session 立即生效 + 迁移建议不强制 / d 建议+用户确认 / git+版本号**（v3.9 新增）               | 1) 新 session 立即用新规范审查；旧代码不回溯但自动生成迁移建议（不强制执行）；2) d 在 review 时发现旧代码不符新规范 → 推送建议"要不要迁移？" → 用户确认才生成迁移任务；3) git history 为底层版本追踪 + architecture.md 头部显式版本号（如 `version: 2.0`）供 d 判断代码写于哪个版本                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**所有架构层细节问题已收敛 ✓**

下一步：基于以上全部 56 项已拍板决策启动 Phase A 设计稿（落到 `.agentdocs/workflow/`）。

---

## 10. 双源对照速查

> 给后续讨论提供快速参考：spec-kit / hermes-agent 概念 → OpenAWork 五层架构等价物。

### 10.1 spec-kit → OpenAWork 五层

| spec-kit                                        | 落点层    | OpenAWork 等价物                                        |
| ----------------------------------------------- | --------- | ------------------------------------------------------- |
| `.specify/memory/constitution.md`               | d / 全局  | `team_workspaces.constitution_md` 字段 + artifact 渲染  |
| `/speckit.specify`                              | c         | team workflow step `id="specify"`                       |
| `/speckit.clarify`                              | c         | team workflow step `id="clarify"`                       |
| `/speckit.plan`                                 | c         | team workflow step `id="plan"`（含 Constitution Check） |
| `/speckit.tasks`                                | c         | team workflow step `id="tasks"`                         |
| `/speckit.analyze`                              | d         | d 层双重 review（spec review + quality review）         |
| `/speckit.implement`                            | e/f/g     | dispatch_package + 子 session 执行                      |
| `[NEEDS CLARIFICATION]`                         | c→d gate  | 同名标记，前端高亮 + handoff 阻塞门禁                   |
| `[P]` 并行标记                                  | d 派发    | 同名标记，d 推导并行 dispatch                           |
| `[US1]` 故事标记                                | c→d→e/f/g | 同名标记，dispatch_package.taskMarkers.userStory        |
| `handoffs` frontmatter                          | 跨层      | 与 hermes 的 handoff_state 合体：声明 + DB 双层         |
| 四层模板栈（overrides/presets/extensions/core） | c         | Phase E 引入两层（overrides + core）                    |
| IntegrationBase 抽象类                          | e/f/g     | `TeamRoleAdapter` 接口                                  |
| 30+ 客户端目录分发                              | —         | **不引入**（OpenAWork 是 SaaS）                         |
| `specify init` 现场分发                         | —         | 不需要（数据库 + artifact 仓库即可）                    |
| `.specify/templates/` 模板包                    | c         | `workflow_templates.metadata_json.teamWorkflow`         |

### 10.2 hermes-agent → OpenAWork 五层

| hermes-agent                                              | 落点层    | OpenAWork 等价物                                                 |
| --------------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| `sessions` 表（带 `parent_session_id` / `handoff_state`） | b/c/d/e-g | `sessions` 表扩展同款字段                                        |
| `gateway/run.py` 消息路由 + watcher                       | b         | `services/agent-gateway/src/handoff/watcher.ts`                  |
| `cli.py` 的 `/handoff <platform>`                         | 跨层触发  | `POST /sessions/:id/handoffs` API                                |
| `agent/prompt_builder.py` 三层 prompt                     | 全层      | identity（SOUL）+ context（constitution）+ engineering（AGENTS） |
| `SOUL.md` 人格文件                                        | 每层一个  | `agent_personas` 表，5 个内置 SOUL                               |
| `AGENTS.md` 项目指令                                      | 全局      | 仓库根 `AGENTS.md`（已存在，保留）                               |
| `.cursorrules` / `.hermes.md`                             | 团队级    | `team_workspaces.constitution_md`                                |
| `tools/todo_tool.py`（压缩后再注入）                      | c/d       | 升级 `team_tasks` 为活跃 todo + 上下文压缩重注入                 |
| `tools/delegate_tool.py` 子代理派发                       | d → e/f/g | `dispatch_package`（goal/context/toolsets/role）                 |
| `max_spawn_depth` / `max_concurrent_children`             | d         | 硬上限 3 层、并发 8                                              |
| `toolsets.py` 能力分层                                    | 五层      | 每层声明 toolset 白名单                                          |
| `tools/mcp_tool.py` MCP 集成                              | 全层      | 复用现有 `packages/mcp-client/`                                  |
| `tools/patch_parser.py` V4A patch                         | e/f/g     | 复用现有 `tools/hash-edit.ts`（同思路）                          |
| `kanban` 长任务板                                         | —         | **不引入**                                                       |
| `cron` 定时任务                                           | —         | **不引入**（OpenAWork 已有 telemetry）                           |
| `curator` 学习闭环                                        | —         | **不引入**（避免复杂度爆炸）                                     |

### 10.3 双源融合点速查

| 融合机制       | spec-kit 部分          | hermes 部分                | OpenAWork 落地点                             |
| -------------- | ---------------------- | -------------------------- | -------------------------------------------- |
| 结构化派发包   | [P] / [US1] / 文件路径 | goal/context/toolsets/role | `HandoffPayload` 接口（5.6 节）              |
| 可审计 handoff | handoffs frontmatter   | handoff_state DB 状态机    | DB 权威 + frontmatter UI 渲染                |
| 三层指令栈     | constitution 单层      | identity/context/volatile  | AGENTS + constitution + SOUL                 |
| 三粒度任务流   | tasks.md 单层          | todo / delegate / kanban   | tasks.md + dispatch_package（kanban 不引入） |

---

## 11. 与现有文档的关系

本稿与既有文档的关系（已扩展为双源视角）：

| 既有文档                            | 关系                | 说明                                                                                  |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `260416-team-创建流程设计分析.md`   | **互补**            | 那是"创建 session 时如何选择团队"的设计；本稿是"五层架构 + 双源方法论"的设计          |
| `260416-team-创建实施方案.md`       | **互补 + 前置依赖** | 那是 session metadata 的 teamDefinition 落地；本稿 Phase A/B 在其之上扩展             |
| `done/260415-team-page-收口方案.md` | **依赖**            | 本稿基于其留下的 `team-runtime-shell` shadow 形态，进一步定义内容                     |
| `AGENTS.md`（仓库根）               | **保留并分层**      | 仓库纪律层（engineering）≠ team 方法论层（context）≠ 角色人格层（identity），三者并存 |
| `temp/spec-kit/`（克隆）            | **思想源 1**        | 主要影响 c/d/e-g 的方法论与产物链                                                     |
| `temp/hermes-agent/`（克隆）        | **思想源 2**        | 主要影响 b/c/d 的会话编排与派发协议                                                   |

---

## 12. 后续动作

本稿是讨论稿，不是实施单。建议下一步：

### 12.1 立即可做（无需决策）

1. **团队评审本稿**（建议 1 次会议 + 异步 comment）
2. 在 `/team` 页面的"团队宪法"侧边 tab 出 UI 草图，验证 Phase A 用户接受度
3. 在 gateway 团队内对齐"五层架构 + 双源思想"是否符合长期演进方向

### 12.2 需先拍板决策再推进

4. **拍板第 9 节决策清单**（D1-D25，分三组：spec-kit / hermes / 双源融合）
5. **如果 D1-D2 + D17 通过** → 启动 Phase A 设计稿（落到 `.agentdocs/workflow/`）
6. **Phase A 验证后**（用户真的会编辑 constitution + SOUL 注入有效）→ 启动 Phase B 讨论
7. **Phase B 是双源第一次合体**（session 状态机 + handoff 协议），需要专门的 chaos test 计划

### 12.3 长期保留

8. **保留本稿不动**，作为长期方法论参考
9. 每个 Phase 完成后写一份 retrospective，验证假设是否成立
10. 任何 Phase 验证不通过 → 在本稿末尾追加"反思与调整"章节，不删除原有内容

---

## 附录 A：spec-kit 关键文件索引

```
temp/spec-kit/
├── README.md                              # 总入口、与 vibe coding 对比
├── spec-driven.md                         # 完整方法论说明
├── docs/
│   ├── concepts/sdd.md                    # SDD 概念
│   ├── reference/workflows.md             # 工作流机制
│   ├── reference/integrations.md          # 多 AI 适配矩阵
│   ├── reference/presets.md               # 预设系统
│   └── reference/extensions.md            # 扩展系统
├── templates/
│   ├── constitution-template.md           # 宪法模板
│   ├── spec-template.md                   # spec 模板
│   ├── plan-template.md                   # plan 模板
│   ├── tasks-template.md                  # tasks 模板
│   └── commands/
│       ├── constitution.md                # /speckit.constitution 命令
│       ├── specify.md                     # /speckit.specify 命令
│       ├── clarify.md                     # /speckit.clarify 命令
│       ├── plan.md                        # /speckit.plan 命令
│       ├── tasks.md                       # /speckit.tasks 命令
│       ├── analyze.md                     # /speckit.analyze 命令
│       └── implement.md                   # /speckit.implement 命令
├── scripts/
│   ├── bash/                              # bash 工作流脚本
│   └── powershell/                        # PowerShell 工作流脚本
└── src/specify_cli/
    ├── __init__.py                        # CLI 主入口
    ├── integrations/__init__.py           # 集成注册矩阵
    └── integrations/base.py               # 集成基类
```

---

## 附录 A2：hermes-agent 关键文件索引

```
temp/hermes-agent/
├── README.md                              # 英文定位：自进化、闭环学习、多端、委派
├── README.zh-CN.md                        # 中文定位
├── AGENTS.md                              # 项目级 agent 设计哲学（工具/技能/计划/kanban）
├── CONTRIBUTING.md                        # 何时用 skill/tool、多 agent/kanban、profile 边界
├── run_agent.py                           # 核心对话循环、system prompt 构建、tool loop
├── cli.py                                 # CLI 入口、/handoff、/resume、会话切换
├── model_tools.py                         # 工具发现、toolset 过滤、函数调用分发
├── toolsets.py                            # 能力分层：todo/memory/delegate_task/kanban
├── hermes_state.py                        # SessionDB、parent_session_id、handoff_state
├── mcp_serve.py                           # Hermes 自身作为 MCP server 的对外接口
├── gateway/
│   ├── session.py                         # SessionSource/Context、session key 路由
│   └── run.py                             # 网关消息路由、pending handoff watcher
├── agent/
│   └── prompt_builder.py                  # 三层 prompt 注入、SOUL/AGENTS/.cursorrules
├── tools/
│   ├── todo_tool.py                       # 会话内 todo + 上下文压缩后再注入
│   ├── delegate_tool.py                   # 子代理派发：goal/context/toolsets/role
│   ├── mcp_tool.py                        # 外部 MCP server 发现/注册
│   ├── file_tools.py                      # 文件读写 + 敏感路径保护
│   └── patch_parser.py                    # V4A patch 结构化产物解析
├── skills/software-development/
│   ├── plan/SKILL.md                      # 计划模式：只产 .md，不执行
│   ├── writing-plans/SKILL.md             # 计划文档模板与任务粒度
│   └── subagent-driven-development/SKILL.md  # 计划→子代理→双重 review→完成 todo
├── skills/autonomous-ai-agents/
│   ├── hermes-agent/SKILL.md              # Hermes 运行哲学
│   └── codex/SKILL.md                     # Codex 作为下游执行体
└── website/docs/
    ├── developer-guide/architecture.md    # agent loop / system prompt / toolsets
    ├── developer-guide/gateway-internals.md  # 网关守卫、授权、handoff、hook
    ├── user-guide/features/skills.md      # skills 方法论
    ├── user-guide/features/mcp.md         # MCP 集成方法论
    └── user-guide/features/cron.md        # 定时任务/计划执行
```

---

## 附录 B：OpenAWork 当前 team 关键文件索引

```
apps/web/src/
├── App.tsx                                # /team 路由注册
├── pages/TeamPage.tsx                     # /team 主容器
├── pages/team/team-page-sections.tsx      # 团队成员/任务/消息/共享/审计区块
├── pages/team/use-team-workspace-state.ts # workspace 状态
├── pages/team/use-team-collaboration.ts   # runtime read model
└── pages/team/runtime/
    ├── team-runtime-shell.tsx             # 完整壳层候选（未挂路由）
    ├── team-runtime-reference-data.tsx    # view-model 组装
    ├── use-team-runtime-projection.ts     # 投影计算
    └── use-team-runtime-role-bindings.ts  # 4 核心角色推导

services/agent-gateway/src/
├── routes/team.ts                         # team 后端主路由
├── db.ts                                  # team_workspaces / team_members ...
├── session-workspace-metadata.ts          # session metadata 校验
├── session-shared-access.ts               # 共享会话查询
└── team-audit-store.ts                    # 审计日志

packages/
├── shared/src/index.ts                    # 固定核心角色常量
├── multi-agent/src/team.ts                # 内存 TeamStoreImpl
├── multi-agent/src/dag.ts                 # DAG 调度
├── multi-agent/src/orchestrator.ts        # 多 Agent 编排
├── agent-core/src/plan/                   # 计划状态机
├── artifacts/                             # 产物系统（待复用）
└── skill-registry/                        # 技能系统（与 team 解耦）

.agentdocs/workflow/
├── 260416-team-创建流程设计分析.md         # 创建流程设计
├── 260416-team-创建实施方案.md             # 创建流程实施
└── done/260415-team-page-收口方案.md       # /team 路由收口
```

---

## 附录 C：术语表

| 术语                        | 定义                                                                     | 来源                                            |
| --------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **SDD**                     | Spec-Driven Development，spec-kit 推广的方法论                           | spec-kit                                        |
| **Constitution**            | 团队/项目长期不可协商的约束集                                            | spec-kit                                        |
| **Spec**                    | 描述"做什么"的产物，不写"怎么做"                                         | spec-kit                                        |
| **Plan**                    | 描述"怎么做"的产物，含技术选型                                           | spec-kit                                        |
| **Tasks**                   | plan 拆解后的可执行任务列表                                              | spec-kit                                        |
| **Constitution Check**      | plan/analyze 阶段强制对齐 constitution 的门禁                            | spec-kit                                        |
| **`[NEEDS CLARIFICATION]`** | 标记 spec 中存在歧义，必须澄清                                           | spec-kit                                        |
| **`[P]`**                   | 标记任务可并行                                                           | spec-kit                                        |
| **`[US1]`**                 | 标记任务关联的用户故事编号                                               | spec-kit                                        |
| **Role Adapter**            | 把同一份方法论分发到不同 Agent 实现的适配器                              | spec-kit                                        |
| **Session State Machine**   | session 作为带 parent/handoff/role_layer 的工作对象                      | hermes-agent                                    |
| **Handoff**                 | 跨层/跨平台/跨 agent 的结构化会话接力                                    | hermes-agent（spec-kit 也有同名概念但仅声明性） |
| **Handoff State**           | pending → claimed → running → completed/failed                           | hermes-agent                                    |
| **Toolset 门控**            | 按角色/层声明 agent 可见的工具白名单                                     | hermes-agent                                    |
| **Delegate Task**           | 父 agent 把单元任务派给子代理，同步等待结果                              | hermes-agent                                    |
| **SOUL**                    | 角色级人格指令（identity 层）                                            | hermes-agent                                    |
| **AGENTS.md**               | 项目级工程指令（context 层）                                             | hermes-agent + 既有                             |
| **Three-tier Prompt**       | identity / context / volatile 三层 prompt 分层                           | hermes-agent                                    |
| **Todo Re-injection**       | 上下文压缩后把活跃 todo 重新注入 prompt                                  | hermes-agent                                    |
| **Spawn Depth**             | 子代理派发的递归深度限制                                                 | hermes-agent                                    |
| **V4A Patch**               | 结构化文件编辑产物（add/update/delete/move）                             | hermes-agent                                    |
| **Five-layer Architecture** | a 用户 / b 接待 / c PM1 / d PM2 / e-g 开发团队                           | OpenAWork（本稿提出）                           |
| **Reception Layer**         | b 层接待 agent，负责意图识别 + 路由                                      | OpenAWork（本稿提出）                           |
| **PM1 / Task Planner**      | c 层项目经理，把模糊需求转成 plan + tasks                                | OpenAWork（本稿提出）                           |
| **PM2 / Dispatch Manager**  | d 层项目经理，把 tasks 拆成 dispatch_package 派发                        | OpenAWork（本稿提出）                           |
| **Dispatch Package**        | d 层派发到 e/f/g 的标准结构（goal/context/toolsets/role + artifactRefs） | OpenAWork（本稿提出，融合双源）                 |
| **Bridge Node**             | 连接 spec-kit 与 hermes 思想的桥接层（即 d 层）                          | OpenAWork（本稿提出）                           |
| **Team Workflow**           | OpenAWork 中"团队级多步精炼流程"的统称                                   | OpenAWork                                       |
| **Team Artifact**           | OpenAWork 中"团队级阶段性产物"的统称                                     | OpenAWork                                       |

---

## 附录 D：双源思想对比速查

| 维度              | spec-kit                           | hermes-agent                                    | 在 OpenAWork 的归属                   |
| ----------------- | ---------------------------------- | ----------------------------------------------- | ------------------------------------- |
| **关注点**        | 把"做什么"想清楚                   | 把"谁来做、怎么接力"想清楚                      | 两者结合                              |
| **时间维度**      | 一次性把流程跑通（线性七步）       | 持续工作（多 session、跨平台）                  | 持续工作 + 阶段性精炼                 |
| **主体抽象**      | 产物（spec/plan/tasks）            | 会话（session + handoff + todo）                | 五层架构                              |
| **长期约束**      | constitution.md 单层               | identity/context/volatile 三层                  | 三层栈                                |
| **任务粒度**      | 单一 tasks.md                      | todo / delegate / kanban 三粒度                 | 三粒度（kanban 不引入）               |
| **跨主体协作**    | 没有显式机制                       | handoff 状态机                                  | handoff_records 表                    |
| **工具能力**      | 不强制约束                         | toolset 门控 + 子代理深度限制                   | 按层声明 toolset                      |
| **产物形态**      | Markdown 一等公民                  | Markdown plans + JSON todo + patch + transcript | 复用 artifact 系统                    |
| **流程触发**      | 用户敲 slash command               | CLI 命令 + IM 消息 + cron                       | Web UI + IM channel                   |
| **多 Agent 编排** | 无                                 | delegate_task + handoff                         | 五层 + handoff + delegate             |
| **形态**          | 单机 CLI                           | 单进程 Python agent + gateway                   | 多端 SaaS                             |
| **核心论断**      | spec 是 truth，code 是 spec 的表达 | session 是工作单元，可路由可接力                | 五层架构 = spec 方法论 + session 编排 |

---

## 附录 E：版本历史

| 版本       | 日期       | 主要变化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1**     | 2026-05-14 | 单源版（仅 spec-kit），四件套，三阶段落地路径                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **v2**     | 2026-05-14 | 双源版（spec-kit × hermes-agent），五层架构（a/b/c/d/e-g），六件套，五阶段落地路径，新增双源融合点章节 + hermes 专项风险与决策清单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **v3**     | 2026-05-14 | **同步/异步双轨版** + 七件套：① TL;DR 加入"a-b 同步对话 / b-下游异步"语义；② Section 3B.0 新增同步/异步拓扑，Section 3B.3 新增 b 双角色（前台对话 + 后台调度器）+ 三种对话模式 + 推送优先级；③ Section 3C 完整端到端流程图（含 review 失败回路、Constitution Check 退回、cancel 路径、3 种典型场景）；④ Section 5.5 ⑤ Session State 加 `BackgroundTask[]` 派生视图；⑤ Section 5.6 ⑥ Handoff 加 cancel 协议（cancel_requested / 'cancelled' state / 级联取消）；⑥ **新增 Section 5.7 ⑦ Project Memory**（双存储记忆 user_memory_md + project_memory_md，frozen snapshot 模式，13 条威胁模式扫描，e/f/g 只读）；⑦ Section 5.8/5.9 升级为七件套关系图 + 落点矩阵；⑧ 决策清单从 D25 扩展到 **D39**（新增 9.4 流程语义 D26-D30、9.5 同步/异步 D31-D33、9.6 项目记忆 D34-D39，并加 9.7 总览 + 5 项最关键决策）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **v3.1**   | 2026-05-14 | **3 项基础架构决策已拍板**（用户确认）：① **D11+D12 = A**：引入 b 接待层 + d PM2 层（五层架构成立，触发 `use-team-runtime-role-bindings.ts` 4 角色 → 5 角色重构、`team.ts` 的 `interaction-agent rewrite` + `team-leader dispatch` 重构）；② **D24 = A**：禁止跨层直连（无 escape hatch，现有 `team-leader dispatch` 必须完全废弃）；③ **D34 = C**：双存储归属确定（`users.user_memory_md` + `team_workspaces.project_memory_md`，注入顺序锁定 AGENTS → constitution → project_memory → user_memory → SOUL）。新增 Section 9.8「已拍板决策」记录拍板结论 + 触发的连锁修改。剩余待讨论的 4 个细节问题（Q-A session 树深度、Q-B Constitution Check 死循环防护、Q-C frozen snapshot 用户提示、Q-D b 创建后台任务实现）按建议次序在 9.8 末尾列出                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **v3.2**   | 2026-05-14 | **D29 已拍板**（用户确认 B3 + 默认动作偏向修宪法/改需求）：① **D29 = B3**（B1 + B2 并存）：B2 结构化反馈（d 退回 c 时必须附"违反原则 + 修改建议"，提高单次成功率）+ B1 硬上限兜底（"d 退回 c 次数 ≥ 2"后强制升级到用户）；② **升级到用户时只提供两个动作**：修改 constitution / 改原始需求（**不含"强制跳过"**，避免约束失效）；③ 数据层连锁：`handoff_records` 加 `escalation_round INTEGER DEFAULT 0` 字段记录退回次数；④ 升级 prompt 模板需在 Phase A 与 constitution 模板一同准备；⑤ 9.8 已拍板决策从 3 项扩展到 **4 项**（D11+D12、D24、D34、D29），剩余待讨论问题从 4 个收敛到 3 个（Q-A、Q-D、Q-C）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **v3.3**   | 2026-05-14 | **D18 已拍板**（用户在 A1/A2/A3 对比后选 A2）：① **D18 = A2**：结构深度 + 执行深度分开计算；② **结构深度** `structural_depth` 固定 4 层（b=0/c=1/d=2/e-g=3），由 schema 强制不可破坏；③ **执行深度** `execution_depth` 每角色独立计数，上限 2（subagent 还可再起 1 层但不能再深）；④ 数据层连锁：`sessions` 表新增 `structural_depth INTEGER NOT NULL DEFAULT 0` 与 `execution_depth INTEGER NOT NULL DEFAULT 0` 两个字段；⑤ 前端 session 树可视化可用两个维度区分颜色：结构深度对应"角色层"、执行深度对应"递归层"；⑥ 9.8 已拍板决策从 4 项扩展到 **5 项**（D11+D12、D24、D34、D29、D18），剩余待讨论问题从 3 个收敛到 2 个（Q-D、Q-C）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **v3.4**   | 2026-05-14 | **D40 已拍板**（用户选 D3 + 字段先扩展不限定最小集）：① **D40 = D3**：MVP 用 `InProcessScheduler`（直接转 createHandoff）+ 抽象 `BackgroundTaskScheduler` 接口预留升级路径；② **接口扩展字段**：`ScheduleInput` 含 `priority` / `scheduledAt` / `deadline` / `retryPolicy` / `idempotencyKey` / `parentTaskId` / `tags` / `metadata`，MVP 可不实现但接口已支持；③ **核心方法**：`schedule` / `getStatus` / `cancel` / `listActive` / `subscribe` 五个；④ **硬约束**：scheduler 接口外不能直接调 createHandoff（与 D24 同源约束），b→其它层必须经 scheduler，且 listActive 必须能从 DB 重建（重启可恢复）；⑤ Section 5.6 末尾完整接口定义落地；⑥ 9.5 决策清单从 D33 扩展到 D40（共 4 项），9.8 已拍板决策从 5 项扩展到 **6 项**（D11+D12、D24、D34、D29、D18、D40），剩余待讨论问题从 2 个收敛到 1 个（仅剩 Q-C）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **v3.5**   | 2026-05-14 | **D41 已拍板**（用户选 C2+C3 混合 + 强调"页面强制生效操作"）：① **D41 = C2+C3 混合**：默认 C2 静默写入（保护 prefix cache），UI 提供 C3"立即生效"按钮供用户主动触发；② **页面强制生效要求**：明显但不醒目位置 + 确认对话框（提示成本）+ 完成后系统消息提示 + 单 session 24h 内最多 5 次（防滥用）；③ **数据层连锁**：`sessions` 表新增 `cache_invalidated INTEGER DEFAULT 0` / `force_apply_count INTEGER DEFAULT 0` / `force_apply_last_at INTEGER` 三个字段；④ **前端组件清单**：`<MemoryWriteBadge>`（C2）、`<ForceApplyButton>` / `<ForceApplyDialog>`（C3 入口与确认）、`<MemoryAppliedBadge>`（C3 完成提示）；⑤ **与 D35 不冲突**：99% 时间 cache 仍受保护，只在用户显式触发时才破坏；⑥ Section 5.7 末尾补完整 C2+C3 混合实现细节；⑦ 9.6 决策清单从 D34-D39 扩展到 D34-D39+D41（共 7 项），9.8 已拍板决策从 6 项扩展到 **7 项**（D11+D12、D24、D34、D29、D18、D40、D41），**所有架构层细节问题已收敛**，可启动 Phase A 设计稿                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **v3.6**   | 2026-05-14 | **D42 已拍板**（用户原话"页面可以直接管控所有团队运行状态，有一件暂停的功能"，选 A 全引入按推荐组合 B/A/D/A/A）：① **D42 = A（团队级运行管控 + 一键暂停）**：双粒度（全团队一键 + 单任务）、LLM 调用前检查 paused 标志（不浪费已付成本）、UI 顶部状态栏 + task 详情抽屉、暂停时 a-b 同步对话不受影响（b 长驻前台原则）、永久暂停直到手动恢复；② **数据层连锁**：`sessions` 与 `handoff_records` 双表均新增 `paused INTEGER DEFAULT 0` / `paused_at INTEGER` / `paused_by_user_id TEXT` / `pause_reason TEXT` 字段，加索引 `idx_sessions_paused`；③ `BackgroundTaskScheduler` 接口扩展 4 个新方法：`pause` / `resume` / `pauseAll` / `resumeAll`，其中 `resume` 返回值含 `staleWarning?: boolean`（暂停 > 1h 触发上下文过期警告），`pauseAll` / `resumeAll` 一键操作整个 receptionSessionId 下所有活跃任务；④ **与 D33 cancel 协议互补**：cancel 销毁中间产物不可恢复，pause 冻结状态可恢复；⑤ **前端组件清单**：`<TeamStatusBar>`（顶部常驻一键操作）/ `<TaskDetailDrawer>`（侧边滑出独立操作）/ `<PauseConfirmDialog>`（"将暂停 N 个任务"确认）/ `<ResumeStaleDialog>`（>1h 上下文过期警告）；⑥ **watcher 集成**：watcher 轮询 `pending` handoff 时跳过 `paused=1` 记录；⑦ Section 5.5/5.6 数据层与接口同步落地；⑧ 9.5 决策清单从 D31-D33+D40 扩展到 D31-D33+D40+D42（共 5 项），9.8 已拍板决策从 7 项扩展到 **8 项**（D11+D12、D24、D34、D29、D18、D40、D41、D42），架构层完整度进一步提升                                                                                                                           |
| **v3.7**   | 2026-05-15 | **D43 已拍板**（用户原话"同意推荐的"，选 C 方案 hybrid 策略）：① **D43 = C 方案**：架构层定能力类别（required/allowed/forbidden 三级）+ 实施层定具体工具白名单（Phase B 落地时定）；② **新增 Section 5.10 工具能力门控**：完整能力类别表覆盖 a/b/c/d/e/f/g 全 7 种角色，明确 required/allowed/forbidden 三级；③ **4 项默认边界**（v3.7 拍板，可后续调整）：① f 测试层禁止写 `src/` 但允许写 `tests/` / `fixtures/` / `mocks/`；② e 开发层不直接写项目记忆但可通过 `result_json.proposedMemoryEntries` 提议由 d 决策；③ b 接待层只能通过 `BackgroundTaskScheduler` 抽象间接触发下游（与 D24 同源）；④ g 评审层加 `review_notes` 工具，建议附加到 d 的 `result_json` 不直接改代码；④ **与 D16 关系**：D16 = "门控存在"（架构决定要做），D43 = "门控的能力类别如何划分"（本次拍板做成什么样），Phase B = "具体工具白名单"（实施时具体怎么做）——三者层层细化；⑤ **类型层强制**：每个角色 SOUL（D17）frontmatter 声明能力类别，由 `TeamRoleAdapter`（D6）注入 toolset；被禁用工具的调用尝试写 audit log（不静默失败）；⑥ **演化机制**：发现"forbidden"需放开时必须修改 D43 而不是绕过，保持架构一致性；⑦ 9.2 决策清单从 D11-D20 扩展到 D11-D20+D43（共 11 项），9.8 已拍板决策从 8 项扩展到 **9 项**（D11+D12、D24、D34、D29、D18、D40、D41、D42、D43）                                                                                                                                                                                                                                                                     |
| **v3.8**   | 2026-05-15 | **D28 + D44 + D45 三项批量拍板**（用户逐层讨论提示词方向后确认"合并"）：① **D28 = C 有限并行**：e/f 并行执行，g 等两者完成后才启动（d 在 dispatch 时按此规则设置 handoff 依赖）；② **D44 = 5 层 4 维度提示词风格基调全部锁定**：b 接待（B/C 切换 + D 用户可选透明 + E 翻译式单点 + C 智能猜兜底）/ c PM1（B 工程实用 + B 严格克制 + B 中等粒度 + D 按需调研）/ d PM2（B 工程主管式 + C 字面+意图补充 + D 启发式兜底 + D 自适应详尽）/ e 开发（架构跟随 D45 + B 限次自治 3 次 + B 偶尔委派 + A 强制 TDD）/ f 测试（D 智能补位 + B 复现+报告 + B 质量优先 + A 严格分工）/ g 评审（C 架构守门 + B 教练式 + D 按严重度分级 + C 看+引用）；跨层共性：SOUL ≤ 2000 字符 / 占位符 `{{ var_name }}` / 中文优先 / 结构化输出强制；新增 Section 5.11 完整细则；③ **D45 = A+B 组合：独立 architecture.md（仓库根）+ 3 个 check 点**：独立文件与 AGENTS.md 平行 / 注入栈插入第 2 位（D34 顺序更新为 6 层：AGENTS → architecture → constitution → project_memory → user_memory → SOUL）/ 3 个 check 点（e SOUL 强制读 + d architecture review + CI lint）/ 10 类内容全选（技术选型/设计模式/命名/目录/模块边界/错误处理/测试/性能/安全/工程纪律）/ 字符上限 ≤ 5000 / 演化机制走 PR + review；新增 Section 5.12 完整细则；④ **Section 5.1 双源指令分层表更新为 6 层**（engineering → architecture → context → memory:project → memory:user → identity）；⑤ 9.2 决策清单从 D11-D20+D43 扩展到 D11-D20+D43+D44+D45（共 13 项），9.8 已拍板决策从 9 项扩展到 **12 项**（D11+D12、D24、D34、D29、D18、D40、D41、D42、D43、D28、D44、D45） |
| **v3.8.1** | 2026-05-15 | **D44 b 层第 5 维度 + D45 初始化流程补充**：① **D44 b 层新增第 5 维度"主动建议"**：D 方案（A+C 融合）= 默认每次回复附 2-3 个建议，用户连续忽略 3 次自动降频到关键节点才带；展示形式 Z = 文字描述 + 可点击按钮并存；建议来源 5 种（对话上下文 / 项目状态 / 后台任务进展 / architecture.md 缺口 / 历史模式）；自适应降频规则写入 user_memory；前端组件 `<SuggestionBar>` + `<SuggestionButton>`；新增 Section 5.11.5 完整细则；② **D45 初始化流程**：新项目 3 分支（A 用户指定技术栈 / B 系统动态推断可选 / C 跳过）+ 已有项目"架构逆向工程"流程（explore subagent 扫描代码 → c 生成初稿 → 用户确认）；分支 B 动态推断 = 可选不强制；推断置信度标注（✅ 通用最佳实践 / ⚠️ 推断需确认 / ❓ 未确定需用户输入）；修改权限矩阵（用户主导创建 / 维护者 PR 修改 / e 提议 / d 不能改）；新增 Section 5.12.7 完整细则                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **v3.9**   | 2026-05-15 | **D46-D56 十一项批量拍板**（隐患扫描后逐一讨论确认）：D46 动态编制（e 最少 2 并行可配上限，f/g 固定）/ D47 每层模型用户前端可配 / D48 注入栈自动压缩 / D49 进度展示 / D50 全局并发上限 / D51 崩溃恢复（心跳+超时+自动重试 1 次+保留产物）/ D52 并发修改（memory 追加无锁+constitution 乐观锁+写入时检测）/ D53 优雅降级（三级降级+fallback+标注可重跑）/ D54 学习闭环（高频失败→独立 lessons-learned.md→d 提议+用户确认）/ D55 跨 team memory（project-memory+lessons=仓库级 git，D34 修正）/ D56 架构版本演进（新 session 立即生效+迁移建议不强制）；注入栈升为 7 层；9.8 从 12 项扩展到 23 项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **v3.10**  | 2026-05-15 | **剩余 33 项决策逐一按推荐确认**（D1-D10 spec-kit 系列 + D13-D17/D19-D20 hermes 系列 + D21-D23/D25 双源融合 + D26-D27/D30 流程语义 + D31-D33 同步/异步 + D35-D39 项目记忆）：全部按推荐方案锁定；D9 reconcile 为"c 层自检=软警告 + d 层审查=硬阻断（D29）"；D17 扩展为 A+C+Z（内置 5 个 SOUL + 用户可编辑 + 编辑时扫描警告但允许）；**全部 56 项决策已锁定 ✅**，Phase A 设计稿可立即启动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

> 本稿欢迎 review。决策清单（第 9 节，共 56 项 D1-D56，**全部 56 项已拍板 ✅**）。可启动 Phase A 设计稿。
> v3.10 状态：**全部 56 项决策已锁定 ✅**（23 项显式拍板 + 33 项逐一按推荐确认）。五层架构 + 七件套 + 7 层注入栈 + 动态编制 + 模型可配 + 注入栈压缩 + 进度展示 + 并发控制 + 崩溃恢复 + 并发修改 + 优雅降级 + 学习闭环 + 仓库级共享 + 架构版本演进 + 提示词风格基调 + 架构规范 + 工具门控 + 一键暂停 + 有限并行 全部锁定。Phase A 设计稿可立即启动。

---

## 13. v3.12 分层决策重组（2026-05-16）

> **本节是 v3.12 修订入口**。基于 v3.10 全部锁定 56 项决策后的 review，发现以下结构性问题：
>
> 1. **决策过度集中**：56 项一次性全部拍板违反 SDD 自身"渐进式精炼"精神
> 2. **修改成本极高**：任何一项修改触发整版升级（v3.1 → v3.10 共 10 个版本说明这一点）
> 3. **新人入门困难**：2830 行文档信息密度低，找不到决策的优先级梯度
> 4. **设计自相矛盾**：D24（禁止跨层直连）与 D29（升级到用户）协议层不可能共存
> 5. **过度依赖 LLM**：d 层一个 LLM 干 5 件事，b 层一个 LLM 兼任路由+陪聊+调度
> 6. **协议设计不足**：原子 handoff 导致 c 层批处理化，澄清往返要重启 session
>
> v3.12 不修改 v3.10 的 56 项决策内容（保留作为讨论历史），但**实际执行以分层决策文档为准**。

### 13.1 新文档结构

```
docs/
├── team-architecture-spec-kit-borrowing-discussion.md   ← 本文档（v3.12，归档）
├── team-architecture-l1-baseline.md                     ← L1 基线（9 项，新建）
├── team-architecture-phase-a-decisions.md               ← Phase A 决策（6 项，新建）
└── team-architecture-deferred-decisions.md              ← 延后决策清单（L3+L4，新建）
```

### 13.2 决策分层

```
L1（必须现在锁，9 项）→ team-architecture-l1-baseline.md
   │ 决定数据模型 + 通信协议 + 延迟约束
   ▼
L2（Phase 启动时拍板，~15 项）→ team-architecture-phase-{X}-decisions.md
   │ 决定该 Phase 的功能范围 + 实现细节
   ▼
L3（实施时拍板，~25 项）→ 不进文档，进 PR 描述
   │ 决定具体阈值 / 默认值 / UI 细节
   ▼
L4（运营时调整，~8 项）→ 不进文档，进 runbook
```

### 13.3 v3.12 关键变更

#### 变更 1：L1.2 引入 d/b 拆分原则（新增 L1）

不允许"一个 LLM 干所有事"。d 层和 b 层强制拆分为"规则代码 + 多 LLM agent"混合架构。详见 L1.2。

```
当前讨论稿设计：d 层 = 1 个 LLM 干 5 件事
       ↓
L1.2 决策：d 层 = 规则代码（d.1/d.2/d.5）+ LLM agent（d.3/d.4）混合

当前讨论稿设计：b 层 = 1 个 LLM 同时陪聊 + 路由 + 调度 + 推送
       ↓
L1.2 决策：b 层 = b.router（规则）+ b.companion（LLM）+ b.scheduler（纯代码）
```

#### 变更 2：L1.3 流式 handoff 替代原子 handoff（新增 L1）

⑥ Handoff Protocol 件套从"原子 handoff"升级为"流式 handoff + 子状态机 + 双向消息通道"。详见 L1.3。

**关键问题**：v3.10 设计中 c 层是黑盒，10-30s 内 b 看不到内部进度，澄清要重启 session。

**修复**：

1. 引入 `sessions.substate` 字段（c 内部子状态机）
2. 引入 `session_inbound_messages` 表（反向消息通道）
3. c 在 spec/clarify/plan/tasks 全程**保持同一 session 不重启**

**对应 spec-kit 七步**：

```
specify  = c.substate='drafting_spec' → 'spec_ready'
clarify  = c.substate='clarifying'（双向往返，不重启）
plan     = c.substate='drafting_plan' → 'plan_ready'
tasks    = c.substate='drafting_tasks' → 'tasks_ready'
```

每一步对外都显式可见、可暂停、可取消。

#### 变更 3：L1.4 D24 加 3 个 escape hatch（修订）

v3.10 D24 拍板"完全禁止跨层直连无 escape hatch"，但与 D29 升级路径冲突（d 必须能反向通知 b）。

**修订**：默认禁止 + 3 个明确的 escape hatch：

1. **escalation 反向通道**（任意层 → b）：通过 `session_inbound_messages`
2. **进度上报通道**（任意层 → b）：通过 EventEmitter
3. **cancel/pause 信号广播**（b → 任意层）：通过 `session_inbound_messages`

#### 变更 4：L1.6 引入用户感知延迟约束（新增 L1）

v3.10 全文没有任何延迟约束。L1.6 补上：

| 场景             | 约束     |
| ---------------- | -------- |
| a→b 直答         | p95 < 3s |
| "已开始处理"确认 | p95 < 2s |
| 后台推送         | p95 < 5s |
| 进度推送间隔     | ≤ 60s    |

#### 变更 5：Phase A 剥离 SOUL（缩小 Phase A 范围）

v3.10 Phase A 同时引入 constitution + 5 个 SOUL + 7 层注入栈，导致**验证失败时无法定位原因**。

**修订**：Phase A 只验证一件事——"用户是否会编辑 constitution"。

- ❌ 不引入 SOUL（延后到 Phase B）
- ❌ 不引入五层架构（Phase B 才引入 b/d 层）
- ❌ 不引入 7 层注入栈（Phase B）
- ✅ 只新增 constitution 字段 + 编辑 UI + 注入到现有 4 角色 system prompt

工作量从 1-2 周减为 5 个工作日。

#### 变更 6：明确 Phase A 验证指标

v3.10 Phase A 没有可量化的验证指标。L2 Phase-A.5 补上：

| 指标                  | 目标          |
| --------------------- | ------------- |
| constitution 编辑率   | 30 天内 ≥ 30% |
| constitution 长度 p50 | ≥ 200 字符    |
| 重新编辑率            | 7 天内 ≥ 20%  |
| session 输出质量提升  | ≥ 5%          |

不达标 → 不启动 Phase B。

### 13.4 v3.10 → v3.12 的 56 项决策映射

| v3.10 决策                    | v3.12 处理                               |
| ----------------------------- | ---------------------------------------- |
| D11+D12（五层架构）           | 升级为 L1.1，保持                        |
| D24（禁止跨层直连）           | 修订为 L1.4（加 3 个 escape hatch）      |
| D34（双存储归属）             | 升级为 L1.5，保持                        |
| D14（handoff 存储位置）       | 升级为 L1.7，保持                        |
| D13/D18/D42（session 状态机） | 整合为 L1.8                              |
| D40（Scheduler 抽象）         | 升级为 L1.9，保持                        |
| -                             | **新增** L1.2（d/b 拆分原则）            |
| -                             | **新增** L1.3（流式 handoff + 子状态机） |
| -                             | **新增** L1.6（用户感知延迟约束）        |
| D1/D17                        | Phase A 决策                             |
| 其余 47 项                    | L3/L4，下沉到延后决策清单                |

### 13.5 后续动作

1. **团队 review L1 决策**（重点 L1.2/L1.3/L1.4/L1.6 这 4 项新增/修改）
2. L1 锁定后启动 Phase A（5 个工作日）
3. Phase A 完成后收集 4-8 周数据
4. 数据达标 → 启动 Phase B（含 v3.10 中 b/d 层 + SOUL + 7 层注入栈）
5. v3.10 56 项决策中**与新 L1 冲突的部分**自动失效（以 L1 为准）

### 13.6 关于 v3.10 的 23 项已显式拍板决策

v3.10 中已显式拍板的 23 项决策**不撤销**，但**有 3 项被 L1 修订**：

| v3.10 拍板            | v3.12 处理                                      |
| --------------------- | ----------------------------------------------- |
| D24 完全禁止跨层直连  | **被 L1.4 修订**：默认禁止 + 3 个 escape hatch  |
| D14 原子 handoff 协议 | **被 L1.3 修订**：升级为流式 handoff + 子状态机 |
| 其余 21 项            | 保持，但实施时以 L1/L2/L3/L4 分层归属为准       |

---

## 14. 版本历史更新

| 版本      | 日期       | 主要变化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **v3.10** | 2026-05-15 | 全部 56 项决策锁定（详见 §9.8）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **v3.11** | 2026-05-15 | 详见 `team-interaction-flow-v3.11.md` 流程图与 `team-page-layout-draft.md` 布局                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **v3.12** | 2026-05-16 | **分层决策重组**：① 拆分为 L1（9 项基线）/ L2（Phase 决策）/ L3（实施触发）/ L4（运营触发）四层；② 新增 L1.2 d/b 拆分原则（强制规则代码 + LLM agent 混合）；③ 新增 L1.3 流式 handoff 协议（替代原子 handoff，c 不重启即可澄清）；④ 修订 L1.4（D24 加 3 个 escape hatch）；⑤ 新增 L1.6 用户感知延迟约束；⑥ Phase A 剥离 SOUL（只验证 constitution 编辑假设）；⑦ Phase A 工作量从 1-2 周减为 5 天；⑧ 明确 Phase A 验证指标。新建 3 份分层决策文档：`team-architecture-l1-baseline.md` / `team-architecture-phase-a-decisions.md` / `team-architecture-deferred-decisions.md`。本文档转为**讨论历史归档**，实际执行以分层文档为准 |
