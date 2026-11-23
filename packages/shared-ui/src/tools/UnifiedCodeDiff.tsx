import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { common, createLowlight } from 'lowlight';
import type { Root, RootContent } from 'hast';
import { tokens } from '../tokens.js';
import './UnifiedCodeDiff.css';

const lowlight = createLowlight(common);

/**
 * 高亮预算：超过就退回纯文本（避免大 diff 阻塞渲染）。
 * 高亮只影响观感，超限时 diff 仍然完整可见。
 */
const MAX_HIGHLIGHT_CHARS = 80_000;

/** 单次渲染的 diff 行数上限：超出部分由「展开全部」放开（轻量替代虚拟化）。 */
const MAX_RENDERED_DIFF_ROWS = 600;

/** 单个高亮片段（`className` 为空表示普通文本）。 */
export interface DiffToken {
  className?: string;
  text: string;
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  h: 'c',
  hpp: 'cpp',
  hs: 'haskell',
  htm: 'xml',
  html: 'xml',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

/** 从文件路径猜高亮语言；猜不到返回 undefined（按纯文本渲染）。 */
export function detectLanguage(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const normalized = filePath.toLowerCase().replaceAll('\\', '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return undefined;
  return EXTENSION_LANGUAGES[base.slice(dot + 1)];
}

/** 把 hast 文本按行拆分，同时继承祖先的 `hljs-*` 类名。 */
function appendHighlightText(
  text: string,
  classNames: readonly string[],
  lines: DiffToken[][],
): void {
  const className = classNames.join(' ');
  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (index > 0) lines.push([]);
    if (part.length === 0) return;
    const line = lines[lines.length - 1];
    if (!line) return;
    const previous = line[line.length - 1];
    if (previous && previous.className === className) {
      previous.text += part;
      return;
    }
    line.push(className ? { className, text: part } : { text: part });
  });
}

/**
 * 用 highlight.js（经 lowlight 的 hast 树）把整段代码转成「按行的 token 列表」。
 * 多行结构（块注释 / 模板字符串）由整段高亮保证，行归属靠换行拆分。
 */
export function highlightCodeLines(
  code: string,
  language: string | undefined,
): DiffToken[][] | undefined {
  if (!language || code.length === 0 || code.length > MAX_HIGHLIGHT_CHARS) return undefined;
  let tree: Root;
  try {
    tree = lowlight.highlight(language, code);
  } catch {
    return undefined;
  }

  const lines: DiffToken[][] = [[]];
  const visit = (nodes: readonly RootContent[], classNames: readonly string[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        appendHighlightText(String(node.value), classNames, lines);
        continue;
      }
      if (node.type === 'element') {
        const classes = node.properties?.['className'];
        const next =
          Array.isArray(classes) && classes.length > 0
            ? [...classNames, ...classes.map(String)]
            : classNames;
        visit(node.children, next);
      }
    }
  };
  visit(tree.children, []);
  return lines;
}

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
  chrome?: 'default' | 'minimal';
  diffText?: string;
  filePath?: string;
  /** 隐藏内部头部（文件路径 + `+N / -M`）——由调用方渲染文件头时使用。 */
  hideHeader?: boolean;
  /**
   * 滚动区高度上限。`'fill'` 表示撑满父容器可用高度（父容器需为 flex/grid 子项且 `min-height: 0`），
   * 用于「面板左右分栏」这类希望 diff 吃满剩余空间的场景——否则短 diff 下方会留大片空白。
   */
  maxHeight?: number | 'fill';
  revealFirstChange?: boolean;
  /**
   * 布局模式。
   * - `unified`：上下单栏（默认，窄屏友好）
   * - `split`：左右双栏
   * - `auto`：按容器宽度自动选择——足够宽用左右双栏，窄屏退回上下单栏
   */
  viewMode?: 'auto' | 'split' | 'unified';
}

/**
 * `viewMode="auto"` 切到左右双栏所需的最小容器宽度。
 *
 * 双栏内容的最小宽度是 720px（每侧 360px：行号 44 + 标记 18 + 文本区），阈值取
 * 760 留出内边距与滚动条余量——刚过阈值就横向滚动，比上下单栏更难读。
 */
const SPLIT_MIN_CONTAINER_WIDTH = 760;

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
  // 空字符串代表「没有内容」，不是「一个空行」——否则 `before=''`（新建文件）会把
  // after 的空白行错配成 context 行（表现为新建文件里混进一条未着色的正常行）。
  const beforeLines = beforeText.length === 0 ? [] : beforeText.replace(/\r\n/g, '\n').split('\n');
  const afterLines = afterText.length === 0 ? [] : afterText.replace(/\r\n/g, '\n').split('\n');
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
      // 保留原始 `@@ -a,b +c,d @@` 头：`toUnifiedDisplayRows` 需要用 new 侧区间
      // 折算「N 行未变更」分隔条（归一化会丢掉计数）。
      rows.push(createHunkRow(line.trim()));
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
  if (kind === 'added') return `color-mix(in srgb, ${tokens.color.success} 12%, transparent)`;
  if (kind === 'removed') return `color-mix(in srgb, ${tokens.color.danger} 12%, transparent)`;
  if (kind === 'empty') return `color-mix(in srgb, ${tokens.color.surface} 12%, transparent)`;
  return `color-mix(in srgb, ${tokens.color.surface} 22%, transparent)`;
}

function sideBorder(kind: DiffSideKind): string {
  if (kind === 'added') return `color-mix(in srgb, ${tokens.color.success} 35%, transparent)`;
  if (kind === 'removed') return `color-mix(in srgb, ${tokens.color.danger} 35%, transparent)`;
  return `color-mix(in srgb, ${tokens.color.muted} 12%, transparent)`;
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

/**
 * 把 hunk 头折算成交付给用户的「⋯ N 行未变更 / ⋯ 第 N 行起」文案。
 *
 * unified 与 split 共用：参考实现（pierre）不会把原始 `@@ -a,b +c,d @@` 铺出来，
 * 两种布局必须给出同一句话，否则只是切换布局就会让同一次变更「说法不一致」。
 */
function computeHunkLabels(rows: readonly DiffRow[]): Map<string, string> {
  const labels = new Map<string, string>();
  let previousNewEnd = 0;
  let hasPreviousHunk = false;

  for (const row of rows) {
    if (row.type !== 'hunk') {
      continue;
    }
    const range = parseHunkRange(row.left.text);
    let text = row.left.text;
    if (range) {
      const hidden = hasPreviousHunk
        ? Math.max(0, range.newStart - previousNewEnd)
        : Math.max(0, range.newStart - 1);
      text = hidden > 0 ? `⋯ ${hidden} 行未变更` : `⋯ 第 ${range.newStart} 行起`;
      previousNewEnd = range.newStart + range.newCount;
      hasPreviousHunk = true;
    }
    labels.set(row.key, text);
  }

  return labels;
}

export function toUnifiedDisplayRows(rows: DiffRow[]): Array<{
  key: string;
  kind: DiffSideKind | 'hunk';
  leftLine?: number;
  rightLine?: number;
  text: string;
}> {
  const display: UnifiedDisplayRow[] = [];
  // 参考实现（pierre）把 hunk 之间的未变更行折叠成一个「N 行未变更」分隔条；
  // 这里用 new 侧行号区间重算同一个信息，而不是把原始 `@@ … @@` 直接铺出来。
  const hunkLabels = computeHunkLabels(rows);

  for (const row of rows) {
    if (row.type === 'hunk') {
      display.push({ key: row.key, kind: 'hunk', text: hunkLabels.get(row.key) ?? row.left.text });
      continue;
    }

    if (row.left.kind === 'context' && row.right.kind === 'context') {
      display.push({
        key: row.key,
        kind: 'context',
        leftLine: row.left.lineNumber,
        rightLine: row.right.lineNumber,
        text: row.left.text,
      });
      continue;
    }

    if (row.left.kind === 'removed') {
      display.push({
        key: `${row.key}:removed`,
        kind: 'removed',
        leftLine: row.left.lineNumber,
        text: row.left.text,
      });
    }
    if (row.right.kind === 'added') {
      display.push({
        key: `${row.key}:added`,
        kind: 'added',
        rightLine: row.right.lineNumber,
        text: row.right.text,
      });
    }
    if (row.left.kind !== 'removed' && row.right.kind !== 'added') {
      display.push({ key: `${row.key}:empty`, kind: 'empty', text: '' });
    }
  }

  return display;
}

/** 解析 unified diff 的 `@@ -a,b +c,d @@` 头（解析失败返回 undefined，按原文透传）。 */
function parseHunkRange(text: string): { newCount: number; newStart: number } | undefined {
  const match = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(text.trim());
  if (!match) return undefined;
  const newStart = Number.parseInt(match[1] ?? '0', 10);
  const newCount = Number.parseInt(match[2] ?? '1', 10);
  if (!Number.isFinite(newStart) || !Number.isFinite(newCount)) return undefined;
  return { newStart, newCount };
}

/**
 * 变更块前后保留的上下文行数（与 git diff 的默认 `-U3` 一致）。
 *
 * 太小会看不出改动落在哪个函数里；太大则失去「只看变更」的意义。
 */
const DEFAULT_CONTEXT_LINES = 3;

/** 该行是否代表一次真实变更（新增或删除）。 */
function isChangedRow(row: DiffRow): boolean {
  return row.type === 'change' && (row.left.kind === 'removed' || row.right.kind === 'added');
}

/**
 * 把快照 diff 折叠成「变更块 + 上下文」，大段未变更内容压成一条占位行。
 *
 * 为什么必须有这一层：`parseSnapshotDiffRows` 是逐行全量输出（快照没有 patch 自带的
 * hunk 信息），于是渲染量随文件行数线性增长。此前只靠 `MAX_RENDERED_DIFF_ROWS`
 * **从第 1 行截断**兜底，带来两个问题：
 *
 * 1. **变更可能被完全截掉**：改动落在第 700 行时，前 600 行未变更内容占满窗口，
 *    用户看到的是「无改动」——比不渲染更误导。
 * 2. **渲染量与文件大小绑死**：1359 行的文件只改 3 行，仍要渲染 1359 行。
 *
 * 折叠后渲染量只与「变更块数量 × 上下文」相关，与文件总行数解耦，变更永远可见。
 *
 * 保持原数组（不折叠）的两种情形：
 * - 没有任何变更（纯上下文没有折叠意义）；
 * - 折叠后行数没有减少（变更过于密集）。
 */
export function collapseSnapshotRows(
  rows: readonly DiffRow[],
  contextLines: number = DEFAULT_CONTEXT_LINES,
): DiffRow[] {
  if (rows.length === 0) return [];

  const keep = new Array<boolean>(rows.length).fill(false);
  let hasChange = false;
  for (let index = 0; index < rows.length; index += 1) {
    if (!isChangedRow(rows[index]!)) continue;
    hasChange = true;
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, index + contextLines);
    for (let cursor = start; cursor <= end; cursor += 1) keep[cursor] = true;
  }
  if (!hasChange) return [...rows];

  const collapsed: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (keep[index]) {
      collapsed.push(rows[index]!);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && !keep[end]) end += 1;
    collapsed.push(createCollapsedRow(end - index, index));
    index = end;
  }

  // 折叠没有带来收益时保留原样：占位行本身也要占一行，不省反而更碎。
  return collapsed.length < rows.length ? collapsed : [...rows];
}

/**
 * 「⋯ N 行未变更」占位行。
 *
 * 复用 `hunk` 类型：unified 与 split 两种布局都已把它渲染成通栏分隔条，
 * 无需再为它新增一种行类型和两套渲染分支。
 */
function createCollapsedRow(hiddenCount: number, offset: number): DiffRow {
  const text = `⋯ ${hiddenCount} 行未变更`;
  return {
    key: `collapsed:${offset}:${hiddenCount}`,
    type: 'hunk',
    left: { kind: 'context', text },
    right: { kind: 'context', text },
  };
}

/**
 * 返回第一处真实变更行的索引（无变更时返回 -1）。
 * 变更行定义为 `type === 'change'` 且左右任一侧为 removed / added 的行。
 */
export function findFirstChangedRowIndex(rows: readonly DiffRow[]): number {
  return rows.findIndex(
    (row) => row.type === 'change' && (row.left.kind === 'removed' || row.right.kind === 'added'),
  );
}

/** 把高亮 token 渲染成 span（无 token 时退回纯文本，空行保留一行高度）。 */
function renderHighlightedText(highlightTokens: DiffToken[] | undefined, text: string) {
  if (highlightTokens && highlightTokens.length > 0) {
    return highlightTokens.map((token, index) =>
      token.className ? (
        <span key={`${index}:${token.text.slice(0, 8)}`} className={token.className}>
          {token.text}
        </span>
      ) : (
        <span key={`${index}:${token.text.slice(0, 8)}`}>{token.text}</span>
      ),
    );
  }
  return text || ' ';
}

function UnifiedRowCell({
  anchor,
  minimal,
  row,
  tokens: highlightTokens,
}: {
  anchor?: boolean;
  minimal: boolean;
  row: UnifiedDisplayRow;
  tokens?: DiffToken[];
}) {
  if (row.kind === 'hunk') {
    return (
      <div
        data-diff-row="hunk"
        style={{
          padding: '4px 12px',
          fontSize: 11,
          // 参考实现用中性表面表达「跳过未变更行」，不用信息色抢注意力。
          color: tokens.color.muted,
          background: `color-mix(in srgb, ${tokens.color.surface} 55%, transparent)`,
          borderBottom: `1px solid ${tokens.color.borderSubtle}`,
          fontVariantNumeric: 'tabular-nums',
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        }}
      >
        {row.text}
      </div>
    );
  }

  const cellPadding = minimal ? '1px 6px' : '2px 6px';
  const numberBorderRight = minimal ? 'none' : `1px solid ${tokens.color.borderSubtle}`;

  return (
    <div
      data-diff-anchor={anchor ? 'true' : undefined}
      data-diff-row={row.kind}
      style={{
        display: 'grid',
        gridTemplateColumns: minimal
          ? '40px 40px 16px minmax(0, 1fr)'
          : '44px 44px 18px minmax(0, 1fr)',
        alignItems: 'stretch',
        minWidth: 0,
        background: sideBackground(row.kind),
        // minimal（工具卡内嵌）不画每行分隔线：靠行底色区分，与参考实现一致。
        ...(minimal ? {} : { borderTop: `1px solid ${tokens.color.borderSubtle}` }),
      }}
    >
      <div
        style={{
          padding: cellPadding,
          textAlign: 'right',
          fontSize: 11,
          color: tokens.color.muted,
          borderRight: numberBorderRight,
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {renderLineNumber(row.leftLine)}
      </div>
      <div
        style={{
          padding: cellPadding,
          textAlign: 'right',
          fontSize: 11,
          color: tokens.color.muted,
          borderRight: numberBorderRight,
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {renderLineNumber(row.rightLine)}
      </div>
      <div
        style={{
          padding: '2px 0',
          textAlign: 'center',
          fontSize: 11,
          color:
            row.kind === 'added'
              ? tokens.color.success
              : row.kind === 'removed'
                ? tokens.color.danger
                : 'transparent',
          borderRight: numberBorderRight,
          userSelect: 'none',
        }}
      >
        {markerFor(row.kind)}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '2px 10px',
          minHeight: minimal ? 20 : 21,
          fontSize: minimal ? 13 : 12,
          lineHeight: minimal ? '20px' : 1.4,
          whiteSpace: 'pre',
          color: row.kind === 'empty' ? 'transparent' : tokens.color.text,
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        }}
      >
        {renderHighlightedText(highlightTokens, row.text)}
      </pre>
    </div>
  );
}

function DiffSideCell({
  showRightBorder,
  side,
  tokens: highlightTokens,
}: {
  showRightBorder: boolean;
  side: DiffSide;
  tokens?: DiffToken[];
}) {
  return (
    <div
      // 单元格自带行语义（added / removed / context / empty）：与 unified 的
      // `UnifiedRowCell` 对齐，布局切换不影响「哪一行是新增/删除」的可查询性。
      data-diff-row={side.kind}
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
          padding: '2px 6px',
          textAlign: 'right',
          fontSize: 11,
          color: tokens.color.muted,
          borderRight: `1px solid ${tokens.color.borderSubtle}`,
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {renderLineNumber(side.lineNumber)}
      </div>
      <div
        style={{
          padding: '2px 0',
          textAlign: 'center',
          fontSize: 11,
          color:
            side.kind === 'added'
              ? tokens.color.success
              : side.kind === 'removed'
                ? tokens.color.danger
                : 'transparent',
          borderRight: `1px solid ${tokens.color.borderSubtle}`,
          userSelect: 'none',
        }}
      >
        {markerFor(side.kind)}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '2px 10px',
          minHeight: 21,
          fontSize: 12,
          lineHeight: 1.4,
          whiteSpace: 'pre',
          /* 双栏时每个代码列只有约半栏宽，长行（深层 import、压缩代码、超长字符串）
             会以 `pre` 的固有宽度撑出单元格并压到右栏上。这里必须显式裁切并让外层
             滚动容器承接横向滚动，否则窄屏（768px）出现跨栏重叠。 */
          overflow: 'hidden',
          minWidth: 0,
          color: side.kind === 'empty' ? 'transparent' : tokens.color.text,
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        }}
      >
        {renderHighlightedText(highlightTokens, side.text)}
      </pre>
    </div>
  );
}

export function UnifiedCodeDiff({
  afterText,
  beforeText,
  chrome = 'default',
  diffText,
  filePath,
  hideHeader = false,
  maxHeight = 360,
  revealFirstChange = false,
  viewMode = 'unified',
}: UnifiedCodeDiffProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);
  /**
   * 是否放弃「只渲染变更区」的折叠。
   *
   * 折叠是默认路径（省渲染、保证变更可见），但「核对某处没被误删」是真实需求，
   * 必须留出口。只在用户点击后按完整行数渲染；展开后仍受 `MAX_RENDERED_DIFF_ROWS`
   * 约束，避免一次点击把几万行塞进 DOM。
   */
  const [expandCollapsed, setExpandCollapsed] = useState(false);
  // `auto` 模式的宽度判定结果。首帧按窄屏（unified）兜底：测量在 layout effect
  // 里同步完成，React 会在绘制前重渲染，用户看不到「先上下、再左右」的跳动。
  const [autoSplit, setAutoSplit] = useState(false);

  useLayoutEffect(() => {
    if (viewMode !== 'auto') {
      return;
    }
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const measure = (width: number): void => {
      const next = width >= SPLIT_MIN_CONTAINER_WIDTH;
      setAutoSplit((previous) => (previous === next ? previous : next));
    };

    measure(element.getBoundingClientRect().width);
    // jsdom / SSR 没有 ResizeObserver：保留初始测量结果即可（通常退回 unified）。
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode]);

  const resolvedViewMode: 'split' | 'unified' =
    viewMode === 'auto' ? (autoSplit ? 'split' : 'unified') : viewMode;
  const isMinimalChrome = chrome === 'minimal';
  const fillsHeight = maxHeight === 'fill';
  const usingSnapshot = typeof beforeText === 'string' || typeof afterText === 'string';
  const normalizedBefore = beforeText ?? '';
  const normalizedAfter = afterText ?? '';
  const derived = useMemo(() => {
    const parsedRows = usingSnapshot
      ? parseSnapshotDiffRows(normalizedBefore, normalizedAfter)
      : parseUnifiedDiffRows(diffText ?? '');
    // 快照对比没有 patch 自带的 hunk 信息，逐行全量输出。大文件下这既浪费渲染，
    // 又会让 `MAX_RENDERED_DIFF_ROWS` 的「从第 1 行截断」把靠后的真实变更整个切掉。
    // 折叠成「变更块 + 上下文」后，渲染量与文件大小解耦，变更永远可见。
    //
    // `expandCollapsed` 是用户的显式覆盖：折叠省的是默认路径，但「我要核对某处没被误删」
    // 是真实需求，必须留出口。只在点击后按完整行数渲染，默认永不铺全文。
    const shouldCollapse = usingSnapshot && !expandCollapsed;
    const rows = shouldCollapse ? collapseSnapshotRows(parsedRows) : parsedRows;
    return {
      rows,
      /** 折叠前的完整行数，用于「显示全部」按钮文案与是否展示该按钮。 */
      sourceRowCount: parsedRows.length,
      collapsible: rows.length < parsedRows.length,
      summary: usingSnapshot
        ? summarizeSnapshotDiff(normalizedBefore, normalizedAfter)
        : summarizeUnifiedDiff(diffText ?? ''),
      unifiedRows: resolvedViewMode === 'split' ? null : toUnifiedDisplayRows(rows),
    };
  }, [
    diffText,
    expandCollapsed,
    normalizedAfter,
    normalizedBefore,
    usingSnapshot,
    resolvedViewMode,
  ]);
  const { collapsible, rows, sourceRowCount, summary, unifiedRows } = derived;
  // split 与 unified 共用同一份 hunk 文案（见 `computeHunkLabels`）：左右布局下
  // 分隔条也必须说「⋯ N 行未变更」，不能退回原始 `@@ … @@`。unified 分支的文案
  // 已由 `toUnifiedDisplayRows` 算好，这里只在 split 下额外计算，避免重复遍历。
  const hunkLabels = useMemo(
    () => (resolvedViewMode === 'split' ? computeHunkLabels(rows) : null),
    [resolvedViewMode, rows],
  );
  const firstChangeIndex =
    resolvedViewMode === 'split'
      ? findFirstChangedRowIndex(rows)
      : (unifiedRows?.findIndex((row) => row.kind === 'added' || row.kind === 'removed') ?? -1);
  const anchorKey =
    resolvedViewMode === 'split'
      ? rows[firstChangeIndex]?.key
      : unifiedRows?.[firstChangeIndex]?.key;
  const anchorIndex = revealFirstChange ? firstChangeIndex : -1;

  const totalRowCount = unifiedRows ? unifiedRows.length : rows.length;
  const hiddenRowCount = showAllRows ? 0 : Math.max(0, totalRowCount - MAX_RENDERED_DIFF_ROWS);
  const visibleRows = useMemo(
    () => (hiddenRowCount > 0 ? rows.slice(0, MAX_RENDERED_DIFF_ROWS) : rows),
    [hiddenRowCount, rows],
  );
  const visibleUnifiedRows = useMemo(
    () =>
      unifiedRows && hiddenRowCount > 0
        ? unifiedRows.slice(0, MAX_RENDERED_DIFF_ROWS)
        : unifiedRows,
    [hiddenRowCount, unifiedRows],
  );

  // 只高亮可见 snapshot 前缀，保留从文件起点开始的多行语法状态。
  // patch 缺失完整上下文，直接使用纯文本，不逐行重置解析器或绕过总预算。
  // key：unified 用 row.key；split 用 `${row.key}:left` / `${row.key}:right`。
  const rowTokens = useMemo(() => {
    const map = new Map<string, DiffToken[]>();
    const language = detectLanguage(filePath);
    if (!usingSnapshot || !language) return map;
    let beforeEnd = 0;
    let afterEnd = 0;
    if (visibleUnifiedRows) {
      for (const row of visibleUnifiedRows) {
        beforeEnd = Math.max(beforeEnd, row.leftLine ?? 0);
        afterEnd = Math.max(afterEnd, row.rightLine ?? 0);
      }
    } else {
      for (const row of visibleRows) {
        beforeEnd = Math.max(beforeEnd, row.left.lineNumber ?? 0);
        afterEnd = Math.max(afterEnd, row.right.lineNumber ?? 0);
      }
    }
    const beforePrefix = normalizedBefore.split('\n', beforeEnd).join('\n');
    const afterPrefix = normalizedAfter.split('\n', afterEnd).join('\n');
    if (beforePrefix.length + afterPrefix.length > MAX_HIGHLIGHT_CHARS) return map;
    const beforeLines = highlightCodeLines(beforePrefix, language);
    const afterLines = highlightCodeLines(afterPrefix, language);

    if (visibleUnifiedRows) {
      for (const row of visibleUnifiedRows) {
        if (row.kind === 'hunk') continue;
        const tokens =
          row.kind === 'removed'
            ? beforeLines?.[(row.leftLine ?? 0) - 1]
            : (afterLines?.[(row.rightLine ?? 0) - 1] ?? beforeLines?.[(row.leftLine ?? 0) - 1]);
        if (tokens && tokens.length > 0) map.set(row.key, tokens);
      }
      return map;
    }

    for (const row of visibleRows) {
      if (row.type === 'hunk') continue;
      const left = beforeLines?.[(row.left.lineNumber ?? 0) - 1];
      const right = afterLines?.[(row.right.lineNumber ?? 0) - 1];
      if (left && left.length > 0) map.set(`${row.key}:left`, left);
      if (right && right.length > 0) map.set(`${row.key}:right`, right);
    }
    return map;
  }, [filePath, normalizedAfter, normalizedBefore, visibleRows, visibleUnifiedRows, usingSnapshot]);

  useLayoutEffect(() => {
    if (!revealFirstChange) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    let frameId: number | undefined;
    let attempts = 0;

    const revealAnchor = () => {
      if (cancelled) {
        return;
      }

      const target = container.querySelector('[data-diff-anchor="true"]');
      if (!target || container.clientHeight === 0) {
        if (attempts < 30) {
          attempts += 1;
          frameId = requestAnimationFrame(revealAnchor);
        }
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      container.scrollTop = Math.max(
        0,
        container.scrollTop + targetRect.top - containerRect.top - 8,
      );
    };

    revealAnchor();

    return () => {
      cancelled = true;
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [anchorKey, revealFirstChange, viewMode]);

  if (rows.length === 0) {
    return (
      <div
        style={{
          border: isMinimalChrome ? 'none' : `1px solid ${tokens.color.border}`,
          borderRadius: isMinimalChrome ? 0 : tokens.radius.lg,
          background: isMinimalChrome
            ? 'transparent'
            : `color-mix(in srgb, ${tokens.color.surface} 86%, transparent)`,
          padding: isMinimalChrome ? '4px 0' : '6px 10px',
          fontSize: 12,
          color: tokens.color.muted,
          ...(fillsHeight
            ? { display: 'flex', alignItems: 'center', height: '100%', minHeight: 0 }
            : {}),
        }}
      >
        暂无可展示的 diff。
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-diff-view-mode={resolvedViewMode}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: isMinimalChrome
          ? 'none'
          : `1px solid color-mix(in srgb, ${tokens.color.border} 88%, transparent)`,
        borderRadius: isMinimalChrome ? 0 : tokens.radius.md,
        background: isMinimalChrome
          ? 'transparent'
          : `color-mix(in srgb, ${tokens.color.surface} 96%, transparent)`,
        // fill 模式：作为 grid/flex 子项撑满父容器剩余高度，短 diff 不再留大片空白。
        ...(fillsHeight ? { flex: '1 1 auto', minHeight: 0 } : {}),
      }}
    >
      {!hideHeader && (filePath || summary.added > 0 || summary.removed > 0) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: isMinimalChrome ? '3px 0 6px' : '6px 10px',
            borderBottom: `1px solid ${tokens.color.borderSubtle}`,
            background: isMinimalChrome
              ? 'transparent'
              : `color-mix(in srgb, ${tokens.color.surface} 12%, transparent)`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              minWidth: 0,
              fontSize: 11,
              color: tokens.color.text,
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
              color: tokens.color.muted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            +{summary.added} / -{summary.removed}
          </div>
        </div>
      )}

      {/* minimal（工具卡内嵌）不渲染列头：参考实现的 diff 没有「旧/新/±/内容」表头，
          文件卡头已经说明这是哪个文件的变更。 */}
      {!isMinimalChrome &&
        (resolvedViewMode === 'split' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              fontSize: 11,
              color: tokens.color.muted,
              fontWeight: 700,
              borderBottom: `1px solid ${tokens.color.borderSubtle}`,
              background: isMinimalChrome
                ? 'transparent'
                : `color-mix(in srgb, ${tokens.color.surface} 8%, transparent)`,
            }}
          >
            <div
              style={{ padding: '6px 10px', borderRight: `1px solid ${tokens.color.borderSubtle}` }}
            >
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
              color: tokens.color.muted,
              fontWeight: 700,
              padding: isMinimalChrome ? 0 : '0 0 0 1px',
              borderBottom: `1px solid ${tokens.color.borderSubtle}`,
              background: isMinimalChrome
                ? 'transparent'
                : `color-mix(in srgb, ${tokens.color.surface} 8%, transparent)`,
            }}
          >
            <div style={{ padding: '4px', textAlign: 'right' }}>旧</div>
            <div style={{ padding: '4px', textAlign: 'right' }}>新</div>
            <div style={{ padding: '4px 0', textAlign: 'center' }}>±</div>
            <div style={{ padding: '4px 8px' }}>内容</div>
          </div>
        ))}

      <div
        ref={scrollContainerRef}
        style={{
          overflow: 'auto',
          maxHeight: fillsHeight ? '100%' : maxHeight,
          ...(fillsHeight ? { flex: '1 1 auto', minHeight: 0 } : {}),
        }}
      >
        <div style={{ minWidth: resolvedViewMode === 'split' ? 720 : undefined }}>
          {resolvedViewMode === 'split'
            ? visibleRows.map((row, index) => {
                if (row.type === 'hunk') {
                  return (
                    <div
                      key={row.key}
                      data-diff-row="hunk"
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        color: tokens.color.muted,
                        background: `color-mix(in srgb, ${tokens.color.surface} 55%, transparent)`,
                        borderTop: index === 0 ? 'none' : `1px solid ${tokens.color.borderSubtle}`,
                        borderBottom: `1px solid ${tokens.color.borderSubtle}`,
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                      }}
                    >
                      {hunkLabels?.get(row.key) ?? row.left.text}
                    </div>
                  );
                }

                return (
                  <div
                    key={row.key}
                    data-diff-anchor={index === anchorIndex ? 'true' : undefined}
                    data-diff-row="change"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                      borderTop: index === 0 ? 'none' : `1px solid ${tokens.color.borderSubtle}`,
                    }}
                  >
                    <DiffSideCell
                      side={row.left}
                      showRightBorder
                      tokens={rowTokens.get(`${row.key}:left`)}
                    />
                    <DiffSideCell
                      side={row.right}
                      showRightBorder={false}
                      tokens={rowTokens.get(`${row.key}:right`)}
                    />
                  </div>
                );
              })
            : (visibleUnifiedRows ?? []).map((row, index) => (
                <UnifiedRowCell
                  key={row.key}
                  row={row}
                  anchor={index === anchorIndex}
                  minimal={isMinimalChrome}
                  tokens={rowTokens.get(row.key)}
                />
              ))}
          {/*
           * 折叠默认只画「变更块 + 上下文」。但「核对某处没被误删」是真实需求，
           * 必须留出口——所以给一个显式入口，点了才按完整行数渲染。
           * 展开后若仍超过 `MAX_RENDERED_DIFF_ROWS`，下面的按钮继续兜底。
           */}
          {collapsible && !expandCollapsed && (
            <button
              type="button"
              className="diff-expand-button"
              data-diff-expand-collapsed="true"
              onClick={() => setExpandCollapsed(true)}
            >
              显示全部 {sourceRowCount} 行
            </button>
          )}
          {hiddenRowCount > 0 && (
            <button
              type="button"
              className="diff-expand-button"
              data-diff-expand="true"
              onClick={() => setShowAllRows(true)}
            >
              ⋯ 还有 {hiddenRowCount} 行未展示（点击展开）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
