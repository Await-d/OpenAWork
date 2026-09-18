# Grill 分层增强方案 — 把 grill-me 纪律注入 OpenAWork 澄清能力

> **日期**：2026-09-14 ｜ **状态**：已实现并全量验证（2026-09-16 补齐 T-12/V-13） ｜ **范围**：A（question 管道）+ B（agent-core 引擎）+ C（team 层）
> **关联**：`docs/architecture/team-architecture-l1-baseline.md`、`docs/architecture/team-interaction-flow-v3.11.md`
> **参考外部资产**：`mattpocock/skills` → `skills/productivity/grilling/SKILL.md`、`skills/productivity/grill-me/SKILL.md`（MIT）

---

## 1. TL;DR（给评审者）

OpenAWork **已经拥有** grill-me 的三块基础设施，缺的只是"grill 纪律"：

| 已有能力 | 位置 | 现状 |
| --- | --- | --- |
| `clarify`（澄清）对话模式 | `DIALOGUE_MODE_SYSTEM_PROMPTS.clarify`（`stream-system-prompts.ts:77`） | 已有"渐进式提问"提示词，但**明确要求每轮只问一个维度、能推断就先假设**——与 grill 相反 |
| `question` / `AskUserQuestion` 工具 | `services/agent-gateway/src/tools/question-tools.ts` | 已支持一次多题 + 多选项；`question_requests` 表 + `question_asked/replied` 事件 + 暂停/恢复 |
| 多轮澄清引擎 | `packages/agent-core/src/context/routing.ts` | 已有 `clarificationRound` / `collectedDimensions` / `recordClarification`，但**固定顺序、单维度/轮**，且几乎未接入 live 循环 |
| team 层澄清往返 | `session_inbound_messages` + `substate=clarifying` + `ClarificationsPanel.tsx` | 已有单轮澄清链路，`pm1.clarifying` 已在白名单 |

**本方案不新增底层协议**，只做三件事：
1. 在 agent-core 建立 **frontier 引擎**（唯一事实来源 / SSOT）；
2. 让 `clarify` 模式与 `question` 工具按 frontier 纪律驱动；
3. 让 team 层（reception / pm1）的 clarify 支持多轮 frontier。

---

## 2. 背景

### 2.1 grill-me 是什么

`grill-me` 是"对一个松散想法做无情访谈，直到决策树每个分支都被解决"。其可复用原语 `grilling` 的六条纪律：

1. **设计树（design tree）**：每个决策向上依赖前置决策。
2. **frontier（前沿）**：当前"前置已全部确定"的决策集合。
3. **rounds（轮次）**：一轮问**整个 frontier**，等用户答完再重算 frontier；依赖本轮未决项的问题留到下一轮。
4. **每题带推荐答案**（`➡️`）：让用户可"确认"而非"从零回答"。
5. **facts vs decisions 分离**：事实由 agent 自己查（派 subagent），只把**决策**抛给用户。
6. **终止 = frontier 空 + 用户显式确认**：确认前不进入执行。

它有两种形态：`grill-me`（stateless、不写文件）与 `grill-with-docs`（stateful、写 `CONTEXT.md`/ADR）。OpenAWork 的 `clarify` 模式定位更接近 **grill-with-docs**（要产出方案文档）。

### 2.2 我们要解决的问题

用户在高影响决策上，往往只给一句话需求。当前 `clarify` 模式的策略是"能不打断就不打断、先假设后推进"——这在**低风险任务**上正确，但在**高影响、不可逆、跨模块**的任务上会导致"方案建立在未验证的假设之上"。grill 纪律要补的正是这个缺口。

---

## 3. 现状盘点（含证据）

### 3.1 前台对话模式：`clarify`

- 类型：`packages/shared/src/index.ts:95` → `export type DialogueMode = 'clarify' | 'coding' | 'programmer'`
- 提示词：`services/agent-gateway/src/routes/stream-system-prompts.ts:77` → `DIALOGUE_MODE_SYSTEM_PROMPTS.clarify`
- 工具门控：`services/agent-gateway/src/session/clarify-mode-tool-policy.ts` → `CLARIFY_MODE_ALLOWED_TOOLS`（只读 + `question`/`AskUserQuestion` + `EnterPlanMode`/`ExitPlanMode` + `task`/`Agent`）
- 门控接线：`services/agent-gateway/src/session/session-tool-visibility.ts:284-288`、`:336-345`
- UI：`apps/web/src/pages/chat-page/mode/DialogueModeToggle.tsx` + `dialogue-mode.ts`（标签"澄清"，描述"渐进式需求澄清与方案设计"）

**已有且与 grill 一致的**：只读约束、用 `task/Agent` 做信息获取（= facts 分离的雏形）、批量产出方案文档。

**与 grill 明确相反的**（`stream-system-prompts.ts:95-105`）：

| 现有指令 | grill 要求 |
| --- | --- |
| "每次提问聚焦一个维度，不要在一轮中堆叠过多问题" | 一轮问**整个 frontier** |
| "能合理推断的细节先列为假设，不逐项打断用户" | frontier 必须清空，不留静默假设 |
| "只有无法安全代决策的关键点才等待用户确认" | **每个**决策都抛给用户确认 |
| "浅层需求展开路径"是固定 5 级阶梯 | 决策树动态重算 |
| 无推荐答案字段 | 每题必带 `➡️` 推荐 |

### 3.2 `question` / `AskUserQuestion` 工具管道（A 层）

- 定义：`services/agent-gateway/src/tools/question-tools.ts`
  - `questionItemSchema = { question, header, multiSelect?, options[{label, description, preview?}] }`（`options` 最少 1 项）
  - 可见名映射：`services/agent-gateway/src/tools/tool-definitions.ts` → `CLAUDE_FIRST_VISIBLE_NAME_OVERRIDES.question = 'AskUserQuestion'`
  - 当前描述含**保守约束**："**仅当**缺失的选择真的阻塞推进时使用"
- 持久化：`services/agent-gateway/src/tools/tool-sandbox.ts:5990` → `createPendingQuestionRequest` → `question_requests` 表
  - 表结构（`services/agent-gateway/src/infra/db.ts:683`）：`id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, status, created_at, updated_at` + `ensureColumn('question_requests','expires_at','INTEGER')`
- 事件：`question_asked` / `question_replied`（`services/agent-gateway/src/session/session-question-events.ts`）
- 恢复：`services/agent-gateway/src/routes/stream-runtime.ts:943` → `resumeAnsweredQuestionRequest` → `continueFromApprovedToolResult`（**持久化恢复，非长阻塞**）
- 路由：`services/agent-gateway/src/routes/questions.ts` → `GET /sessions/:id/questions/pending`、`POST /sessions/:id/questions/reply`
- 前端：`apps/web/src/pages/chat-page/conversation/render/select-pending-question.ts`、`InlineQuestionPanel`、`packages/web-client/src/session/questions.ts`
- 标签截断：`services/agent-gateway/src/tools/question-label-truncator.ts` → `MAX_LABEL_LENGTH = 30`

### 3.3 agent-core 多轮澄清引擎（B 层）

`packages/agent-core/src/context/routing.ts`（215 行，已从 `index.ts:173-187` 公开导出）：

```ts
type ClarificationDimension = 'goal' | 'constraint' | 'deliverable' | 'acceptance';
interface ClarificationQuestion { dimension; question; options?: {label; description?}[] }
interface SessionContext { sessionId; clarificationRound; collectedDimensions: Set<...>; history: string[] }
function buildClarifications(level, context, input)   // ← 固定顺序，取 missing[0]，每轮 1 个维度，round>=3 停
function recordClarification(context, dimension, answer): SessionContext
function canProceedWithoutClarification(decision): boolean
function evaluate(input, context): RoutingDecision    // R0/R1 → clarifications 为空
```

**问题**：
- `CLARIFICATION_ORDER` 固定 `goal→constraint→deliverable→acceptance`，非 frontier 依赖。
- `evaluate` 仅 2 处调用：`services/agent-gateway/src/tools/desktop-automation.ts`、`packages/agent-core/src/index.ts` → **基本未接入主对话循环**。
- `SessionContext` 是内存对象，**无持久化**；session 压缩/恢复即丢失。
- ⚠️ 该文件**无任何测试覆盖**（代码图谱标注 `no covering tests found`）；**T-00 已补特征化测试**（`src/context/routing.test.ts`，21 例）。
- 🔴 **`acceptance` 维度实际不可达**：`buildClarifications` 在 `clarificationRound >= 3` 时停止，而 4 个维度需要 4 轮 → 第 4 个维度永远问不到。已由 T-00 特征化测试锁定。**修复方式（T-03 定调）**：不改 legacy 行为（否则 V-04 破），改由引擎迁移路径修复——`buildClarificationQuestions` + `seedGrillState` 一次把 4 个维度全部放入 frontier，无轮次上限。
- 模板为静态英文（`CLARIFICATION_TEMPLATES`），无推荐答案。

### 3.4 team 层的澄清往返（C 层）

- 运行层：`reception(b) → pm1(c) → pm2(d) → executor(e) → reviewer(g)`
- 澄清链路（`docs/architecture/team-architecture-l1-baseline.md` §L1.3.2）：
  `c 发现 [NEEDS CLARIFICATION]` → `substate='clarifying'` → 推 `clarification_needed` 给 b → b 推给 a → 用户答 → `session_inbound_messages(clarification_answer)` → c 不重启继续
- 实现：`services/agent-gateway/src/handoff/runner/artifact-chain.ts:663`（消费 `clarification_answer`）、`services/agent-gateway/src/routes/team-inbound.ts:200`
- 白名单：`services/agent-gateway/src/handoff/capability/layer-capabilities.ts`
  - `reception.allowedSubstates = [idle, chatting, routing, dispatching, awaiting_downstream, failed, cancelled]`（**无 grilling**）
  - `pm1.allowedSubstates` **已含 `clarifying`**；`pm1.allowedInboundTypes` **已含 `clarification_answer`**
  - `reception.allowedInboundTypes` **已含 `user_input`**
  - pm1 内置指令 **已含 `request_clarification`**；reception **已含 `request_user_input`**
- inbound 类型：`services/agent-gateway/src/handoff/store/inbound-store.ts:25` → `InboundMessageType`（含 `clarification_answer`）
- 团队 UI：`apps/web/src/pages/team/runtime/tabs/tasks/ClarificationsPanel.tsx`（含测试）
- 前端事件：`apps/web/src/stores/team/team-events.ts`（`LayerNode` 用 `roleLayer` + `substate`）

### 3.5 ⚠️ 关键约束（决定 C 层设计）

`services/agent-gateway/src/session/session-tool-visibility.ts:238-260`：

```ts
// Team 成员 session 在后台运行，无法与用户交互——强制禁用 AskUserQuestion。
if (typeof metadata['teamWorkspaceId'] === 'string' || isRecord(metadata['teamRoleInstance'])) {
  return false;
}
```

**结论**：team session **不可能**使用 `question`/`AskUserQuestion` 工具。C 层必须走 `session_inbound_messages` 反向通道 + substate，**不能**复用 A 层的工具管道。这是本方案最重要的一条硬边界。

---

## 4. 缺口矩阵

| # | grill 纪律 | `clarify` 模式 | `question` 管道 | routing 引擎 | team 层 | 需要新增 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | 一轮问整个 frontier | ❌ 明确要求单维度 | 🟡 已支持多题，但未被要求用满 | ❌ 每轮 1 维度 | 🟡 单轮 | 策略 + 引擎 |
| G2 | 每题带推荐答案 | ❌ | ❌ 无字段 | ❌ | ❌ | `recommended` 字段 + UI |
| G3 | facts 派 subagent 不问用户 | ✅ 已一致 | n/a | ❌ | ❌ | 策略固化 |
| G4 | frontier 空才收口 | ❌ "能推断先假设" | ❌ 保守描述 | 🟡 `canProceedWithoutClarification` | ❌ | 引擎 + 策略 |
| G5 | 轮次态抗压缩/恢复 | ❌ | 🟡 表在，但无轮次态 | ❌ 纯内存 | ✅ inbound 持久化 | 持久化 |
| G6 | 结束需用户确认共识 | ❌ | ❌ | ❌ | ❌ | 门控（T-15 / V-16） |
| G7 | 决策树动态重算 | ❌ 固定 5 级阶梯 | n/a | ❌ 固定顺序 | ❌ | 引擎 |

---

## 5. 设计

### 5.1 架构原则：SSOT 单一事实来源

```
              ┌──────────────────────────────────────────────┐
              │  B. agent-core frontier 引擎（SSOT）          │
              │  context/clarification-tree.ts : 纯函数       │
              │  computeFrontier / applyAnswer / isFrontierEmpty │
              └───────────────┬──────────────────┬───────────┘
                              │                  │
              ┌───────────────▼──────┐   ┌───────▼──────────────────────┐
              │ A. 前台（chat）       │   │ C. team 层（handoff）        │
              │ clarify 模式 +        │   │ reception/pm1 substate +      │
              │ question 工具管道      │   │ session_inbound_messages      │
              │ （Session metadata 存态）│  │ （inbound payload 存态）      │
              └──────────────────────┘   └──────────────────────────────┘
```

**铁律**：frontier 计算只在 agent-core 实现一次；A 与 C 只负责传输与渲染，**不得各自实现澄清算法**（防止 `routing.ts` 与 gateway 再次漂移）。

### 5.2 B 层：frontier 引擎（新增，纯函数）

新增 `packages/agent-core/src/context/clarification-tree.ts`：

```ts
export type ClarificationNodeStatus = 'open' | 'settled' | 'blocked';

export interface ClarificationNode {
  id: string;                              // 稳定 id，用于跨轮引用与去重
  dimension: ClarificationDimension;        // 首期沿用既有 4 维，见 §5.7
  question: string;
  options: Array<{ label: string; description?: string; recommended?: boolean }>;
  dependsOn: string[];                      // 前置决策 node id
  status: ClarificationNodeStatus;
  answer?: string;
}

export interface GrillState {
  nodes: ClarificationNode[];
  round: number;
  history: Array<{ nodeId: string; answer: string; at: number }>;
  /** 用户显式确认"已达成共识"的时间戳；undefined = 尚未确认。见 G6 确认门控。 */
  confirmedAt?: number;
}

/** 前沿 = 所有 status=open 且 dependsOn 全部 settled 的节点。纯函数，无副作用。 */
export function computeFrontier(state: GrillState): ClarificationNode[];

/** 回答一个节点，级联把下游从 blocked 解锁为 open。返回新 state（不可变）。 */
export function applyAnswer(state: GrillState, nodeId: string, answer: string): GrillState;

/** frontier 为空 = 所有节点 settled。 */
export function isFrontierEmpty(state: GrillState): boolean;

/** G6 确认门控：决策树的终结节点 id。确认本身"就是树上的最后一个节点"，复用同一传输通道。 */
export const CONFIRM_NODE_ID = '__grill_confirm__';

/** G6 确认门控：frontier 只剩（或已空且未 settle）终结节点 → true。此时**必须停止推进，禁止进入执行**。 */
export function needsConfirmation(state: GrillState): boolean;

/** G6 确认门控：由 runner 在消费终结节点答案时调用，写入 confirmedAt。 */
export function confirmGrill(state: GrillState, at: number): GrillState;

/** 从 RoutingDecision 种子构造初始决策树（复用既有维度模板作为初始节点来源）。 */
export function seedFromRoutingDecision(decision: RoutingDecision, input: string): GrillState;

/** 序列化/反序列化（供 session metadata / inbound payload 持久化）。 */
export function serializeGrillState(state: GrillState): string;
export function parseGrillState(json: string): GrillState | null;
```

**G6 确认门控（硬约束，含协议定稿）**：

确认**不引入新消息类型**——它是决策树上的**终结节点**（`CONFIRM_NODE_ID`，`dimension='acceptance'`，受同一 `computeFrontier`/`applyAnswer` 管辖）。因此确认走**与普通澄清答案完全相同的通道**：

| | A 层（chat / clarify） | C 层（team reception / pm1） |
| --- | --- | --- |
| 传输 | `question` 工具（`AskUserQuestion`）一次性问"以上共识是否确认？"，选项 `确认 / 需修改` | `clarification_answer` inbound，payload `{ nodeId: CONFIRM_NODE_ID, roundNumber, answer: 'confirmed' \| 'rejected' }` |
| 状态 | 保持当前 substate，不推进 | substate 置 **`awaiting_confirmation`**（新增白名单值，见 §5.4/T-09），**不使用** `paused`（`paused` 是 session 级列，仅用于用户主动暂停，与确认门控正交） |
| 解锁 | 用户确认后 → `confirmGrill()` 由 runner 调用，随后可执行 | 收到 `answer:'confirmed'` → runner 调 `confirmGrill()` → 才 `drafting_plan`/`dispatching` |
| 拒绝 | `answer:'rejected'` → 该节点回落 `open`，重算 frontier，继续提问 | 同左 |

**确认判定（引擎实现）**：确认节点视为"已确认"的条件是——答案为字面量 `confirmed`，**或**答案等于该题中标记 `recommended: true` 的选项标签（UI/路由传的是选项标签，如"确认"）。二者皆不满足则不结算、不写 `confirmedAt`。（此条为 T-14 编写验收脚本时暴露并修复的真实缺陷：原实现只认字面量 `confirmed`，导致实操中永远无法确认。）

`needsConfirmation(state) === true` 时，A 与 C **都不得产生任何执行副作用**（无 write / 无 handoff / 无 dispatch）。未确认的 grill 视为**未完成**。

**兼容策略**：`routing.ts` 的 `evaluate` / `recordClarification` / `canProceedWithoutClarification` **保留导出**（已有 2 处调用），内部改为委托引擎；新增 `@deprecated` JSDoc 指向新引擎。首期不动 `ClarificationDimension` 枚举。

**推荐答案生成**：新增 `packages/agent-core/src/context/clarification-recommendation.ts`（纯函数或 prompt builder），把"给出推荐答案"从 LLM 自由发挥收敛为可测的输入契约（`options[].recommended` 至多一个为 true）。

### 5.3 A 层：`clarify` 模式 grill 化

1. **schema 扩展**（`question-tools.ts`）：
   - `questionOptionSchema` 增 `recommended: z.boolean().optional()`
   - `questionItemSchema` 增 `nodeId: z.string().optional()`、`round: z.number().int().optional()`
   - 描述改写：由"仅当阻塞时使用"改为**模式相关**——clarify 模式下 frontend 要求"一轮问整个 frontier，每题必带推荐答案；frontier 空才收口"
2. **提示词改写**（`stream-system-prompts.ts` 的 `DIALOGUE_MODE_SYSTEM_PROMPTS.clarify`）：
   - 删除/改写"每次提问聚焦一个维度"
   - 新增 frontier 语义、推荐答案要求、facts-via-subagent、结束需用户确认
   - 保留只读约束与"产出方案文档"定位
3. **轮次态持久化**：写入 `sessions.metadata_json.clarificationState`（复用既有 metadata 字段，**不新增表**）；键名 `clarificationState`，值 = `serializeGrillState(...)`
   - 兜底：`question_requests` 增 `round_number INTEGER`（用既有 `ensureColumn` 模式，`db.ts:697`）——**仅用于审计/排序**，不作 SSOT
4. **前端**：`InlineQuestionPanel` 增"推荐"徽标（`recommended === true` 的选项置首 + 视觉标记）；渲染题目编号 `Q1/Q2...` 与轮次分组
   - ⚠️ 注意 `question-label-truncator.ts` 的 30 字符上限：推荐徽标不入 label，走独立字段，避免被截断

### 5.4 C 层：team 层多轮 frontier

**硬约束**：不得使用 `question` 工具（§3.5），走 inbound 通道。

1. **substate 白名单扩展**（`layer-capabilities.ts`）：
   - `reception.allowedSubstates` 增 `'grilling'` 与 `'awaiting_confirmation'`
   - `pm1.allowedSubstates` 已有 `'clarifying'`（语义扩展为多轮，不改名）+ 增 `'awaiting_confirmation'`
   - ⚠️ **不**新增 `'paused'` 到任何白名单——`paused` 是 `sessions.paused` 列，由 scheduler 管理，与 substate 白名单无关（见 §5.2 确认门控表）
2. **inbound 承载轮次**：`clarification_answer` payload 增 `{ nodeId, roundNumber, answer }`
   - 幂等：`inbound-store.ts` 已要求"同一 message_id 消费多次不产生副作用"，`nodeId` 作为幂等键的一部分
   - 每轮 b 重新计算 frontier（调 agent-core 引擎）并可推多个 `clarification_needed`
3. **reception 编排**：`handoff/runner/reception-router.ts` 增加"grill 分支"——高影响意图（R2/R3）优先进入 `grilling` substate，而非直接 `routing→dispatching`
   - 复用既有内置指令 `request_user_input`（reception）
4. **pm1 编排**：`handoff/runner/artifact-chain.ts` 的 `clarification_answer` 消费点扩展为循环：每轮 answers 后重算 frontier；空则进入 `drafting_plan`
   - 复用既有内置指令 `request_clarification`（pm1）
5. **团队 UI**：`ClarificationsPanel.tsx` 增轮次分组与推荐徽标；`team-events.ts` 的 `LayerNode.substate` 已能表达 `grilling`/`clarifying`，无需改结构

**实现补充（加固轮，2026-09-14）**：

6. **中文高影响检测**：`evaluate` 的关键词为英文，中文产品下 grill 不会触发 → `shouldGrillIntent` 增补保守的中文高影响模式（`重构|重写|架构级|跨系统|全量迁移|迁移到|数据迁移|删库|清空数据|删除生产|删除线上|不可逆|破坏性|生产环境|线上环境`），**不误伤** light 只读提问（如"了解一下架构"）。未改动 agent-core 既有行为。
7. **激活条件收紧**：reception grill 预检要求 `clarificationIntent` **必须存在**——避免与 A 层（`routes/questions.ts`）写入的同名 `clarificationState` 互相干扰。
8. **重入守卫**：grill 启动分支必须 `!input.__skipGrill`；否则确认后按锁定意图重入时 `decision` 仍为 `grill`，会重启拷问、**永不派发**。
9. **新节点合并**：A 层状态在首轮固定决策树；后续轮次出现的新 `nodeId` 必须合并进状态并重建确认节点依赖（保留既有确认答案），否则该答案被 `applyAnswer` 静默丢弃。

### 5.5 数据模型改动汇总

| 位置 | 改动 | 迁移方式 |
| --- | --- | --- |
| `sessions.metadata_json` | 新增键 `clarificationState`（序列化 `GrillState`） | 无需迁移（JSON 字段） |
| `question_requests` | 新增列 `round_number INTEGER` | `ensureColumn`（既有模式） |
| `question_requests.questions_json` | `options[].recommended` 可选字段 | 向后兼容（可选） |
| `session_inbound_messages.payload_json` | `{ nodeId, roundNumber, answer }` | 向后兼容（可选字段） |
| `layer-capabilities.ts` | reception 增 `'grilling'` / `'awaiting_confirmation'`；pm1 增 `'awaiting_confirmation'` | 代码改动，无 DB 迁移 |

**不新增任何表、不新增任何 RunEvent 类型。**

### 5.6 UI 改动

| 组件 | 文件 | 改动 |
| --- | --- | --- |
| `InlineQuestionPanel` | `apps/web/src/components/chat/misc/InlineQuestionPanel.tsx` | 推荐徽标 + `Q1/Q2` 编号 + 轮次分组 |
| `DialogueModeToggle` / 模式说明 | `apps/web/src/pages/chat-page/mode/dialogue-mode.ts` | 澄清模式 `details` 文案对齐 grill 语义 |
| `ClarificationsPanel` | `apps/web/src/pages/team/runtime/tabs/tasks/ClarificationsPanel.tsx` | 轮次分组 + 推荐徽标 |

UI 必须加载 `frontend` skill 并遵守 `packages/shared-ui/DESIGN-TOKENS.md`（E·Nebula token，禁止硬编码色值）。

### 5.7 关于维度扩展（**本期不做**）

`ClarificationDimension` 现为 4 维（goal/constraint/deliverable/acceptance）。grill 场景可能需要 `tradeoff`/`risk`/`scope`。但新增维度会连带影响 capability 矩阵、团队层白名单与 UI。**本期保持 4 维**，维度扩展单独立项（见 §8 开放问题 Q3）。

---

## 6. 分期与任务

### 6.1 依赖图

```
Phase 0 测试基线锁定（characterization tests：T-00）
        │
        ▼
Phase 1（B）frontier 引擎 + 单测 ────────────────────────┐
   T-01 → T-02 → T-03                                   │
        │                                               │
        ├──► Phase 2（A）前台 clarify grill 化  ◄───────┘  （A 消费 B）
        │      T-04 → T-05 → T-06 → { T-07, T-08 }
        │
        ├──► Phase 3（C）team 层多轮  ◄──────────────────  （C 消费 B）
        │      T-09 → T-10 → T-11 → T-12 → T-13
        │
        └──► T-15（G6 确认门控，横跨 A/C）──► T-14 端到端验收
```

**排序说明**：先做 B 再做 A，是为了避免"先用提示词凑、再被引擎推翻"的返工；B 无用户可见效果但它是 SSOT。若追求快速可见收益，可将 Phase 2 的 **提示词部分**（不含持久化）提前，但与引擎并行、以 §5.1 铁律约束不实现算法。

### 6.2 任务表

| ID | 阶段 | 任务 | 关键文件 | 依赖 | 验证项 |
| --- | --- | --- | --- | --- | --- |
| T-00 | 0 | routing.ts 特征化测试（锁定现行为） | `packages/agent-core/src/context/routing.test.ts` | — | V-01 |
| T-01 | 1 | 新增 `clarification-tree.ts`（frontier 纯函数） | `packages/agent-core/src/context/clarification-tree.ts` | T-00 | V-02 |
| T-02 | 1 | 推荐答案契约 | `clarification-recommendation.ts` | T-01 | V-03 |
| T-03 | 1 | routing.ts 新增全量模板构建器 `buildClarificationQuestions` + 弃用 legacy 澄清 API（**行为不变**） | `context/routing.ts`、`index.ts` | T-01 | V-04 |
| T-04 | 2 | `question` schema 增 `recommended`/`nodeId`/`round` | `tools/question-tools.ts` | T-02 | V-05 |
| T-05 | 2 | clarify 提示词改写（frontier 纪律） | `routes/stream-system-prompts.ts` | T-02 | V-06 |
| T-06 | 2 | 轮次态持久化到 session metadata | `routes/stream.ts`、`session/session-workspace-metadata.ts` | T-03 | V-07 |
| T-07 | 2 | 前端推荐徽标 + 轮次分组 | `InlineQuestionPanel` 等 | T-04,T-06 | V-08 |
| T-08 | 2 | `question_requests.round_number` | `infra/db.ts` | T-04 | V-09 |
| T-09 | 3 | substate 白名单：reception 增 `grilling`/`awaiting_confirmation`；pm1 增 `awaiting_confirmation` | `handoff/capability/layer-capabilities.ts` | T-03 | V-10 |
| T-10 | 3 | inbound payload 轮次 + 幂等 | `handoff/store/inbound-store.ts`、`routes/team-inbound.ts` | T-09 | V-11 |
| T-11 | 3 | reception grill 分支 | `handoff/runner/reception-router.ts` | T-09 | V-12 |
| T-12 | 3 | pm1 多轮 clarify 循环 | `handoff/runner/artifact-chain.ts` | T-10 | V-13 |
| T-13 | 3 | 团队 UI 轮次分组 | `ClarificationsPanel.tsx` | T-10 | V-14 |
| T-14 | 3 | 端到端验收 | `services/agent-gateway/src/verification/verify-*.ts` | 全部（含 T-15） | V-15 |
| T-15 | 1+3 | **G6 共识确认门控**（A 前台 + C team） | `clarification-tree.ts`、`stream-system-prompts.ts`、`reception-router.ts` / `artifact-chain.ts` | T-01,T-06,T-10 | V-16 |

### 6.3 QA 契约（每任务可执行验证 — Momus 阻断项修复）

> 约定：`<AC>` = agent-core；`<GW>` = agent-gateway；`<WEB>` = apps/web。
> 所有命令在仓库根执行。新增测试文件路径为**建议命名**，实现时按同目录既有约定落位。

| 验证项 | 命令 | 步骤 | 通过判定（Pass） |
| --- | --- | --- | --- |
| **V-01** (T-00) | `pnpm --filter @openAwork/agent-core exec vitest run src/context/routing.test.ts` | 对 `evaluate` 用 R0/R1/R2/R3 各 1 输入；`recordClarification` 累积至上限；`canProceedWithoutClarification` 正反例，逐一断言 | vitest 全绿；该文件在 **T-03 改造前**建立基线，改造后**同一文件仍全绿**（兼容性证明） |
| **V-02** (T-01) | `pnpm --filter @openAwork/agent-core exec vitest run src/__tests__/clarification-tree.test.ts` | 构造 3 层依赖树：断言 `computeFrontier` 只返回 `open` 且 `dependsOn` 全 `settled` 的节点；`applyAnswer` 级联解锁下游；`isFrontierEmpty` 真/假；深比较输入对象未被 mutate | 全部断言通过；不可变性断言通过 |
| **V-03** (T-02) | `pnpm --filter @openAwork/agent-core exec vitest run src/__tests__/clarification-recommendation.test.ts` | 构造多选项题目，断言每题 `recommended===true` 至多 1 个；无可推荐时输出确定性缺省（不抛错） | 全部断言通过 |
| **V-04** (T-03) | `pnpm --filter @openAwork/agent-core test && pnpm typecheck` | 跑 agent-core 全量单测（含 V-01）+ 全仓类型检查 | agent-core 测试全绿（V-01 未被破坏）；`pnpm typecheck` exit 0 |
| **V-05** (T-04) | `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/tools/question-tools.test.ts` | parse 含 `recommended`/`nodeId`/`round` 的输入；再 parse **不含**这些字段的旧输入 | 新输入通过校验；旧输入同样通过（向后兼容）；非法类型被拒 |
| **V-06** (T-05) | `pnpm --filter @openAwork/agent-gateway run test:verification` + 本地手工 | ① 先跑既有 verification 全绿；② 手工验收（**走 Web UI**）：`pnpm --filter @openAwork/agent-gateway dev` + `pnpm --filter @openAwork/web dev` → 浏览器开 `/chat` → 顶部 `DialogueModeToggle` 选中"澄清" → 输入高影响需求，例：「把所有会话数据迁移到 Postgres 并删除 SQLite 实现」→ 等首轮回复。③ 备选纯 HTTP 路径：`POST /sessions/:id/stream`（body `dialogueMode:'clarify'`），观察 `question_asked` 事件，再 `GET /sessions/:id/questions/pending` 取全量题目 | ① 既有 verification 全绿（无回归）；② 首轮返回问题卡片数 ≥2（frontier 批量），每题含"推荐"项，且**不**直接产出完整方案或代码；③ pending 列表返回的 `questions[]` 中每题 ≥1 个 `recommended:true` 选项 |
| **V-07** (T-06) | `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session/clarification-state-persistence.test.ts` | 触发一轮 clarify 后查 `sessions.metadata_json.clarificationState`；用 `parseGrillState` 解析；模拟压缩/重载后再解析 | 键已写入、可解析、轮次与已答节点完整；重载后 `computeFrontier` 结果一致 |
| **V-08** (T-07) | `pnpm --filter @openAwork/web exec vitest run src/components/chat/misc/InlineQuestionPanel.test.tsx` | 渲染含 `recommended` 的题目；断言推荐项置首且有徽标、`Q1/Q2` 编号正确、轮次分组正确 | 断言通过；另跑 `pnpm --filter @openAwork/web test` 无新增失败 |
| **V-09** (T-08) | `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/infra/db-question-round.test.ts` | 在旧结构 DB 上跑 `migrate()`；断言 `round_number` 列存在且历史行默认 NULL；重复 migrate 幂等 | 列存在、旧行可读、二次 migrate 无副作用 |
| **V-10** (T-09) | `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/handoff/layer-capabilities.test.ts` | 断言 reception 可 `setSubstate('grilling')` 与 `setSubstate('awaiting_confirmation')`；pm1 可 `setSubstate('clarifying')` 与 `'awaiting_confirmation'`；非法值（如 reception 写 `reviewing`、任意层写 `'paused'`）仍被 `assertSubstateAllowed` 拒绝 | 合法值放行、非法值（含 `'paused'`）拒绝，均断言通过 |
| **V-11** (T-10) | `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/handoff/inbound-round.test.ts` | 用**相同 `clientIdempotencyKey`** 调用 `submitInboundMessage()` 两次（payload `{nodeId,roundNumber,answer}`）；再查 `SELECT COUNT(*) FROM session_inbound_messages WHERE client_idempotency_key = ?` | 首次返回 `reused:false` 且新增 1 行；二次返回 `reused:true` 且该 key 仍只有 1 行（无副作用）；payload 中 `nodeId`/`roundNumber` 可正确解析 |
| **V-12** (T-11) | `pnpm --filter @openAwork/agent-gateway run verify -- src/verification/verify-team-grill-reception.ts` | 高影响输入 → 断言 substate=`grilling` 且发出 ≥1 `clarification_needed`；低影响输入 → 断言**不**进 `grilling` | 两类断言均通过 |
| **V-13** (T-12) | `pnpm --filter @openAwork/agent-gateway run verify -- src/verification/verify-team-pm1-multiround.ts` | 注入两轮 `clarification_answer`；记录 session id；随后**只让 frontier 变空、不发确认**，观察状态；再发 `clarification_answer` 且 payload `{ nodeId: '__grill_confirm__', roundNumber, answer: 'confirmed' }` | frontier 空但**未确认**时：substate = `awaiting_confirmation`，**不**进入 `drafting_plan`，且无执行副作用；收到 `'confirmed'` 后才进入 `drafting_plan`；`answer:'rejected'` 时终结节点回落 `open` 并重新提问；session id **前后一致**（未重启） |
| **V-14** (T-13) | `pnpm --filter @openAwork/web exec vitest run src/pages/team/runtime/tabs/tasks/ClarificationsPanel.test.tsx` | 渲染多轮澄清数据 | 轮次分组、推荐徽标断言通过 |
| **V-15** (T-14) | `pnpm --filter @openAwork/agent-gateway run test:verification && pnpm typecheck && pnpm lint && pnpm test` | 新增 `src/verification/verify-grill-end-to-end.ts`：完整 grill 往返（含**确认门控**：frontier 空但未确认仍暂停、确认后才推进）；grill 进行中 `pause_signal`/`cancel_signal` 不破语义；压缩后恢复 | 新增验收脚本 pass；frontier 空但未确认时**不产生任何执行副作用**（无 write/handoff）；确认后才推进；既有 `test:verification` 全绿；`typecheck`/`lint`/`test` 全绿；暂停不影响 a-b 同步对话（§7 不变量） |
| **V-16** (T-15) | `pnpm --filter @openAwork/agent-core exec vitest run src/__tests__/clarification-confirm-gate.test.ts` | 断言 `needsConfirmation`：frontier 非空→false；frontier 空且 `confirmedAt` 未设→true；`confirmGrill` 后→false。并断言 A/C 调用点在 `needsConfirmation===true` 时不推进（单测桩） | 三个真值断言通过；`confirmGrill` 写入 `confirmedAt`；序列化/反序列化后 `confirmedAt` 保留 |

---

## 7. 验证策略

> **可执行验证契约以 §6.3（V-01..V-16）为准**——每项含具体命令、步骤与通过判定。本节只说明分层原则。

| 层 | 手段 | 说明 | 对应验证项 |
| --- | --- | --- | --- |
| agent-core | Vitest 单测 | `computeFrontier`/`applyAnswer`/`isFrontierEmpty`/`needsConfirmation`/`confirmGrill` 的依赖解锁、级联、幂等、不可变性、确认门控；**先锁特征化测试再重构** | V-01..V-04、V-16 |
| gateway | `src/verification/verify-*.ts` | question 提问→暂停→回复→恢复链路；轮次态跨恢复不丢 | V-05..V-07、V-09 |
| team | verification 脚本 | reception `grilling` → inbound 往返 → pm1 `clarifying` 多轮 → `drafting_plan` | V-10..V-13 |
| web | component test | 推荐徽标渲染、轮次分组、空态/加载态 | V-08、V-14 |
| 全量 | `pnpm typecheck && pnpm lint && pnpm test` | 提交前 | V-15 |

**取消/暂停回归**：grill 多轮不得破坏 `pause`/`cancel` 语义（`docs/architecture/team-interaction-flow-v3.11.md` §2 关键不变量："pause 不影响 a-b 同步对话"）。T-14 必须覆盖"grill 进行中用户暂停/取消"。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | 两套澄清逻辑漂移（routing.ts vs gateway） | 高 | §5.1 SSOT 铁律；A/C 禁止实现算法；code review checklist |
| R2 | `routing.ts` 无测试，改造易回归 | 高 | T-00 先补特征化测试，再重构（Test → Refactor） |
| R3 | team 层 grilling 破坏"不重启 session"原则 | 高 | 复用既有 inbound 非重启通道（`session_inbound_messages`）；T-14 验收 |
| R4 | 轮次态在压缩/恢复后丢失 | 中 | 持久化到 `sessions.metadata_json`；T-14 覆盖压缩后恢复 |
| R5 | grill 过于打扰，用户体验劣化 | 中 | 仅高影响意图（R2/R3）触发 grill；保留 `clarify` 与 `coding` 模式分离；提供"直接给方案"逃生口 |
| R6 | `question_requests` schema 变更破坏历史数据 | 中 | 全部新字段可选 + `ensureColumn`；解析层容忍缺失 |
| R7 | 推荐答案被 30 字符截断器误伤 | 低 | 推荐标记走独立字段，不进 `label` |
| R8 | 多轮导致 token/成本上升 | 中 | frontier 一次问多题（轮数减少）；普通任务不触发 |
| R9 | 破坏 `CLARIFY_MODE_ALLOWED_TOOLS` 只读不变量 | 中 | 不改该集合（已含 `question`/`task`）；新增能力不改门控 |

---

## 9. 非目标（Out of Scope）

- ❌ 不新增数据库表、不新增 RunEvent 类型。
- ❌ 不改 `handoff_records` 协议与五层拓扑（`a→b→c→d→e/f/g` 不动）。
- ❌ 不把 grill 塞进 `packages/multi-agent` 的 DAG 编排（那是执行控制面，非用户对话入口）。
- ❌ 不扩展 `ClarificationDimension` 枚举（本期保持 4 维）。
- ❌ 不做"技能 Manifest 自动生成 slash command"（现有 slash command 为静态注册表 `routes/command-descriptors.ts`）。
- ❌ 不改 `question` 工具在 team session 的硬禁用（§3.5 是刻意设计）。

## 10. 开放问题（已拍板，见 §11 审批门；「倾向」列为最终决议）

| # | 问题 | 备选 | 倾向 |
| --- | --- | --- | --- |
| Q1 | grill 是"新模式"还是"`clarify` 模式的升级"？ | (a) 新增 `DialogueMode='grill'`；(b) 升级现有 `clarify`；(c) clarify 内加强度开关 | **(b)+(c)**：默认 clarify 即含 grill 纪律，高影响任务自动升级；不新增枚举以免牵动 `DialogueMode`/UI/设置三处 |
| Q2 | 分期顺序：B→A→C 还是 A→B→C？ | B 先行（防返工，但无可见收益） / A 先行（快见效果，有返工风险） | **B→A→C**（§6.1） |
| Q3 | 是否需要 `tradeoff`/`risk` 新维度？ | 本期否 / 单独立项 | **单独立项** |
| Q4 | team 层 grill 由 reception 还是 pm1 主导？ | reception（承诺方案前） / pm1（spec 后） | **reception 为主**（对齐 grill-me"承诺前"语义），pm1 保留现有 `clarifying` |
| Q5 | 是否交付为可安装 Skill（`SKILL.md`）？ | 是（走 `system-skills.ts` 发现） / 否（内建模式） | **否**：核心价值在算法与管道，非提示词；可作为后续增强 |

## 11. 审批门（实现前必须通过）

- [x] 范围（A+B+C）与分期顺序确认（用户："感觉都可以，a b c"）
- [x] §10 五个开放问题拍板（按文档默认倾向执行）
- [x] §8 风险缓解被评审接受（Momus OKAY）
- [x] T-00 特征化测试基线先落地（编码前）—— 已完成，21 例
- [x] UI 相关任务加载 `frontend` skill 并附视觉自查（T-07/T-13 已加载 `frontend` skill，遵循 `--contrast`/`--accent` 等设计 token，未硬编码色值；组件测试覆盖）
- [x] T-12 补齐（pm1 frontier 多轮 + 确认门控）—— 2026-09-16，见 §12.3
- [x] V-13 验收脚本落地并实跑通过 —— 2026-09-16，见 §12.5
- [~] V-06：**可自动化部分已闭环**（pending 列表契约断言已入 `verify-grill-end-to-end.ts`，见 §13.4）；「活体 LLM + 浏览器」人工视觉走查因本机 `AI_API_KEY` 为空而不可执行 —— 见 §12.6 L1 / §13.4

---

## 12. 完成核对附录（2026-09-16）

> 目的：把「已完成 / 未完成」逐项对齐到代码证据，并记录 2026-09-16 补齐 T-12/V-13 时的实测结果与偏差。

### 12.1 任务台账（T-00 … T-15）

| ID | 状态 | 落地证据 |
| --- | --- | --- |
| T-00 | ✅ 完成 | `packages/agent-core/src/context/routing.test.ts`（特征化基线） |
| T-01 | ✅ 完成 | `packages/agent-core/src/context/clarification-tree.ts` + `clarification-tree.test.ts` |
| T-02 | ✅ 完成 | `packages/agent-core/src/context/clarification-recommendation.ts` + `.test.ts` |
| T-03 | ✅ 完成 | `context/routing.ts:189 buildClarificationQuestions`、`:193 @deprecated` 委托注释 |
| T-04 | ✅ 完成 | `services/agent-gateway/src/tools/question-tools.ts:9/17/18`（`recommended`/`nodeId`/`round`） |
| T-05 | ✅ 完成 | `src/routes/stream-system-prompts.ts:82-123`（frontier 纪律 + `__grill_confirm__`） |
| T-06 | ✅ 完成 | `src/session/session-workspace-metadata.ts:139-145`（`clarificationState` + zod refine） |
| T-07 | ✅ 完成 | `apps/web/src/components/chat/misc/InlineQuestionPanel.tsx:480-495` + 组件测试 |
| T-08 | ✅ 完成 | `src/infra/db.ts:728 ensureColumn('question_requests','round_number','INTEGER')` |
| T-09 | ✅ 完成 | `src/handoff/capability/layer-capabilities.ts:107-108`（reception `grilling`/`awaiting_confirmation`）、`:143`（pm1 `awaiting_confirmation`） |
| T-10 | ✅ 完成（本轮补齐消费者） | `src/handoff/store/inbound-store.ts:642-677` `parseGrillClarificationAnswerPayload`（`questionId` 复用为决策树节点 id + 可选 `roundNumber`）+ 9 例测试；**本轮**让生产消费者落地：`artifact-chain.ts` 的 `extractClarificationAnswer` 改走该解析器 |
| T-11 | ✅ 完成（本轮解耦层级） | `src/handoff/runner/reception-router.ts` grill 分支 + `reception-grill-runner.ts` + `verify-team-grill-reception.ts`；**本轮**把 `shouldGrillIntent` 下沉到 `src/handoff/capability/grill-intent.ts`（c 层需要复用它，直连 b 层 runner 违反跨层禁令） |
| T-12 | ✅ **本轮实现** | 新增 `src/handoff/runner/pm1-grill-runner.ts`；`artifact-chain.ts` Step 2 重写为「frontier 多轮 + 确认门控」 |
| T-13 | ✅ 完成 | `apps/web/src/pages/team/runtime/tabs/tasks/ClarificationsPanel.tsx:195-204`（轮次分组）+ 测试 |
| T-14 | ✅ 完成 | `src/verification/verify-grill-end-to-end.ts` |
| T-15 | ✅ 完成（本轮补齐 pm1 段） | A 层：`src/routes/session-dialogue-mode.ts:85-102`（`confirmGrill` 合流写入）；C 层 reception：`reception-grill-runner.ts:106-133`；**本轮**补 C 层 pm1：`artifact-chain.ts` 在 frontier 空后进 `awaiting_confirmation`，仅 `confirmedAt` 落定才进 `drafting_plan` |

### 12.2 验证项台账（V-01 … V-16）

| 验证项 | 状态 | 实际落点（与 §6.3「建议命名」的差异见 §12.4） |
| --- | --- | --- |
| V-01 | ✅ | `packages/agent-core/src/context/routing.test.ts` |
| V-02 | ✅ | `packages/agent-core/src/context/clarification-tree.test.ts` |
| V-03 | ✅ | `packages/agent-core/src/context/clarification-recommendation.test.ts` |
| V-04 | ✅ | agent-core 全量：33 文件 / 397 测试全绿；网关 `typecheck` exit 0 |
| V-05 | ✅ | `services/agent-gateway/src/__tests__/tools/question-tools.test.ts` |
| V-06 | ⚠️ 部分 | 自动化链路（`test:verification` / `test:grill`）全绿；**浏览器手工验收未执行**（见 §12.6） |
| V-07 | ✅ | `src/__tests__/session/clarification-state-metadata.test.ts` |
| V-08 | ✅ | `apps/web/src/components/chat/misc/InlineQuestionPanel.test.tsx` |
| V-09 | ✅ | `src/__tests__/infra/question-requests-round-number.test.ts` |
| V-10 | ✅ | `src/__tests__/handoff/layer-capabilities.test.ts` |
| V-11 | ✅（由既有用例覆盖） | `src/__tests__/handoff/inbound-store.test.ts`：`submitInboundMessage` 幂等（`reused:true`）+ `parseGrillClarificationAnswerPayload` 9 例 |
| V-12 | ✅ | `src/verification/verify-team-grill-reception.ts` |
| V-13 | ✅ **本轮新增** | `src/verification/verify-team-pm1-multiround.ts`，脚本输出 `verify-team-pm1-multiround: ok` |
| V-14 | ✅ | `apps/web/src/pages/team/runtime/tabs/tasks/ClarificationsPanel.test.tsx` |
| V-15 | ✅ | `verify-grill-end-to-end.ts` + 网关全量单测 + `typecheck` + ESLint |
| V-16 | ✅（落点不同） | 确认门控用例位于 `packages/agent-core/src/context/clarification-tree.test.ts:122-201`（`needsConfirmation` / `confirmGrill` / 肯定文案归一化） |

### 12.3 本轮（2026-09-16）补齐的实现

1. **新增 `src/handoff/capability/grill-intent.ts`**：`shouldGrillIntent` 从 `reception-router` 下沉，b/c 两层共用；`reception-router` 保留同名 re-export，既有调用方与测试无需改动。
2. **新增 `src/handoff/runner/pm1-grill-runner.ts`**：`buildPm1GrillSeed` / `readPm1GrillTask` / `persistPm1Grill` / `clearPm1Grill` / `frontierToQuestions` / `applyPm1GrillAnswers` / `formatSettledAnswers` / `confirmTransportQuestionId` / `toEngineNodeId`。所有前沿/级联/确认判定均委托 agent-core 引擎，网关侧不实现澄清算法（§5.1 SSOT 铁律）。
3. **重写 `artifact-chain.ts` Step 2**：由「解析 spec 的 `[NEEDS CLARIFICATION]` 后按 `answeredIds` 单轮认领」改为引擎驱动的 frontier 多轮 + 确认门控（详见 §12.7 复审修复）。
4. **`extractClarificationAnswer` 接入 `parseGrillClarificationAnswerPayload`**：T-10 的解析器从「无生产消费者」变为真实链路消费者；旧的纯文本载荷（无 `questionId`）保留兜底分支。
5. **新增 `src/verification/verify-team-pm1-multiround.ts`（V-13）** 并接入 `package.json` 的 `test:grill-pm1` 与 `test:verification` 链。
6. **agent-core `CLARIFICATION_TEMPLATES` 中文化**（`context/routing.ts`）：4 个维度的题面/选项/描述由英文改为中文，供 reception grill 与 pm1 grill 共用；选项顺序语义（**首项即推荐**）在两个消费方保持一致。

### 12.4 与计划的偏差（均已落地验证）

| # | 偏差 | 原因 |
| --- | --- | --- |
| D1 | **grill 触发条件收窄**为「spec 标记了 `[NEEDS CLARIFICATION]` **或** 原始/改写意图命中高影响（`shouldGrillIntent`）」，而非「pm1 每次都 grill」 | 字面「always 4 维」会破坏 `team-b-c-integration.test.ts:413` 对无标记 spec 的精确 substate 序列契约（`drafting_spec→spec_ready→drafting_plan→…`），并使每个团队任务固定多 5 轮阻塞、与 reception 的 grill 叠加成双重拷问；且与本文档 §8 R5「仅高影响意图（R2/R3）触发 grill」冲突 |
| D2 | `shouldGrillIntent` 下沉到 `handoff/capability/grill-intent.ts` | c 层（`artifact-chain`）直接 import b 层 runner（`reception-router`）会触发 `team-architecture/no-cross-layer-runner-import` |
| D3 | 若干验证项实际文件路径 ≠ §6.3 的「建议命名」（V-07/V-09/V-11/V-16） | §6.3 已注明为建议命名，实现按同目录既有约定落地 |
| D4 | T-10 的 `nodeId` 复用既有 `questionId` 字段承载，未新增独立字段 | 既有实现即如此设计（`inbound-store.ts:648-651` 注释："复用既有 `questionId` 字段作为决策树节点 id，仅新增 `roundNumber`，避免引入第二套 id"）；本轮沿用并在 §5.4 语义下补齐消费者 |
| D5 | **确认轮超时语义收紧**：非确认轮超时仍「按保守默认继续」，确认轮超时改为**抛 `PlanningFailure`（不得产出 plan）** | §5.2 硬约束「`needsConfirmation === true` 时 A/C 不得产生任何执行副作用；未确认的 grill 视为未完成」；原实现会静默放行，构成 G6 违反 |
| D6 | **确认题的传输 id 轮次化**（`__grill_confirm__@r<n>`，消费时归一化剥离后缀） | 前端 `useClarificationStore.push` / `replaceFromRuntime` 按 `id` 去重（历史实现每轮用随机 uuid 故不冲突）。稳定 id 会被去重 → 驳回后重提的确认题不渲染 → 用户无法再确认。普通节点只问一次（未答项在前端保持 pending），无需后缀 |
| D7 | **轮次态改为「成功后保留」**（不再收口即清空），仅取消时清空 | G5「抗压缩/恢复」要求运行开始时可恢复已答节点；且质量评审退回的重规划需沿用原答案作为 plan 上下文。为避免重复提问，恢复以「意图一致」为门 |

### 12.5 验证证据（2026-09-16 实跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @openAwork/agent-core test` | 33 文件 / **397 通过**，0 失败 |
| `pnpm --filter @openAwork/agent-gateway run test:unit --hookTimeout=90000 --testTimeout=60000` | 456 文件 / **3248 通过**（2 skipped），0 失败 |
| `pnpm --filter @openAwork/agent-gateway run test:grill` | `verify-grill-end-to-end: ok` |
| `pnpm --filter @openAwork/agent-gateway run test:grill-reception` | `verify-team-grill-reception: ok` |
| `pnpm --filter @openAwork/agent-gateway run test:grill-pm1` | `verify-team-pm1-multiround: ok` |
| `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/handoff/artifact-chain.test.ts` | **16 通过**（含 3 条本轮新增：确认轮超时必失败、同意图已确认不再提问、质量退回不再 grill） |
| `pnpm --filter @openAwork/web exec vitest run src/pages/team/runtime/tabs/tasks/ClarificationsPanel.test.tsx src/stores/team/team-events.test.ts` | 2 文件 / **36 通过**（含 7 条结构化选项用例） |
| `pnpm --filter @openAwork/agent-gateway run typecheck` | exit 0 |
| `pnpm exec eslint <本轮全部改动文件>` | exit 0，无告警 |
| `pnpm run lint:rules` | `no-cross-layer-runner-import: all RuleTester cases passed` |

> 注 1：`test:unit` 与目录级批量运行建议带 `--hookTimeout=90000`——本机 `beforeAll` 内 `await import()` + `migrate()` 在并行负载下会超过 vitest 默认 10s，属环境耗时而非用例缺陷。
> 注 2：另有 2 个与本改动无关的用例（`codegraph-e2e`、`feishu-channel-tools`）在**默认 5s `testTimeout`** 下会因本机负载超时；单独加长超时运行 `5/5 通过`，判定为环境抖动。

### 12.6 未执行 / 遗留

| # | 项 | 说明 |
| --- | --- | --- |
| L1 | **V-06 的「活体 LLM + 浏览器」实操** | 本环境 `.env` 的 `AI_API_KEY` 为空，**无法**让模型真实产出 `AskUserQuestion` 卡片，故这一段人工走查不可执行（详见 §13.4）。V-06 中可自动化的部分已补齐断言（§13.4） |
| L2 | **§10 Q3 维度扩展** | 仍按原决议「单独立项」，本期保持 4 维 |
| L3 | ~~`prefers-reduced-motion`~~ | **已关闭**（§13.4） |

---

## 13. 复审（2026-09-16）：对 §12 调整的独立复核与修复

> 触发：用户要求「检查这个方案的调整」。方式：逐条复核代码路径（前端回传载荷、substate 语义、持久化消费者、触发 intent 来源），并核实测试隔离与失败语义。

### 13.1 复核确认成立

- 载荷契约兼容：前端读 `payload.clarifications[].{id,question,context}` + `payload.round`，面板回传 `questionId: item.id`，与生成结构一致。
- 测试隔离：`PRAGMA foreign_keys=ON`（`db.ts:109`）+ `sessions.user_id ... ON DELETE CASCADE` ⇒ 测试间 `DELETE FROM users` 会级联清掉 session，恢复逻辑不会跨用例串味。
- 失败语义：`planning-generation-failed:` 在 watcher（`:1283` / `:1420`）走**终态**分支（不触发降级 auto-chain），与「未确认 = 未完成」一致。
- §12.4 的 D1–D4 论证成立。

### 13.2 发现并已修复的问题

| # | 问题 | 影响 | 修复 |
| --- | --- | --- | --- |
| F1 | 确认轮超时静默放行 | 用户不确认即生成 plan，**违反 §5.2 G6** | 确认轮超时抛 `PlanningFailure`（见 D5）；非确认轮保持既有「保守默认」契约 |
| F2 | 确认题稳定 id 被前端去重 | 驳回后无法再确认 → 叠加 F1 直接放行 | 确认题传输 id 轮次化（见 D6） |
| F3 | `awaiting_confirmation` 未列入 `WAITING_PROGRESS_SUBSTATES`（`store/substate-store.ts:63`） | 人工等待时长被计入 `progress_interval` 延迟指标（L1.6 p95 污染），与 `clarifying` 语义不一致 | 加入该集合 |
| F4 | 触发只查 `rewrittenIntent` | 改写中性化后漏触发 grill | 同时查 `sourceIntent` |
| F5 | 持久化是死写：`readPm1Grill` 无生产消费者 | G5「抗压缩/恢复」对 pm1 实际未交付 | 改为 `readPm1GrillTask` 并在运行开始恢复（见 D7）；同意图已确认则跳过 grill，质量退回则不重复 grill 但沿用原答案 |
| F6 | 题面为英文模板 + 确认题只能手打 | 中文产品展示英文题；确认语义易误判 | 模板中文化；载荷携带结构化 `options`，前端渲染选项按钮 + 「推荐」徽标 |

### 13.3 本轮（复审修复）变更清单

| 层 | 文件 | 改动 |
| --- | --- | --- |
| agent-core | `src/context/routing.ts` | `CLARIFICATION_TEMPLATES` 中文化；注明「首项即推荐」的跨消费方契约 |
| gateway | `src/handoff/runner/pm1-grill-runner.ts` | 新增 `readPm1GrillTask` / `confirmTransportQuestionId` / `toEngineNodeId`；`persistPm1Grill` 增 `intent` 参数；`frontierToQuestions` 输出 `options` 且确认题 id 轮次化；`applyPm1GrillAnswers` 归一化 |
| gateway | `src/handoff/runner/artifact-chain.ts` | 触发增查 `sourceIntent`；恢复已持久化决策树；质量退回跳过 grill；确认轮超时抛 `PlanningFailure`；取消时清空状态 |
| gateway | `src/handoff/store/substate-store.ts` | `awaiting_confirmation` 纳入等待态集合 |
| gateway | `src/routes/team.ts` | `listRuntimeClarifications` 透传并校验 `options` |
| gateway | `src/__tests__/handoff/artifact-chain.test.ts` | 新增 3 条用例（确认轮超时必失败 / 同意图已确认不提问 / 质量退回不 grill） |
| gateway | `src/verification/verify-team-pm1-multiround.ts` | 适配新签名与轮次化 id；新增「驳回后重提使用新 id」「确认后状态保留」断言 |
| web-client | `src/team/team.ts` | `TeamRuntimeClarificationRecord` 增 `options?` |
| web | `src/stores/team/team-events.ts` | `ClarificationOption` / `ClarificationItem.options`；`push` 校验并携带；`hydrateClarificationStore` 透传 |
| web | `src/pages/team/hooks/use-team-workspace-snapshot-state.ts` | 快照映射透传 `options` |
| web | `src/pages/team/runtime/tabs/tasks/ClarificationsPanel.tsx` | 结构化选项按钮（推荐置首 + 徽标 + 描述）、完整交互态、纯 token（无硬编码色值）、无选项回退 textarea |
| web | `ClarificationsPanel.test.tsx` / `team-events.test.ts` | 新增 7 条结构化选项用例 |

### 13.4 收尾（2026-09-16 续）：V-06 契约自动化 + 动效无障碍

**V-06 的分解与处置**——该验证项混了三类判定，逐类处置：

| V-06 判定 | 类别 | 处置 |
| --- | --- | --- |
| 首轮返回问题卡片数 ≥2（frontier 批量）、每题含「推荐」项 | **API 契约** | ✅ 已自动化：`verify-grill-end-to-end.ts` 新增 `GET /sessions/:id/questions/pending` 断言——`requests[].questions` 扁平后 `>= 2`、每题 `options.some(recommended === true)`、每题带非空 `nodeId` |
| 「不直接产出完整方案或代码」 | **提示词契约** | ✅ 已由 `__tests__/prompt/dialogue-mode-prompts.test.ts` 覆盖（断言 frontier 纪律与只读约定） |
| 在浏览器里实操「选澄清模式 → 输入高影响需求 → 看首轮卡片」 | **活体 LLM + 人工视觉** | ❌ **本环境不可执行**：`.env` 的 `AI_API_KEY` 为空（`len=0`），模型无法真实发起 `AskUserQuestion`。需要凭据后执行：`pnpm --filter @openAwork/agent-gateway dev` + `pnpm --filter @openAwork/web dev` → `/chat` → 澄清模式 → 输入高影响需求 |

> 结论：V-06 的**可自动化部分已全部落地**；残余仅为「活体 LLM 下的浏览器视觉走查」，缺凭据而非缺覆盖。

**L3 动效无障碍（已关闭）**：`ClarificationsPanel.tsx` 的 `OPTION_STYLES`（第 265-274 行）新增 `@media (prefers-reduced-motion: reduce)`，对 `.clarification-option` 与 `.clarification-free-input-toggle` 置 `transition: none` 并把 `:active` 的 `transform` 复位为 `none`（保留 hover/active 配色），无硬编码色值。

**本节验证**：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @openAwork/agent-gateway run test:grill` | `verify-grill-end-to-end: ok`（含新增 pending 契约断言） |
| `pnpm --filter @openAwork/agent-gateway run test:grill-reception` | `verify-team-grill-reception: ok` |
| `pnpm --filter @openAwork/agent-gateway run test:grill-pm1` | `verify-team-pm1-multiround: ok` |
| `pnpm --filter @openAwork/web exec vitest run <ClarificationsPanel + team-events 测试>` | 2 文件 / **36 通过** |
| `pnpm --filter @openAwork/agent-gateway run typecheck` | exit 0 |
| 硬编码色值自检（`ClarificationsPanel.tsx`） | 无命中 |

