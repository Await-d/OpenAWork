import { useMemo, useState } from 'react';
import { CopyBtn } from '../shared/copy-btn.js';

/**
 * Bash 命令输出专门预览组件
 * 提供：错误行高亮、退出码显示、stdout/stderr 区分
 */

export interface BashOutputLike {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  command?: string;
  durationMs?: number;
}

/**
 * 识别 bash 工具的输出格式
 */
export function extractBashOutputFromOutput(output: unknown): BashOutputLike | null {
  if (!output || typeof output !== 'object') return null;
  const r = output as Record<string, unknown>;

  // 必须有 stdout 或 stderr
  if (typeof r.stdout !== 'string' && typeof r.stderr !== 'string') return null;

  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : undefined,
    command: typeof r.command === 'string' ? r.command : undefined,
    durationMs: typeof r.durationMs === 'number' ? r.durationMs : undefined,
  };
}

const MAX_LINES = 30;

export function BashOutputPreview({
  data,
  defaultExpanded = false,
}: {
  data: BashOutputLike;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasStdout = data.stdout && data.stdout.length > 0;
  const hasStderr = data.stderr && data.stderr.length > 0;
  const exitSuccess = data.exitCode === 0 || data.exitCode === undefined;

  const fullOutput = useMemo(() => {
    const parts: string[] = [];
    if (hasStdout) parts.push(data.stdout!);
    if (hasStderr) parts.push(data.stderr!);
    return parts.join('\n');
  }, [data.stdout, data.stderr, hasStdout, hasStderr]);

  const lines = fullOutput.split('\n');
  const shouldCollapse = lines.length > MAX_LINES;
  const displayLines = expanded || !shouldCollapse ? lines : lines.slice(0, MAX_LINES);

  // 检测错误关键词
  const hasErrors = /error|failed|exception|fatal/i.test(fullOutput);

  return (
    <div className="bash-output-preview">
      <div className="bash-output-header">
        <div className="bash-output-meta">
          {data.command && <span className="bash-output-command">$ {data.command}</span>}
          <span className="bash-output-stats">
            {lines.length} 行
            {data.durationMs !== undefined && ` · ${formatDuration(data.durationMs)}`}
          </span>
        </div>
        <div className="bash-output-actions">
          {data.exitCode !== undefined && (
            <span className="bash-exit-code" data-success={exitSuccess}>
              exit {data.exitCode}
            </span>
          )}
          {hasErrors && <span className="bash-error-badge">包含错误</span>}
          <CopyBtn text={fullOutput} />
        </div>
      </div>

      <div className="bash-output-content">
        {hasStdout && data.stdout && (
          <pre className="bash-output-stdout">{expanded ? data.stdout : displayLines.join('\n')}</pre>
        )}
        {hasStderr && data.stderr && (
          <pre className="bash-output-stderr">
            <span className="bash-stderr-label">stderr:</span>
            {'\n'}
            {data.stderr}
          </pre>
        )}
      </div>

      {shouldCollapse && (
        <button
          type="button"
          className="bash-output-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : `展开全部 (${lines.length} 行)`}
        </button>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
