import { ExpandableOutput } from '../shared/expandable-output.js';
import { JsonPreview } from './json-preview.js';

/**
 * `read_tool_output` returns a paged window over a previously-stored tool
 * result: `{ outputType, selection, output, totalLines/totalItems/totalChars,
 * topLevelKeys, note }` (see the gateway's `tool-output-schemas.ts`). Showing
 * the raw envelope buries the actual page, so we render the window metadata
 * and the payload separately.
 */
export interface ToolOutputReadView {
  isError: boolean;
  note?: string;
  output?: unknown;
  outputType: string;
  selectionLabel: string;
  sizeBytes?: number;
  topLevelKeys?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function describeSelection(
  selection: Record<string, unknown>,
  total: { chars?: number; items?: number; lines?: number },
): string {
  const mode = typeof selection['mode'] === 'string' ? selection['mode'] : 'full';
  switch (mode) {
    case 'lines': {
      const start = readNumber(selection, 'lineStart') ?? 1;
      const count = readNumber(selection, 'lineCount') ?? 0;
      return total.lines === undefined
        ? `第 ${start} 行起共 ${count} 行`
        : `第 ${start}-${start + count - 1} 行 / 共 ${total.lines} 行`;
    }
    case 'chars': {
      const start = readNumber(selection, 'charStart') ?? 0;
      const count = readNumber(selection, 'charCount') ?? 0;
      return total.chars === undefined
        ? `字符 ${start}-${start + count}`
        : `字符 ${start}-${start + count} / 共 ${total.chars}`;
    }
    case 'items': {
      const start = readNumber(selection, 'itemStart') ?? 0;
      const count = readNumber(selection, 'itemCount') ?? 0;
      return total.items === undefined
        ? `第 ${start} 项起共 ${count} 项`
        : `第 ${start}-${start + count - 1} 项 / 共 ${total.items} 项`;
    }
    case 'keys':
      return typeof selection['jsonPath'] === 'string'
        ? `读取路径 ${selection['jsonPath']}`
        : '仅顶层键名';
    default:
      return '完整结果';
  }
}

export function extractToolOutputRead(output: unknown): ToolOutputReadView | null {
  const record = asRecord(output);
  if (!record) return null;
  if (record['fullOutputPreserved'] !== true) return null;
  const selection = asRecord(record['selection']);
  if (!selection) return null;

  const total = {
    chars: readNumber(record, 'totalChars'),
    items: readNumber(record, 'totalItems'),
    lines: readNumber(record, 'totalLines'),
  };
  const topLevelKeys = Array.isArray(record['topLevelKeys'])
    ? record['topLevelKeys'].filter((key): key is string => typeof key === 'string')
    : undefined;

  return {
    isError: record['isError'] === true,
    ...(typeof record['note'] === 'string' ? { note: record['note'] } : {}),
    ...(record['output'] !== undefined ? { output: record['output'] } : {}),
    outputType: typeof record['outputType'] === 'string' ? record['outputType'] : 'unknown',
    selectionLabel: describeSelection(selection, total),
    ...(typeof record['sizeBytes'] === 'number' ? { sizeBytes: record['sizeBytes'] } : {}),
    ...(topLevelKeys && topLevelKeys.length > 0 ? { topLevelKeys } : {}),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  return `${bytes} B`;
}

export function ToolOutputReadPreview({ view }: { view: ToolOutputReadView }) {
  const { output } = view;
  return (
    <div className="tool-read" data-error={view.isError ? 'true' : undefined}>
      <div className="tool-read-head">
        <span className="tool-read-type">{view.outputType}</span>
        <span className="tool-read-range">{view.selectionLabel}</span>
        {view.sizeBytes !== undefined && (
          <span className="tool-read-size">{formatBytes(view.sizeBytes)}</span>
        )}
      </div>
      {view.topLevelKeys && view.topLevelKeys.length > 0 && (
        <div className="tool-read-keys">
          {view.topLevelKeys.map((key) => (
            <span className="tool-read-key" key={key}>
              {key}
            </span>
          ))}
        </div>
      )}
      {output !== undefined &&
        (typeof output === 'string' ? (
          <ExpandableOutput text={output} maxChars={800} maxLines={24} />
        ) : (
          <JsonPreview data={output} maxLines={18} />
        ))}
      {view.note && <div className="tool-read-note">{view.note}</div>}
    </div>
  );
}
