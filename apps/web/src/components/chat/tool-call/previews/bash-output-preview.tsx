import { useMemo, useState } from 'react';
import { CopyBtn } from '../shared/copy-btn.js';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

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
  const isInsideExpandedCard = useIsInsideExpandedToolCard();
  const effectiveExpanded = expanded || isInsideExpandedCard;

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

  // stdout / stderr 必须各自独立截断。旧实现把**合并后**的 displayLines 塞进
  // stdout 块，于是「stdout 短、stderr 长」时 stderr 的前 29 行会在 stdout 里
  // 重复出现一次，同时 stderr 自己完全不受 MAX_LINES 保护。
  const stdoutLines = useMemo(() => (data.stdout ?? '').split('\n'), [data.stdout]);
  const stderrLines = useMemo(() => (data.stderr ?? '').split('\n'), [data.stderr]);

  // 错误判定以 exitCode / stderr 为准。旧实现对全文匹配
  // /error|failed|exception|fatal/i，`0 failed` 这类成功输出也会亮起徽标。
  const hasErrors = useMemo(() => {
    if (data.exitCode !== undefined && data.exitCode !== 0) return true;
    if (hasStderr && data.stderr && data.stderr.trim().length > 0) return true;
    return /(^|\n)\s*(error|exception|fatal)\b/im.test(fullOutput);
  }, [data.exitCode, data.stderr, hasStderr, fullOutput]);

  const stdoutBody = effectiveExpanded ? data.stdout : stdoutLines.slice(0, MAX_LINES).join('\n');
  const stderrBody = effectiveExpanded ? data.stderr : stderrLines.slice(0, MAX_LINES).join('\n');

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
        {hasStdout && data.stdout && <pre className="bash-output-stdout">{stdoutBody}</pre>}
        {hasStderr && data.stderr && (
          <pre className="bash-output-stderr">
            <span className="bash-stderr-label">stderr:</span>
            {'\n'}
            {stderrBody}
          </pre>
        )}
      </div>

      {shouldCollapse && !isInsideExpandedCard && (
        <button type="button" className="bash-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {effectiveExpanded ? '收起' : `展开全部 (${lines.length} 行)`}
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
