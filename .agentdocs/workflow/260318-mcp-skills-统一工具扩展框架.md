# .agentdocs/workflow/260318-mcp-skills-统一工具扩展框架.md

## 任务概览

为跨平台 AI 智能体客户端（Expo 移动端 + Tauri 桌面端）设计一套**统一工具扩展框架**，将 MCP 协议适配层与 Skills/Plugin 系统整合为单一、可扩展的客户端能力体系，并补充 OpenWork 竞品对标分析中发现的六大差距模块。

本方案与主计划（260318-跨平台-ai-智能体-任务计划）**完全隔离**，独立时间线，独立交付。

**v2 新增模块（对标 OpenWork different-ai/openwork，12K stars）：**

- 计划/Todo 可视化 UI（任务执行进度面板）
- Plugin 系统（slash commands、subagents、hooks）
- MCP OAuth UI 引导（OAuth 登录流程）
- 消息平台连接器（Telegram/Slack/WhatsApp）
- Cloud Workers / 沙箱执行模式
- Orchestrator CLI 模式（无 UI 后台运行）
- 定时任务（Scheduled Tasks）

---

## 当前分析

### 现有方案的工具支持现状

- `T-07`：工具调用契约（JSON Schema + 输入输出校验）—— 仅定义了单次调用接口
- `T-13`：工具执行沙箱（白名单、超时、审计日志）—— 仅涉及服务端 Gateway 侧
- **空白**：客户端侧工具注册/发现/执行、Skills 能力包、MCP 协议适配均无设计

### 核心问题

1. 客户端如何发现并调用工具（本地工具 vs 远程 MCP server）？
2. Skills（能力包）与 MCP Tools 的关系如何定义？
3. 工具权限如何在 iOS/Android/macOS/Windows 不同沙箱中统一管理？
4. 用户/开发者如何扩展新工具能力而不需要发版？

---

## 方案设计

### 核心概念分层

```
┌─────────────────────────────────────────┐
│              Agent 对话层               │  ← tool_use 触发
├─────────────────────────────────────────┤
│           Skills 层（能力包）            │  ← 高级抽象，组合多个工具
│  Skill = manifest + 权限声明 + 入口函数  │
├─────────────────────────────────────────┤
│         Tool Registry（工具注册表）      │  ← 统一索引，路由
├──────────────────┬──────────────────────┤
│  MCP Client 适配层│   内置工具执行层      │
│  (远程 MCP server)│   (本地文件/剪贴板等) │
└──────────────────┴──────────────────────┘
```

### 层级说明

| 层级              | 职责                                 | 位置                    |
| ----------------- | ------------------------------------ | ----------------------- |
| Skills 层         | 封装复合能力                         | `packages/skills`       |
| Tool Registry     | 运行时注册表，tool_name → 执行器映射 | `packages/agent-core`   |
| MCP Client 适配层 | MCP 协议，连接外部 MCP server        | `packages/mcp-client`   |
| 内置工具执行层    | 平台原生能力                         | `packages/native-tools` |

---

### Skill Manifest 规范

> 参考 OpenAI Plugin Manifest、MCP ServerInfo、AgenC PluginManifest、Claude Code SKILL.md 的设计收敛结论。

**文件名**：`skill.yaml`（每个 Skill 包的根目录）

```yaml
apiVersion: 'agent-skill/v1' # manifest schema 版本
id: 'com.myapp.web-search' # 反向域名，全局唯一
name: 'web-search' # model-facing name（用于 tool 路由）
displayName: 'Web Search' # 用户界面显示名
version: '1.0.0' # semver
description: 'Search the web for current information'
descriptionForModel: | # 注入 LLM 的调用指引（类比 OpenAI description_for_model）
  Use this skill when the user needs real-time information, news, or
  current events. Call the search tool with the user's exact query.
author: 'MyApp'
license: 'MIT'

# 平台支持声明
platforms:
  - ios
  - android
  - macos
  - windows

# 提供的能力标签（用于发现/搜索）
capabilities:
  - search.web
  - information.real-time

# MCP server 绑定（如果此 Skill 是对 MCP server 的封装）
mcp:
  transport: sse # 移动端：sse/websocket；桌面端额外支持 stdio
  url: 'https://mcp.example.com/brave-search'
  # 桌面端 stdio 模式：
  # command: "npx"
  # args: ["-y", "@modelcontextprotocol/server-brave-search"]

# 权限声明（install-time 授权，运行时按此过滤 tool list）
permissions:
  - type: network
    scope: 'https://api.search.brave.com/*'
    required: true # true=缺失则拒绝安装；false=降级运行
  - type: env
    scope: BRAVE_API_KEY
    required: true

# 资源约束
constraints:
  maxConcurrentCalls: 5
  rateLimitPerMinute: 60
  timeout: 30000 # ms

# 生命周期
lifecycle:
  activation: on-demand # on-demand | startup | manual
  warmup: false

# 用户可配置项（渲染为设置 UI）
configSchema:
  type: object
  properties:
    safeSearch:
      type: boolean
      default: true
  required: []

# 注入上下文的参考文档
references:
  - path: ./references/api-guide.md
    loadAt: activation # activation | never
```

**TypeScript 类型（用于 `packages/skill-types`）**：

```typescript
export interface SkillManifest {
  apiVersion: 'agent-skill/v1';
  id: string; // 反向域名
  name: string; // model-facing name
  displayName: string;
  version: string; // semver
  description: string;
  descriptionForModel?: string; // 注入 LLM 的调用指引
  author?: string;
  license?: string;
  platforms?: Array<'ios' | 'android' | 'macos' | 'windows'>;
  capabilities: string[]; // 能力标签
  mcp?: MCPServerRef; // 如封装 MCP server
  permissions: SkillPermission[]; // 权限声明（必须显式列出）
  constraints?: SkillConstraints;
  lifecycle?: SkillLifecycle;
  configSchema?: JSONSchema;
  references?: SkillReference[];
}

export interface SkillPermission {
  type: 'network' | 'filesystem' | 'clipboard' | 'env' | 'notifications' | 'camera' | 'location';
  scope: string; // URL pattern / path pattern / env var name
  required: boolean; // false = 降级运行
}

export interface MCPServerRef {
  transport: 'sse' | 'websocket' | 'stdio';
  url?: string; // SSE/WebSocket
  command?: string; // stdio（仅桌面端）
  args?: string[];
}

export interface SkillConstraints {
  maxConcurrentCalls?: number;
  rateLimitPerMinute?: number;
  timeout?: number; // ms
}

export interface SkillLifecycle {
  activation: 'on-demand' | 'startup' | 'manual';
  warmup?: boolean;
}

export interface SkillReference {
  path: string;
  loadAt: 'activation' | 'never';
}
```

### MCP Client 适配层接口

> 基于 `@modelcontextprotocol/sdk` TypeScript SDK 官方 API 设计，支持 Streamable HTTP → SSE 自动降级，桌面端额外支持 stdio。

```typescript
import {
  Client,
  StreamableHTTPClientTransport,
  SSEClientTransport,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client';

// --- 公开接口 ---

export interface MCPClientAdapter {
  connect(server: MCPServerRef): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  listTools(serverId: string): Promise<MCPToolDef[]>;
  callTool(
    serverId: string,
    toolName: string,
    args: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPToolResult>;
  getStatus(serverId: string): MCPConnectionStatus;
}

export interface MCPCallOptions {
  timeout?: number; // ms，默认 30000
  resetTimeoutOnProgress?: boolean;
  onprogress?: (p: { progress: number; total?: number }) => void;
}

export interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface MCPToolResult {
  content: Array<{ type: 'text' | 'image' | 'resource'; text?: string; data?: unknown }>;
  structuredContent?: unknown; // MCP structured output
  isError?: boolean;
}

export type MCPConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

// --- 参考实现（packages/mcp-client/src/adapter.ts）---

export class MCPClientAdapterImpl implements MCPClientAdapter {
  private clients = new Map<string, { client: Client; status: MCPConnectionStatus }>();

  async connect(server: MCPServerRef): Promise<void> {
    this.clients.set(server.id, { client: null!, status: 'connecting' });
    const client = new Client(
      { name: 'app-client', version: '1.0.0' },
      { capabilities: { sampling: {} } },
    );

    if (server.transport === 'stdio') {
      // 仅桌面端（Tauri）
      const transport = new StdioClientTransport({
        command: server.command!,
        args: server.args ?? [],
      });
      await client.connect(transport);
    } else {
      // 移动端 + 桌面端：Streamable HTTP → SSE 自动降级
      const baseUrl = new URL(server.url!);
      try {
        await client.connect(new StreamableHTTPClientTransport(baseUrl));
      } catch {
        await client.connect(new SSEClientTransport(baseUrl));
      }
    }

    this.clients.set(server.id, { client, status: 'connected' });
  }

  async listTools(serverId: string): Promise<MCPToolDef[]> {
    const { client } = this.getClient(serverId);
    const all: MCPToolDef[] = [];
    let cursor: string | undefined;
    do {
      const { tools, nextCursor } = await client.listTools({ cursor });
      all.push(
        ...tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema as JSONSchema,
        })),
      );
      cursor = nextCursor;
    } while (cursor);
    return all;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPToolResult> {
    const { client } = this.getClient(serverId);
    const result = await client.callTool(
      { name: toolName, arguments: args as Record<string, unknown> },
      {
        timeout: options?.timeout ?? 30_000,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
        onprogress: options?.onprogress,
      },
    );
    return {
      content: result.content as MCPToolResult['content'],
      structuredContent: result.structuredContent,
      isError: result.isError,
    };
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.clients.get(serverId);
    if (entry) {
      await entry.client.close();
      this.clients.delete(serverId);
    }
  }

  getStatus(serverId: string): MCPConnectionStatus {
    return this.clients.get(serverId)?.status ?? 'disconnected';
  }

  private getClient(serverId: string) {
    const entry = this.clients.get(serverId);
    if (!entry || entry.status !== 'connected')
      throw new Error(`MCP server ${serverId} not connected`);
    return entry;
  }
}
```

### Tool Registry 接口

```typescript
export interface ToolRegistry {
  registerBuiltin(tool: BuiltinTool): void;
  registerSkill(skill: SkillManifest, executor: SkillExecutor): void;
  registerMCPServer(serverId: string, tools: MCPToolDef[]): void;
  listAvailable(): ToolDefinition[]; // 仅已授权 + 平台兼容
  execute(toolName: string, args: unknown): Promise<ToolResult>;
  unregister(toolId: string): void;
}
```

---

### 平台差异处理

| 能力            | iOS/Android               | macOS/Windows           |
| --------------- | ------------------------- | ----------------------- |
| MCP transport   | SSE / WebSocket           | SSE / WebSocket + stdio |
| 文件访问        | 沙箱目录 + DocumentPicker | 全路径（Tauri 权限）    |
| 本地 MCP server | 仅远程                    | 支持 stdio 子进程       |
| 安全存储        | SecureStore               | Stronghold / 系统凭据库 |
| 权限请求        | 系统弹窗                  | Tauri capability 配置   |

### 关键设计决策

1. **MCP transport 策略**：移动端仅 SSE/WebSocket；桌面端额外支持 stdio（本地子进程）。
2. **Skills 是 MCP Tools 的高阶封装**：一个 Skill 可绑定一个 MCP server、组合多个 MCP server、或纯本地实现无 MCP 依赖。
3. **权限双层模型**：Skill manifest 显式声明权限（`required: true/false`） → 用户安装时授权 → 运行时按授权状态过滤 `ToolRegistry.listAvailable()` 结果。
4. **Manifest-first 验证**：manifest schema 校验在任何代码执行之前完成；校验失败则阻断安装（参考 OpenClaw、AgenC 的 hard-fail 设计）。
5. **Allow/Deny 硬失败**：`ToolRegistry` 初始化时，若 allow/deny 列表中存在未声明 Skill ID，抛出启动错误（不静默忽略）。
6. **动态注册无需发版**：用户配置 MCP server URL 后，capability negotiation 立即执行，工具注入 tool list。
7. **凭据代理模式**：Skill 不直接读取 API Key；通过平台安全存储（SecureStore/Stronghold）的凭据代理获取 scope 限定的短期 token。

---

## 实施计划（独立时间线）

> 状态说明：🟡待开始 | 🔵进行中 | ✅完成 | ❌失败 | ⏸️阻塞

### Phase A（W1-W2）基础类型层与协议适配

- [x] A-01 ✅：定义 `SkillManifest`、`MCPToolDef`、`ToolRegistry` 接口类型（`packages/skill-types`）
- [x] A-02 ✅：实现 `MCPClientAdapter` SSE transport（移动端 + 桌面端通用）
- [x] A-03 ✅：实现 `MCPClientAdapter` stdio transport（仅桌面端）
- [x] A-04 ✅：实现基础 `ToolRegistry`（注册、查询、执行、注销）

**验收标准**

- 可连接远程 MCP server（SSE），列出并调用其工具
- 桌面端可通过 stdio 启动本地 MCP server 进程
- 单元测试覆盖率 ≥ 80%

---

### Phase B（W2-W3）Skills 注册中心

- [x] B-01 ✅：实现 Skill 安装/卸载（manifest 解析 + 持久化）
- [x] B-02 ✅：实现权限声明与用户授权 UI（install-time permission grant）
- [x] B-03 ✅：实现 Skill → MCP dependency 自动连接
- [x] B-04 ✅：实现内置 Skills（web-search、file-read、clipboard-read 各平台变体）

**验收标准**

- 安装 Skill 后其工具出现在 LLM tool list
- 未授权 Skill 的工具不暴露给 LLM
- 内置 Skills 在四平台均可执行

---

### Phase C（W3-W4）客户端集成

- [x] C-01 ✅：移动端（Expo）Skill 管理 UI（列表、安装、授权、状态）
- [x] C-02 ✅：桌面端（Tauri）Skill 管理 UI
- [x] C-03 ✅：agent-core 对话循环接入 Tool Registry（tool_use → registry.execute）
- [x] C-04 ✅：MCP server 用户自定义配置页（URL/command 输入，保存，自动注册）

**验收标准**

- 完整链路：提问 → tool_use → Tool Registry → MCP/内置执行 → 结果返回对话
- 用户可添加自定义 MCP server，工具立即可用

---

### Phase D（W4-W5）测试、安全加固与文档

- [x] D-01 ✅：端到端测试（MCP 连接 → tool_use → 结果渲染）
- [x] D-02 ✅：权限边界测试（未授权不可调用，撤销立即生效）
- [x] D-03 ✅：MCP server 异常处理（断连、超时、malformed response）
- [x] D-04 ✅：Skill manifest 安全校验（schema 校验、来源白名单）
- [x] D-05 ✅：开发者文档（如何编写并发布一个 Skill）

**验收标准**

- 所有权限边界 case 通过
- MCP 断连后自动重连，不影响对话
- 开发者文档可独立指引外部开发者创建 Skill

---

## 里程碑

- MA（W2 结束）：MCP Client 可连接远程 server，Tool Registry 基础就绪
- MB（W3 结束）：Skill 安装/授权/执行完整闭环
- MC（W4 结束）：移动端 + 桌面端全链路可用
- MD（W5 结束）：测试覆盖、安全加固、开发者文档完成

---

## 依赖关系（DAG）

```
A-01 → A-02 → A-04 → B-01 → B-02 → B-03 → C-01
          ↓              ↓               → C-02
        A-03           B-04 → C-03 → C-04
                                ↓
                           D-01~D-05
```

---

## 风险矩阵

| 风险                                         | 概率 | 影响 | 控制措施                                                 |
| -------------------------------------------- | ---- | ---- | -------------------------------------------------------- |
| 移动端不支持 stdio，部分 MCP server 无法连接 | 高   | 中   | 明确告知用户仅支持远程 MCP；鼓励 Skill 封装为 SSE server |
| Skill manifest 来源不可信（恶意代码）        | 中   | 高   | 来源白名单 + schema 严格校验 + 沙箱执行                  |
| MCP 协议版本差异                             | 中   | 中   | 锁定 MCP spec 版本，提供兼容层                           |
| 平台权限碎片化（四端不一致）                 | 高   | 中   | 统一权限抽象层，平台差异封装在 native-tools              |

---

## 度量指标

- Skill 安装成功率
- MCP server 连接成功率 / 平均连接时延
- tool_use 执行成功率（按 skill/tool 分类）
- 权限拒绝次数（异常授权行为检测）

---

---

## 扩展模块设计（v2 补充）

### 模块 E：计划/Todo 可视化 UI

**设计目标**：将 agent-core 的 todo 状态机暴露为前端可视组件，让用户实时看到任务拆解、执行进度、步骤时间戳。

**核心数据结构**：

```typescript
export interface TaskPlan {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  startedAt?: number;
  completedAt?: number;
  toolCalls?: ToolCallRecord[];
}

export interface ToolCallRecord {
  toolName: string;
  args: unknown;
  result?: unknown;
  durationMs?: number;
}
```

**UI 组件**：

- `PlanPanel`：侧边栏或底栏，实时显示当前 Task 的步骤列表 + 状态图标
- `StepRow`：单步展示（状态图标 + 标题 + 耗时 + 展开工具调用详情）
- `ToolCallInspector`：展开查看 tool name、args、result
- 步骤状态 → 图标：🟡 pending | 🔵 in_progress | ✅ completed | ❌ failed | ⏸️ blocked

**Plan 生命周期**：

1. 用户发送消息 → agent-core 生成 Plan（可编辑）
2. 执行中 → 每个步骤状态变更通过事件流推送到 UI
3. 执行结束 → Plan 作为结构化产物持久化到 SQLite
4. 历史会话可回放 Plan 执行路径

**平台实现**：移动端（Expo）+ 桌面端（Tauri）共用 React 组件；事件流通过 WebSocket/SSE 从 agent-core 推送。

---

### 模块 F：Plugin 系统

**设计目标**：在 Skill 基础上支持完整 Plugin 能力——Slash Commands、Subagents、Lifecycle Hooks。

**Plugin vs Skill 区别**：

| 维度     | Skill                | Plugin                         |
| -------- | -------------------- | ------------------------------ |
| 核心能力 | 工具调用（tool_use） | 工具 + 命令 + subagent + hooks |
| 触发方式 | LLM tool_use         | 用户 `/命令` 或事件钩子        |
| 复杂度   | 轻量                 | 重量，可含多个 Skill           |

**Plugin Manifest 扩展**：

```yaml
apiVersion: 'agent-plugin/v1'
id: 'com.myapp.git-assistant'
name: 'git-assistant'
displayName: 'Git Assistant'
version: '1.0.0'

# 包含的 Skills
skills:
  - com.myapp.git-commit
  - com.myapp.git-review

# Slash Commands
commands:
  - name: commit
    description: '生成并提交 git commit'
    usage: '/commit [message]'
    handler: './commands/commit.ts'

  - name: review
    description: '对当前 diff 做 code review'
    usage: '/review'
    handler: './commands/review.ts'

# Subagents（可被主 agent 调用的子智能体）
subagents:
  - id: 'reviewer'
    description: '专注代码审查的子智能体'
    systemPrompt: './prompts/reviewer.md'
    tools: ['com.myapp.git-review']

# Lifecycle Hooks
hooks:
  onInstall: './hooks/install.ts'
  onUninstall: './hooks/uninstall.ts'
  onSessionStart: './hooks/session-start.ts' # 每次会话开始时注入上下文
  onSessionEnd: './hooks/session-end.ts'
  beforeToolCall: './hooks/before-tool.ts' # 工具调用前拦截
  afterToolCall: './hooks/after-tool.ts' # 工具调用后处理
```

**Slash Command 解析**：

- 用户输入 `/commit fix login bug` → 解析 command name + args
- 路由到对应 plugin handler
- Handler 可直接返回文本、触发 tool_use、或启动 subagent

**Hook 执行时序**：

```
onSessionStart → [对话循环] → beforeToolCall → tool执行 → afterToolCall → onSessionEnd
```

---

### 模块 G：MCP OAuth UI 引导

**设计目标**：用户无需手动操作 OAuth callback，UI 自动引导完成 MCP server 授权登录。

**OAuth 流程**（参考 OpenWork bug #759 的修复方向）：

```
用户点击「连接 MCP Server」
    ↓
调用 mcp.auth.start(serverId) → 获取 authUrl
    ↓
打开系统浏览器 / In-App WebView
    ↓
用户完成 OAuth 授权
    ↓
[移动端] Deep Link 回调 → 捕获 code → mcp.auth.callback({ code })
[桌面端] localhost:PORT/mcp/oauth/callback 捕获 → 自动完成
    ↓
pollStatus() → status === 'connected' → 更新 UI
```

**关键差异处理**：

- **移动端**：注册 Deep Link scheme（`myapp://mcp/oauth/callback`），Expo Linking 监听回调
- **桌面端**：Tauri 启动本地 HTTP server 监听 callback（避免 OpenWork 的 sandbox 问题）
- **沙箱/远程 worker**：manual fallback — 显示「粘贴授权码」输入框

**UI 组件**：

- `MCPConnectModal`：显示连接状态、授权进度、错误提示
- `MCPServerList`：已连接 server 列表，显示认证状态、工具数量
- `OAuthCallbackHandler`：平台适配层，统一处理 Deep Link / localhost callback

---

### 模块 H：消息平台连接器

**设计目标**：让用户通过 Telegram/Slack/WhatsApp 发起任务、监控进度，无需打开桌面/移动 App。

**架构**：

```
[Telegram Bot / Slack App / WhatsApp Business]
           ↓ webhook / long-polling
[Connector Service（packages/connectors）]
           ↓ OpenWork Server HTTP API
[Agent Core + Tool Registry]
           ↓ 执行结果
[Connector Service]
           ↓ 消息回复
[用户]
```

**消息格式映射**：

| 功能     | 用户消息             | Agent 回复             |
| -------- | -------------------- | ---------------------- |
| 发起任务 | 自然语言文本         | 流式文本（分块发送）   |
| 查看计划 | `/plan`              | 步骤列表（格式化文本） |
| 批准操作 | `/approve` / `/deny` | 权限确认结果           |
| 查看历史 | `/history`           | 最近 N 条会话摘要      |

**Connector 包结构**：

```
packages/connectors/
├── telegram/
│   ├── bot.ts          # Telegraf bot
│   └── formatter.ts    # 消息格式化
├── slack/
│   ├── app.ts          # Bolt for JS
│   └── formatter.ts
├── whatsapp/
│   ├── client.ts       # WhatsApp Business API
│   └── formatter.ts
└── shared/
    ├── router.ts       # 统一消息路由
    └── session-bridge.ts  # 连接 OpenWork Server 会话
```

**权限控制**：Connector 侧用户身份 → 映射到 OpenWork workspace 用户 → 继承该用户的工具权限。

---

### 模块 I：Cloud Workers / 沙箱执行模式

**设计目标**：支持将任务卸载到云端隔离 worker 执行，客户端仅负责发起和监控。

**执行模式对比**：

| 模式         | 执行位置     | 适用场景                 |
| ------------ | ------------ | ------------------------ |
| Local Mode   | 用户本机     | 隐私敏感任务、离线       |
| Cloud Worker | 云端沙箱容器 | 长时间任务、多端共享结果 |
| Sandbox Mode | 本地隔离进程 | 不信任工具的安全执行     |

**Cloud Worker 架构**：

```typescript
export interface WorkerSession {
  workerId: string;
  status: 'starting' | 'running' | 'idle' | 'stopped';
  region: string;
  createdAt: number;
  expiresAt: number;
  endpoint: string; // WebSocket URL
}

export interface WorkerManager {
  launch(config: WorkerConfig): Promise<WorkerSession>;
  connect(workerId: string): Promise<void>;
  stop(workerId: string): Promise<void>;
  list(): Promise<WorkerSession[]>;
}
```

**沙箱模式（本地）**：

- 每个 Tool 执行在独立进程中（Node.js child_process / Tauri sidecar）
- 文件系统访问限制在指定目录
- 网络访问通过代理过滤白名单域名
- 进程超时强制 kill

**客户端 UI**：

- Worker 状态指示器（本地/云端/沙箱）
- 云端 worker 启动/停止控制
- 资源用量（执行时长、token 消耗）显示

---

### 模块 J：Orchestrator CLI 模式

**设计目标**：无 UI 情况下通过 CLI 启动 agent，支持自动审批、批量任务、CI/CD 集成。

**CLI 接口设计**：

```bash
# 基础启动
openwork start --workspace /path/to/workspace

# 自动审批所有操作（CI/CD 场景）
openwork start --workspace . --approval auto

# 执行单次任务后退出
openwork run --task "帮我整理 ./reports 目录下的 Excel 文件"

# 后台 daemon 模式
openwork start --daemon --port 8080

# 连接已运行的 daemon
openwork attach --port 8080

# 查看任务状态
openwork status [task-id]

# 取消任务
openwork cancel <task-id>
```

**Orchestrator 包结构**：

```
packages/orchestrator/
├── cli.ts              # Commander.js CLI 入口
├── daemon.ts           # 后台 HTTP server
├── approval.ts         # 审批策略（auto/prompt/deny）
├── task-runner.ts      # 单次任务执行
└── workspace.ts        # workspace 加载与配置
```

**审批策略**：

```typescript
export type ApprovalPolicy =
  | 'auto' // 自动批准所有操作（CI/CD）
  | 'prompt' // 终端交互式确认（默认）
  | 'deny'; // 拒绝所有高风险操作（只读模式）
```

**与 OpenWork Server 集成**：CLI daemon 启动后暴露相同的 HTTP API，Telegram/Slack connector 可直接连接。

---

### 模块 K：定时任务（Scheduled Tasks）

**设计目标**：支持用户定义定时/周期性 Agent 任务，无需手动触发。

**调度规范**：

```typescript
export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  prompt: string; // 发给 agent 的指令
  schedule: ScheduleConfig;
  workspace?: string;
  approvalPolicy: ApprovalPolicy;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: 'success' | 'failed' | 'running';
}

export type ScheduleConfig =
  | { type: 'cron'; expression: string } // '0 9 * * 1-5'（工作日早9点）
  | { type: 'interval'; ms: number } // 每 N 毫秒
  | { type: 'once'; at: number }; // 指定时间戳执行一次
```

**使用场景示例**：

- 每天早上9点：「汇总昨日邮件并生成摘要」
- 每小时：「检查监控指标，异常时发 Telegram 通知」
- 每周一：「从 GitHub 拉取上周 PR 列表并生成周报」

**UI 组件**：

- `ScheduleManager`：任务列表，启用/禁用，手动触发，查看执行历史
- `ScheduleEditor`：可视化 cron 表达式编辑器（+ 人类可读预览："每个工作日 09:00"）

**平台实现**：

- 桌面端：Tauri 原生定时器 / OS 级 launchd/Task Scheduler
- 移动端：仅支持 interval 类型（受 iOS/Android 后台限制）；cron 由 Cloud Worker 执行
- CLI daemon：Node.js `node-cron` 在后台执行

---

## 扩展模块实施计划

> 在原 Phase A-D（W1-W5）完成后启动。

### Phase E（W6-W7）计划可视化 + Plugin 系统

- [x] E-01 ✅：定义 `TaskPlan`、`PlanStep`、`ToolCallRecord` 类型，agent-core 集成事件推送
- [x] E-02 ✅：实现 `PlanPanel` + `StepRow` UI 组件（移动端 + 桌面端）
- [x] E-03 ✅：Plan 持久化到 SQLite，支持历史回放
- [x] E-04 ✅：定义 Plugin Manifest（`agent-plugin/v1`），扩展 Skill manifest
- [x] E-05 ✅：实现 Slash Command 解析与路由
- [x] E-06 ✅：实现 Plugin Lifecycle Hooks（onSessionStart/End、beforeToolCall/afterToolCall）
- [x] E-07 ✅：实现 Subagent 调度（主 agent → 子 agent 委托执行）

**验收标准**

- 执行中任务步骤实时更新，延迟 < 500ms
- `/command` 正确路由到 plugin handler
- Hook 执行不阻塞主对话流

---

### Phase F（W7-W8）MCP OAuth + 消息平台连接器

- [x] F-01 ✅：实现 `MCPConnectModal` + OAuth 流程（移动端 Deep Link + 桌面端 localhost callback）
- [x] F-02 ✅：实现 manual fallback（授权码粘贴输入框）
- [x] F-03 ✅：`MCPServerList` UI 显示认证状态与工具数量
- [x] F-04 ✅：实现 Telegram connector（Telegraf，消息收发 + `/plan`、`/approve`）
- [x] F-05 ✅：实现 Slack connector（Bolt for JS）
- [x] F-06 ✅：实现 connector 用户身份映射到 workspace 权限

**验收标准**

- MCP OAuth 在移动端 + 桌面端均可自动完成（无需手动粘贴）
- Telegram 可发起任务并收到流式回复（分块文本）

---

### Phase G（W8-W9）Cloud Workers + Orchestrator CLI + 定时任务

- [x] G-01 ✅：实现本地沙箱模式（工具在独立子进程执行，文件/网络隔离）
- [x] G-02 ✅：实现 `WorkerManager` 接口（launch/connect/stop/list）
- [x] G-03 ✅：客户端 Worker 状态指示器 UI
- [x] G-04 ✅：实现 Orchestrator CLI（`openwork start/run/status/cancel`）
- [x] G-05 ✅：实现 daemon 模式（后台 HTTP server，兼容 connector 接入）
- [x] G-06 ✅：实现定时任务调度器（cron + interval + once）
- [x] G-07 ✅：`ScheduleManager` UI + 可视化 cron 编辑器

**验收标准**

- `openwork run --task "..."` 执行任务并输出结果，exit code 0
- 定时任务按计划触发，执行历史可查
- 沙箱模式下工具无法访问指定目录外的文件系统

---

## 更新后里程碑

- MA（W2）：MCP Client + Tool Registry 基础就绪
- MB（W3）：Skill 安装/授权/执行完整闭环
- MC（W4）：移动端 + 桌面端全链路可用
- MD（W5）：测试、安全加固、开发者文档
- ME（W7）：计划可视化 UI + Plugin 系统
- MF（W8）：MCP OAuth UI + Telegram/Slack 连接器
- MG（W9）：Cloud Workers + Orchestrator CLI + 定时任务

---

## 更新后风险矩阵（新增项）

| 风险                                         | 概率 | 影响 | 控制措施                                                       |
| -------------------------------------------- | ---- | ---- | -------------------------------------------------------------- |
| MCP OAuth callback 在沙箱/远程 worker 中失败 | 高   | 高   | manual fallback 授权码输入；桌面端 localhost server 独立于沙箱 |
| Plugin hook 执行阻塞主对话流                 | 中   | 高   | hook 异步执行 + 超时强制终止（默认 5s）                        |
| 消息平台 webhook 被滥用（未授权用户）        | 中   | 高   | 用户身份映射 + workspace 权限校验 + 速率限制                   |
| 移动端定时任务后台被 OS 杀死                 | 高   | 中   | cron 任务迁移至 Cloud Worker；移动端仅支持 interval            |
| Cloud Worker 计费超支                        | 中   | 中   | 用量上限配置 + 超支预警                                        |

---

## 备注

- 本文档为独立方案 v2（在 v1 MCP+Skills 基础上扩展七大模块）。
- 不修改主计划任何任务。
- 与主计划接口边界：`ToolRegistry`（T-07）、`agent-core` 事件流（T-05/T-06）。
- Memory sync: completed
