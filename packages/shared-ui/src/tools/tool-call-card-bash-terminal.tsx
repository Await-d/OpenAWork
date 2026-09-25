import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { tokens, color } from '../tokens.js';

/** 终端类内容的等宽字体栈（命令 / 输出共用）。 */
const TERMINAL_MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

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
  30: 'var(--fg-muted)',
  31: color.danger,
  32: 'var(--success)',
  33: color.contrast,
  34: 'var(--aux)',
  35: 'var(--aux-hover)',
  36: color.accent,
  37: color.fgDefault,
  90: 'var(--fg-muted)',
  91: color.complementHover,
  92: 'var(--success)',
  93: color.contrast,
  94: color.aux,
  95: color.auxHover,
  96: 'var(--accent)',
  97: 'var(--fg-strong)',
};

function resolveAnsiColor(code: number): string | undefined {
  return ANSI_BASIC_COLOR_MAP[code];
}

function resolveAnsi256Color(index: number): string {
  if (index < 16) {
    const basic = [
      color.bgBase,
      'var(--danger)',
      'var(--success)',
      color.contrast,
      color.aux,
      color.auxHover,
      color.accent,
      color.fgStrong,
      color.fgMuted,
      color.danger,
      'var(--success)',
      color.contrast,
      'var(--aux)',
      'var(--aux-hover)',
      'var(--accent)',
      color.fgOnAccent,
    ];
    return basic[index] ?? 'var(--fg-strong)';
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

  return segments.map((segment, segmentIndex) => {
    const hasAnsiStyle = Boolean(
      segment.style.color || segment.style.backgroundColor || segment.style.fontWeight,
    );
    const color = segment.style.color;
    const inlineTokens = splitTerminalInlineTokens(segment.text);
    const segmentKey = `${keyPrefix}-segment-${segmentIndex}-${segmentOffset}`;
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
        {inlineTokens.map((token, tokenIndex) => {
          const tokenKey = `${segmentKey}-${tokenIndex}-${token.key}`;
          if (token.kind === 'url') {
            return (
              <a
                key={tokenKey}
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
                key={tokenKey}
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

          return <span key={tokenKey}>{token.value}</span>;
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
        // stderr 用左侧 danger 细线标记段边界（终端里 stderr 与 stdout 混排时
        // 只靠文字颜色区分不够）。
        ...(isDanger
          ? {
              borderLeft: `2px solid color-mix(in srgb, ${tokens.color.danger} 45%, transparent)`,
              paddingLeft: 8,
            }
          : {}),
      }}
    >
      <div
        style={{
          margin: 0,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          // 与终端块（13px / 行高 20）一致：不再用 11px 把正文压小；
          // 输出用正常前景色（ANSI 片段会各自覆盖），只有 stderr 走危险色。
          fontSize: 13,
          lineHeight: '20px',
          color: isDanger ? tokens.color.danger : color.fgDefault,
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
  running = false,
  view,
}: {
  compact?: boolean;
  /**
   * 工具仍在执行。为 true 时输出区显示「运行中，等待输出…」动画行，
   * 并在输出增长时自动贴底（batch 子工具的 partialOutput 是滚动快照）。
   */
  running?: boolean;
  view: BashTerminalView;
}) {
  const hasStdout = typeof view.stdout === 'string' && view.stdout.length > 0;
  const hasStderr = typeof view.stderr === 'string' && view.stderr.length > 0;
  const hasOutput = typeof view.output === 'string' && view.output.length > 0;
  const hasFailure = (view.exitCode !== undefined && view.exitCode !== 0) || hasStderr;
  const combinedText = [view.stderr, view.stdout ?? view.output].filter(Boolean).join('\n\n');
  // 展开态默认显示全部内容（参考实现的终端观感：命令 + 结果 + 滚动）；
  // compact（折叠摘要）时由 ShellTextPane 自行收尾。
  const expanded = !compact;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const outputScrollRef = useRef<HTMLDivElement | null>(null);
  const showWaitingState = running && combinedText.length === 0;

  // Live 输出自动贴底：运行中的终端视口必须停在最新一行。
  useEffect(() => {
    if (!running) {
      return;
    }
    const container = outputScrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [running, combinedText]);

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
      data-terminal-running={running ? 'true' : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      {/* 终端块：`$ 命令` + 同底色输出（终端观感），复制按钮悬停显示在右上角。 */}
      <div
        data-tool-card-bash-block="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          borderRadius: 6,
          border: `0.5px solid ${tokens.color.borderSubtle}`,
          background: tokens.color.bg,
          overflow: 'hidden',
        }}
      >
        {view.command && (
          <div
            data-tool-card-bash-command-row="true"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: 12,
              fontFamily: TERMINAL_MONO_FONT,
              fontSize: 13,
              fontWeight: 440,
              lineHeight: '20px',
              minWidth: 0,
            }}
          >
            {/* 终端提示符：和命令一起构成「$ command」的终端观感。 */}
            <span
              data-tool-card-bash-prompt="true"
              aria-hidden
              style={{ flexShrink: 0, userSelect: 'none', color: color.success, fontWeight: 700 }}
            >
              $
            </span>
            <span
              data-tool-card-bash-command="true"
              style={{
                flex: 1,
                minWidth: 0,
                color: tokens.color.text,
                // 展开态完整显示多行命令（终端观感）；折叠态保持单行省略。
                whiteSpace: compact ? 'nowrap' : 'pre-wrap',
                wordBreak: 'break-word',
                ...(compact ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
              }}
            >
              {compact ? compactTerminalText(view.command, 2, 180) : view.command}
            </span>
          </div>
        )}

        <div
          ref={outputScrollRef}
          data-tool-card-terminal-output-panel="true"
          style={{
            maxHeight: compact ? 220 : 240,
            overflow: 'auto',
            padding: '0 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontFamily: TERMINAL_MONO_FONT,
            fontSize: 13,
            fontWeight: 440,
            lineHeight: '20px',
            // 终端输出用正常前景色（不是次级信息色）：和提示符/命令同处一个画面。
            color: color.fgDefault,
            minWidth: 0,
          }}
        >
          {showWaitingState ? (
            <div
              data-tool-card-terminal-running="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: tokens.color.muted,
                lineHeight: '20px',
              }}
            >
              <span data-tool-card-terminal-cursor="true" />
              运行中，等待输出…
            </div>
          ) : (
            <>
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
              ) : null}
              {/* 运行中的块光标：跟在最后一行输出之后（真实终端观感）。 */}
              {running && (
                <div data-tool-card-terminal-live-cursor="true" style={{ lineHeight: '20px' }}>
                  <span data-tool-card-terminal-cursor="true" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {combinedText.length > 0 && (
        <button
          type="button"
          data-tool-card-bash-copy="true"
          onClick={handleCopy}
          title={copyState === 'copied' ? '已复制' : '复制命令与输出'}
          style={{
            appearance: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            border: `0.5px solid ${tokens.color.borderSubtle}`,
            borderRadius: 4,
            background: tokens.color.surface,
            color:
              copyState === 'failed'
                ? tokens.color.danger
                : copyState === 'copied'
                  ? tokens.color.success
                  : tokens.color.muted,
            fontSize: 12,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {copyState === 'copied' ? '✓' : copyState === 'failed' ? '✗' : '⧉'}
        </button>
      )}
    </div>
  );
}
