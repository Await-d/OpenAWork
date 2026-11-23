import type {
  FileChangeResult,
  FileChangeResultEntry,
} from '../src/components/chat/tool-call/shared/file-change-result.js';

/**
 * 「快照被网关瘦身」的真实形态：`before` / `after` 都被截到
 * `SLIM_STRING_MAX = 8000`，于是差异（位于第 8000 字符之后）在部分 diff 里
 * 完全消失，显示成 `+0/-0`——「文件根本没变」。
 *
 * 下面用 500 行填充把真实差异推到 9000+ 字符处：截断副本只含相同前缀，
 * 完整副本才包含那一行改动。harness 因此能同时验证「默认显示 +0/-0」与
 * 「加载完整后变成 +1/-1」。
 */
const FILLER_LINES = Array.from(
  { length: 500 },
  (_, index) => `// filler line ${index} — 用于把真实差异推到截断点之后`,
).join('\n');

function buildFull(tail: string): string {
  return `${FILLER_LINES}\n${tail}\n`;
}

export const fullBefore = buildFull("const value = 'before';");
export const fullAfter = buildFull("const value = 'after';");

const SLIM_MAX = 8000;
export const slimBefore = fullBefore.slice(0, SLIM_MAX);
export const slimAfter = fullAfter.slice(0, SLIM_MAX);

/** 工具输出里常见的相对路径形态（存储侧是绝对路径）。 */
export const RELATIVE_PATH = 'apps/web/src/large-file.ts';
export const ABSOLUTE_PATH = '/home/await/project/OpenAWork/apps/web/src/large-file.ts';

function entry(overrides: Partial<FileChangeResultEntry>): FileChangeResultEntry {
  return {
    action: 'update',
    path: RELATIVE_PATH,
    before: slimBefore,
    after: slimAfter,
    additions: 0,
    deletions: 0,
    incomplete: true,
    omittedChars: fullBefore.length - slimBefore.length + (fullAfter.length - slimAfter.length),
    ...overrides,
  };
}

/** 截断态：部分 diff 是 +0/-0，且带「快照被截断 · 省略 N 字符」提示。 */
export const truncatedResult: FileChangeResult = {
  success: true,
  files: [entry({})],
  raw: { success: true, path: ABSOLUTE_PATH, truncated: true },
};

/** 完整态：两侧都是全文，无提示、无加载入口。 */
export const completeResult: FileChangeResult = {
  success: true,
  files: [
    entry({
      before: fullBefore,
      after: fullAfter,
      additions: 1,
      deletions: 1,
      incomplete: false,
      omittedChars: undefined,
    }),
  ],
  raw: { success: true, path: ABSOLUTE_PATH },
};

/** 网关在 `includeText=true` 下返回的完整 `fileDiffs[]`。 */
export const completeProjection = {
  fileDiffs: [
    {
      file: ABSOLUTE_PATH,
      before: fullBefore,
      after: fullAfter,
      additions: 1,
      deletions: 1,
    },
  ],
  snapshots: [],
  summary: {
    snapshotCount: 0,
    sourceKinds: [],
    totalAdditions: 1,
    totalDeletions: 1,
    totalFileDiffs: 1,
  },
};
