/// <reference types="vite/client" />
import streamSource from '../../../services/agent-gateway/src/routes/stream.ts?raw';

const file = {
  action: 'update',
  path: 'src/example.ts',
  before: 'export const original = 1;\n',
  after: 'export const replacement = 2;\n',
  additions: 1,
  deletions: 1,
};
const envelope = { success: true, files: [file] };
export const cases = [
  { id: 'generic', tool: 'tool', output: envelope, complete: [true] },
  { id: 'patch-no-request', tool: 'patch', output: JSON.stringify(envelope), complete: [true] },
  {
    id: 'double-json',
    tool: 'tool',
    output: JSON.stringify(JSON.stringify(envelope)),
    complete: [true],
  },
  {
    id: 'stream-source',
    tool: 'tool',
    output: JSON.stringify({
      success: true,
      files: [
        {
          ...file,
          path: 'services/agent-gateway/src/routes/stream.ts',
          before: streamSource,
          after: `${streamSource}\n// file-change QA end sentinel\n`,
        },
      ],
    }),
    complete: [true],
  },
  {
    id: 'partial-before',
    tool: 'tool',
    output: `{"success":true,"files":[{"action":"update","path":"services/agent-gateway/src/routes/stream.ts","before":${JSON.stringify(streamSource).slice(0, 16000)}`,
    complete: [false],
  },
  {
    id: 'truncated-flag',
    tool: 'tool',
    output: { success: true, files: [{ ...file, truncated: true }] },
    complete: [false],
    /*
     * 「不完整」不等于「画不出差异」：两侧前后文本都在，产品有意渲染「仅对比前段」
     * 的部分 diff。`complete` 表示对比是否完整，`diff` 表示是否渲染差异，两件事。
     */
    diff: [true],
  },
  {
    id: 'truncated-marker',
    tool: 'tool',
    output: {
      success: true,
      files: [{ ...file, before: 'prefix…[truncated, 123 chars omitted]' }],
    },
    complete: [false],
    diff: [true],
  },
  {
    id: 'false-success',
    tool: 'tool',
    output: { success: false, files: [file] },
    complete: [true],
  },
  {
    id: 'multiple-paths',
    tool: 'tool',
    output: {
      success: true,
      files: [
        {
          action: 'add',
          path: 'src/new.ts',
          before: '',
          after: 'export const created = true;\n',
          additions: 1,
        },
        {
          action: 'delete',
          path: 'src/removed.ts',
          before: 'export const removed = true;\n',
          after: '',
          deletions: 1,
        },
        {
          ...file,
          path: 'src/old.ts',
          moveTo: `apps/web/${'deeply-nested-workspace/'.repeat(8)}moved.ts`,
        },
        {
          ...file,
          path: `src/${'unbrokenlongsegment'.repeat(24)}.ts`,
          after: `const longValue = '${'long-content-'.repeat(80)}';\n`,
        },
      ],
    },
    complete: [true, true, true, true],
  },
  {
    id: 'missing-after',
    tool: 'tool',
    output: {
      success: true,
      files: [{ action: 'update', path: 'src/missing.ts', before: file.before }],
    },
    complete: [false],
  },
  { id: 'empty', tool: 'tool', output: { success: true, files: [] }, complete: [] },
] as const;
