import React from 'react';
import { tokens } from './tokens.js';

type DiffSideKind = 'added' | 'context' | 'empty' | 'removed';

interface DiffSide {
  kind: DiffSideKind;
  lineNumber?: number;
  text: string;
}

interface DiffRow {
  key: string;
  left: DiffSide;
  right: DiffSide;
  type: 'change' | 'hunk';
}

export interface UnifiedCodeDiffSummary {
  added: number;
  removed: number;
}

export interface UnifiedCodeDiffProps {
  afterText?: string;
  beforeText?: string;
  diffText?: string;
  filePath?: string;
  maxHeight?: number;
  viewMode?: 'split' | 'unified';
}

function createEmptySide(): DiffSide {
  return { kind: 'empty', text: '' };
}

function createContextSide(lineNumber: number, text: string): DiffSide {
  return { kind: 'context', lineNumber, text };
}

function createRemovedSide(lineNumber: number, text: string): DiffSide {
  return { kind: 'removed', lineNumber, text };
}

function createAddedSide(lineNumber: number, text: string): DiffSide {
  return { kind: 'added', lineNumber, text };
}

function createHunkRow(text: string): DiffRow {
  return {
    key: `hunk:${text}`,
    type: 'hunk',
    left: { kind: 'context', text },
    right: { kind: 'context', text },
  };
}

function flushPendingChanges(input: {
  pendingAdds: DiffSide[];
  pendingRemoves: DiffSide[];
  rows: DiffRow[];
}): void {
  const pairCount = Math.max(input.pendingAdds.length, input.pendingRemoves.length);
  for (let index = 0; index < pairCount; index += 1) {
    input.rows.push({
      key: `change:${input.pendingRemoves[index]?.lineNumber ?? 'na'}:${input.pendingAdds[index]?.lineNumber ?? 'na'}:${input.pendingRemoves[index]?.text ?? ''}:${input.pendingAdds[index]?.text ?? ''}`,
      type: 'change',
      left: input.pendingRemoves[index] ?? createEmptySide(),
      right: input.pendingAdds[index] ?? createEmptySide(),
    });
  }
  input.pendingAdds.length = 0;
  input.pendingRemoves.length = 0;
}

export function summarizeUnifiedDiff(diffText: string): UnifiedCodeDiffSummary {
  return diffText.split(/\r?\n/).reduce(
    (summary, line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        summary.added += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        summary.removed += 1;
      }
      return summary;
    },
    { added: 0, removed: 0 },
  );
}

export function summarizeSnapshotDiff(
  beforeText: string,
  afterText: string,
): UnifiedCodeDiffSummary {
  const rows = parseSnapshotDiffRows(beforeText, afterText);
  return rows.reduce(
    (summary, row) => {
      if (row.type !== 'change') {
        return summary;
      }
      if (row.left.kind === 'removed') {
        summary.removed += 1;
      }
      if (row.right.kind === 'added') {
        summary.added += 1;
      }
      return summary;
    },
    { added: 0, removed: 0 },
  );
}

export function parseSnapshotDiffRows(beforeText: string, afterText: string): DiffRow[] {
  const beforeLines = beforeText.replace(/\r\n/g, '\n').split('\n');
  const afterLines = afterText.replace(/\r\n/g, '\n').split('\n');
  const rows: DiffRow[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];

    if (beforeLine === afterLine && beforeLine !== undefined) {
      rows.push({
        key: `snapshot:context:${beforeIndex + 1}:${afterIndex + 1}:${beforeLine}`,
        type: 'change',
        left: createContextSide(beforeIndex + 1, beforeLine),
        right: createContextSide(afterIndex + 1, beforeLine),
      });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (
      afterLine !== undefined &&
      beforeLine !== undefined &&
      beforeLines[beforeIndex + 1] === afterLine
    ) {
      rows.push({
        key: `snapshot:remove:${beforeIndex + 1}:${beforeLine}`,
        type: 'change',
        left: createRemovedSide(beforeIndex + 1, beforeLine),
        right: createEmptySide(),
      });
      beforeIndex += 1;
      continue;
    }

    if (
      afterLine !== undefined &&
      beforeLine !== undefined &&
      afterLines[afterIndex + 1] === beforeLine
    ) {
      rows.push({
        key: `snapshot:add:${afterIndex + 1}:${afterLine}`,
        type: 'change',
        left: createEmptySide(),
        right: createAddedSide(afterIndex + 1, afterLine),
      });
      afterIndex += 1;
      continue;
    }

    if (beforeLine !== undefined || afterLine !== undefined) {
      rows.push({
        key: `snapshot:replace:${beforeIndex + 1}:${afterIndex + 1}:${beforeLine ?? ''}:${afterLine ?? ''}`,
        type: 'change',
        left:
          beforeLine !== undefined
            ? createRemovedSide(beforeIndex + 1, beforeLine)
            : createEmptySide(),
        right:
          afterLine !== undefined ? createAddedSide(afterIndex + 1, afterLine) : createEmptySide(),
      });
    }

    if (beforeLine !== undefined) {
      beforeIndex += 1;
    }
    if (afterLine !== undefined) {
      afterIndex += 1;
    }
  }

  return rows;
}

export function parseUnifiedDiffRows(diffText: string): DiffRow[] {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const rows: DiffRow[] = [];
  const pendingRemoves: DiffSide[] = [];
  const pendingAdds: DiffSide[] = [];
  let leftLine = 0;
  let rightLine = 0;
  let hasActiveHunk = false;

  for (const line of lines) {
    const headerMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (headerMatch) {
      flushPendingChanges({ pendingAdds, pendingRemoves, rows });
      leftLine = Number.parseInt(headerMatch[1] ?? '0', 10);
      rightLine = Number.parseInt(headerMatch[2] ?? '0', 10);
      rows.push(createHunkRow(`@@ -${leftLine} +${rightLine}${headerMatch[3] ?? ''}`.trim()));
      hasActiveHunk = true;
      continue;
    }

    if (!hasActiveHunk) {
      continue;
    }

    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      continue;
    }

    if (line === '\\ No newline at end of file') {
      continue;
    }

    if (line.startsWith('-')) {
      pendingRemoves.push(createRemovedSide(leftLine, line.slice(1)));
      leftLine += 1;
      continue;
    }

    if (line.startsWith('+')) {
      pendingAdds.push(createAddedSide(rightLine, line.slice(1)));
      rightLine += 1;
      continue;
    }

    flushPendingChanges({ pendingAdds, pendingRemoves, rows });
    const contextText = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      key: `context:${leftLine}:${rightLine}:${contextText}`,
      type: 'change',
      left: createContextSide(leftLine, contextText),
      right: createContextSide(rightLine, contextText),
    });
    leftLine += 1;
    rightLine += 1;
  }

  flushPendingChanges({ pendingAdds, pendingRemoves, rows });
  return rows;
}

function sideBackground(kind: DiffSideKind): string {
  if (kind === 'added') return 'rgba(16, 185, 129, 0.12)';
  if (kind === 'removed') return 'rgba(239, 68, 68, 0.12)';
  if (kind === 'empty') return 'rgba(15, 23, 42, 0.12)';
  return 'rgba(15, 23, 42, 0.22)';
}

function sideBorder(kind: DiffSideKind): string {
  if (kind === 'added') return 'rgba(16, 185, 129, 0.35)';
  if (kind === 'removed') return 'rgba(239, 68, 68, 0.35)';
  return 'rgba(148, 163, 184, 0.12)';
}

function markerFor(kind: DiffSideKind): string {
  if (kind === 'added') return '+';
  if (kind === 'removed') return '-';
  return ' ';
}

function renderLineNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

interface UnifiedDisplayRow {
  key: string;
  kind: DiffSideKind | 'hunk';
  leftLine?: number;
  rightLine?: number;
  text: string;
}

export function toUnifiedDisplayRows(rows: DiffRow[]): Array<{
  key: string;
  kind: DiffSideKind | 'hunk';
  leftLine?: number;
  rightLine?: number;
  text: string;
}> {
  return rows.flatMap((row) => {
    if (row.type === 'hunk') {
      return [
        {
          key: row.key,
          kind: 'hunk',
          text: row.left.text,
        },
      ];
    }

    if (row.left.kind === 'context' && row.right.kind === 'context') {
      return [
        {
          key: row.key,
          kind: 'context',
          leftLine: row.left.lineNumber,
          rightLine: row.right.lineNumber,
          text: row.left.text,
        },
      ];
    }

    const unifiedRows: UnifiedDisplayRow[] = [];
    if (row.left.kind === 'removed') {
      unifiedRows.push({
        key: `${row.key}:removed`,
        kind: 'removed',
        leftLine: row.left.lineNumber,
        text: row.left.text,
      });
    }
    if (row.right.kind === 'added') {
      unifiedRows.push({
        key: `${row.key}:added`,
        kind: 'added',
        rightLine: row.right.lineNumber,
        text: row.right.text,
      });
    }
    if (unifiedRows.length === 0) {
      unifiedRows.push({
        key: `${row.key}:empty`,
        kind: 'empty',
        text: '',
      });
    }
    return unifiedRows;
  });
}

function UnifiedRowCell({ row }: { row: UnifiedDisplayRow }) {
  if (row.kind === 'hunk') {
    return (
      <div
        style={{
          padding: '6px 10px',
          fontSize: 11,
          color: '#93c5fd',
          background: 'rgba(59, 130, 246, 0.1)',
          borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
          fontVariantNumeric: 'tabular-nums',
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        }}
      >
        {row.text}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 44px 18px minmax(0, 1fr)',
        alignItems: 'stretch',
        minWidth: 0,
        background: sideBackground(row.kind),
        borderTop: '1px solid rgba(148, 163, 184, 0.06)',
      }}
    >
      <div
        style={{
          padding: '4px 6px',
          textAlign: 'right',
          fontSize: 11,
          color: 'var(--color-muted, #94a3b8)',
          borderRight: '1px solid rgba(148, 163, 184, 0.08)',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {renderLineNumber(row.leftLine)}
      </div>
      <div
        style={{
          padding: '4px 6px',
          textAlign: 'right',
          fontSize: 11,
          color: 'var(--color-muted, #94a3b8)',
          borderRight: '1px solid rgba(148, 163, 184, 0.08)',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {renderLineNumber(row.rightLine)}
      </div>
      <div
        style={{
          padding: '4px 0',
          textAlign: 'center',
          fontSize: 11,
          color:
            row.kind === 'added' ? '#34d399' : row.kind === 'removed' ? '#f87171' : 'transparent',
          borderRight: '1px solid rgba(148, 163, 184, 0.08)',
          userSelect: 'none',
        }}
      >
        {markerFor(row.kind)}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '4px 10px',
          minHeight: 26,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre',
          color: row.kind === 'empty' ? 'transparent' : 'var(--color-text, #f8fafc)',
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        }}
      >
        {row.text || ' '}
      </pre>
    </div>
  );
}

function DiffSideCell({ showRightBorder, side }: { showRightBorder: boolean; side: DiffSide }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 18px minmax(0, 1fr)',
        alignItems: 'stretch',
        minWidth: 0,
        background: sideBackground(side.kind),
        borderRight: showRightBorder ? `1px solid ${sideBorder(side.kind)}` : 'none',
      }}
    >
      <div
        style={{
          padding: '4px 6px',
          textAlign: 'right',
          fontSize: 11,
          color: 'var(--color-muted, #94a3b8)',
          borderRight: '1px solid rgba(148, 163, 184, 0.08)',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {renderLineNumber(side.lineNumber)}
      </div>
      <div
        style={{
          padding: '4px 0',
          textAlign: 'center',
          fontSize: 11,
          color:
            side.kind === 'added' ? '#34d399' : side.kind === 'removed' ? '#f87171' : 'transparent',
          borderRight: '1px solid rgba(148, 163, 184, 0.08)',
          userSelect: 'none',
        }}
      >
        {markerFor(side.kind)}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '4px 10px',
          minHeight: 26,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre',
          color: side.kind === 'empty' ? 'transparent' : 'var(--color-text, #f8fafc)',
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        }}
      >
        {side.text || ' '}
      </pre>
    </div>
  );
}

export function UnifiedCodeDiff({
  afterText,
  beforeText,
  diffText,
  filePath,
  maxHeight = 360,
  viewMode = 'unified',
}: UnifiedCodeDiffProps) {
  const usingSnapshot = typeof beforeText === 'string' || typeof afterText === 'string';
  const normalizedBefore = beforeText ?? '';
  const normalizedAfter = afterText ?? '';
  const rows = usingSnapshot
    ? parseSnapshotDiffRows(normalizedBefore, normalizedAfter)
    : parseUnifiedDiffRows(diffText ?? '');
  const summary = usingSnapshot
    ? summarizeSnapshotDiff(normalizedBefore, normalizedAfter)
    : summarizeUnifiedDiff(diffText ?? '');

  if (rows.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--color-border, #334155)',
          borderRadius: tokens.radius.lg,
          background: 'color-mix(in srgb, var(--color-surface, #111827) 86%, transparent)',
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--color-muted, #94a3b8)',
        }}
      >
        暂无可展示的 diff。
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid color-mix(in srgb, var(--color-border, #334155) 88%, transparent)',
        borderRadius: tokens.radius.md,
        background: 'color-mix(in srgb, var(--color-surface, #111827) 96%, transparent)',
      }}
    >
      {(filePath || summary.added > 0 || summary.removed > 0) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 12px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
            background: 'rgba(15, 23, 42, 0.12)',
          }}
        >
          <div
            style={{
              minWidth: 0,
              fontSize: 11,
              color: 'var(--color-text, #f8fafc)',
              fontFamily:
                'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={filePath}
          >
            {filePath ?? 'Diff'}
          </div>
          <div
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: 'var(--color-muted, #94a3b8)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            +{summary.added} / -{summary.removed}
          </div>
        </div>
      )}

      {viewMode === 'split' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            fontSize: 11,
            color: 'var(--color-muted, #94a3b8)',
            fontWeight: 700,
            borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
            background: 'rgba(15, 23, 42, 0.08)',
          }}
        >
          <div style={{ padding: '6px 10px', borderRight: '1px solid rgba(148, 163, 184, 0.08)' }}>
            修改前
          </div>
          <div style={{ padding: '6px 10px' }}>修改后</div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '44px 44px 18px minmax(0, 1fr)',
            gap: 0,
            fontSize: 11,
            color: 'var(--color-muted, #94a3b8)',
            fontWeight: 700,
            padding: '0 0 0 1px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
            background: 'rgba(15, 23, 42, 0.08)',
          }}
        >
          <div style={{ padding: '6px', textAlign: 'right' }}>旧</div>
          <div style={{ padding: '6px', textAlign: 'right' }}>新</div>
          <div style={{ padding: '6px 0', textAlign: 'center' }}>±</div>
          <div style={{ padding: '6px 8px' }}>内容</div>
        </div>
      )}

      <div
        style={{
          overflow: 'auto',
          maxHeight,
        }}
      >
        <div style={{ minWidth: viewMode === 'split' ? 720 : undefined }}>
          {viewMode === 'split'
            ? rows.map((row, index) => {
                if (row.type === 'hunk') {
                  return (
                    <div
                      key={row.key}
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        color: '#93c5fd',
                        background: 'rgba(59, 130, 246, 0.1)',
                        borderTop: index === 0 ? 'none' : '1px solid rgba(148, 163, 184, 0.08)',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                      }}
                    >
                      {row.left.text}
                    </div>
                  );
                }

                return (
                  <div
                    key={row.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                      borderTop: index === 0 ? 'none' : '1px solid rgba(148, 163, 184, 0.06)',
                    }}
                  >
                    <DiffSideCell side={row.left} showRightBorder />
                    <DiffSideCell side={row.right} showRightBorder={false} />
                  </div>
                );
              })
            : toUnifiedDisplayRows(rows).map((row) => <UnifiedRowCell key={row.key} row={row} />)}
        </div>
      </div>
    </div>
  );
}
