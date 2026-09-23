/**
 * 「后台任务」面板的纯数据模型。
 *
 * 把两类后台对象归一为同一份行模型：
 * - 子代理任务：`SessionTask`（父会话的 `recovery.tasks` / `getStatus` / 流内 `task_update`）
 * - 终端与后台命令：`SessionTerminalView`（`useSessionTerminals` 的实时事件 + 兜底对账结果）
 *
 * 本文件是纯函数模块：不 import React、不做 I/O、不读时钟——`now` 由调用方注入，
 * 因此 hook（`use-background-task-panel.ts`）与单测都能完全掌控时间。
 */

import type { SessionTask } from '@openAwork/web-client';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';

/** 后台对象种类：子代理任务 / 终端（含后台命令）。 */
export type BackgroundTaskKind = 'subagent' | 'shell';

/** 归一后的状态词表：两种活跃态 + 三种终态。 */
export type BackgroundTaskState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 面板中的一行（子代理任务或终端）。 */
export interface BackgroundTaskRow {
  /** subagent: task_id；shell: terminalId */
  key: string;
  kind: BackgroundTaskKind;
  state: BackgroundTaskState;
  /** 任务标题 / 命令首行 */
  title: string;
  /** @agent / cwd */
  detail?: string;
  /** 模型侧主键（T-…），可复制 */
  taskId?: string;
  terminalId?: string;
  sessionId?: string;
  agent?: string;
  command?: string;
  cwd?: string;
  startedAtMs: number;
  endedAtMs?: number;
  /** subagent：startedAt - createdAt（排队时长） */
  queuedMs?: number;
  outputBytesTotal?: number;
  terminalKind?: 'foreground' | 'background' | 'tmux';
  errorMessage?: string;
}

/**
 * 汇总条数据。
 * - `runningSubagents` / `runningShells`：只统计**正在运行**的行（排队中不算「运行中」）；
 * - `activeTotal`：活跃行总数（`pending` + `running`），也是「面板是否还需要心跳」的行数口径。
 */
export interface BackgroundTaskSummary {
  runningSubagents: number;
  runningShells: number;
  activeTotal: number;
}

/** 排序分组：运行中 → 排队中 → 终态（终态组内按结束时间倒序）。 */
const STATE_SORT_RANK: Record<BackgroundTaskState, number> = {
  running: 0,
  pending: 1,
  succeeded: 2,
  failed: 2,
  cancelled: 2,
};

/** `SessionTask.status` → 归一状态。 */
const TASK_STATE_BY_STATUS: Record<SessionTask['status'], BackgroundTaskState> = {
  pending: 'pending',
  running: 'running',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
};

/**
 * `SessionTerminalStatus` → 归一状态。
 *
 * - `idle`（进程存活、只是没有新输出）与 `tmux-spawned` 同属活跃；
 * - `aborted` / `killed` / `tmux-killed` 是用户或会话侧主动终止 → cancelled；
 * - `timeout` / `spawn_error` 是失败；`stale`（网关重启后无法确认结果的陈旧行）也按失败处理，
 *   否则会被误读成正常完成；
 * - `exited` 的成败由 `resolveTerminalState` 依据 `exitCode` 细化。
 */
const TERMINAL_STATE_BY_STATUS: Record<SessionTerminalView['status'], BackgroundTaskState> = {
  running: 'running',
  idle: 'running',
  exited: 'succeeded',
  aborted: 'cancelled',
  timeout: 'failed',
  spawn_error: 'failed',
  killed: 'cancelled',
  stale: 'failed',
  'tmux-spawned': 'running',
  'tmux-killed': 'cancelled',
};

/**
 * 归一过程中的中间行：可选字段保持 `undefined`，便于去重时做「有值才覆盖」的合并，
 * 并让标题 / 起始时间等兜底发生在合并**之后**（避免后到行的空字段抹掉先到行的有效字段）。
 */
interface RawBackgroundTaskRow {
  key: string;
  kind: BackgroundTaskKind;
  state: BackgroundTaskState;
  title?: string;
  detail?: string;
  taskId?: string;
  terminalId?: string;
  sessionId?: string;
  agent?: string;
  command?: string;
  cwd?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  outputBytesTotal?: number;
  terminalKind?: 'foreground' | 'background' | 'tmux';
  errorMessage?: string;
  /** 仅用于 subagent 排队时长计算，不进入最终行。 */
  createdAtMs?: number;
}

/**
 * 归一 `SessionTask[]` + `SessionTerminalView[]` 为排序后的行列表。
 *
 * 规则：
 * 1. 状态映射见上表；2. 去重按 (kind, key)，后到行的有值字段覆盖先到行；
 * 3. 排序 `running → pending → 终态`，终态按 `endedAtMs` 倒序，同状态按 `startedAtMs`
 *    升序，最后按 `key` 字典序兜底（与输入顺序无关的稳定序）。
 */
export function buildBackgroundTaskRows(input: {
  tasks: readonly SessionTask[];
  terminals: readonly SessionTerminalView[];
  now: number;
}): BackgroundTaskRow[] {
  const now = Number.isFinite(input.now) ? input.now : 0;
  const rowsByKey = new Map<string, RawBackgroundTaskRow>();

  for (const task of input.tasks) {
    mergeRawRow(rowsByKey, rawRowFromTask(task));
  }
  for (const terminal of input.terminals) {
    // 只收「后台类」终端：`foreground` 是**阻塞式** `bash` 调用与用户自己开的交互终端
    // （`quick_terminal`）——它们不是后台任务，统一由终端面板管理；若收进来，「后台命令」
    // 分组与常驻胶囊会把用户开着的终端算成「后台命令在跑」（实测真实会话 3 个终端全部
    // 是 foreground，含 2 个用户交互终端）。`background`（run_bash_in_background）与
    // `tmux`（interactive_bash）保留；`kind` 缺失时不隐藏（保守，旧网关兼容）。
    if (terminal.kind === 'foreground') {
      continue;
    }
    mergeRawRow(rowsByKey, rawRowFromTerminal(terminal));
  }

  return [...rowsByKey.values()].map((raw) => finalizeRow(raw, now)).sort(compareRows);
}

/** 汇总行列表：只统计活跃（`running` / `pending`）与运行中的两个分项。 */
export function buildBackgroundTaskSummary(
  rows: readonly BackgroundTaskRow[],
): BackgroundTaskSummary {
  let runningSubagents = 0;
  let runningShells = 0;
  let activeTotal = 0;

  for (const row of rows) {
    if (row.state === 'running') {
      if (row.kind === 'subagent') {
        runningSubagents += 1;
      } else {
        runningShells += 1;
      }
      activeTotal += 1;
      continue;
    }

    if (row.state === 'pending') {
      activeTotal += 1;
    }
  }

  return { runningSubagents, runningShells, activeTotal };
}

function rawRowFromTask(task: SessionTask): RawBackgroundTaskRow {
  const state = TASK_STATE_BY_STATUS[task.status];

  return {
    key: task.id,
    kind: 'subagent',
    state,
    title: normalizeText(task.title),
    detail: formatAgentDetail(task.assignedAgent),
    taskId: normalizeText(task.id),
    sessionId: normalizeText(task.sessionId),
    agent: normalizeText(task.assignedAgent),
    startedAtMs: normalizeMs(task.startedAt),
    // 只有终态才暴露结束时间：活跃行若残留 completedAt 也不参与排序 / 展示。
    endedAtMs: isTerminalState(state) ? normalizeMs(task.completedAt) : undefined,
    errorMessage: normalizeText(task.errorMessage),
    createdAtMs: normalizeMs(task.createdAt),
  };
}

function rawRowFromTerminal(terminal: SessionTerminalView): RawBackgroundTaskRow {
  const state = resolveTerminalState(terminal);
  const command = normalizeText(terminal.command);

  return {
    key: terminal.terminalId,
    kind: 'shell',
    state,
    title: firstCommandLine(terminal.command),
    detail: normalizeText(terminal.cwd),
    terminalId: normalizeText(terminal.terminalId),
    sessionId: normalizeText(terminal.sessionId),
    command,
    cwd: normalizeText(terminal.cwd),
    startedAtMs: normalizeMs(terminal.startedAtMs),
    endedAtMs: isTerminalState(state) ? normalizeMs(terminal.endedAtMs) : undefined,
    outputBytesTotal: Number.isFinite(terminal.outputBytesTotal)
      ? terminal.outputBytesTotal
      : undefined,
    terminalKind: terminal.kind,
  };
}

/** `exited` 需要看退出码：显式非 0 视为失败，0 / 未知视为成功。 */
function resolveTerminalState(terminal: SessionTerminalView): BackgroundTaskState {
  if (terminal.status === 'exited' && terminal.exitCode !== undefined && terminal.exitCode !== 0) {
    return 'failed';
  }

  return TERMINAL_STATE_BY_STATUS[terminal.status];
}

/**
 * 去重：同一 (kind, key) 只保留一行。
 * 后到行的有值字段覆盖先到行；终态不会被活跃态回退（防止迟到但更旧的快照让已结束行复活）。
 */
function mergeRawRow(
  rowsByKey: Map<string, RawBackgroundTaskRow>,
  incoming: RawBackgroundTaskRow,
): void {
  const compositeKey = `${incoming.kind}:${incoming.key}`;
  const existing = rowsByKey.get(compositeKey);
  rowsByKey.set(compositeKey, existing === undefined ? incoming : mergeRawRows(existing, incoming));
}

function mergeRawRows(
  base: RawBackgroundTaskRow,
  incoming: RawBackgroundTaskRow,
): RawBackgroundTaskRow {
  return {
    key: base.key,
    kind: base.kind,
    state: mergeState(base.state, incoming.state),
    title: incoming.title ?? base.title,
    detail: incoming.detail ?? base.detail,
    taskId: incoming.taskId ?? base.taskId,
    terminalId: incoming.terminalId ?? base.terminalId,
    sessionId: incoming.sessionId ?? base.sessionId,
    agent: incoming.agent ?? base.agent,
    command: incoming.command ?? base.command,
    cwd: incoming.cwd ?? base.cwd,
    startedAtMs: incoming.startedAtMs ?? base.startedAtMs,
    endedAtMs: incoming.endedAtMs ?? base.endedAtMs,
    outputBytesTotal: incoming.outputBytesTotal ?? base.outputBytesTotal,
    terminalKind: incoming.terminalKind ?? base.terminalKind,
    errorMessage: incoming.errorMessage ?? base.errorMessage,
    createdAtMs: incoming.createdAtMs ?? base.createdAtMs,
  };
}

function mergeState(base: BackgroundTaskState, incoming: BackgroundTaskState): BackgroundTaskState {
  if (isTerminalState(base) && !isTerminalState(incoming)) {
    return base;
  }

  return incoming;
}

/** 合并完成后应用兜底：标题、起始时间、排队时长。 */
function finalizeRow(raw: RawBackgroundTaskRow, now: number): BackgroundTaskRow {
  const row: BackgroundTaskRow = {
    key: raw.key,
    kind: raw.kind,
    state: raw.state,
    title: resolveRowTitle(raw),
    startedAtMs: raw.startedAtMs ?? raw.createdAtMs ?? 0,
  };

  if (raw.detail !== undefined) {
    row.detail = raw.detail;
  }
  if (raw.taskId !== undefined) {
    row.taskId = raw.taskId;
  }
  if (raw.terminalId !== undefined) {
    row.terminalId = raw.terminalId;
  }
  if (raw.sessionId !== undefined) {
    row.sessionId = raw.sessionId;
  }
  if (raw.agent !== undefined) {
    row.agent = raw.agent;
  }
  if (raw.command !== undefined) {
    row.command = raw.command;
  }
  if (raw.cwd !== undefined) {
    row.cwd = raw.cwd;
  }
  if (raw.endedAtMs !== undefined) {
    row.endedAtMs = raw.endedAtMs;
  }

  const queuedMs = resolveQueuedMs(raw, now);
  if (queuedMs !== undefined) {
    row.queuedMs = queuedMs;
  }
  if (raw.outputBytesTotal !== undefined) {
    row.outputBytesTotal = raw.outputBytesTotal;
  }
  if (raw.terminalKind !== undefined) {
    row.terminalKind = raw.terminalKind;
  }
  if (raw.errorMessage !== undefined) {
    row.errorMessage = raw.errorMessage;
  }

  return row;
}

/** 标题兜底：shell 用命令首行，subagent 用任务标题；都没有时给可读占位。 */
function resolveRowTitle(raw: RawBackgroundTaskRow): string {
  if (raw.title !== undefined) {
    return raw.title;
  }

  return raw.kind === 'shell' ? '未命名命令' : '未命名任务';
}

/**
 * 排队时长（仅 pending 子代理）：已开始但未落定用 `startedAt - createdAt`，
 * 尚未开始用 `now - createdAt`；时钟回拨导致的负值夹到 0，`createdAt` 不可信时不给值。
 */
function resolveQueuedMs(raw: RawBackgroundTaskRow, now: number): number | undefined {
  if (raw.kind !== 'subagent' || raw.state !== 'pending') {
    return undefined;
  }

  const createdAtMs = raw.createdAtMs;
  if (createdAtMs === undefined) {
    return undefined;
  }

  const base = raw.startedAtMs ?? now;
  return Math.max(0, base - createdAtMs);
}

function compareRows(a: BackgroundTaskRow, b: BackgroundTaskRow): number {
  const rankDiff = STATE_SORT_RANK[a.state] - STATE_SORT_RANK[b.state];
  if (rankDiff !== 0) {
    return rankDiff;
  }

  if (isTerminalState(a.state)) {
    // 终态组：最近结束的排前面；缺 endedAtMs 时退回 startedAtMs 作为近似键。
    const endedDiff = resolveEndedSortKey(b) - resolveEndedSortKey(a);
    if (endedDiff !== 0) {
      return endedDiff;
    }
  }

  const startedDiff = a.startedAtMs - b.startedAtMs;
  if (startedDiff !== 0) {
    return startedDiff;
  }

  return compareKeys(a.key, b.key);
}

function resolveEndedSortKey(row: BackgroundTaskRow): number {
  return row.endedAtMs ?? row.startedAtMs;
}

/** 字典序（按 UTF-16 码元，不依赖运行环境的 locale）。 */
function compareKeys(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

function isTerminalState(state: BackgroundTaskState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}

function formatAgentDetail(agent: string | undefined): string | undefined {
  const normalized = normalizeText(agent);
  return normalized === undefined ? undefined : `@${normalized}`;
}

/** 命令首行（跳过前导空行），用于 shell 行标题。 */
function firstCommandLine(command: string | undefined): string | undefined {
  if (command === undefined) {
    return undefined;
  }

  for (const line of command.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

/** 空白字符串归一为 `undefined`，让「缺失字段兜底」与去重合并共用同一套判定。 */
function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 时间戳兜底：非有限数或非正数（0 / 负数）视为缺失。 */
function normalizeMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}
