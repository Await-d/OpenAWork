# .agentdocs/workflow/260319-opencowork-补充借鉴方案.md

## 任务概览

基于对 OpenCowork stores/ 和 cowork/ 组件目录的深度分析，补充 4 个高价值借鉴模块：
1. Plan 状态机（PlanStore）
2. Team 实时协作（TeamStore）
3. Settings 版本化迁移 + 场景化配置
4. API Quota 实时监控

附：新发现的 2 个 UI 缺口（ContextPanel、FileTreePanel）和 Web Search 完整配置设计。

---

## Part 1：Plan 状态机

**来源**：`src/renderer/src/stores/plan-store.ts`
**归属**：`packages/agent-core/src/plan/`

### 状态流转

```
drafting → approved → implementing → completed
               ↘ rejected
```

### 数据模型

```typescript
// packages/agent-core/src/plan/types.ts

export type PlanStatus = 'drafting' | 'approved' | 'implementing' | 'completed' | 'rejected'

export interface Plan {
  id: string
  sessionId: string      // 每个对话只有一个活跃 Plan
  title: string
  status: PlanStatus
  filePath?: string      // 可导出为本地 markdown
  content?: string       // markdown 格式的完整计划文本
  specJson?: string      // JSON 格式的结构化规范（Agent 执行时解析）
  createdAt: number
  updatedAt: number
}
```

### PlanManager 接口

```typescript
// packages/agent-core/src/plan/manager.ts

export interface PlanManager {
  // 查询
  getPlanBySession(sessionId: string): Plan | undefined;
  getActivePlan(): Plan | undefined;
  list(): Plan[];

  // CRUD
  createPlan(
    sessionId: string,
    title: string,
    options?: Partial<Pick<Plan, 'status' | 'filePath' | 'content' | 'specJson'>>
  ): Plan;
  updatePlan(planId: string, patch: Partial<Omit<Plan, 'id' | 'sessionId' | 'createdAt'>>): void;
  deletePlan(planId: string): void;

  // 状态迁移（原子操作）
  approvePlan(planId: string): void;       // drafting → approved
  rejectPlan(planId: string): void;        // drafting → rejected
  startImplementing(planId: string): void; // approved → implementing
  completePlan(planId: string): void;      // implementing → completed

  // 活跃 Plan
  setActivePlan(planId: string | null): void;
}
```

### 与 D2 执行模式的集成

Plan 状态机是 D2（ExecutionMode）的持久化层：

```
D2 INTERACTIVE 模式:
  Agent 生成方案 → createPlan(status='drafting') → 展示 PlanPanel
  用户点击「批准」→ approvePlan() → Agent 开始实现（startImplementing）
  用户点击「拒绝」→ rejectPlan() → Agent 重新设计
  Agent 完成所有任务 → completePlan()

D2 DELEGATED 模式:
  createPlan(status='approved') → 直接 startImplementing → completePlan
  （跳过用户确认步骤）
```

**`specJson` 字段的用途**：Agent 在 DESIGN 阶段生成结构化规范：
```json
{
  "goal": "重构认证模块",
  "steps": [
    { "id": "s1", "action": "分析现有代码", "files": ["src/auth/"] },
    { "id": "s2", "action": "重构为 JWT", "dependsOn": ["s1"] }
  ],
  "acceptanceCriteria": ["所有测试通过", "无 TypeScript 错误"]
}
```
Agent 在 DEVELOP 阶段读取 `specJson`，按步骤执行，`StepsPanel` 展示进度。

### PlanPanel UI

```
┌─ 方案 ─────────────────────────────────────────┐
│  重构认证模块                     [草稿]         │
│                                                  │
│  ## 目标                                         │
│  将现有 Session Cookie 认证迁移到 JWT...          │
│                                                  │
│  ## 步骤                                         │
│  1. ✅ 分析现有代码（已完成）                     │
│  2. 🔵 重构为 JWT（进行中）                       │
│  3. ○  更新测试                                  │
│                                                  │
│  [批准并开始实施]    [拒绝，重新设计]             │
└──────────────────────────────────────────────────┘
```

---

## Part 2：Team 实时协作（TeamStore）

**来源**：`src/renderer/src/stores/team-store.ts`
**归属**：`packages/multi-agent/src/team/`

### 数据模型

```typescript
export interface ActiveTeam {
  name: string
  description: string
  sessionId?: string
  members: TeamMember[]    // Agent 角色列表
  tasks: TeamTask[]        // 任务列表
  messages: TeamMessage[]  // 团队内部消息日志
  createdAt: number
}

export interface TeamMember {
  id: string
  name: string
  role: string             // 如 'researcher' | 'coder' | 'reviewer'
  status: 'idle' | 'working' | 'done' | 'error'
  currentTask?: string     // 当前正在执行的任务 ID
  avatar?: string
}

export interface TeamTask {
  id: string
  title: string
  assignedTo?: string      // TeamMember.id
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  dependsOn?: string[]     // 依赖的任务 ID
  result?: string          // 任务输出摘要
}

export interface TeamMessage {
  id: string
  memberId: string
  content: string
  timestamp: number
  type: 'update' | 'question' | 'result' | 'error'
}
```

### 事件驱动更新

```typescript
export type TeamEvent =
  | { type: 'team_start'; teamName: string; description: string }
  | { type: 'team_member_add'; member: TeamMember }
  | { type: 'team_member_update'; memberId: string; patch: Partial<TeamMember> }
  | { type: 'team_member_remove'; memberId: string }
  | { type: 'team_task_add'; task: TeamTask }
  | { type: 'team_task_update'; taskId: string; patch: Partial<TeamTask> }
  | { type: 'team_message'; message: TeamMessage }
  | { type: 'team_end' }

// Orchestrator 执行时发出事件，TeamStore 消费更新 UI
orchestrator.on('dag_event', (event: DAGEvent) => {
  teamStore.handleTeamEvent(mapDAGEventToTeamEvent(event), sessionId)
})
```

**防护机制**（直接借鉴）：
- 成员添加：name + id 双重去重
- 任务状态：`completed` 任务不可回滚到非完成状态
- 团队历史：`team_end` 触发归档到 `teamHistory`（会话结束后可查历史）

### 与现有 AgentDAG 的映射

```typescript
function mapDAGEventToTeamEvent(event: DAGEvent): TeamEvent | null {
  switch (event.type) {
    case 'node_started':
      return { type: 'team_member_update', memberId: event.nodeId, patch: { status: 'working', currentTask: event.nodeId } }
    case 'node_completed':
      return { type: 'team_member_update', memberId: event.nodeId, patch: { status: 'done' } }
    case 'node_failed':
      return { type: 'team_member_update', memberId: event.nodeId, patch: { status: 'error' } }
    case 'dag_completed':
      return { type: 'team_end' }
    default:
      return null
  }
}
```

---

## Part 3：Settings 版本化迁移

**来源**：`src/renderer/src/stores/settings-store.ts`
**归属**：`packages/agent-core/src/settings/`

### 借鉴的关键设计

#### 3.1 版本化迁移（`migrate` 函数）

```typescript
// 每次 store 结构变化，version 递增，migrate 函数补全新字段默认值
{
  version: 6,
  migrate: (persisted, version) => {
    const state = persisted as Record<string, unknown>
    if (version < 2) state.language = getSystemLanguage()
    if (state.webSearchEnabled === undefined) state.webSearchEnabled = false
    if (state.contextCompressionEnabled === undefined) state.contextCompressionEnabled = true
    // ... 每个版本只补充新增字段，不覆盖已有值
    return state
  }
}
```

**规则**：只补充缺失字段，不覆盖用户已设置的值。这保证了跨版本升级时用户配置不丢失。

#### 3.2 场景化模型绑定

```typescript
export type PromptRecommendationModelBindings = Record<
  'chat' | 'clarify' | 'cowork' | 'code',
  { providerId: string; modelId: string } | null
>
```

不同场景可独立绑定模型（比五维 active 更细粒度）：用于「推荐 prompt」生成时使用更快的模型，对话时用更强的模型。

#### 3.3 新会话默认模型

```typescript
newSessionDefaultModel: {
  providerId: string
  modelId: string
  useGlobalActiveModel: boolean  // true = 跟随全局 active，false = 用固定模型
} | null
```

#### 3.4 外观定制

```typescript
backgroundColor: string    // 自定义背景色
fontFamily: string         // 自定义字体
fontSize: number           // 字体大小（默认 16）
animationsEnabled: boolean // 动画开关
toolbarCollapsedByDefault: boolean  // 工具栏默认折叠
leftSidebarWidth: number   // 侧边栏宽度（含 clamp 防止拖出边界）
```

#### 3.5 全局设置完整字段清单

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoApprove` | boolean | false | 工具调用自动批准 |
| `devMode` | boolean | false | 开发者模式（raw 事件流）|
| `thinkingEnabled` | boolean | false | 全局推理模式 |
| `fastModeEnabled` | boolean | false | 快速模式（用 fast model）|
| `reasoningEffort` | string | 'medium' | 推理强度 |
| `teamToolsEnabled` | boolean | false | 多 Agent 团队工具 |
| `contextCompressionEnabled` | boolean | true | Auto Compact |
| `toolResultFormat` | 'toon'/'json' | 'toon' | 工具结果展示格式 |
| `webSearchEnabled` | boolean | false | Web 搜索开关 |
| `webSearchProvider` | string | 'duckduckgo' | 搜索引擎 |
| `webSearchApiKey` | string | '' | 搜索 API Key |
| `promptRecommendationModels` | Record | null map | 四场景模型绑定 |
| `newSessionDefaultModel` | ModelBinding | null | 新会话默认模型 |

---

## Part 4：API Quota 实时监控

**来源**：`stores/quota-store.ts` | **归属**：`packages/agent-core/src/quota/`

```typescript
export interface ProviderQuota {
  type: string
  planType?: string
  primary?: {
    usedPercent?: number
    windowMinutes?: number
    resetAt?: string
    resetAfterSeconds?: number
  }
  credits?: { hasCredits?: boolean; balance?: number; unlimited?: boolean }
  fetchedAt: number
}

export interface QuotaManager {
  getQuota(providerId: string): ProviderQuota | null;
  updateFromResponse(providerId: string, headers: Record<string, string>): void;
  subscribe(cb: (providerId: string, quota: ProviderQuota) => void): () => void;
}
```

从 API 响应头自动解析：OpenAI `x-ratelimit-*`、Anthropic `anthropic-ratelimit-*`。
UI：模型选择器旁展示「312/1000 请求 · 23min 后重置」。

---

## Part 5：新发现的 UI 缺口

### 5.1 ContextPanel（显式上下文管理）

**来源**：`components/cowork/ContextPanel.tsx` | **我们方案**：未设计

用户可显式添加/移除对话上下文（与 .agentignore 互补）：

```typescript
export interface ContextItem {
  id: string
  type: 'file' | 'url' | 'clipboard' | 'screenshot' | 'selection'
  label: string
  path?: string
  url?: string
  tokenEstimate?: number
  addedAt: number
}

export interface ContextManager {
  items: ContextItem[];
  addFile(path: string): Promise<void>;
  addUrl(url: string): Promise<void>;
  addClipboard(): Promise<void>;
  removeItem(id: string): void;
  getTotalTokenEstimate(): number;
  buildContextBlock(): string; // 注入 prompt 的上下文块
}
```

**归属**：`packages/agent-core/src/context/`

### 5.2 FileTreePanel（文件树 + 变更视图）

**来源**：`components/cowork/FileTreePanel.tsx` | **我们方案**：P1-D 只有变更列表，无树形视图

```
工作区文件树
  ├─ src/auth/
  │   ├─ ✏️ jwt.ts     [修改]  [diff]
  │   └─ 🆕 refresh.ts [新增]
  └─ tests/
      └─ ✏️ auth.test.ts [修改]
  [撤销所有]
```

P1-D 需增加树形视图模式（列表/树形 切换）。

---

## Part 6：Web Search 完整配置

**来源**：`settings-store.ts` webSearch* 字段

OpenCowork 支持 9 种搜索引擎，我们的 `web_search` 工具（OC-12）需对应：

| provider | 需要 Key | 备注 |
|---------|----------|------|
| `duckduckgo` | 否 | 默认，免费 |
| `tavily` | 是 | AI 优化搜索 |
| `exa` | 是 | 语义搜索 |
| `serper` | 是 | Google 代理 |
| `searxng` | 否（自建）| 自托管 |
| `bocha` | 是 | 国内 |
| `zhipu` | 是 | 国内，智谱 |
| `google` | 是 | 官方 Custom Search |
| `bing` | 是 | Bing Search API |

配置结构扩展（补充到 OC-12）：
```typescript
export interface WebSearchConfig {
  enabled: boolean
  provider: 'duckduckgo' | 'tavily' | 'exa' | 'serper' | 'searxng' | 'bocha' | 'zhipu' | 'google' | 'bing'
  apiKey?: string          // 对应 provider 的 Key（DuckDuckGo/SearXNG 不需要）
  baseUrl?: string         // SearXNG 自建实例 URL
  maxResults: number       // 默认 5
  timeout: number          // 默认 30000ms
}
```

---

## 实施计划

### Phase EX1（W3-W5，与 agent-core 并行）

- [x] EX-01 ✅：实现 `PlanManager`（状态机 + SQLite 持久化）
- [x] EX-02 ✅：Plan 状态机与 D2 ExecutionMode 集成（INTERACTIVE/DELEGATED）
- [x] EX-03 ✅：`PlanPanel` UI 组件（markdown 展示 + 批准/拒绝 + 步骤进度）
- [x] EX-04 ✅：实现 `TeamStore`（事件驱动 + DAGEvent 映射 + 历史归档）
- [x] EX-05 ✅：`TeamPanel` + `TeammateCard` UI（成员状态 + 任务进度）
- [x] EX-06 ✅：Settings 版本化迁移机制（version + migrate 函数）
- [x] EX-07 ✅：补充全局设置字段（devMode / thinkingEnabled / toolResultFormat 等）
- [x] EX-08 ✅：`QuotaManager`（响应头解析 + 订阅 + TTL 缓存）
- [x] EX-09 ✅：`ContextManager`（显式上下文管理 + prompt 注入）
- [x] EX-10 ✅：`ContextPanel` UI（添加文件/URL/剪贴板 + token 估算）
- [x] EX-11 ✅：`FileTreePanel` UI（树形文件变更视图 + diff 查看）
- [x] EX-12 ✅：Web Search 多引擎配置扩展（9 种 provider + 设置页）

**验收标准**
- Plan 状态机从 drafting → approved → implementing → completed 完整流转
- TeamStore 消费 DAGEvent 后 TeamPanel 实时更新成员状态
- Settings 从 v1 升级到最新版本，用户配置不丢失
- QuotaManager 在 OpenAI 请求后自动解析响应头并更新 UI
- ContextPanel 添加文件后 token 估算正确，prompt 中注入对应内容

---

## 备注

- 本文档为 `260319-opencowork借鉴方案.md` 的第二部分补充。
- Plan 状态机解决了「AI 生成方案后用户如何批准/拒绝」的闭环问题，是 D2 执行模式的持久化实现。
- TeamStore 事件驱动设计与我们的 DAGEvent 系统天然匹配，几乎可以直接映射。
- Settings 版本化迁移是生产必须的工程实践，避免 breaking change 导致用户配置丢失。
- Memory sync: completed
