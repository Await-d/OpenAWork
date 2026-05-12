# 260512 — 会话终端跟踪与后台 bash Spec

> 让 chat 会话里每一次跑过的终端（同步 `bash` / `interactive_bash`(tmux) / 新增的后台 bash）都被登记下来，前端可以实时看到「正在跑的终端」+「最近退出的终端」，用户可以**单独 kill 一条命令而不打断整轮 LLM 对话**；同时给模型一组真正的后台 bash 工具，可以 spawn → 走开 → 拉日志 → 终止。

## 1. 现状与痛点

- `services/agent-gateway/src/bash-tools.ts` 的 `runBashCommand` 是**同步阻塞**的，默认超时 2 分钟、上限 30 分钟。在它执行期间：
  - 用户看不到 pid / cwd / 命令文本 / 实时输出（前端只会在 `tool_result` 落地后才看见完整 output）。
  - 「停止」按钮通过 `abortController` 中断整轮 LLM stream，把当前 bash 一起杀掉。**没法只杀这一条命令、让对话继续。**
  - 命令是「fire-and-forget 风格的瞬时记录」——一旦退出，除了 `session_messages` 里的 tool_result 不会有任何状态痕迹。
- `services/agent-gateway/src/interactive-bash-tools.ts` 把 tmux 子命令通过 `execFile` 走完即返回，不存任何 lifecycle 元数据。模型新建了一个 tmux 会话之后，用户在前端是看不见的。
- 模型想跑「持久 dev server / 长任务」目前只能在 bash 命令里 `nohup ... &` 然后用 `interactive_bash`/`tail` 之类的方式拉日志，**没有结构化的「后台进程」概念**。

## 2. 决策摘要

1. **统一注册中心**：一张 `session_terminals` SQLite 表 + 一个内存注册中心（in-memory map），所有跟终端生命周期相关的事件都过它。
2. **跟踪范围**：
   - 前台 `bash` 工具：每次进入 `runBashCommand` 就 register，spawn 拿到 pid 后回填，退出 markExited。
   - `interactive_bash`(tmux)：只跟踪 `new-session` / `kill-session` / `kill-server` 三类 lifecycle，命令完成后 `session_terminals.status` 写 `tmux-spawned` / `tmux-killed`。
   - 新增三件套 `run_bash_in_background` / `bash_output` / `bash_kill`：模型显式 spawn → 拿 terminalId → 拉日志 / kill。
3. **持久化策略**：
   - 终端元数据 + 末段输出快照写入 SQLite（重启后还能列出"最近退出的终端"）。
   - 完整输出走文件落盘（复用 `bash-output-truncator` 的 `TRUNCATION_DIR`），数据库只存 tail（最后 8KB）。
4. **干预方式**：
   - 单独 kill 一条命令 → 触发那条命令的 `AbortController`，仅杀进程组，**不影响 LLM stream**。
   - 前台 bash 被 kill：模型当轮拿到 `kind='aborted'` 的 tool_result，可以继续推理（沿用 opencode `<bash_metadata>` 协议）。
   - 后台 bash 被 kill：模型下次调 `bash_output` 拿到 `status='killed'`。
5. **事件协议**：扩展 `RunEvent` 联合体加 `terminal_started` / `terminal_output` / `terminal_exited`，复用现有 `publishSessionRunEvent` 推送通道；前端在现有 SSE/WS 流里订阅。
6. **重启恢复**：进程启动时把数据库里 `status='running'` 的行全部标为 `stale`（pid 已失效），不尝试 reattach。

## 3. 数据模型

新增一张表，加到 `services/agent-gateway/src/db.ts` 的 `migrate()`：

```sql
CREATE TABLE IF NOT EXISTS session_terminals (
  terminal_id        TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id  TEXT,
  tool_name          TEXT NOT NULL,                 -- 'bash' | 'interactive_bash' | 'run_bash_in_background'
  kind               TEXT NOT NULL,                 -- 'foreground' | 'background' | 'tmux'
  command            TEXT NOT NULL,
  description        TEXT,
  cwd                TEXT NOT NULL,
  pid                INTEGER,
  status             TEXT NOT NULL,                 -- 'running' | 'exited' | 'aborted' | 'timeout'
                                                    -- | 'spawn_error' | 'killed' | 'stale'
                                                    -- | 'tmux-spawned' | 'tmux-killed'
  exit_code          INTEGER,
  started_at_ms      INTEGER NOT NULL,
  ended_at_ms        INTEGER,
  last_activity_ms   INTEGER NOT NULL,
  output_bytes_total INTEGER NOT NULL DEFAULT 0,
  output_tail        TEXT NOT NULL DEFAULT '',      -- 末尾 8KB 快照（utf-8 safe）
  output_path        TEXT,                          -- 全量输出落盘路径（可选）
  metadata_json      TEXT NOT NULL DEFAULT '{}'     -- 工具特定附加信息
);
CREATE INDEX IF NOT EXISTS idx_session_terminals_session ON session_terminals(session_id, started_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_session_terminals_status ON session_terminals(status, session_id);
```

约束：
- `terminal_id` = `term_<8B hex>`，本进程内唯一，跨重启稳定（直接持久化）。
- `output_tail` 长度上限 `TERMINAL_OUTPUT_TAIL_BYTES = 8192`，按 utf-8 边界截断。
- 表里 `pid` 仅作为信息展示，不依赖它做精确控制（重启后 pid 已经失效）。

## 4. 注册中心 API

`services/agent-gateway/src/session-terminal-registry.ts`：

```ts
export interface RegisterTerminalInput {
  sessionId: string;
  userId: string;
  clientRequestId?: string;
  toolName: 'bash' | 'interactive_bash' | 'run_bash_in_background';
  kind: 'foreground' | 'background' | 'tmux';
  command: string;
  description?: string;
  cwd: string;
  metadata?: Record<string, unknown>;
  abortController?: AbortController; // 让 killTerminal() 能触发中断
}

export interface SessionTerminalRecord {
  terminalId: string;
  sessionId: string;
  userId: string;
  clientRequestId?: string;
  toolName: string;
  kind: 'foreground' | 'background' | 'tmux';
  command: string;
  description?: string;
  cwd: string;
  pid?: number;
  status:
    | 'running' | 'exited' | 'aborted' | 'timeout' | 'spawn_error'
    | 'killed' | 'stale' | 'tmux-spawned' | 'tmux-killed';
  exitCode?: number;
  startedAtMs: number;
  endedAtMs?: number;
  lastActivityMs: number;
  outputBytesTotal: number;
  outputTail: string;
  outputPath?: string;
  metadata: Record<string, unknown>;
}

export function registerTerminal(input: RegisterTerminalInput): SessionTerminalRecord;
export function setTerminalPid(terminalId: string, pid: number | undefined): void;
export function appendTerminalOutput(terminalId: string, snapshot: string): void;
export function markTerminalExited(input: {
  terminalId: string;
  status: SessionTerminalRecord['status'];
  exitCode?: number;
  outputPath?: string;
}): void;
export function listSessionTerminals(input: {
  sessionId: string;
  userId: string;
  includeClosed?: boolean;        // 默认 true，false 仅返回 status='running'
  limit?: number;                 // 默认 50
}): SessionTerminalRecord[];
export function getTerminal(terminalId: string, userId: string): SessionTerminalRecord | null;
export function killTerminal(input: { terminalId: string; userId: string }): {
  found: boolean; alreadyClosed: boolean; killed: boolean;
};
export function reconcileStaleRunningTerminalsAtBoot(): number;
```

行为约束：
- `appendTerminalOutput(snapshot)`：snapshot 是**累积**的 stdout+stderr 文本（与 `bash-tools.onPartialOutput` 契约一致）。
  - `outputBytesTotal` ← `Math.max(prev, byteLength(snapshot))`。
  - `outputTail` ← 末尾 8KB（utf-8 safe）。
  - 触发 `terminal_output` 事件（节流：≥ 100ms 一次 + 退出前 flush）。
- `killTerminal`：
  1. 找内存记录的 `abortController`，`.abort()` 它（前台 bash + 后台 bash 都靠这个走 `spawnAndCollect` 的 `onAbort` 分支）。
  2. 兜底：如果有 pid 且未退出，发 `process.kill(-pid, 'SIGTERM')`，3 秒后再 `SIGKILL`。
  3. 不主动写 DB，等 `spawnAndCollect` 退出回调走正常的 `markTerminalExited`。
- 注册中心是单进程内的；多副本部署目前不在考虑范围（gateway 当前也是单进程）。

## 5. 事件协议

`packages/shared/src/index.ts` 新增：

```ts
export interface StreamTerminalStartedChunk {
  type: 'terminal_started';
  terminalId: string;
  sessionId: string;
  toolName: string;
  kind: 'foreground' | 'background' | 'tmux';
  command: string;
  description?: string;
  cwd: string;
  startedAtMs: number;
  clientRequestId?: string;
  toolCallId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamTerminalOutputChunk {
  type: 'terminal_output';
  terminalId: string;
  outputTail: string;
  outputBytesTotal: number;
  occurredAt?: number;
  eventId?: string;
  runId?: string;
}

export interface StreamTerminalExitedChunk {
  type: 'terminal_exited';
  terminalId: string;
  status: SessionTerminalRecord['status'];
  exitCode?: number;
  endedAtMs: number;
  occurredAt?: number;
  eventId?: string;
  runId?: string;
}
```

加入 `RunEvent` 联合体。通过 `publishSessionRunEvent(sessionId, chunk, { clientRequestId })` 发布；现有 SSE attach + WS 流自动转发。

## 6. 工具改造

### 6.1 `runBashCommand` 增加 tracking

`services/agent-gateway/src/bash-tools.ts`：

```ts
interface RunOptions {
  signal?: AbortSignal;
  onPartialOutput?: (text: string) => void;
  tracking?: {
    sessionId: string;
    userId: string;
    clientRequestId?: string;
    toolCallId?: string;
    toolName: 'bash' | 'run_bash_in_background';
    kind: 'foreground' | 'background';
    description?: string;
    /** 由调用方提供的 AbortController，killTerminal 会触发它 */
    abortController?: AbortController;
  };
}
```

实现：
1. 函数开头 `registerTerminal()` 拿到 `terminalId`。
2. `spawnAndCollect` 创建子进程后回调 `setTerminalPid(child.pid)`。
3. `onPartialOutput` 内部包一层：先调原始 `onPartialOutput`，再 `appendTerminalOutput`。
4. 退出时根据 `outcome.kind` 映射到 status：
   - `exit` → `'exited'`
   - `timeout` → `'timeout'`
   - `aborted` → `'aborted'`（如果是被 killTerminal 触发的，前端事件已经先发了）
   - `spawn_error` → `'spawn_error'`
5. 截断后的 `outputPath`（如果有）写入 `markTerminalExited` 的 `outputPath`。

### 6.2 后台 bash 三件套

新建 `services/agent-gateway/src/run-background-bash-tools.ts`：

- `run_bash_in_background({ command, description, workdir?, timeout? })` → 同步登记 + 立刻返回 `{ terminalId, pid?, startedAtMs }`；命令在后台跑直到自然退出或被 kill。
- `bash_output({ terminal_id, since_bytes? })` → 返回当前 `{ status, exitCode?, outputTail, outputBytesTotal, startedAtMs, endedAtMs? }`，可按 `since_bytes` 增量截取末尾。
- `bash_kill({ terminal_id })` → 调 `killTerminal`，返回 `{ found, alreadyClosed, killed }`。

实现细节：
- 后台 bash 复用 `runBashCommand`，但用 `tracking.kind='background'`，并且**不 await**：在 sandbox 路径里 `void runBashCommand(...).catch(...)`，立刻返回 terminalId。
- timeout 上限 24h（环境变量 `OPENAWORK_BACKGROUND_BASH_MAX_TIMEOUT_MS`）；默认无超时。
- 安全限制完全复用 `assertSafeBashCommand` + `resolveBashWorkdir`。
- 工具加入 `tool-definitions.ts` `MODEL_VISIBLE_GATEWAY_TOOLS` + JSON schema。

### 6.3 tmux lifecycle 跟踪

`services/agent-gateway/src/interactive-bash-tools.ts`：

- 解析 `parts` 第一个 token：
  - `new-session` / `new` → 命令成功后 `registerTerminal({ kind:'tmux', toolName:'interactive_bash', status='tmux-spawned' })`（直接进入 `tmux-spawned` 状态，跳过 running）。
  - `kill-session` / `kill-server` → 命令成功后把对应 session 的记录 `markTerminalExited('tmux-killed')`。
- session id 的解析按 `-s <name>` 或 `-t <name>` 提取；找不到就拿命令文本作为 `command` 字段。

## 7. 路由

新建 `services/agent-gateway/src/routes/session-terminals.ts`，全部 `requireAuth`：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/sessions/:sessionId/terminals?status=running\|all&limit=50` | 列表 |
| `GET` | `/api/sessions/:sessionId/terminals/:terminalId` | 详情（含 outputTail，可选 `?full=true` 读 `outputPath`） |
| `POST` | `/api/sessions/:sessionId/terminals/:terminalId/kill` | kill |
| `DELETE` | `/api/sessions/:sessionId/terminals/:terminalId` | 清理已退出记录（只允许删 closed） |

返回 `SessionTerminalRecord` 投影（去掉 `userId`、`metadata`）。

`services/agent-gateway/src/index.ts` 调 `app.register(sessionTerminalsRoutes)`。

## 8. 前端

### 8.1 API 客户端

`apps/web/src/pages/chat-page/terminals-api.ts`：`listTerminals` / `getTerminal` / `killTerminal`。

### 8.2 实时状态

在 `apps/web/src/pages/ChatPage.tsx` 已有的 SSE 事件循环里，加 3 个 case：
- `terminal_started` → 把记录塞进 `liveTerminals` map。
- `terminal_output` → 更新对应 record 的 `outputTail` + `outputBytesTotal`。
- `terminal_exited` → 更新 `status` / `endedAtMs` / `exitCode`。

加载会话时还要 `GET /sessions/:id/terminals?status=all&limit=50` 做一次 hydration，保证 SSE 错过的事件也能补上。

### 8.3 UI

新组件 `apps/web/src/components/chat/SessionTerminalsPanel.tsx`：
- 顶栏角标：`🖥 N`（N = 当前 status='running' 计数），点击展开抽屉。
- 抽屉列表：每行 `command`（截断 60 字符）+ 状态 chip + 起止时间 + 「查看」「kill」按钮。
- 点击「查看」展开内联日志区，渲染 `outputTail`（黑底 mono 字体，最多 200 行）。
- 「kill」按钮：调 API → 乐观更新 status 为 `killing`（前端临时态）→ 等 `terminal_exited` 事件落地。

挂载点：`ChatPage` 标题栏右侧（紧贴现有的 Token usage / Stop 按钮）。

## 9. 测试

后端 vitest：
1. `session-terminal-registry.test.ts`
   - register → pid 回填 → output 累积 → markExited → list 投影。
   - killTerminal: 找不到 / 已退出 / 正常 abort 三条路径。
   - boot-time reconcile：先插入两条 `status='running'`，调 `reconcileStaleRunningTerminalsAtBoot` 应改成 `stale`。
2. `bash-tools-tracking.test.ts`
   - 跑 `echo` 命令 → 应该有一条 `status='exited'` 记录、outputTail 包含 echo 内容。
   - 跑 `sleep 5` + 外部 abort → `status='aborted'`。
   - 跑超时命令 → `status='timeout'`。
3. `run-background-bash-tools.test.ts`
   - `run_bash_in_background` 返回 terminalId，注册中心马上看得到 running。
   - `bash_output` 在命令退出后返回 `status='exited'`。
   - `bash_kill` 在 running 时返回 `killed:true`，之后 `bash_output` 看到 `status='aborted'`。
4. `session-terminals-routes.test.ts`
   - GET 列表 + 状态过滤。
   - POST kill 触发 markExited。
   - 鉴权失败、跨用户访问 404。

前端 vitest：
- `SessionTerminalsPanel.test.tsx`
  - 给定初始 list → 渲染条数 + kill 按钮可见。
  - 派发 `terminal_output` 事件 → tail 更新。
  - 点 kill → 调到 API + 乐观态切换。

## 10. 验证命令

```bash
pnpm exec tsc -b tsconfig.typecheck.json --force                 # services/agent-gateway
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/session-terminal-registry.test.ts \
  src/__tests__/bash-tools-tracking.test.ts \
  src/__tests__/run-background-bash-tools.test.ts \
  src/__tests__/session-terminals-routes.test.ts

pnpm --filter @openAwork/web exec tsc --noEmit
pnpm --filter @openAwork/web exec vitest run \
  src/components/chat/SessionTerminalsPanel.test.tsx
```

## 11. 风险与回退

- **后台 bash 失控**：模型大量 spawn 长时间任务可能跑满机器。对策：会话级活跃后台终端上限 `OPENAWORK_BACKGROUND_BASH_MAX_ACTIVE=8`（超过拒绝 spawn），并在工具 description 里写明。
- **kill 不掉**：`process.kill(-pid, 'SIGTERM')` 在某些 shell 内嵌进程里可能漏杀，已经在 `bash-tools.ts:killTree` 走过 SIGKILL grace 路径，复用即可。
- **DB 涨太快**：每条命令一行 + 8KB tail；如果一个会话跑 500 条 bash，约 4MB。前端只默认拉最近 50 条，DB 不主动清理（与现有 `session_messages` 策略一致）。
- **协议向下兼容**：新增的 `terminal_*` chunk 加入 RunEvent 联合体后，旧版本前端会忽略未知 type（已有的 `default` 兜底）。
