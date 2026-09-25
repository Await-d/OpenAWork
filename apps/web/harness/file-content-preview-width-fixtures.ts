/**
 * FileContentPreview 宽度验收夹具（entry 与 verify 共用）。
 *
 * 受力点：
 *   1. 短行文件 —— 输出区在 `.tool-call-inline-section`（row flex + wrap）里
 *      是否被「输出」标签挤窄、代码块是否铺满卡片；
 *   2. 超长单行 —— `white-space: pre` 的横向溢出是否被约束在代码块自身，
 *      行号栏在横向滚动时是否仍可见。
 */
import type { FileContentLike } from '../src/components/chat/tool-call/previews/file-content-preview.js';

export interface FileContentWidthCase {
  readonly id: string;
  readonly label: string;
  readonly data: FileContentLike;
}

/** 故意超长的一行（约 300 字符），任何移动端 / 窄分栏宽度都放不下。 */
export const OVERSIZED_LINE =
  'const result = pipeline.filter((item) => item.enabled && item.score > threshold).map((item) => ({ ...item, label: `${item.name}: ${item.score.toFixed(2)}` })).sort((a, b) => b.score - a.score); // prettier-ignore 这一行故意很长，用于验证代码块的横向溢出是否被约束在自身容器内';

export const NORMAL_LINE_A = 'export function resolveWidth(input: WidthInput): number {';
export const NORMAL_LINE_B = '  return input.available;';

const SHORT_LINE = 'export const MAX_VISIBLE_LINES = 30;';
const SHORT_LINE_2 = 'const PAD = 2;';

export const FILE_CONTENT_WIDTH_CASES: readonly FileContentWidthCase[] = [
  {
    id: 'short-lines',
    label: '短行文件：代码块应铺满卡片、与「输出」标签后的可用宽度对齐',
    data: {
      path: 'apps/web/src/components/chat/tool-call/css/previews.css',
      content: [SHORT_LINE, SHORT_LINE_2, NORMAL_LINE_B].join('\n'),
      lineStart: 1,
      lineEnd: 3,
      totalLines: 3,
    },
  },
  {
    id: 'long-line',
    label: '超长单行（横向溢出受力点）',
    data: {
      path: 'apps/web/src/components/chat/tool-call/previews/file-content-preview.tsx',
      content: [NORMAL_LINE_A, OVERSIZED_LINE, NORMAL_LINE_B].join('\n'),
      lineStart: 1,
      lineEnd: 3,
      totalLines: 3,
    },
  },
  {
    id: 'wide-gutter',
    label: '五行行号（号码栏变宽）+ 超长单行',
    data: {
      path: 'services/agent-gateway/src/session/very/deeply/nested/path/to/session-store.ts',
      content: Array.from({ length: 40 }, (_, i) =>
        i === 12 ? OVERSIZED_LINE : `  const value${i} = compute(${i});`,
      ).join('\n'),
      lineStart: 10000,
      lineEnd: 10039,
      totalLines: 12345,
    },
  },
  {
    id: 'flags',
    label: '截断 / 超大文件标记 + 长路径（meta 行换行受力点）',
    data: {
      path: 'apps/web/src/pages/chat-page/conversation/render/chat-page-utils-with-an-extremely-long-file-name.ts',
      content: [SHORT_LINE, NORMAL_LINE_A, OVERSIZED_LINE].join('\n'),
      lineStart: 1,
      lineEnd: 3,
      totalLines: 98765,
      truncated: true,
      byteLimitReached: true,
    },
  },
];

/** 固定宽度的容器用例（宽度由容器决定，不依赖视口尺寸）。 */
export const FILE_CONTENT_PANE_WIDTHS = [375, 768, 1280] as const;
