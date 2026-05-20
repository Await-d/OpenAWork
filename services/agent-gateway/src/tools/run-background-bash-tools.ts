/**
 * Background bash tools — three tools that let the model spawn a
 * detached shell command, poll its output, and kill it without
 * blocking the LLM stream.
 *
 *   run_bash_in_background → spawn + register + return terminalId
 *   bash_output            → poll status / tail by terminalId
 *   bash_kill              → trigger abort on terminalId
 *
 * Spawn lifecycle reuses `runBashCommand` with `tracking.kind='background'`
 * but is fired-and-forgotten (no await), so the public dispatch returns
 * the terminalId immediately. The registry handles state transitions
 * (running → exited|aborted|timeout|spawn_error|killed) and broadcasts
 * `terminal_*` RunEvents which the UI consumes.
 *
 * Security: relies on the same `assertSafeBashCommand` deny-list and
 * `resolveBashWorkdir` workspace guard as the foreground `bash` tool.
 *
 * Limits:
 *   - Max simultaneous background terminals per session is governed by
 *     `OPENAWORK_BACKGROUND_BASH_MAX_ACTIVE` (default 8). Beyond the
 *     ceiling, spawn is rejected with a structured error so the model
 *     can wait for existing tasks to finish.
 *   - Timeout default is 24 h (the registry only emits a `timeout`
 *     transition once the underlying spawn hits it; killing earlier is
 *     up to the model or the user).
 */

import { randomBytes } from 'node:crypto';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { deriveBashDescription, runBashCommand } from './bash-tools.js';
import {
  getTerminal,
  killTerminal,
  listSessionTerminals,
} from '../session/session-terminal-registry.js';

const DEFAULT_BACKGROUND_TIMEOUT_MS = (() => {
  const raw = process.env['OPENAWORK_BACKGROUND_BASH_DEFAULT_TIMEOUT_MS'];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24 * 60 * 60 * 1000;
})();

const MAX_BACKGROUND_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_ACTIVE_BACKGROUND_PER_SESSION = (() => {
  const raw = process.env['OPENAWORK_BACKGROUND_BASH_MAX_ACTIVE'];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
})();

// ---------- Schemas ----------

const runBackgroundBashInputSchema = z.object({
  command: z.string().min(1).describe('要在后台执行的单行 shell 命令（不要嵌入换行）'),
  description: z
    .string()
    .min(1)
    .optional()
    .describe(
      '可选：用 5-10 个词清晰描述这个后台命令。省略时由 command 前缀自动生成。示例：\n输入：npm run dev\n输出：启动开发服务器\n\n输入：pnpm exec vitest run\n输出：运行单元测试\n\n输入：tail -F build.log\n输出：持续跟踪构建日志',
    ),
  workdir: z.string().min(1).optional().describe('命令执行的工作目录绝对路径。默认工作区根目录。'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(MAX_BACKGROUND_TIMEOUT_MS)
    .optional()
    .describe('后台命令超时（毫秒），到期会被自动 SIGTERM。默认 24h。'),
});

export type RunBackgroundBashInput = z.infer<typeof runBackgroundBashInputSchema>;

const runBackgroundBashOutputSchema = z.object({
  terminalId: z.string(),
  status: z.string(),
  startedAtMs: z.number(),
  command: z.string(),
  cwd: z.string(),
});

const bashOutputInputSchema = z.object({
  terminal_id: z.string().min(1).describe('run_bash_in_background 返回的 terminalId'),
  since_bytes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('只返回累计输出超过此字节数之后的尾段；默认 0 返回全部缓存的 tail'),
});

const bashOutputOutputSchema = z.object({
  terminalId: z.string(),
  status: z.string(),
  exitCode: z.number().int().optional(),
  outputTail: z.string(),
  outputBytesTotal: z.number().int(),
  startedAtMs: z.number(),
  endedAtMs: z.number().optional(),
  command: z.string(),
  cwd: z.string(),
});

const bashKillInputSchema = z.object({
  terminal_id: z.string().min(1),
});

const bashKillOutputSchema = z.object({
  terminalId: z.string(),
  found: z.boolean(),
  alreadyClosed: z.boolean(),
  killed: z.boolean(),
});

// ---------- Tool definitions (model-facing description only; the
// actual execution flows through the gateway-managed dispatch in
// tool-sandbox.ts, mirroring how `background_output` / `background_cancel`
// stub their `execute` to a hard error). ----------

export const runBashInBackgroundToolDefinition: ToolDefinition<
  typeof runBackgroundBashInputSchema,
  typeof runBackgroundBashOutputSchema
> = {
  name: 'run_bash_in_background',
  description:
    '在后台启动一条 bash 命令并立即返回 terminalId，命令在后台持续运行直到自然退出或被 bash_kill 终止。' +
    '\n\n用途：长时间任务（dev server、watch、批量数据处理、抓取日志等）。' +
    '\n约束：' +
    '\n- 命令同样受安全规则限制（不允许 sudo / 反引号 / $() / 多行 / PATH=*）。' +
    '\n- 若需要在退出后查看完整输出，调 bash_output(terminalId)。' +
    '\n- 想要中断，调 bash_kill(terminalId)。' +
    '\n- 与前台 bash 共享同一终端登记表，前端可见。',
  inputSchema: runBackgroundBashInputSchema,
  outputSchema: runBackgroundBashOutputSchema,
  timeout: 5_000,
  execute: async () => {
    throw new Error('run_bash_in_background must execute through the gateway-managed sandbox path');
  },
};

export const bashOutputToolDefinition: ToolDefinition<
  typeof bashOutputInputSchema,
  typeof bashOutputOutputSchema
> = {
  name: 'bash_output',
  description:
    '查看某个后台 bash 终端的最新状态与末段输出。可重复调用以拉取新增的输出。' +
    '\n返回字段：' +
    '\n- status: running / exited / aborted / timeout / spawn_error / killed' +
    '\n- exitCode: 退出时存在' +
    '\n- outputTail: 最后 8KB 输出（utf-8 安全）' +
    '\n- outputBytesTotal: 整个会话累计字节数（含已被截断的部分）',
  inputSchema: bashOutputInputSchema,
  outputSchema: bashOutputOutputSchema,
  timeout: 10_000,
  execute: async () => {
    throw new Error('bash_output must execute through the gateway-managed sandbox path');
  },
};

export const bashKillToolDefinition: ToolDefinition<
  typeof bashKillInputSchema,
  typeof bashKillOutputSchema
> = {
  name: 'bash_kill',
  description:
    '终止指定后台 bash 终端。等价于用户在前端 UI 点击 kill，会发 SIGTERM（3s 后 SIGKILL）。' +
    '\n返回 { found, alreadyClosed, killed }，alreadyClosed=true 表示终端早已退出。',
  inputSchema: bashKillInputSchema,
  outputSchema: bashKillOutputSchema,
  timeout: 5_000,
  execute: async () => {
    throw new Error('bash_kill must execute through the gateway-managed sandbox path');
  },
};

// ---------- Gateway-managed dispatchers ----------

function generateBackgroundTerminalId(): string {
  return `term_${randomBytes(8).toString('hex')}`;
}

export interface BackgroundBashDispatchContext {
  sessionId: string;
  userId: string;
  clientRequestId?: string;
  toolCallId?: string;
}

export interface BackgroundBashSpawnResult {
  terminalId: string;
  status: string;
  startedAtMs: number;
  command: string;
  cwd: string;
}

/**
 * Spawn a background bash command, register it in the session terminal
 * registry, and return immediately. The promise from `runBashCommand`
 * is intentionally NOT awaited — its eventual resolution (exit / abort /
 * timeout / spawn_error) is observed through the registry's
 * `markTerminalExited` call, which broadcasts `terminal_exited`.
 */
export async function dispatchRunBashInBackground(input: {
  context: BackgroundBashDispatchContext;
  rawInput: unknown;
}): Promise<{ ok: true; output: BackgroundBashSpawnResult } | { ok: false; error: string }> {
  const parsed = runBackgroundBashInputSchema.safeParse(input.rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }

  // Enforce per-session background-active ceiling so a model can't flood
  // the host with long-lived spawns. The check uses the runtime registry
  // (DB-backed), so it survives gateway restarts and races correctly with
  // killTerminal / markTerminalExited.
  const running = listSessionTerminals({
    sessionId: input.context.sessionId,
    userId: input.context.userId,
    includeClosed: false,
    limit: 200,
  }).filter((t) => t.kind === 'background');
  if (running.length >= MAX_ACTIVE_BACKGROUND_PER_SESSION) {
    return {
      ok: false,
      error: `当前会话后台 bash 数量已达上限 (${MAX_ACTIVE_BACKGROUND_PER_SESSION})。请等待已有任务退出或先调 bash_kill。`,
    };
  }

  const terminalId = generateBackgroundTerminalId();
  const abortController = new AbortController();
  const startedAtMs = Date.now();

  // Build the bash input. runBashCommand will register the terminal
  // up-front with kind='background' and our pre-allocated terminalId.
  const bashInput = {
    command: parsed.data.command,
    description: parsed.data.description ?? deriveBashDescription(parsed.data.command),
    ...(parsed.data.workdir ? { workdir: parsed.data.workdir } : {}),
    timeout: parsed.data.timeout ?? DEFAULT_BACKGROUND_TIMEOUT_MS,
  };

  // Fire-and-forget. Errors are swallowed here because the registry has
  // already recorded the failure (spawn_error → markTerminalExited) and
  // the model will see it through bash_output(terminalId).
  void runBashCommand(bashInput, {
    signal: abortController.signal,
    tracking: {
      sessionId: input.context.sessionId,
      userId: input.context.userId,
      ...(input.context.clientRequestId ? { clientRequestId: input.context.clientRequestId } : {}),
      ...(input.context.toolCallId ? { toolCallId: input.context.toolCallId } : {}),
      toolName: 'run_bash_in_background',
      kind: 'background',
      description: parsed.data.description ?? deriveBashDescription(parsed.data.command),
      abortController,
      terminalId,
      metadata: {
        timeoutMs: bashInput.timeout,
      },
    },
  }).catch((err: unknown) => {
    console.warn(
      `[background-bash] runBashCommand rejected unexpectedly for ${terminalId}:`,
      err instanceof Error ? err.message : String(err),
    );
  });

  // Look the registry row up so we return the canonical cwd (after
  // workspace validation) instead of echoing the user-supplied path.
  const record = getTerminal(terminalId, input.context.userId);
  return {
    ok: true,
    output: {
      terminalId,
      status: record?.status ?? 'running',
      startedAtMs: record?.startedAtMs ?? startedAtMs,
      command: parsed.data.command,
      cwd: record?.cwd ?? parsed.data.workdir ?? '',
    },
  };
}

export type BashOutputResult = z.infer<typeof bashOutputOutputSchema>;

export function dispatchBashOutput(input: {
  context: BackgroundBashDispatchContext;
  rawInput: unknown;
}): { ok: true; output: BashOutputResult } | { ok: false; error: string } {
  const parsed = bashOutputInputSchema.safeParse(input.rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }
  const record = getTerminal(parsed.data.terminal_id, input.context.userId);
  if (!record) {
    return {
      ok: false,
      error: `terminal_id 不存在或不属于当前用户：${parsed.data.terminal_id}`,
    };
  }
  if (record.sessionId !== input.context.sessionId) {
    return {
      ok: false,
      error: `terminal_id ${parsed.data.terminal_id} 不属于当前会话。`,
    };
  }
  // Apply since_bytes filter (suffix-based) so the model can poll
  // incremental output cheaply.
  let tail = record.outputTail;
  if (parsed.data.since_bytes !== undefined && parsed.data.since_bytes >= 0) {
    const skip = parsed.data.since_bytes;
    // outputTail is at most 8KB, so we can't slice across the whole
    // history; we approximate by trimming the same-length prefix off the
    // tail when since_bytes lands inside it. Otherwise return tail intact.
    const tailBytes = Buffer.byteLength(tail, 'utf-8');
    const tailStartByte = Math.max(0, record.outputBytesTotal - tailBytes);
    if (skip > tailStartByte) {
      const cut = Math.min(tailBytes, skip - tailStartByte);
      const buf = Buffer.from(tail, 'utf-8').subarray(cut);
      // Re-align to a utf-8 boundary just like tailUtf8 in the registry.
      let start = 0;
      while (start < buf.length && (buf[start]! & 0b1100_0000) === 0b1000_0000) {
        start += 1;
      }
      tail = buf.subarray(start).toString('utf-8');
    }
  }
  return {
    ok: true,
    output: {
      terminalId: record.terminalId,
      status: record.status,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      outputTail: tail,
      outputBytesTotal: record.outputBytesTotal,
      startedAtMs: record.startedAtMs,
      ...(record.endedAtMs !== undefined ? { endedAtMs: record.endedAtMs } : {}),
      command: record.command,
      cwd: record.cwd,
    },
  };
}

export type BashKillResult = z.infer<typeof bashKillOutputSchema>;

export function dispatchBashKill(input: {
  context: BackgroundBashDispatchContext;
  rawInput: unknown;
}): { ok: true; output: BashKillResult } | { ok: false; error: string } {
  const parsed = bashKillInputSchema.safeParse(input.rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }
  const record = getTerminal(parsed.data.terminal_id, input.context.userId);
  if (!record) {
    return {
      ok: true,
      output: {
        terminalId: parsed.data.terminal_id,
        found: false,
        alreadyClosed: false,
        killed: false,
      },
    };
  }
  if (record.sessionId !== input.context.sessionId) {
    return {
      ok: false,
      error: `terminal_id ${parsed.data.terminal_id} 不属于当前会话。`,
    };
  }
  const result = killTerminal({
    terminalId: parsed.data.terminal_id,
    userId: input.context.userId,
  });
  return {
    ok: true,
    output: {
      terminalId: parsed.data.terminal_id,
      found: result.found,
      alreadyClosed: result.alreadyClosed,
      killed: result.killed,
    },
  };
}
