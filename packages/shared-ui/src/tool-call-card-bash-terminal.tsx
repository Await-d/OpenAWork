import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { tokens } from './tokens.js';

export interface BashTerminalView {
  command?: string;
  cwd?: string;
  exitCode?: number;
  mode?: 'live' | 'structured' | 'plain';
  output?: string;
  processId?: string;
  summary?: {
    errorLikeLines?: number;
    live?: boolean;
    mode?: 'compact' | 'full' | 'tail';
    noisy?: boolean;
    stderrLines?: number;
    stdoutLines?: number;
    totalChars?: number;
    totalLines?: number;
    warningLikeLines?: number;
  };
  stderr?: string;
  stdout?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readRawString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compactTerminalText(value: string, maxLines: number, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const limitedLines = lines.slice(0, maxLines);
  let joined = limitedLines.join('\n');
  if (joined.length > maxChars) {
    joined = `${joined.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  if (lines.length > maxLines || normalized.length > joined.length) {
    return joined.trimEnd().length > 0 ? `${joined.trimEnd()}\n…` : '…';
  }
  return joined;
}

function countTerminalLines(value: string): number {
  return value.replace(/\r\n/g, '\n').split('\n').length;
}

interface TerminalSegmentStyle {
  backgroundColor?: string;
  color?: string;
  fontWeight?: CSSProperties['fontWeight'];
}

interface TerminalSegment {
  style: TerminalSegmentStyle;
  text: string;
}

interface TerminalInlineToken {
  kind: 'path' | 'text' | 'url';
  key: string;
  value: string;
}

const ANSI_BASIC_COLOR_MAP: Record<number, string> = {
  30: '#94a3b8',
  31: '#f87171',
  32: '#4ade80',
  33: '#facc15',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#22d3ee',
  37: '#e5e7eb',
  90: '#94a3b8',
  91: '#fca5a5',
  92: '#86efac',
  93: '#fde68a',
  94: '#93c5fd',
  95: '#d8b4fe',
  96: '#67e8f9',
  97: '#f8fafc',
};

function resolveAnsiColor(code: number): string | undefined {
  return ANSI_BASIC_COLOR_MAP[code];
}

function resolveAnsi256Color(index: number): string {
  if (index < 16) {
    const basic = [
      '#111827',
      '#ef4444',
      '#22c55e',
      '#eab308',
      '#3b82f6',
      '#a855f7',
      '#06b6d4',
      '#f3f4f6',
      '#6b7280',
      '#f87171',
      '#4ade80',
      '#fde047',
      '#60a5fa',
      '#c084fc',
      '#67e8f9',
      '#ffffff',
    ];
    return basic[index] ?? '#f8fafc';
  }

  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }

  const cube = index - 16;
  const r = Math.floor(cube / 36);
  const g = Math.floor((cube % 36) / 6);
  const b = cube % 6;
  const levels = [0, 95, 135, 175, 215, 255];
  return `rgb(${levels[r]}, ${levels[g]}, ${levels[b]})`;
}

function applyAnsiCodes(base: TerminalSegmentStyle, sequence: string): TerminalSegmentStyle {
  const next: TerminalSegmentStyle = { ...base };
  const codes = sequence.length > 0 ? sequence.split(';').map((part) => Number(part || '0')) : [0];

  for (let index = 0; index < codes.length; index += 1) {
    const code = Number.isFinite(codes[index]) ? codes[index]! : 0;
    if (code === 0) {
      delete next.color;
      delete next.backgroundColor;
      delete next.fontWeight;
      continue;
    }
    if (code === 1) {
      next.fontWeight = 700;
      continue;
    }
    if (code === 22) {
      delete next.fontWeight;
      continue;
    }
    if (code === 39) {
      delete next.color;
      continue;
    }
    if (code === 49) {
      delete next.backgroundColor;
      continue;
    }

    const basicColor = resolveAnsiColor(code);
    if (basicColor) {
      next.color = basicColor;
      continue;
    }

    if (code >= 40 && code <= 47) {
      next.backgroundColor = resolveAnsiColor(code - 10);
      continue;
    }
    if (code >= 100 && code <= 107) {
      next.backgroundColor = resolveAnsiColor(code - 10);
      continue;
    }

    if ((code === 38 || code === 48) && index + 1 < codes.length) {
      const mode = codes[index + 1];
      if (mode === 5 && index + 2 < codes.length) {
        const color = resolveAnsi256Color(codes[index + 2]!);
        if (code === 38) {
          next.color = color;
        } else {
          next.backgroundColor = color;
        }
        index += 2;
        continue;
      }
      if (mode === 2 && index + 4 < codes.length) {
        const color = `rgb(${codes[index + 2]}, ${codes[index + 3]}, ${codes[index + 4]})`;
        if (code === 38) {
          next.color = color;
        } else {
          next.backgroundColor = color;
        }
        index += 4;
      }
    }
  }

  return next;
}

function parseAnsiSegments(value: string): TerminalSegment[] {
  const segments: TerminalSegment[] = [];
  const escapePrefix = String.fromCharCode(27);
  const matcher = new RegExp(`${escapePrefix}\\[([0-9;]*)m`, 'g');
  let style: TerminalSegmentStyle = {};
  let lastIndex = 0;

  for (const match of value.matchAll(matcher)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ style: { ...style }, text: value.slice(lastIndex, matchIndex) });
    }
    style = applyAnsiCodes(style, match[1] ?? '');
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < value.length) {
    segments.push({ style: { ...style }, text: value.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ style: {}, text: value }];
}

function splitSegmentsIntoLines(segments: TerminalSegment[]): TerminalSegment[][] {
  const lines: TerminalSegment[][] = [[]];

  for (const segment of segments) {
    const parts = segment.text.split('\n');
    parts.forEach((part, index) => {
      if (part.length > 0) {
        lines[lines.length - 1]!.push({ style: segment.style, text: part });
      }
      if (index < parts.length - 1) {
        lines.push([]);
      }
    });
  }

  return lines;
}

function countPlainCharacters(lines: TerminalSegment[][]): number {
  return lines.reduce(
    (total, line) =>
      total + line.reduce((lineTotal, segment) => lineTotal + segment.text.length, 0),
    0,
  );
}

function truncateSegments(
  lines: TerminalSegment[][],
  maxLines: number,
  maxChars: number,
): { lines: TerminalSegment[][]; truncated: boolean } {
  const visible: TerminalSegment[][] = [];
  let usedChars = 0;
  let truncated = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (lineIndex >= maxLines) {
      truncated = true;
      break;
    }

    const line = lines[lineIndex]!;
    const nextLine: TerminalSegment[] = [];

    for (const segment of line) {
      const remaining = maxChars - usedChars;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (segment.text.length <= remaining) {
        nextLine.push(segment);
        usedChars += segment.text.length;
        continue;
      }
      nextLine.push({
        style: segment.style,
        text: `${segment.text.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`,
      });
      usedChars = maxChars;
      truncated = true;
      break;
    }

    visible.push(nextLine);
    if (truncated) {
      break;
    }
  }

  if (!truncated && visible.length < lines.length) {
    truncated = true;
  }

  return { lines: visible, truncated };
}

function detectPromptLength(plainLine: string): number {
  const match = plainLine.match(
    /^((?:\[[^\]]+\]\s*)?(?:[\w.-]+@[\w.-]+(?::[^\s]+)?[#$]|[#$>]))\s+/u,
  );
  return match ? match[0].length : 0;
}

function splitLineAtCharacter(
  line: TerminalSegment[],
  characterCount: number,
): [TerminalSegment[], TerminalSegment[]] {
  const head: TerminalSegment[] = [];
  const tail: TerminalSegment[] = [];
  let consumed = 0;

  for (const segment of line) {
    const nextConsumed = consumed + segment.text.length;
    if (nextConsumed <= characterCount) {
      head.push(segment);
      consumed = nextConsumed;
      continue;
    }
    const splitAt = Math.max(0, characterCount - consumed);
    if (splitAt > 0) {
      head.push({ style: segment.style, text: segment.text.slice(0, splitAt) });
    }
    tail.push({ style: segment.style, text: segment.text.slice(splitAt) });
    consumed = characterCount;
  }

  return [head, tail];
}

function renderSegments(segments: TerminalSegment[], keyPrefix: string): ReactNode[] {
  let segmentOffset = 0;

  return segments.map((segment) => {
    const hasAnsiStyle = Boolean(
      segment.style.color || segment.style.backgroundColor || segment.style.fontWeight,
    );
    const color = segment.style.color;
    const inlineTokens = splitTerminalInlineTokens(segment.text);
    const segmentKey = `${keyPrefix}-segment-${segmentOffset}`;
    segmentOffset += segment.text.length;
    return (
      <span
        key={segmentKey}
        {...(hasAnsiStyle ? { 'data-tool-card-ansi': 'true' } : {})}
        style={{
          ...(segment.style.backgroundColor
            ? { backgroundColor: segment.style.backgroundColor }
            : {}),
          ...(segment.style.color ? { color: segment.style.color } : {}),
          ...(segment.style.fontWeight ? { fontWeight: segment.style.fontWeight } : {}),
        }}
      >
        {inlineTokens.map((token) => {
          if (token.kind === 'url') {
            return (
              <a
                key={`${segmentKey}-${token.key}`}
                data-tool-card-terminal-url="true"
                href={token.value}
                rel="noreferrer noopener"
                target="_blank"
                style={{
                  color: color ?? tokens.color.info,
                  textDecoration: 'underline',
                  textUnderlineOffset: '0.18em',
                }}
              >
                {token.value}
              </a>
            );
          }

          if (token.kind === 'path') {
            return (
              <span
                key={`${segmentKey}-${token.key}`}
                data-tool-card-terminal-path="true"
                style={{
                  color: color ?? tokens.color.text,
                  background: `color-mix(in srgb, ${tokens.color.muted} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tokens.color.muted} 18%, transparent)`,
                  borderRadius: 4,
                  padding: '0 4px',
                }}
                title={token.value}
              >
                {token.value}
              </span>
            );
          }

          return <span key={`${segmentKey}-${token.key}`}>{token.value}</span>;
        })}
      </span>
    );
  });
}

function classifyTerminalToken(token: string): TerminalInlineToken['kind'] {
  if (/^https?:\/\/\S+$/u.test(token)) {
    return 'url';
  }

  const pathLike =
    token.includes('/') &&
    !token.startsWith('//') &&
    !/^https?:/u.test(token) &&
    /[A-Za-z0-9._-]/u.test(token);

  return pathLike ? 'path' : 'text';
}

function splitTerminalInlineTokens(value: string): TerminalInlineToken[] {
  const parts = value.split(/(\s+)/u);
  let cursor = 0;

  return parts.flatMap((part) => {
    if (part.length === 0) {
      return [];
    }

    if (/^\s+$/u.test(part)) {
      const token = { kind: 'text' as const, key: `offset-${cursor}`, value: part };
      cursor += part.length;
      return [token];
    }

    const match = part.match(/^([([{"'`<]*)(.*?)([)\]}",;:>'`.]*)$/u);
    const leading = match?.[1] ?? '';
    const core = match?.[2] ?? part;
    const trailing = match?.[3] ?? '';
    const classified = classifyTerminalToken(core);
    const tokens: TerminalInlineToken[] = [];

    if (leading) {
      tokens.push({ kind: 'text', key: `offset-${cursor}`, value: leading });
      cursor += leading.length;
    }

    tokens.push({ kind: classified, key: `offset-${cursor}`, value: core });
    cursor += core.length;

    if (trailing) {
      tokens.push({ kind: 'text', key: `offset-${cursor}`, value: trailing });
      cursor += trailing.length;
    }

    return tokens;
  });
}

function renderTerminalLines(lines: TerminalSegment[][], keyPrefix: string): ReactNode[] {
  let lineOffset = 0;

  return lines.map((line) => {
    const plainLine = line.map((segment) => segment.text).join('');
    const promptLength = detectPromptLength(plainLine);
    const [promptSegments, remainderSegments] =
      promptLength > 0 ? splitLineAtCharacter(line, promptLength) : [[], line];
    const lineKey = `${keyPrefix}-line-${lineOffset}`;
    lineOffset += plainLine.length + 1;

    return (
      <div key={lineKey} style={{ minHeight: '1.6em' }}>
        {promptSegments.length > 0 && (
          <span
            data-tool-card-terminal-prompt="true"
            style={{
              color: tokens.color.success,
              fontWeight: 700,
            }}
          >
            {renderSegments(promptSegments, `${lineKey}-prompt`)}
          </span>
        )}
        {remainderSegments.length > 0
          ? renderSegments(remainderSegments, `${lineKey}-body`)
          : plainLine.length === 0
            ? '\u00a0'
            : null}
      </div>
    );
  });
}

export function resolveBashTerminalView(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
): BashTerminalView | undefined {
  if (!normalizeToolName(toolName).includes('bash')) {
    return undefined;
  }

  const outputRecord = asRecord(output);
  const command =
    readNonEmptyString(outputRecord?.['command']) ?? readNonEmptyString(input['command']);
  const cwd =
    readNonEmptyString(outputRecord?.['cwd']) ??
    readNonEmptyString(input['cwd']) ??
    readNonEmptyString(input['workdir']);
  const stdout = outputRecord ? readRawString(outputRecord['stdout']) : readRawString(output);
  const stderr = outputRecord ? readRawString(outputRecord['stderr']) : undefined;
  const plainOutput = outputRecord ? readRawString(outputRecord['output']) : undefined;
  const exitCode =
    typeof outputRecord?.['exitCode'] === 'number' && Number.isFinite(outputRecord['exitCode'])
      ? outputRecord['exitCode']
      : undefined;
  const processId = readNonEmptyString(outputRecord?.['processId']);
  const summaryRecord = asRecord(outputRecord?.['summary']);
  const summaryMode: 'compact' | 'full' | 'tail' | undefined =
    summaryRecord?.['mode'] === 'compact' ||
    summaryRecord?.['mode'] === 'full' ||
    summaryRecord?.['mode'] === 'tail'
      ? summaryRecord['mode']
      : undefined;
  const summary = summaryRecord
    ? {
        errorLikeLines: readFiniteNumber(summaryRecord['errorLikeLines']),
        live: summaryRecord['live'] === true,
        mode: summaryMode,
        noisy: summaryRecord['noisy'] === true,
        stderrLines: readFiniteNumber(summaryRecord['stderrLines']),
        stdoutLines: readFiniteNumber(summaryRecord['stdoutLines']),
        totalChars: readFiniteNumber(summaryRecord['totalChars']),
        totalLines: readFiniteNumber(summaryRecord['totalLines']),
        warningLikeLines: readFiniteNumber(summaryRecord['warningLikeLines']),
      }
    : undefined;
  const mode: BashTerminalView['mode'] = outputRecord
    ? summary?.live
      ? 'live'
      : 'structured'
    : 'plain';

  if (
    !command &&
    !cwd &&
    exitCode === undefined &&
    !plainOutput &&
    !processId &&
    (stdout === undefined || stdout.length === 0) &&
    (stderr === undefined || stderr.length === 0)
  ) {
    return undefined;
  }

  return {
    command,
    cwd,
    exitCode,
    mode,
    output: plainOutput,
    processId,
    summary,
    stderr,
    stdout,
  };
}

function ShellTextPane({
  compact = false,
  content,
  expanded = false,
  tone,
}: {
  compact?: boolean;
  content: string;
  expanded?: boolean;
  tone: 'danger' | 'default';
}) {
  const parsedLines = useMemo(() => splitSegmentsIntoLines(parseAnsiSegments(content)), [content]);
  const plainCharCount = useMemo(() => countPlainCharacters(parsedLines), [parsedLines]);
  const lineCount = useMemo(() => countTerminalLines(content), [content]);
  const isLong = lineCount > 18 || plainCharCount > 1600;
  const collapsed = useMemo(
    () => truncateSegments(parsedLines, compact ? 5 : 18, compact ? 420 : 1600),
    [compact, parsedLines],
  );
  const resolvedExpanded = expanded;
  const visibleLines = compact || !resolvedExpanded ? collapsed.lines : parsedLines;
  const isCollapsed = isLong && (compact || !resolvedExpanded);
  const isDanger = tone === 'danger';

  return (
    <div
      data-tool-card-terminal-stream={isDanger ? 'stderr' : 'stdout'}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
    >
      <div
        style={{
          margin: 0,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 11,
          lineHeight: 1.6,
          color: isDanger ? tokens.color.danger : tokens.color.text,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {renderTerminalLines(
          visibleLines,
          `${isDanger ? 'stderr' : 'stdout'}-${compact ? 'compact' : 'full'}`,
        )}
        {collapsed.truncated && isCollapsed ? <div aria-hidden="true">…</div> : null}
      </div>
    </div>
  );
}

export function BashTerminalCard({
  compact = false,
  view,
}: {
  compact?: boolean;
  view: BashTerminalView;
}) {
  const hasStdout = typeof view.stdout === 'string' && view.stdout.length > 0;
  const hasStderr = typeof view.stderr === 'string' && view.stderr.length > 0;
  const hasOutput = typeof view.output === 'string' && view.output.length > 0;
  const hasFailure = (view.exitCode !== undefined && view.exitCode !== 0) || hasStderr;
  const shellSummaryBadges: { label: string; tone: 'default' | 'amber' | 'red' | 'blue' }[] = [
    ...(view.summary?.mode ? [{ label: view.summary.mode, tone: 'default' as const }] : []),
    ...(view.summary?.noisy ? [{ label: 'noise reduced', tone: 'amber' as const }] : []),
    ...(typeof view.summary?.totalLines === 'number' && view.summary.totalLines > 0
      ? [{ label: `${view.summary.totalLines} lines`, tone: 'default' as const }]
      : []),
    ...(typeof view.summary?.errorLikeLines === 'number' && view.summary.errorLikeLines > 0
      ? [{ label: `${view.summary.errorLikeLines} error-like`, tone: 'red' as const }]
      : []),
    ...(typeof view.summary?.warningLikeLines === 'number' && view.summary.warningLikeLines > 0
      ? [{ label: `${view.summary.warningLikeLines} warning-like`, tone: 'amber' as const }]
      : []),
  ];
  const combinedText = [view.stderr, view.stdout ?? view.output].filter(Boolean).join('\n\n');
  const totalLineCount =
    view.summary?.totalLines ?? (combinedText.length > 0 ? countTerminalLines(combinedText) : 0);
  const tokenEstimate = Math.max(1, Math.ceil(combinedText.length / 4));
  const isLong = combinedText.length > 1000;
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timer = window.setTimeout(
      () => setCopyState('idle'),
      copyState === 'failed' ? 1800 : 1200,
    );
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = () => {
    if (!navigator.clipboard) {
      setCopyState('failed');
      return;
    }

    void navigator.clipboard
      .writeText(combinedText)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'));
  };

  return (
    <div
      data-tool-card-bash-terminal="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: 0,
      }}
    >
      {view.command && (
        <div
          style={{
            maxHeight: 160,
            overflow: 'auto',
            borderRadius: 6,
            border: `1px solid ${tokens.color.borderSubtle}`,
            background: `color-mix(in srgb, ${tokens.color.surface} 60%, transparent)`,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontSize: 11,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              color: tokens.color.success,
              minWidth: 0,
            }}
          >
            <span
              style={{
                color: tokens.color.success,
                opacity: 0.6,
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              $
            </span>
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: tokens.color.text,
                flex: 1,
                minWidth: 0,
              }}
            >
              {compact ? compactTerminalText(view.command, 2, 180) : view.command}
            </span>
            {view.cwd && (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  color: tokens.color.muted,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 200,
                }}
                title={view.cwd}
              >
                {view.cwd}
              </span>
            )}
            {combinedText.length > 0 && (
              <button
                type="button"
                data-tool-card-bash-copy="true"
                onClick={handleCopy}
                style={{
                  appearance: 'none',
                  border: 'none',
                  background: 'transparent',
                  color:
                    copyState === 'failed'
                      ? tokens.color.danger
                      : copyState === 'copied'
                        ? tokens.color.success
                        : tokens.color.muted,
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                {copyState === 'idle' ? '复制' : copyState === 'copied' ? '已复制' : '复制失败'}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        data-tool-card-terminal-output-panel="true"
        style={{
          maxHeight: compact ? 220 : 288,
          overflow: 'auto',
          borderRadius: 6,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: `color-mix(in srgb, ${tokens.color.surface} 60%, transparent)`,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px' }}>
          {shellSummaryBadges.length > 0 && (
            <div
              data-tool-card-bash-shell-summary="true"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
              }}
            >
              {shellSummaryBadges.map((badge, i) => (
                <span
                  key={`${badge.label}-${i}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    background:
                      badge.tone === 'red'
                        ? `color-mix(in srgb, ${tokens.color.danger} 10%, transparent)`
                        : badge.tone === 'amber'
                          ? `color-mix(in srgb, ${tokens.color.warning} 10%, transparent)`
                          : badge.tone === 'blue'
                            ? `color-mix(in srgb, ${tokens.color.info} 10%, transparent)`
                            : `color-mix(in srgb, ${tokens.color.muted} 10%, transparent)`,
                    color:
                      badge.tone === 'red'
                        ? tokens.color.danger
                        : badge.tone === 'amber'
                          ? tokens.color.warning
                          : badge.tone === 'blue'
                            ? tokens.color.info
                            : tokens.color.muted,
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}

          {hasStderr && (
            <ShellTextPane
              compact={compact}
              content={view.stderr!}
              expanded={expanded || (!compact && hasFailure)}
              tone="danger"
            />
          )}

          {hasStdout ? (
            <ShellTextPane
              compact={compact}
              content={view.stdout!}
              expanded={expanded}
              tone="default"
            />
          ) : hasOutput ? (
            <ShellTextPane
              compact={compact}
              content={view.output!}
              expanded={expanded}
              tone="default"
            />
          ) : view.exitCode !== undefined ? null : null}
        </div>
      </div>

      {isLong && !compact && (
        <button
          type="button"
          data-tool-card-terminal-show-all="true"
          onClick={() => setExpanded((previous) => !previous)}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            padding: 0,
            alignSelf: 'flex-start',
            fontSize: 10,
            color: tokens.color.muted,
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = tokens.color.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = tokens.color.muted;
          }}
        >
          {expanded
            ? '显示较少'
            : `显示全部（约 ${tokenEstimate} tokens，${totalLineCount} lines）`}
        </button>
      )}
    </div>
  );
}
