# .agentdocs/workflow/260319-opencowork借鉴方案.md

## 任务概览

基于对 AIDotNet/OpenCowork（207 stars，v0.6.0，Electron + React + SQLite）的深度源码分析，识别可直接移植到我们系统的设计模式，并补充 3 个新发现的功能缺口。

参考源码：`src/main/channels/`、`src/main/cron/cron-scheduler.ts`、`src/main/ipc/`

**技术栈差异说明**：OpenCowork 用 Electron IPC，我们用 Tauri Commands + Fastify WebSocket。
适配映射：`ipcMain.handle()` → Tauri `#[tauri::command]`；`BrowserWindow.send()` → Tauri `emit()`；消息平台 Channel 系统放在 Agent Gateway（需公网 WebHook 端点）。

---

## Part 1：消息平台连接器（Channel System）

**来源**：`src/main/channels/`，可移植到 `services/agent-gateway/src/channels/`

### 1.1 工厂注册模式（ChannelManager）

```typescript
// services/agent-gateway/src/channels/channel-manager.ts

export class ChannelManager {
  private factories = new Map<string, ChannelServiceFactory>()
  private parsers = new Map<string, ChannelWsMessageParser>()
  private services = new Map<string, MessagingChannelService>()
  private statuses = new Map<string, 'running' | 'stopped' | 'error'>()

  // 添加新平台 = 注册一个工厂函数，无需修改核心代码
  registerFactory(type: string, factory: ChannelServiceFactory): void
  registerParser(type: string, parser: ChannelWsMessageParser): void

  async startPlugin(instance: ChannelInstance, notify: (event: ChannelEvent) => void): Promise<void>
  async stopPlugin(id: string): Promise<void>
  async restartPlugin(instance: ChannelInstance, notify: ...): Promise<void>
  getService(id: string): MessagingChannelService | undefined
  getStatus(id: string): 'running' | 'stopped' | 'error'
  async stopAll(): Promise<void>
}
```

### 1.2 统一消息服务接口

```typescript
// services/agent-gateway/src/channels/channel-types.ts

export interface MessagingChannelService {
  readonly pluginId: string
  readonly pluginType: string

  // 生命周期
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean

  // 统一消息操作
  sendMessage(chatId: string, content: string): Promise<{ messageId: string }>
  replyMessage(messageId: string, content: string): Promise<{ messageId: string }>
  getGroupMessages(chatId: string, count?: number): Promise<ChannelMessage[]>
  listGroups(): Promise<ChannelGroup[]>

  // 流式回复（可选，支持的平台实现）
  supportsStreaming?: boolean
  sendStreamingMessage?(
    chatId: string,
    initialContent: string,
    replyToMessageId?: string
  ): Promise<ChannelStreamingHandle>
}

export interface ChannelStreamingHandle {
  update(content: string): Promise<void>  // 增量更新（累积内容，非 delta）
  finish(finalContent: string): Promise<void>
}

export interface ChannelMessage {
  id: string
  senderId: string
  senderName: string
  chatId: string
  chatName?: string
  content: string
  timestamp: number
  raw?: unknown
}
```

### 1.3 路径级权限控制

比我们现有的 4 级权限语义（once/session/permanent/reject）更细粒度，直接控制到路径前缀级别：

```typescript
export interface ChannelPermissions {
  allowReadHome: boolean           // 允许读取 Home 目录外的文件
  readablePathPrefixes: string[]   // 可读路径绝对前缀白名单（allowReadHome=false 时有效）
  allowWriteOutside: boolean       // 允许写出插件工作目录
  allowShell: boolean              // 允许执行 shell 命令
  allowSubAgents: boolean          // 允许调用子 Agent（Task tool）
}

export interface ChannelFeatures {
  autoReply: boolean               // 自动回复来消息
  streamingReply: boolean          // 流式推送回复（CardKit 格式）
  autoStart: boolean               // 应用启动时自动连接
}

export interface ChannelInstance {
  id: string
  type: string                     // 'feishu' | 'dingtalk' | 'discord' | ...
  name: string
  enabled: boolean
  config: Record<string, string>   // 平台特有配置（API Key、Webhook URL 等）
  tools?: Record<string, boolean>  // 每个工具的启用开关
  providerId?: string | null       // 覆盖全局 AI Provider
  model?: string | null            // 覆盖全局模型
  features?: ChannelFeatures
  permissions?: ChannelPermissions
  createdAt: number
}
```

### 1.4 Auto-Reply 管道

```typescript
// services/agent-gateway/src/channels/auto-reply.ts
// 接收 channel 消息 → 创建/复用 session → 命令拦截 → 触发 Agent Loop

function handleChannelAutoReply(event: ChannelEvent): void {
  // 1. 按 `channel:{pluginId}:chat:{chatId}` 找或创建 SQLite session
  // 2. 命令拦截（tryHandleCommand）
  //    → true：完全处理，跳过 Agent
  //    → string：改写消息内容，继续 Agent
  //    → false：原样传给 Agent
  // 3. 检测 service 是否支持 streaming
  // 4. 通过 WebSocket 推送 'channel:session-task' 事件给前端
  //    （渲染侧的 Agent Loop 处理 → 流式回复回 channel）
}
```

**内置命令（可扩展）**：
- `/help` → 返回平台帮助信息
- `/new` → 创建新会话
- `/status` → 返回系统状态
- `/init` → 初始化工作区

### 1.5 MVP 支持的平台（优先级排序）

| 平台 | 优先级 | 特殊能力 |
|------|--------|----------|
| Telegram | P0 | Bot API 成熟，无需企业账号 |
| Discord | P0 | 开发者社区首选，WebSocket 推送 |
| 飞书（Feishu） | P1 | 国内企业场景，卡片消息流式更新 |
| 钉钉（DingTalk） | P1 | 国内企业场景 |
| 企业微信（WeCom） | P2 | 国内企业场景 |
| WhatsApp | P2 | 国际市场 |
| QQ | P3 | 消费者场景 |

---

## Part 2：Cron 定时任务调度系统

**来源**：`src/main/cron/cron-scheduler.ts`，可移植到 `services/agent-gateway/src/cron/`

### 2.1 数据模型

```typescript
export interface CronJobRecord {
  id: string
  name: string

  // 三种调度类型
  schedule_kind: 'at' | 'every' | 'cron'
  schedule_at: number | null        // at: 时间戳（毫秒）
  schedule_every: number | null     // every: 间隔毫秒
  schedule_expr: string | null      // cron: 标准 cron 表达式
  schedule_tz: string               // 时区（如 'Asia/Shanghai'）

  // 执行配置
  prompt: string                    // 要发送给 Agent 的 prompt
  agent_id: string | null
  model: string | null
  working_folder: string | null
  session_id: string | null         // 可继承已有会话上下文

  // 输出配置
  delivery_mode: 'desktop' | 'session' | 'none'
  delivery_target: string | null    // channel chatId（发消息到 channel）
  plugin_id: string | null          // 可定时向特定 channel 发消息
  plugin_chat_id: string | null

  // 控制
  enabled: number
  delete_after_run: number          // 执行后自动删除（一次性任务）
  max_iterations: number

  // 统计
  last_fired_at: number | null
  fire_count: number
  created_at: number
  updated_at: number
}

export interface CronRunRecord {
  id: string
  job_id: string
  started_at: number
  finished_at: number | null
  status: 'running' | 'success' | 'error' | 'aborted'
  tool_call_count: number
  output_summary: string | null
  error: string | null
  // 快照字段（job 删除后仍可查历史）
  job_name_snapshot: string | null
  prompt_snapshot: string | null
  model_snapshot: string | null
  delivery_mode_snapshot: string | null
}
```

### 2.2 调度引擎关键设计

```typescript
// 三种调度类型的处理

// at: 指定时间点
if (kind === 'at') {
  const delay = targetMs - Date.now()
  if (delay <= -30_000) return false  // 超过30s的过去时间：跳过，不补跑
  if (delay <= 0) { onJobFired(record); return true }  // 30s容差内：立即触发
  const timer = setTimeout(() => onJobFired(record), delay)
}

// every: 间隔触发（基于 anchor 对齐，不因重启补跑）
if (kind === 'every') {
  const anchor = record.last_fired_at ?? record.updated_at ?? record.created_at
  const elapsed = Math.max(0, now - anchor)
  const initialDelay = intervalMs - (elapsed % intervalMs || intervalMs)
  // initialDelay 对齐到下次应触发的时间点
}

// cron: 标准 cron 表达式（node-cron）
if (kind === 'cron') {
  const task = cron.schedule(expr, () => onJobFired(record), {
    scheduled: true,
    timezone: record.schedule_tz || 'UTC'
  })
}
```

**并发控制**：`maxConcurrentRuns`（默认 2），同一任务已在运行时跳过触发（不堆积）。

**delete_after_run 处理**：执行后停止调度（防重复），但等 Agent 跑完再删 DB 记录，UI 期间可见状态。

---

## Part 3：新发现的 3 个功能缺口

### 3.1 SSH 远程连接（`src/main/ssh/` + `src/main/ipc/ssh-handlers.ts`）

**缺口**：Agent 目前只能操作本地文件系统，无法连接远程服务器执行工具。

**OpenCowork 设计**：每个 session/project 可绑定 `ssh_connection_id`，Agent 的文件/shell 工具通过 SSH 在远程环境执行。

**我们的适配方案**：

```typescript
// packages/agent-core/src/ssh/

export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  privateKeyPath?: string;
  password?: string;    // 存储在 SecureStore
  status: 'connected' | 'disconnected' | 'error';
  createdAt: number;
}

export interface SSHConnectionManager {
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  execCommand(id: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(id: string, remotePath: string): Promise<string>;
  writeFile(id: string, remotePath: string, content: string): Promise<void>;
  listFiles(id: string, remotePath: string): Promise<string[]>;
  getStatus(id: string): SSHConnection['status'];
}
```

**适配点**：
- Session 增加 `sshConnectionId?: string` 字段
- 工具沙箱检测到 session 绑定 SSH 连接时，文件/shell 工具走 SSH 通道
- 桌面端：直接用 `ssh2` 库；移动端：通过 Agent Gateway 代理（Gateway 在本地运行或云端）

**实施**：`packages/agent-core/src/ssh/`（新模块），W8-W9 桌面端阶段集成。

---

### 3.2 系统原生通知（Desktop Notification）

**缺口**：定时任务完成、Channel 收到重要消息时，没有系统级推送通知。

**OpenCowork 设计**：`src/main/ipc/notify-handlers.ts` + Electron `Notification` API。

**我们的适配方案（Tauri）**：

```typescript
// apps/desktop/src/notification/

export interface NotificationManager {
  send(options: NotificationOptions): Promise<void>;
  requestPermission(): Promise<boolean>;
}

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  // 点击后跳转
  action?: {
    type: 'open_session' | 'open_channel';
    targetId: string;
  };
}

// Tauri 实现
import { sendNotification } from '@tauri-apps/plugin-notification';

// 触发时机：
// 1. 定时任务（CronJob）执行完成
// 2. Channel 收到新消息（autoReply = false 时）
// 3. Agent 长时间任务完成
// 4. LSP 发现严重错误（可选）
```

**配置**：用户可在设置中控制各类通知开关（定时任务/消息/Agent完成）。

---

### 3.3 Web 搜索作为内置工具

**缺口**：我们的 Web 搜索只在 MCP 层提到（需要外部 MCP server），没有作为开箱即用的内置工具。

**OpenCowork 设计**：`src/main/ipc/web-search-handlers.ts` — 内置搜索工具，无需外部 MCP。

**我们的适配方案**：

```typescript
// packages/agent-core/src/tools/builtin/web-search.ts

// 支持多搜索引擎，按优先级 fallback
const SEARCH_PROVIDERS = [
  { id: 'brave', name: 'Brave Search', apiKey: 'BRAVE_API_KEY' },
  { id: 'serper', name: 'Serper (Google)', apiKey: 'SERPER_API_KEY' },
  { id: 'duckduckgo', name: 'DuckDuckGo', apiKey: null }, // 免费，无需 key
] as const;

export const webSearchTool = ToolRegistry.define({
  name: 'web_search',
  description: 'Search the web for real-time information, news, and current events',
  parameters: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().default(5),
  }),
  async execute({ query, maxResults }, context) {
    // 按配置选择搜索引擎
    const provider = context.config.searchProvider ?? 'duckduckgo';
    return await searchWeb(query, { provider, maxResults });
  },
});
```

**DuckDuckGo 作为默认**（无需 API Key）：用户可在设置中配置 Brave/Serper 获得更好结果。

---

## Part 4：可直接复用的 IPC Handler 功能清单

以下功能 OpenCowork 已实现，我们可直接参考并移植到 Tauri Commands：

| OpenCowork IPC Handler | 功能 | 我们的对应位置 | 状态 |
|------------------------|------|--------------|------|
| `agents-handlers.ts` | Agent 配置 CRUD | `packages/agent-core` | ✅ 已设计 |
| `channel-handlers.ts` | 消息平台实例 CRUD | `services/agent-gateway/channels` | ❌ 本文档新增 |
| `cron-handlers.ts` | 定时任务 CRUD | `services/agent-gateway/cron` | ❌ 本文档新增 |
| `fs-handlers.ts` | 文件系统读写 | 工具沙箱 | ✅ 已设计 |
| `gitignore-utils.ts` | .gitignore 解析 | `packages/agent-core/filesystem` | ✅ P1-A |
| `mcp-handlers.ts` | MCP 服务器管理 | `packages/mcp-client` | ✅ 已设计 |
| `oauth-handlers.ts` | OAuth 2.0 流程 | Skill 市场 OAuth | ❌ 部分缺失 |
| `process-manager.ts` | 子进程生命周期 | `packages/lsp-client` spawn | ✅ LSP 方案 |
| `screenshot-handlers.ts` | 截图工具 | 多模态输入 | 🟡 设计中 |
| `secure-key-store.ts` | 安全密钥存储 | T-17 SecureStore | ✅ 已设计 |
| `skills-handlers.ts` | Skills 管理 | `packages/skill-registry` | ✅ 已设计 |
| `ssh-handlers.ts` | SSH 远程连接 | `packages/agent-core/ssh` | ❌ 本文档新增 |
| `web-search-handlers.ts` | Web 搜索工具 | `packages/agent-core/tools/builtin` | ❌ 本文档新增 |
| `notify-handlers.ts` | 系统通知 | `apps/desktop/notification` | ❌ 本文档新增 |

---

## 实施计划

### Phase OC1（W6-W8，与 Phase 4 桌面端并行）

**消息平台连接器**：
- [x] OC-01 ✅：移植 `ChannelManager`（工厂注册模式）到 `services/agent-gateway/src/channels/`
- [x] OC-02 ✅：实现 `MessagingChannelService` 接口 + `ChannelPermissions` 细粒度权限
- [x] OC-03 ✅：实现 Telegram provider（P0，Bot API）
- [x] OC-04 ✅：实现 Discord provider（P0，WebSocket）
- [x] OC-05 ✅：实现 Auto-Reply 管道（消息→session→命令拦截→Agent Loop）
- [x] OC-06 ✅：Channel CRUD API（`GET/POST/PUT/DELETE /channels`）
- [x] OC-07 ✅：Channel 管理 UI（添加/配置/启动/停止）

**Cron 定时任务**：
- [x] OC-08 ✅：移植 `CronScheduler`（at/every/cron 三种类型）到 Gateway
- [x] OC-09 ✅：实现 `CronJobRecord` SQLite 存储 + `CronRunRecord` 执行历史
- [x] OC-10 ✅：Cron CRUD API + WebSocket 触发推送
- [x] OC-11 ✅：Cron 管理 UI（创建/编辑/历史记录/下次触发时间）

**内置工具**：
- [x] OC-12 ✅：实现 `web_search` 内置工具（DuckDuckGo 默认 + Brave/Serper 可配置）
- [x] OC-13 ✅：实现系统通知（Tauri notification plugin）

### Phase OC2（W9-W10）

**SSH + 更多 Channel**：
- [x] OC-14 ✅：实现 `SSHConnectionManager`（桌面端，ssh2 库）
- [x] OC-15 ✅：Session 绑定 SSH 连接（工具沙箱走 SSH 通道）
- [x] OC-16 ✅：实现飞书（Feishu）provider（P1，卡片消息流式更新）
- [x] OC-17 ✅：实现钉钉（DingTalk）provider（P1）

**验收标准**
- Telegram/Discord bot 收到消息后自动触发 Agent，回复内容推送回原平台（P0）
- Cron `every` 类型在应用重启后正确对齐触发时间，不补跑遗漏触发
- `web_search` 工具 DuckDuckGo 无 Key 可用，有 Key 时切换 Brave
- 系统通知在 macOS/Windows 上正确展示（Tauri notification）
- SSH 连接后 Agent 文件工具在远程路径操作成功

---

## 与现有方案的集成边界

| 模块 | 与现有方案的关系 |
|------|----------------|
| ChannelManager | 扩展 `260318-扩展能力方案` 中的消息平台连接器（原方案无实现细节，本文档提供完整接口）|
| ChannelPermissions | 与 `260319-缺陷补充` P1-E 的 4 级权限语义并存：路径级权限（本文档）用于 Channel 场景，4 级语义用于工具调用场景 |
| CronScheduler | 扩展 `260318-mcp-skills` 中的「定时任务」（原方案只有一句话，本文档提供完整实现）|
| web_search | 作为 ToolRegistry 的内置工具注册（`T-07` 工具调用契约），无需外部 MCP server |
| SSHConnectionManager | 新模块，`packages/agent-core/src/ssh/`，桌面端 Phase 4 集成 |
| 系统通知 | Tauri plugin，`apps/desktop/src/notification/`，消费 CronJob/Channel/Agent 事件 |

---

## 备注

- 本文档参考 AIDotNet/OpenCowork v0.6.0 源码（2026-03-19），Apache 2.0 协议。
- 技术栈适配：Electron IPC → Tauri Commands/Events；`BrowserWindow.send()` → Tauri `emit()`；SQLite 使用 better-sqlite3（同 OpenCowork）。
- Channel 系统需要公网 WebHook 端点接收消息推送（Telegram/Discord 等）；本地开发环境可用 ngrok 穿透。
- Memory sync: completed
