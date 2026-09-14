import { ExpandableOutput } from '../shared/expandable-output.js';

/**
 * Background-bash tools (`run_bash_in_background` / `bash_output` /
 * `bash_kill`) all return a terminal-shaped payload keyed by `terminalId`
 * (see the gateway's `run-background-bash-tools.ts`). Rendering that as a
 * key/value dump hides the one thing users care about — the tail output —
 * so we surface status, command and output explicitly.
 */
export interface BackgroundTerminalView {
  command?: string;
  cwd?: string;
  exitCode?: number;
  kill?: {
    alreadyClosed: boolean;
    found: boolean;
    killed: boolean;
  };
  outputBytesTotal?: number;
  outputTail?: string;
  status: string;
  terminalId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function extractBackgroundTerminal(output: unknown): BackgroundTerminalView | null {
  const record = asRecord(output);
  if (!record) return null;
  const terminalId = record['terminalId'];
  if (typeof terminalId !== 'string' || terminalId.length === 0) return null;

  const view: BackgroundTerminalView = {
    status: typeof record['status'] === 'string' ? record['status'] : 'unknown',
    terminalId,
  };
  if (typeof record['command'] === 'string') view.command = record['command'];
  if (typeof record['cwd'] === 'string') view.cwd = record['cwd'];
  if (typeof record['exitCode'] === 'number') view.exitCode = record['exitCode'];
  if (typeof record['outputTail'] === 'string') view.outputTail = record['outputTail'];
  if (typeof record['outputBytesTotal'] === 'number') {
    view.outputBytesTotal = record['outputBytesTotal'];
  }
  if (typeof record['found'] === 'boolean' || typeof record['killed'] === 'boolean') {
    view.kill = {
      alreadyClosed: record['alreadyClosed'] === true,
      found: record['found'] === true,
      killed: record['killed'] === true,
    };
  }
  return view;
}

function statusTone(status: string): 'danger' | 'muted' | 'running' | 'success' | 'warning' {
  switch (status) {
    case 'running':
      return 'running';
    case 'exited':
      return 'success';
    case 'killed':
    case 'aborted':
      return 'muted';
    case 'timeout':
    case 'spawn_error':
      return 'danger';
    default:
      return 'warning';
  }
}

function killSummary(kill: NonNullable<BackgroundTerminalView['kill']>): string {
  if (kill.killed) return '已发送终止信号';
  if (kill.alreadyClosed) return '该终端早已退出';
  if (!kill.found) return '未找到该终端';
  return '未终止';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  return `${bytes} B`;
}

export function BackgroundTerminalPreview({ view }: { view: BackgroundTerminalView }) {
  const tone = statusTone(view.status);
  return (
    <div className="bg-term" data-tone={tone}>
      <div className="bg-term-head">
        <span className="bg-term-status">{view.status}</span>
        <span className="bg-term-id">{view.terminalId}</span>
      </div>
      {view.command && <code className="bg-term-command">{view.command}</code>}
      <div className="bg-term-meta">
        {view.cwd && <span>{view.cwd}</span>}
        {view.exitCode !== undefined && <span>退出码 {view.exitCode}</span>}
        {view.outputBytesTotal !== undefined && (
          <span>累计输出 {formatBytes(view.outputBytesTotal)}</span>
        )}
        {view.kill && <span>{killSummary(view.kill)}</span>}
      </div>
      {view.outputTail && view.outputTail.length > 0 && (
        <ExpandableOutput text={view.outputTail} maxChars={600} maxLines={18} />
      )}
    </div>
  );
}
