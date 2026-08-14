import type { AssistantTraceToolCall } from '@openAwork/shared';
import { describe, expect, it } from 'vitest';
import { extractSnippet } from '../../file-preview/extract-snippet.js';
import { decideTimeDivider } from '../../message/time-divider.js';
import { formatGroupItem } from '../cards/grouped-tool-call-pill.js';
import {
  extractFilenameExtension,
  getToolCategory,
  tokenizeSummary,
} from '../shared/colorize-summary.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { groupConsecutiveTools } from '../shared/group-consecutive-tools.js';
import { textContainsPath, tokenizePathsInText } from '../shared/tokenize-paths.js';
import {
  batchSubInputSummary,
  batchSubVisualState,
  buildGenericInputSummary,
  buildLspInlineSummary,
  buildPartialBashOutput,
  extractDiagnosticsFromOutput,
  extractFileContentFromOutput,
  extractFilePathListFromOutput,
  extractGrepContentHitsFromOutput,
  extractGrepCountsFromOutput,
  extractReviewChangesFromOutput,
  extractSearchHitsFromOutput,
  extractTextFromOutput,
  extractTodosFromOutput,
  extractTreeNodesFromOutput,
  lspErrorSnippet,
  lspInputDescription,
  lspSuccessSummary,
  summarizeArrayField,
  summarizeBackgroundCancelInput,
  summarizeBackgroundOutputInput,
  summarizeBatchInput,
  summarizeExitPlanModeInput,
  summarizeMcpCallInput,
  summarizeObjectField,
  summarizeQuestionInput,
  summarizeSessionInfoInput,
  summarizeSkillMcpInput,
  summarizeTodoWriteInput,
} from './tool-call-inline.js';

/**
 * Regression coverage for the tool-card title/summary helpers. The bug we
 * are guarding against: previously these helpers `JSON.stringify`'d any
 * array/object input and sliced the first 40 characters into the card's
 * header, which produced titles like `batch [{"tool":"bash","parameters":...`
 * and `todowrite [{"content":"...","status":"..."`. The asserts below pin
 * the new contract: **no header may ever contain raw JSON brackets**.
 */
describe('summarizeArrayField', () => {
  it('renders batch.tool_calls as "<n> 个调用 · <names>" with dedup', () => {
    expect(
      summarizeArrayField('tool_calls', [
        { tool: 'bash', parameters: {} },
        { tool: 'grep', parameters: {} },
        { tool: 'bash', parameters: {} },
      ]),
    ).toBe('3 个调用 · bash, grep');
  });

  it('caps the displayed tool name list at 3 with a "+N" suffix', () => {
    const calls = [
      { tool: 'bash' },
      { tool: 'grep' },
      { tool: 'glob' },
      { tool: 'read' },
      { tool: 'edit' },
    ];
    expect(summarizeArrayField('tool_calls', calls)).toBe('5 个调用 · bash, grep, glob +2');
  });

  it('falls back to "<n> 个调用" when items have no `tool` field', () => {
    expect(summarizeArrayField('tool_calls', [{ foo: 1 }, { bar: 2 }])).toBe('2 个调用');
  });

  it('summarises todowrite.todos by status', () => {
    expect(
      summarizeArrayField('todos', [
        { content: 'a', status: 'pending', priority: 'high', id: '1' },
        { content: 'b', status: 'in_progress', priority: 'medium', id: '2' },
        { content: 'c', status: 'completed', priority: 'low', id: '3' },
      ]),
    ).toBe('3 项 · 1待办/1进行中/1完成');
  });

  it('uses generic "<key>×<n>" for unknown array fields', () => {
    expect(summarizeArrayField('files', [1, 2, 3])).toBe('files×3');
  });

  it('marks an empty array explicitly', () => {
    expect(summarizeArrayField('todos', [])).toBe('todos: ∅');
  });
});

describe('summarizeObjectField', () => {
  it('lists up to 3 keys then "+n" for the rest', () => {
    expect(summarizeObjectField({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe('{a, b, c, +2}');
  });

  it('skips undefined values when counting keys', () => {
    expect(summarizeObjectField({ a: 1, b: undefined, c: 2 })).toBe('{a, c}');
  });

  it('returns "{}" for an empty object', () => {
    expect(summarizeObjectField({})).toBe('{}');
  });
});

describe('summarizeTodoWriteInput', () => {
  it('returns the array summary when todos is present', () => {
    expect(
      summarizeTodoWriteInput({
        todos: [{ content: 'x', status: 'pending', priority: 'high', id: '1' }],
      }),
    ).toBe('1 项 · 1待办');
  });

  it('returns undefined for malformed input so caller can fall back', () => {
    expect(summarizeTodoWriteInput({ todos: 'not-an-array' })).toBeUndefined();
    expect(summarizeTodoWriteInput({})).toBeUndefined();
  });
});

describe('summarizeBatchInput', () => {
  it('reads tool_calls', () => {
    expect(summarizeBatchInput({ tool_calls: [{ tool: 'bash' }] })).toBe('1 个调用 · bash');
  });

  it('falls back to alternative key names', () => {
    expect(summarizeBatchInput({ calls: [{ tool: 'bash' }] })).toBe('1 个调用 · bash');
    expect(summarizeBatchInput({ invocations: [{ tool: 'bash' }] })).toBe('1 个调用 · bash');
  });

  it('returns undefined when no calls field is present', () => {
    expect(summarizeBatchInput({})).toBeUndefined();
  });
});

describe('summarizeMcpCallInput', () => {
  it('formats as "<serverId>.<toolName>"', () => {
    expect(
      summarizeMcpCallInput({
        serverId: 'memory',
        toolName: 'query',
        arguments: {},
      }),
    ).toBe('memory.query');
  });

  it('appends an arguments object summary when non-empty', () => {
    expect(
      summarizeMcpCallInput({
        serverId: 'memory',
        toolName: 'query',
        arguments: { q: 'hello', limit: 10 },
      }),
    ).toBe('memory.query · {q, limit}');
  });

  it('uses "?" placeholders for missing identifiers', () => {
    expect(summarizeMcpCallInput({})).toBe('?.?');
  });
});

describe('buildGenericInputSummary — JSON-leak regression', () => {
  it('NEVER stringifies an array field into the header', () => {
    const summary = buildGenericInputSummary({
      tool_calls: [
        { tool: 'bash', parameters: { command: 'ls' } },
        { tool: 'grep', parameters: { pattern: 'foo' } },
      ],
    });
    expect(summary).not.toMatch(/\[\{/);
    expect(summary).not.toMatch(/"tool":/);
    expect(summary).toContain('个调用');
  });

  it('NEVER stringifies an object field into the header', () => {
    const summary = buildGenericInputSummary({
      arguments: { url: 'https://example.com', method: 'POST', body: { a: 1 } },
    });
    expect(summary).not.toMatch(/\{"url"/);
    expect(summary).toMatch(/\{url, method, body\}/);
  });

  it('preserves human-readable strings verbatim (no JSON wrapping)', () => {
    expect(buildGenericInputSummary({ command: 'ls -la' })).toBe('ls -la');
  });

  it('clamps very long string fields with U+2026 ellipsis', () => {
    const long = 'x'.repeat(200);
    const summary = buildGenericInputSummary({ command: long });
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(80);
  });

  it('skips noise keys like _batchProgress / metadata', () => {
    const summary = buildGenericInputSummary({
      command: 'ls',
      _batchProgress: { subTools: [{ status: 'running' }] },
      metadata: { foo: 'bar' },
    });
    expect(summary).toBe('ls');
  });

  it('handles empty input gracefully', () => {
    expect(buildGenericInputSummary({})).toBe('');
  });
});

describe('extractTodosFromOutput', () => {
  it('reads metadata.todos out of the standard todowrite envelope', () => {
    const todos = extractTodosFromOutput({
      title: '2 项 todos',
      output: '[]',
      metadata: {
        todos: [
          { content: 'a', status: 'pending', priority: 'high', id: '1' },
          { content: 'b', status: 'completed', priority: 'low', id: '2' },
        ],
      },
    });
    expect(todos).toHaveLength(2);
    expect(todos?.[0]?.content).toBe('a');
  });

  it('also reads a top-level todos array when present', () => {
    const todos = extractTodosFromOutput({
      todos: [{ content: 'x', status: 'pending' }],
    });
    expect(todos).toHaveLength(1);
  });

  it('returns null for non-object outputs and unrelated shapes', () => {
    expect(extractTodosFromOutput(null)).toBeNull();
    expect(extractTodosFromOutput('hello')).toBeNull();
    expect(extractTodosFromOutput([1, 2, 3])).toBeNull();
    expect(extractTodosFromOutput({ foo: 'bar' })).toBeNull();
  });

  it('returns null when metadata.todos is not an array', () => {
    expect(extractTodosFromOutput({ metadata: { todos: 'oops' } })).toBeNull();
  });
});

describe('extractTextFromOutput', () => {
  it('returns plain string outputs verbatim', () => {
    expect(extractTextFromOutput('hello')).toEqual({
      text: 'hello',
      isMarkdown: false,
    });
  });

  it('extracts the .output field from envelopes (todoread/skill/lsp_*)', () => {
    expect(extractTextFromOutput({ output: 'rendered text', metadata: {} })).toEqual({
      text: 'rendered text',
      isMarkdown: false,
    });
  });

  it('falls back to .content (workspace_read_file shape)', () => {
    expect(
      extractTextFromOutput({
        content: 'file body',
        path: '/x',
        truncated: false,
      }),
    ).toEqual({
      text: 'file body',
      isMarkdown: false,
    });
  });

  it('honours format: "markdown" hint to enable markdown rendering', () => {
    expect(extractTextFromOutput({ output: '# title', format: 'markdown' })).toEqual({
      text: '# title',
      isMarkdown: true,
    });
  });

  it('returns null for arrays / null / numbers / objects without text fields', () => {
    expect(extractTextFromOutput(null)).toBeNull();
    expect(extractTextFromOutput([1, 2])).toBeNull();
    expect(extractTextFromOutput(42)).toBeNull();
    expect(extractTextFromOutput({ foo: 1 })).toBeNull();
  });

  it('skips empty string fields and tries the next priority key', () => {
    expect(extractTextFromOutput({ output: '', content: 'fallback' })).toEqual({
      text: 'fallback',
      isMarkdown: false,
    });
  });

  it('falls back to .result for lsp_rename-style envelopes', () => {
    expect(
      extractTextFromOutput({
        result: 'renamed 3 references',
        diagnostics: [],
      }),
    ).toEqual({ text: 'renamed 3 references', isMarkdown: false });
  });
});

describe('extractSearchHitsFromOutput', () => {
  it('parses workspace_search results into structured hits', () => {
    const data = extractSearchHitsFromOutput({
      path: '/repo',
      query: 'foo',
      results: [
        { path: 'a.ts', line: 12, text: 'const foo = 1' },
        { path: 'b.ts', line: 7, text: 'foo()' },
      ],
      scannedFiles: 2,
      skippedLargeFiles: 0,
    });
    expect(data?.hits).toHaveLength(2);
    expect(data?.hits[0]).toEqual({
      path: 'a.ts',
      line: 12,
      text: 'const foo = 1',
    });
    expect(data?.query).toBe('foo');
    expect(data?.scanned).toBe(2);
  });

  it('drops malformed result entries instead of crashing', () => {
    const data = extractSearchHitsFromOutput({
      results: [
        { path: 'ok.ts', line: 1, text: 'x' },
        null,
        { line: 99, text: 'no path' },
        'garbage',
      ],
    });
    expect(data?.hits).toHaveLength(1);
    expect(data?.hits[0]?.path).toBe('ok.ts');
  });

  it('returns null for outputs without a results array', () => {
    expect(extractSearchHitsFromOutput({ foo: 'bar' })).toBeNull();
    expect(extractSearchHitsFromOutput(null)).toBeNull();
  });
});

describe('extractTreeNodesFromOutput', () => {
  it('reads workspace_tree nodes + meta', () => {
    const data = extractTreeNodesFromOutput({
      path: '/repo',
      depth: 2,
      visitedEntries: 5,
      nodes: [
        {
          name: 'src',
          type: 'dir',
          children: [{ name: 'index.ts', type: 'file' }],
        },
      ],
    });
    expect(data?.path).toBe('/repo');
    expect(data?.visited).toBe(5);
    expect(data?.nodes).toHaveLength(1);
  });

  it('returns null when there is no nodes array', () => {
    expect(extractTreeNodesFromOutput({ path: '/x' })).toBeNull();
    expect(extractTreeNodesFromOutput(null)).toBeNull();
  });
});

describe('extractReviewChangesFromOutput', () => {
  it('extracts changes array', () => {
    const data = extractReviewChangesFromOutput({
      path: '/repo',
      changes: [
        { path: 'a.ts', status: 'modified', linesAdded: 3, linesDeleted: 1 },
        { path: 'b.ts', status: 'added', linesAdded: 50, linesDeleted: 0 },
      ],
    });
    expect(data?.changes).toHaveLength(2);
    expect(data?.changes[0]?.linesAdded).toBe(3);
  });

  it('returns null when changes is missing or non-array', () => {
    expect(extractReviewChangesFromOutput({ path: '/x' })).toBeNull();
    expect(extractReviewChangesFromOutput({ path: '/x', changes: 'oops' })).toBeNull();
  });
});

describe('extractDiagnosticsFromOutput', () => {
  it('returns diagnostics array', () => {
    const diags = extractDiagnosticsFromOutput({
      diagnostics: [{ filePath: 'a.ts', line: 1, severity: 'error', message: 'oops' }],
    });
    expect(diags).toHaveLength(1);
    expect(diags?.[0]?.severity).toBe('error');
  });

  it('returns null when no diagnostics field', () => {
    expect(extractDiagnosticsFromOutput({})).toBeNull();
    expect(extractDiagnosticsFromOutput({ diagnostics: 'no' })).toBeNull();
  });
});

describe('batchSubVisualState', () => {
  it('returns running when no result yet', () => {
    expect(batchSubVisualState(undefined)).toBe('running');
  });

  it('returns running when status === running', () => {
    expect(batchSubVisualState({ index: 0, tool: 'bash', status: 'running' })).toBe('running');
  });

  it('returns completed for plain success', () => {
    expect(batchSubVisualState({ index: 0, tool: 'bash', status: 'completed' })).toBe('completed');
  });

  it('returns failed when status === error', () => {
    expect(batchSubVisualState({ index: 0, tool: 'bash', status: 'error' })).toBe('failed');
  });

  it('returns failed when status completed but isError flag set', () => {
    expect(
      batchSubVisualState({
        index: 0,
        tool: 'bash',
        status: 'completed',
        isError: true,
      }),
    ).toBe('failed');
  });

  it('returns skipped distinctly from failed', () => {
    expect(batchSubVisualState({ index: 0, tool: 'edit', status: 'skipped' })).toBe('skipped');
  });
});

describe('batchSubInputSummary', () => {
  it('prefixes bash commands with $ and trims newlines', () => {
    expect(batchSubInputSummary('bash', { command: 'pnpm\n  test' })).toBe('$ pnpm test');
  });

  it('truncates long bash commands at 64 chars', () => {
    const long = 'x'.repeat(80);
    const out = batchSubInputSummary('bash', { command: long });
    expect(out.startsWith('$ ')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(70);
  });

  it('uses pattern for grep / workspace_search', () => {
    expect(batchSubInputSummary('workspace_search', { pattern: 'handler' })).toBe('handler');
    expect(batchSubInputSummary('grep', { query: 'todo' })).toBe('todo');
  });

  it('uses glob pattern for workspace_glob', () => {
    expect(batchSubInputSummary('workspace_glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('falls back to file path when present', () => {
    expect(batchSubInputSummary('edit', { filePath: 'src/foo.ts' })).toBe('src/foo.ts');
  });

  it('routes mcp_* tools through summarizeMcpCallInput', () => {
    const out = batchSubInputSummary('mcp_call', {
      serverId: 'gh',
      toolName: 'list_issues',
      arguments: { repo: 'owner/x' },
    });
    expect(out).toContain('gh.list_issues');
    // mcp summary intentionally renders `{argName}` as a compact placeholder.
    // What we want to ensure: no raw JSON value leaks through.
    expect(out).not.toContain('"');
    expect(out).not.toContain('owner/x');
  });

  it('falls back to generic summary and never leaks raw JSON values', () => {
    const out = batchSubInputSummary('unknown_tool', {
      foo: { a: 1, b: [2, 3] },
      bar: 'baz',
    });
    // generic summarizer wraps key lists in `{a, b}` — that's a placeholder,
    // not raw JSON. The contract is: no raw values + no JSON syntax tokens.
    expect(out).not.toContain('"');
    expect(out).not.toContain('[');
    expect(out).not.toContain(': 1');
  });

  it('returns empty string for empty input', () => {
    expect(batchSubInputSummary('unknown_tool', {})).toBe('');
  });
});

describe('buildPartialBashOutput', () => {
  it('synthesizes a BashExecutionResult-shaped object with mode="live"', () => {
    const out = buildPartialBashOutput({ command: 'pnpm test' }, 'PASS  src/foo.test.ts');
    expect(out).toEqual({
      command: 'pnpm test',
      output: 'PASS  src/foo.test.ts',
      mode: 'live',
      truncated: false,
    });
  });

  it('falls back to empty command when input.command is missing', () => {
    const out = buildPartialBashOutput({}, 'streaming...');
    expect(out.command).toBe('');
    expect(out.output).toBe('streaming...');
    expect(out.mode).toBe('live');
  });

  it('passes partial text through verbatim (no transformation)', () => {
    const ansi = '\x1b[32m✓\x1b[0m line one\nline two';
    const out = buildPartialBashOutput({ command: 'ls' }, ansi);
    expect(out.output).toBe(ansi);
  });

  it('omits exitCode so terminal card knows the run is incomplete', () => {
    const out = buildPartialBashOutput({ command: 'sleep 5' }, '');
    expect('exitCode' in out).toBe(false);
  });
});

describe('extractFileContentFromOutput', () => {
  it('recognises a workspace_read_file output envelope', () => {
    const out = extractFileContentFromOutput({
      path: 'src/foo.ts',
      content: 'line 1\nline 2',
      truncated: false,
      lineStart: 1,
      lineEnd: 2,
      totalLines: 2,
    });
    expect(out).toEqual({
      path: 'src/foo.ts',
      content: 'line 1\nline 2',
      truncated: false,
      lineStart: 1,
      lineEnd: 2,
      totalLines: 2,
      byteLimitReached: false,
    });
  });

  it('requires both path and content fields (rejects pure content envelopes)', () => {
    // Looks like webfetch / lsp_* — only `content`, no `path`. Must NOT
    // match so the textPayload path keeps owning these envelopes.
    expect(extractFileContentFromOutput({ content: '<html>...</html>' })).toBeNull();
    expect(extractFileContentFromOutput({ path: 'src/foo.ts' })).toBeNull();
  });

  it('rejects strings, arrays, null, undefined', () => {
    expect(extractFileContentFromOutput('plain text')).toBeNull();
    expect(extractFileContentFromOutput(null)).toBeNull();
    expect(extractFileContentFromOutput(undefined)).toBeNull();
    expect(extractFileContentFromOutput([])).toBeNull();
  });

  it('flags truncated and byteLimitReached when present', () => {
    const out = extractFileContentFromOutput({
      path: 'big.log',
      content: 'tail',
      truncated: true,
      byteLimitReached: true,
    });
    expect(out?.truncated).toBe(true);
    expect(out?.byteLimitReached).toBe(true);
  });
});

describe('extractGrepContentHitsFromOutput', () => {
  it('parses standard grep --content rows', () => {
    const out = extractGrepContentHitsFromOutput(
      "src/a.ts:12: console.log('a')\nsrc/b.ts:5: const x = 1",
    );
    expect(out).toEqual([
      { path: 'src/a.ts', line: 12, text: "console.log('a')" },
      { path: 'src/b.ts', line: 5, text: 'const x = 1' },
    ]);
  });

  it('returns null when any line fails the pattern (mixed mode bail-out)', () => {
    // First line is a count row, not content. Bail so the call site can
    // try extractGrepCountsFromOutput next.
    expect(extractGrepContentHitsFromOutput('src/a.ts: 5\nsrc/b.ts:1: foo')).toBeNull();
  });

  it('returns null for the no-results sentinel', () => {
    expect(extractGrepContentHitsFromOutput('No files found')).toBeNull();
  });

  it('returns null for non-strings', () => {
    expect(extractGrepContentHitsFromOutput({})).toBeNull();
    expect(extractGrepContentHitsFromOutput(null)).toBeNull();
  });

  it('preserves the colon character inside the matched text segment', () => {
    const out = extractGrepContentHitsFromOutput('src/a.ts:12: const obj = { a: 1, b: 2 }');
    expect(out).toEqual([{ path: 'src/a.ts', line: 12, text: 'const obj = { a: 1, b: 2 }' }]);
  });
});

describe('extractGrepCountsFromOutput', () => {
  it('parses standard grep --count rows', () => {
    const out = extractGrepCountsFromOutput('src/a.ts: 5\nsrc/b.ts: 12');
    expect(out).toEqual([
      { path: 'src/a.ts', count: 5 },
      { path: 'src/b.ts', count: 12 },
    ]);
  });

  it('returns null when any line fails (e.g. mixed with content rows)', () => {
    expect(extractGrepCountsFromOutput('src/a.ts: 5\nsrc/b.ts:1: foo')).toBeNull();
  });

  it('returns null for the no-results sentinel', () => {
    expect(extractGrepCountsFromOutput('No files found')).toBeNull();
  });
});

describe('extractFilePathListFromOutput', () => {
  it('returns paths when every line is a bare path', () => {
    expect(extractFilePathListFromOutput('src/a.ts\nsrc/b.ts\npackages/shared/index.ts')).toEqual([
      'src/a.ts',
      'src/b.ts',
      'packages/shared/index.ts',
    ]);
  });

  it('rejects when any line looks like a content row', () => {
    // `path:line: text` smells like a content row; must NOT be treated as
    // a path list (otherwise the user sees `src/a.ts:12: console.log` as
    // a single path which is wrong).
    expect(extractFilePathListFromOutput('src/a.ts:12: console.log\nsrc/b.ts')).toBeNull();
  });

  it('rejects when any line looks like a count row', () => {
    expect(extractFilePathListFromOutput('src/a.ts: 5\nsrc/b.ts')).toBeNull();
  });

  it('returns null for the no-results sentinels', () => {
    expect(extractFilePathListFromOutput('No files found')).toBeNull();
    expect(extractFilePathListFromOutput('No files matching pattern')).toBeNull();
  });

  it('returns null for empty / whitespace-only inputs', () => {
    expect(extractFilePathListFromOutput('')).toBeNull();
    expect(extractFilePathListFromOutput('   \n\n  ')).toBeNull();
  });

  it('trims whitespace and skips empty lines', () => {
    expect(extractFilePathListFromOutput('  src/a.ts  \n\n  src/b.ts\n\n  src/c.ts  ')).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });
});

/**
 * LSP tools render as a non-expandable single-line pill: `<position> · <status>`.
 * These tests pin the contract for all 10 lsp_* tools across running /
 * completed / failed states. Critical: the summary string must NEVER
 * contain raw JSON brackets (the same bug class we guarded against for
 * batch / todowrite above).
 */
describe('lspInputDescription', () => {
  it('formats file:line:char for position-based tools', () => {
    expect(
      lspInputDescription('lsp_goto_definition', {
        filePath: 'src/foo.ts',
        line: 42,
        character: 8,
      }),
    ).toBe('src/foo.ts:42:8');
  });

  it('falls back to filePath only for lsp_diagnostics', () => {
    expect(lspInputDescription('lsp_diagnostics', { filePath: 'src/foo.ts' })).toBe('src/foo.ts');
  });

  it('supports the `path` field used by lsp_touch', () => {
    expect(lspInputDescription('lsp_touch', { path: 'src/foo.ts' })).toBe('src/foo.ts');
  });

  it('appends → "newName" for lsp_rename', () => {
    expect(
      lspInputDescription('lsp_rename', {
        filePath: 'src/foo.ts',
        line: 10,
        character: 4,
        newName: 'renamed',
      }),
    ).toBe('src/foo.ts:10:4 → "renamed"');
  });

  it('appends (scope) and (scope, query) for lsp_symbols', () => {
    expect(
      lspInputDescription('lsp_symbols', {
        filePath: 'src/foo.ts',
        scope: 'document',
      }),
    ).toBe('src/foo.ts (document)');
    expect(
      lspInputDescription('lsp_symbols', {
        filePath: 'src/foo.ts',
        scope: 'workspace',
        query: 'User',
      }),
    ).toBe('src/foo.ts (workspace, "User")');
  });

  it('appends (direction) for lsp_call_hierarchy', () => {
    expect(
      lspInputDescription('lsp_call_hierarchy', {
        filePath: 'src/foo.ts',
        line: 5,
        character: 0,
        direction: 'incoming',
      }),
    ).toBe('src/foo.ts:5:0 (incoming)');
  });

  it('appends (no-decl) for lsp_find_references with includeDeclaration=false', () => {
    expect(
      lspInputDescription('lsp_find_references', {
        filePath: 'src/foo.ts',
        line: 5,
        character: 0,
        includeDeclaration: false,
      }),
    ).toBe('src/foo.ts:5:0 (no-decl)');
  });

  it('returns empty string when no recognised input is present yet', () => {
    expect(lspInputDescription('lsp_hover', {})).toBe('');
  });
});

describe('lspSuccessSummary', () => {
  it('counts diagnostics across files', () => {
    expect(
      lspSuccessSummary('lsp_diagnostics', {
        'src/a.ts': [{}, {}],
        'src/b.ts': [{}],
      }),
    ).toBe('2 个文件 · 3 个问题');
  });

  it('says "无诊断" when diagnostics map is empty / all empty arrays', () => {
    expect(lspSuccessSummary('lsp_diagnostics', {})).toBe('无诊断');
    expect(lspSuccessSummary('lsp_diagnostics', { 'src/a.ts': [], 'src/b.ts': [] })).toBe('无诊断');
  });

  it('returns ok when lsp_touch resolves with {ok:true}', () => {
    expect(lspSuccessSummary('lsp_touch', { ok: true })).toBe('ok');
  });

  it('counts references for lsp_find_references', () => {
    expect(lspSuccessSummary('lsp_find_references', [{}, {}, {}])).toBe('3 个引用');
    expect(lspSuccessSummary('lsp_find_references', { references: [{}, {}] })).toBe('2 个引用');
  });

  it('counts symbols for lsp_symbols', () => {
    expect(lspSuccessSummary('lsp_symbols', [{ name: 'a' }, { name: 'b' }])).toBe('2 个符号');
  });

  it('formats "未找到" / first match for lsp_goto_definition', () => {
    expect(lspSuccessSummary('lsp_goto_definition', [])).toBe('未找到');
    expect(
      lspSuccessSummary('lsp_goto_definition', [{ filePath: 'src/x.ts', line: 9, character: 2 }]),
    ).toBe('src/x.ts:9');
    expect(
      lspSuccessSummary('lsp_goto_definition', [
        { filePath: 'src/x.ts', line: 9, character: 2 },
        { filePath: 'src/y.ts', line: 12, character: 0 },
      ]),
    ).toBe('src/x.ts:9 (+1)');
  });

  it('returns hover text snippet for lsp_hover', () => {
    expect(lspSuccessSummary('lsp_hover', { output: '(typeof) Promise<string>' })).toBe(
      '"(typeof) Promise<string>"',
    );
  });

  it('counts edits across files for lsp_rename', () => {
    expect(
      lspSuccessSummary('lsp_rename', {
        changes: { 'src/a.ts': [{}, {}], 'src/b.ts': [{}] },
      }),
    ).toBe('2 个文件 · 3 个修改');
  });

  it('formats lsp_prepare_rename valid/invalid', () => {
    expect(lspSuccessSummary('lsp_prepare_rename', { valid: true })).toBe('可重命名');
    expect(lspSuccessSummary('lsp_prepare_rename', { valid: false })).toBe('不可重命名');
    expect(lspSuccessSummary('lsp_prepare_rename', null)).toBe('不可重命名');
  });

  it('formats incoming/outgoing counts for lsp_call_hierarchy', () => {
    expect(
      lspSuccessSummary('lsp_call_hierarchy', {
        incoming: [{}, {}],
        outgoing: [{}],
      }),
    ).toBe('↑2 ↓1');
  });

  it('falls back to text envelope snippet when schema is unknown', () => {
    expect(lspSuccessSummary('lsp_hover', { output: 'Hello world  \n  more text' })).toBe(
      '"Hello world more text"',
    );
  });
});

describe('lspErrorSnippet', () => {
  it('extracts a string from common envelope keys', () => {
    expect(lspErrorSnippet({ error: 'connection refused' })).toBe('connection refused');
    expect(lspErrorSnippet({ message: 'timeout' })).toBe('timeout');
  });

  it('returns the string itself when output is a string', () => {
    expect(lspErrorSnippet('server crashed')).toBe('server crashed');
  });

  it('truncates long messages', () => {
    const long = 'x'.repeat(120);
    const out = lspErrorSnippet({ error: long });
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty string for unknown shapes', () => {
    expect(lspErrorSnippet(null)).toBe('');
    expect(lspErrorSnippet([1, 2])).toBe('');
    expect(lspErrorSnippet({})).toBe('');
  });
});

describe('buildLspInlineSummary', () => {
  it('renders "<lhs> · <success>" on completed', () => {
    expect(
      buildLspInlineSummary({
        toolName: 'lsp_find_references',
        input: { filePath: 'src/foo.ts', line: 5, character: 0 },
        output: [{}, {}, {}],
        visualState: 'completed',
      }),
    ).toBe('src/foo.ts:5:0 · 3 个引用');
  });

  it('renders "<lhs> · ✗ <error>" on failed', () => {
    expect(
      buildLspInlineSummary({
        toolName: 'lsp_hover',
        input: { filePath: 'src/foo.ts', line: 1, character: 0 },
        output: { error: 'no language server' },
        visualState: 'failed',
      }),
    ).toBe('src/foo.ts:1:0 · ✗ no language server');
  });

  it('renders "<lhs> · ✗ 失败" when no error message is present', () => {
    expect(
      buildLspInlineSummary({
        toolName: 'lsp_touch',
        input: { path: 'src/foo.ts' },
        output: undefined,
        visualState: 'running',
        isError: true,
      }),
    ).toBe('src/foo.ts · ✗ 失败');
  });

  it('renders just <lhs> while running (ToolIcon already conveys progress)', () => {
    expect(
      buildLspInlineSummary({
        toolName: 'lsp_diagnostics',
        input: { filePath: 'src/foo.ts' },
        output: undefined,
        visualState: 'running',
      }),
    ).toBe('src/foo.ts');
  });

  it('falls back to "✓ 完成" when completed but output schema is unknown', () => {
    expect(
      buildLspInlineSummary({
        toolName: 'lsp_diagnostics',
        input: { filePath: 'src/foo.ts' },
        output: 42,
        visualState: 'completed',
      }),
    ).toBe('src/foo.ts · ✓ 完成');
  });

  it('never returns a string with raw JSON brackets', () => {
    const summary = buildLspInlineSummary({
      toolName: 'lsp_symbols',
      input: { filePath: 'src/foo.ts', scope: 'workspace', query: 'User' },
      output: { symbols: [{ name: 'UserService' }] },
      visualState: 'completed',
    });
    expect(summary).not.toMatch(/[{}[\]]/);
    expect(summary).toBe('src/foo.ts (workspace, "User") · 1 个符号');
  });
});

/**
 * `question` / `AskUserQuestion` summary: must surface the first question's
 * header (preferred) or text instead of dumping the raw `questions` array as
 * "questions×N". Critical regression case: AGUI / question tool calls whose
 * input is the entire prompt list.
 */
describe('summarizeQuestionInput', () => {
  it("returns the first question's header when present", () => {
    expect(
      summarizeQuestionInput({
        questions: [
          {
            header: 'Confirm deployment',
            question: 'Deploy to prod?',
            options: [{ label: 'Yes', description: 'go' }],
          },
        ],
      }),
    ).toBe('Confirm deployment · "Deploy to prod?"');
  });

  it('returns just the header when header equals question', () => {
    expect(
      summarizeQuestionInput({
        questions: [
          {
            header: 'Deploy to prod?',
            question: 'Deploy to prod?',
            options: [{ label: 'Yes', description: 'go' }],
          },
        ],
      }),
    ).toBe('Deploy to prod?');
  });

  it('appends (+N) when there are multiple questions', () => {
    expect(
      summarizeQuestionInput({
        questions: [
          { header: 'Q1', question: 'First?', options: [] },
          { header: 'Q2', question: 'Second?', options: [] },
          { header: 'Q3', question: 'Third?', options: [] },
        ],
      }),
    ).toBe('Q1 · "First?" (+2)');
  });

  it('falls back to question text when header is missing', () => {
    expect(
      summarizeQuestionInput({
        questions: [{ question: 'Should I continue?', options: [] }],
      }),
    ).toBe('"Should I continue?"');
  });

  it('returns undefined for non-question shapes', () => {
    expect(summarizeQuestionInput({})).toBeUndefined();
    expect(summarizeQuestionInput({ questions: [] })).toBeUndefined();
    expect(summarizeQuestionInput({ questions: 'not an array' })).toBeUndefined();
    expect(summarizeQuestionInput({ questions: [{ options: [] }] })).toBeUndefined();
  });

  it('never returns a string with raw JSON brackets', () => {
    const out = summarizeQuestionInput({
      questions: [
        {
          header: 'Pick a route',
          question: 'Which?',
          options: [{ label: 'A' }],
        },
      ],
    });
    expect(out).not.toMatch(/[{}[\]]/);
  });
});

/**
 * `ExitPlanMode` summary: surface the plan markdown's first 60 chars so the
 * user can decide whether to drill in. Returns undefined when no plan is
 * provided so the caller can render a neutral "退出计划模式" label.
 */
describe('summarizeExitPlanModeInput', () => {
  it('clamps the plan markdown to a quoted preview', () => {
    expect(
      summarizeExitPlanModeInput({
        plan: '1. Refactor parser\n2. Add tests\n3. Run lint',
      }),
    ).toBe('"1. Refactor parser 2. Add tests 3. Run lint"');
  });

  it('truncates plans longer than 60 chars with an ellipsis', () => {
    const long = `Step ${'x'.repeat(80)}`;
    const out = summarizeExitPlanModeInput({ plan: long });
    expect(out).toBeDefined();
    // 60 chars + 2 quotes = 62 max
    expect((out ?? '').length).toBeLessThanOrEqual(62);
    expect(out).toMatch(/…"$/);
  });

  it('returns undefined when no plan is provided', () => {
    expect(summarizeExitPlanModeInput({})).toBeUndefined();
    expect(summarizeExitPlanModeInput({ plan: '' })).toBeUndefined();
    expect(summarizeExitPlanModeInput({ plan: '   ' })).toBeUndefined();
  });

  it('returns undefined when plan is not a string', () => {
    expect(summarizeExitPlanModeInput({ plan: 42 })).toBeUndefined();
    expect(summarizeExitPlanModeInput({ plan: null })).toBeUndefined();
  });
});

/**
 * `background_cancel` / `background_output` accept three id aliases
 * (`taskId`, `task_id`, `runId`) plus a special `all:true` flag for cancel.
 * The pill must show what the agent is doing without dumping raw JSON.
 */
describe('summarizeBackgroundCancelInput', () => {
  it('returns 取消所有后台任务 when all:true', () => {
    expect(summarizeBackgroundCancelInput({ all: true })).toBe('取消所有后台任务');
  });

  it('prefers taskId when present', () => {
    expect(summarizeBackgroundCancelInput({ taskId: 't-abc' })).toBe('取消 t-abc');
  });

  it('falls back to task_id then runId', () => {
    expect(summarizeBackgroundCancelInput({ task_id: 't-xyz' })).toBe('取消 t-xyz');
    expect(summarizeBackgroundCancelInput({ runId: 'r-1' })).toBe('取消 r-1');
  });

  it('trims whitespace around the id', () => {
    expect(summarizeBackgroundCancelInput({ taskId: '  t-pad  ' })).toBe('取消 t-pad');
  });

  it('returns undefined when no id and not all=true', () => {
    expect(summarizeBackgroundCancelInput({})).toBeUndefined();
    expect(summarizeBackgroundCancelInput({ all: false })).toBeUndefined();
    expect(summarizeBackgroundCancelInput({ taskId: '' })).toBeUndefined();
    expect(summarizeBackgroundCancelInput({ taskId: '   ' })).toBeUndefined();
  });
});

describe('summarizeBackgroundOutputInput', () => {
  it('returns the trimmed task id when present', () => {
    expect(summarizeBackgroundOutputInput({ task_id: 't-1' })).toBe('t-1');
    expect(summarizeBackgroundOutputInput({ taskId: 't-2' })).toBe('t-2');
    expect(summarizeBackgroundOutputInput({ runId: '  r-3 ' })).toBe('r-3');
  });

  it('returns undefined for missing/empty id', () => {
    expect(summarizeBackgroundOutputInput({})).toBeUndefined();
    expect(summarizeBackgroundOutputInput({ taskId: '' })).toBeUndefined();
  });

  it('returns undefined when id is not a string', () => {
    expect(summarizeBackgroundOutputInput({ taskId: 42 })).toBeUndefined();
  });
});

/**
 * `session_info` schema requires `session_id`. The pill must surface it
 * (which is the only useful field) or a neutral fallback.
 */
describe('summarizeSessionInfoInput', () => {
  it('returns the trimmed session id', () => {
    expect(summarizeSessionInfoInput({ session_id: 'sess-abc' })).toBe('sess-abc');
    expect(summarizeSessionInfoInput({ session_id: '  sess-pad  ' })).toBe('sess-pad');
  });

  it('returns undefined for missing/empty/non-string id', () => {
    expect(summarizeSessionInfoInput({})).toBeUndefined();
    expect(summarizeSessionInfoInput({ session_id: '' })).toBeUndefined();
    expect(summarizeSessionInfoInput({ session_id: 42 })).toBeUndefined();
  });
});

/**
 * `skill_mcp` schema requires `mcp_name` and exactly one of
 * `{tool_name, resource_name, prompt_name}`. We render `<mcp>.<child>`
 * with `?` placeholders — never raw JSON.
 */
describe('summarizeSkillMcpInput', () => {
  it('formats <mcp>.<tool> when tool_name is present', () => {
    expect(summarizeSkillMcpInput({ mcp_name: 'skill-foo', tool_name: 'search' })).toBe(
      'skill-foo.search',
    );
  });

  it('formats <mcp>.<resource> when resource_name is present', () => {
    expect(
      summarizeSkillMcpInput({
        mcp_name: 'skill-foo',
        resource_name: 'wiki/article',
      }),
    ).toBe('skill-foo.wiki/article');
  });

  it('formats <mcp>.<prompt> when prompt_name is present', () => {
    expect(
      summarizeSkillMcpInput({
        mcp_name: 'skill-foo',
        prompt_name: 'summarize',
      }),
    ).toBe('skill-foo.summarize');
  });

  it('prefers tool_name over resource/prompt when multiple are set', () => {
    expect(
      summarizeSkillMcpInput({
        mcp_name: 'skill-foo',
        tool_name: 'win',
        resource_name: 'lose',
        prompt_name: 'lose',
      }),
    ).toBe('skill-foo.win');
  });

  it('falls back to ? placeholders for missing fields', () => {
    expect(summarizeSkillMcpInput({})).toBe('?.?');
    expect(summarizeSkillMcpInput({ mcp_name: 'skill-foo' })).toBe('skill-foo.?');
    expect(summarizeSkillMcpInput({ tool_name: 'search' })).toBe('?.search');
  });

  it('never returns a string with raw JSON brackets', () => {
    const out = summarizeSkillMcpInput({
      mcp_name: 'skill-foo',
      tool_name: 'search',
      arguments: { q: 'complex', nested: { key: 'value' } },
    });
    expect(out).not.toMatch(/[{}[\]]/);
  });
});

/**
 * Colorize-summary regression suite. The tokenizer drives the
 * `<span class="tc-tok-*">` wrappers in `BlockToolCall` /
 * `InlineToolCall`. We pin the grammar here so future helpers don't
 * accidentally produce strings the parser drops on the floor.
 */
describe('tokenizeSummary', () => {
  it('returns an empty list for empty input', () => {
    expect(tokenizeSummary('')).toEqual([]);
  });

  it('emits the entire string as a single plain token when nothing matches', () => {
    expect(tokenizeSummary('hello world')).toEqual([{ kind: 'plain', text: 'hello world' }]);
  });

  it('classifies a leading `$ ` as a keyword + cmd pair', () => {
    const tokens = tokenizeSummary('$ git status -sb');
    expect(tokens).toEqual([
      { kind: 'keyword', text: '$' },
      { kind: 'plain', text: ' ' },
      { kind: 'cmd', text: 'git status -sb' },
    ]);
  });

  it('preserves the keyword/plain prefix when only `$` is present', () => {
    const tokens = tokenizeSummary('$ ');
    expect(tokens).toEqual([
      { kind: 'keyword', text: '$' },
      { kind: 'plain', text: ' ' },
    ]);
  });

  it('matches absolute paths and tags them with the file extension', () => {
    const tokens = tokenizeSummary('/repo/src/foo.ts');
    expect(tokens).toEqual([{ kind: 'path', text: '/repo/src/foo.ts', ext: 'ts' }]);
  });

  it('matches truncated paths starting with U+2026', () => {
    const tokens = tokenizeSummary('…/src/foo.tsx');
    expect(tokens).toEqual([{ kind: 'path', text: '…/src/foo.tsx', ext: 'tsx' }]);
  });

  it('matches a bare filename via the dotted-extension fallback', () => {
    const tokens = tokenizeSummary('readme.md');
    expect(tokens).toEqual([{ kind: 'path', text: 'readme.md', ext: 'md' }]);
  });

  it('classifies semver-ish versions as a single num token', () => {
    // `v1.0.0` reads as an identifier, not a malformed path. The
    // `version` regex sits before `path` in the alternation so it
    // always wins for digit-dot-digit shapes.
    expect(tokenizeSummary('v1.0.0')).toEqual([{ kind: 'num', text: 'v1.0.0' }]);
    expect(tokenizeSummary('1.2')).toEqual([{ kind: 'num', text: '1.2' }]);
    expect(tokenizeSummary('released 2026.4.29')).toContainEqual({
      kind: 'num',
      text: '2026.4.29',
    });
  });

  it('does NOT misclassify English abbreviations as paths', () => {
    // Pre-fix this would fire the dotted-filename branch on `e.g`,
    // `i.e`, `a.m` and emit a 1-letter "extension". The grammar
    // now requires ≥2 letters on each side of the dot.
    for (const word of ['e.g', 'i.e', 'a.m', 'p.m']) {
      const tokens = tokenizeSummary(`see ${word} for details`);
      expect(tokens.find((t) => t.kind === 'path')).toBeUndefined();
    }
  });

  it('recognises HTTP and HTTPS URLs as a single token', () => {
    const tokens = tokenizeSummary('Fetch https://example.com/foo?a=1');
    expect(tokens).toEqual([
      { kind: 'plain', text: 'Fetch ' },
      { kind: 'url', text: 'https://example.com/foo?a=1' },
    ]);
  });

  it('matches double-quoted strings as one string token', () => {
    const tokens = tokenizeSummary('grep · "needle"');
    expect(tokens).toContainEqual({ kind: 'string', text: '"needle"' });
  });

  it('matches single-quoted strings as one string token', () => {
    const tokens = tokenizeSummary("plan: 'do thing'");
    expect(tokens).toContainEqual({ kind: 'string', text: "'do thing'" });
  });

  it('renders → and · as keyword tokens', () => {
    const tokens = tokenizeSummary('a → b · c');
    const keywords = tokens.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['→', '·']);
  });

  it('renders [ts]-style language brackets as keyword tokens', () => {
    const tokens = tokenizeSummary('[ts] grep');
    expect(tokens[0]).toEqual({ kind: 'keyword', text: '[ts]' });
  });

  it('classifies short prefix-ids like `t-abc` as num', () => {
    const tokens = tokenizeSummary('task_update t-abc → done');
    expect(tokens).toContainEqual({ kind: 'num', text: 't-abc' });
    expect(tokens).toContainEqual({ kind: 'keyword', text: '→' });
  });

  it('classifies long hex ids as num', () => {
    const tokens = tokenizeSummary('commit a1b2c3d4e5f6');
    expect(tokens).toContainEqual({ kind: 'num', text: 'a1b2c3d4e5f6' });
  });

  it('classifies bare integers as num', () => {
    const tokens = tokenizeSummary('12 行');
    expect(tokens).toContainEqual({ kind: 'num', text: '12' });
  });

  it('round-trips the original text when concatenating tokens', () => {
    const inputs = [
      'grep src/foo.ts · "pattern"',
      'task_update t-abc → done',
      '$ pnpm test',
      'Fetch https://example.com',
      'ast-grep [ts] "needle" → "replacement"',
      'workspace_review_diff /repo/foo.go',
    ];
    for (const text of inputs) {
      expect(
        tokenizeSummary(text)
          .map((t) => t.text)
          .join(''),
      ).toBe(text);
    }
  });
});

describe('extractFilenameExtension', () => {
  it('returns the lowercase extension for typical paths', () => {
    expect(extractFilenameExtension('/a/b/foo.TS')).toBe('ts');
    expect(extractFilenameExtension('foo.tsx')).toBe('tsx');
    expect(extractFilenameExtension('a/b/c.py')).toBe('py');
  });

  it('returns undefined for files without an extension', () => {
    expect(extractFilenameExtension('Makefile')).toBeUndefined();
    expect(extractFilenameExtension('/etc/hosts')).toBeUndefined();
  });

  it('returns undefined when the dot is leading or trailing', () => {
    expect(extractFilenameExtension('.env')).toBeUndefined();
    expect(extractFilenameExtension('foo.')).toBeUndefined();
  });

  it('rejects extensions longer than 5 chars or containing digits', () => {
    expect(extractFilenameExtension('backup.tarball')).toBeUndefined();
    expect(extractFilenameExtension('v1.2.3')).toBeUndefined();
  });
});

describe('getToolCategory', () => {
  it('classifies read-family tools as `read`', () => {
    for (const t of ['read', 'grep', 'glob', 'list', 'codesearch', 'ast_grep_search']) {
      expect(getToolCategory(t)).toBe('read');
    }
  });

  it('classifies file-mutating tools as `edit`', () => {
    for (const t of [
      'write',
      'edit',
      'multi_edit',
      'apply_patch',
      'ast_grep_replace',
      'workspace_create_directory',
    ]) {
      expect(getToolCategory(t)).toBe('edit');
    }
  });

  it('classifies shell / OS tools as `shell`', () => {
    for (const t of [
      'bash',
      'interactive_bash',
      'background_output',
      'background_cancel',
      'desktop_automation',
      'look_at',
    ]) {
      expect(getToolCategory(t)).toBe('shell');
    }
  });

  it('classifies all lsp_* + skill + planning tools as `think`', () => {
    for (const t of [
      'lsp_diagnostics',
      'lsp_goto_definition',
      'skill',
      'skill_mcp',
      'question',
      'AskUserQuestion',
      'EnterPlanMode',
      'ExitPlanMode',
    ]) {
      expect(getToolCategory(t)).toBe('think');
    }
  });

  it('classifies network tools as `net`', () => {
    for (const t of ['webfetch', 'websearch', 'google_search']) {
      expect(getToolCategory(t)).toBe('net');
    }
  });

  it('classifies persistent-state tools as `state`', () => {
    for (const t of [
      'todowrite',
      'todoread',
      'subtodowrite',
      'subtodoread',
      'task_create',
      'task_get',
      'session_list',
      'session_read',
      'mcp_call',
      'batch',
    ]) {
      expect(getToolCategory(t)).toBe('state');
    }
  });

  it('returns undefined for unknown tools so callers fall back to default', () => {
    expect(getToolCategory('totally_made_up')).toBeUndefined();
    expect(getToolCategory('')).toBeUndefined();
  });

  it('is case-insensitive on the input tool name', () => {
    expect(getToolCategory('READ')).toBe('read');
    expect(getToolCategory('AskUserQuestion')).toBe('think');
  });
});

/**
 * `groupConsecutiveTools` collapses runs of read/grep/glob into a
 * single grouped pill in the chat. Pinning the rules here protects
 * downstream chat rendering from regressions where a status flip or
 * approval-pending flag accidentally widens / narrows the run.
 */
describe('groupConsecutiveTools', () => {
  function call(
    toolName: string,
    extras: Partial<AssistantTraceToolCall> = {},
  ): AssistantTraceToolCall {
    return {
      toolName,
      input: {},
      ...extras,
    };
  }

  it('returns each call as a single entry when no run is groupable', () => {
    const result = groupConsecutiveTools([call('write'), call('bash'), call('read')]);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.kind === 'single')).toBe(true);
  });

  it('collapses ≥2 consecutive same-name groupable calls into a group', () => {
    const calls = [call('read'), call('read'), call('read')];
    const result = groupConsecutiveTools(calls);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
    if (result[0]?.kind === 'group') {
      expect(result[0].calls).toHaveLength(3);
      expect(result[0].toolName).toBe('read');
      expect(result[0].startIndex).toBe(0);
    }
  });

  it('does not collapse a single call (run length 1)', () => {
    const result = groupConsecutiveTools([call('read')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('single');
  });

  it('breaks runs across different tool names even if both are groupable', () => {
    const result = groupConsecutiveTools([call('read'), call('read'), call('grep'), call('grep')]);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('group');
    expect(result[1]?.kind).toBe('group');
    if (result[0]?.kind === 'group') expect(result[0].toolName).toBe('read');
    if (result[1]?.kind === 'group') expect(result[1].toolName).toBe('grep');
  });

  it('breaks runs around an in-flight (running) call', () => {
    const result = groupConsecutiveTools([
      call('read'),
      call('read', { status: 'running' }),
      call('read'),
    ]);
    // The running call surfaces individually so the user can see its
    // active state. The neighbours are run length 1 each, so they
    // also stay individual.
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.kind === 'single')).toBe(true);
  });

  it('breaks runs around a paused call', () => {
    const result = groupConsecutiveTools([
      call('read'),
      call('read'),
      call('read', { status: 'paused' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('group');
    expect(result[1]?.kind).toBe('single');
  });

  it('breaks runs around an approval-pending call', () => {
    const result = groupConsecutiveTools([
      call('read'),
      call('read'),
      call('read', { pendingPermissionRequestId: 'req-1' }),
      call('read'),
    ]);
    expect(result.map((e) => e.kind)).toEqual(['group', 'single', 'single']);
  });

  it('groups failed calls together with completed ones (status: failed is finalized)', () => {
    const result = groupConsecutiveTools([
      call('read', { status: 'completed' }),
      call('read', { status: 'failed', isError: true }),
      call('read', { status: 'completed' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
  });

  it('treats undefined status as completed (eligible for grouping)', () => {
    const result = groupConsecutiveTools([call('read'), call('read')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
  });

  it('preserves startIndex pointing at the original array position', () => {
    const result = groupConsecutiveTools([call('write'), call('read'), call('read')]);
    expect(result).toHaveLength(2);
    if (result[1]?.kind === 'group') {
      expect(result[1].startIndex).toBe(1);
    }
  });

  it('is case-insensitive on the tool name (READ === read)', () => {
    const result = groupConsecutiveTools([call('READ'), call('read'), call('Read')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
  });

  it('groups consecutive bash commands (extended set)', () => {
    const result = groupConsecutiveTools([call('bash'), call('bash'), call('bash'), call('bash')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
    if (result[0]?.kind === 'group') {
      expect(result[0].calls).toHaveLength(4);
    }
  });

  it('groups consecutive edit calls (extended set)', () => {
    const result = groupConsecutiveTools([call('edit'), call('edit'), call('edit')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
  });

  it('groups consecutive write calls (extended set)', () => {
    const result = groupConsecutiveTools([call('write'), call('write')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('group');
  });

  it('does not cross tool boundaries (edit then write stay separate)', () => {
    // Mixed edit / write must not collapse into a single group, even
    // though both are individually groupable: tool-name parity is
    // the boundary so the pill icon and category color stay accurate.
    const result = groupConsecutiveTools([call('edit'), call('write'), call('edit')]);
    expect(result).toHaveLength(3);
    for (const r of result) expect(r.kind).toBe('single');
  });

  it('does not group truly ungroupable tools (skill, todowrite)', () => {
    const result = groupConsecutiveTools([call('skill'), call('skill'), call('todowrite')]);
    expect(result.every((r) => r.kind === 'single')).toBe(false);
  });

  it('returns an empty array on empty input', () => {
    expect(groupConsecutiveTools([])).toEqual([]);
  });
});

/**
 * `formatGroupItem` shapes a per-call label inside a grouped pill.
 * Each tool family has a different "primary" input shape so the
 * helper picks the right field and bounds the visible width.
 */
describe('formatGroupItem', () => {
  it('renders read calls as a trimmed path', () => {
    expect(formatGroupItem('read', { filePath: 'apps/web/src/foo.ts' })).toBe(
      'apps/web/src/foo.ts',
    );
  });

  it('renders grep with both path and pattern joined by ·', () => {
    // trimPath strips empty segments, so a trailing slash is dropped.
    expect(formatGroupItem('grep', { path: 'src/', pattern: 'useState' })).toBe('src · "useState"');
  });

  it('renders grep with only pattern when path is absent', () => {
    expect(formatGroupItem('grep', { pattern: 'TODO' })).toBe('"TODO"');
  });

  it('renders bash as a trimmed command (whitespace collapsed)', () => {
    expect(
      formatGroupItem('bash', {
        command: '  ls   -la   /tmp  ',
      }),
    ).toBe('ls -la /tmp');
  });

  it('ellipses long bash commands at 32 chars', () => {
    const long = `echo ${'x'.repeat(60)}`;
    const out = formatGroupItem('bash', { command: long });
    expect(out.length).toBeLessThanOrEqual(32);
    expect(out.endsWith('…')).toBe(true);
  });

  it('renders edit as a trimmed file path (>4 segments → ellipsis)', () => {
    // 5 segments collapse to the last three with a leading ellipsis.
    expect(formatGroupItem('edit', { filePath: 'apps/web/src/components/x.tsx' })).toBe(
      '…/src/components/x.tsx',
    );
  });

  it('renders write as a trimmed file path (leading slash stripped)', () => {
    expect(formatGroupItem('write', { file_path: '/tmp/foo.txt' })).toBe('tmp/foo.txt');
  });

  it('renders multiedit as a trimmed file path (uses filePath alias)', () => {
    expect(
      formatGroupItem('multiedit', {
        filePath: 'src/lib/util.ts',
      }),
    ).toBe('src/lib/util.ts');
  });

  it('returns empty string when bash command is missing', () => {
    expect(formatGroupItem('bash', {})).toBe('');
  });

  it('returns empty string when path-shaped tool has no path', () => {
    expect(formatGroupItem('read', {})).toBe('');
    expect(formatGroupItem('edit', {})).toBe('');
  });
});

/**
 * Path tokenizer used by the chat-markdown renderer to wrap file
 * path references in clickable elements. Tests pin both the positive
 * cases (real paths get detected) and the false-positive guards
 * (identifiers, version numbers, plain words don't).
 */
describe('tokenizePathsInText', () => {
  function paths(text: string): string[] {
    return tokenizePathsInText(text)
      .filter((t) => t.type === 'path')
      .map((t) => (t.type === 'path' ? t.path : ''));
  }

  it('detects a basic relative path with extension', () => {
    const result = tokenizePathsInText('see apps/web/src/foo.ts now');
    expect(paths('see apps/web/src/foo.ts now')).toEqual(['apps/web/src/foo.ts']);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'text', value: 'see ' });
    expect(result[1]?.type).toBe('path');
    expect(result[2]).toEqual({ type: 'text', value: ' now' });
  });

  it('captures the optional :line suffix', () => {
    const tokens = tokenizePathsInText('apps/web/foo.ts:30 then');
    const first = tokens[0];
    expect(first?.type).toBe('path');
    if (first?.type === 'path') {
      expect(first.path).toBe('apps/web/foo.ts');
      expect(first.line).toBe(30);
      expect(first.raw).toBe('apps/web/foo.ts:30');
    }
  });

  it('works at the start and end of the string', () => {
    expect(paths('apps/web/foo.ts is the entry')).toEqual(['apps/web/foo.ts']);
    expect(paths('entry: apps/web/foo.ts')).toEqual(['apps/web/foo.ts']);
  });

  it('matches multiple paths in one string', () => {
    expect(paths('compare apps/web/foo.ts and packages/shared/bar.ts')).toEqual([
      'apps/web/foo.ts',
      'packages/shared/bar.ts',
    ]);
  });

  it('supports leading ./ and / prefixes', () => {
    expect(paths('see ./src/foo.ts')).toEqual(['./src/foo.ts']);
    expect(paths('absolute /etc/hosts.cfg path')).toEqual(['/etc/hosts.cfg']);
  });

  it('does not match identifiers without a slash', () => {
    expect(paths('Buffer.byteLength is fine')).toEqual([]);
    expect(paths('foo.ts standalone')).toEqual([]);
  });

  it('does not match version numbers like 1.2.3', () => {
    expect(paths('v1.2.3 release')).toEqual([]);
    expect(paths('1.0.0 stable')).toEqual([]);
  });

  it('does not match dates with slashes (no extension)', () => {
    // `12/15/2023` has no terminal `.ext`, so the regex rejects it.
    expect(paths('on 12/15/2023 we shipped')).toEqual([]);
  });

  it('does not match directory paths without extension', () => {
    expect(paths('see apps/web for details')).toEqual([]);
    expect(paths('packages/shared/')).toEqual([]);
  });

  it('does not double-match overlapping path segments', () => {
    const tokens = tokenizePathsInText('a/b/c/d.ts and e/f/g.ts');
    expect(tokens.filter((t) => t.type === 'path')).toHaveLength(2);
  });

  it('preserves the raw matched text including the line suffix', () => {
    const tokens = tokenizePathsInText('at apps/web/foo.ts:42 — done');
    const path = tokens.find((t) => t.type === 'path');
    expect(path?.type).toBe('path');
    if (path?.type === 'path') {
      expect(path.raw).toBe('apps/web/foo.ts:42');
      expect(path.line).toBe(42);
    }
  });

  it('returns an empty array on empty input', () => {
    expect(tokenizePathsInText('')).toEqual([]);
  });

  it('round-trips: concatenation of token raw/value reproduces input', () => {
    const inputs = [
      'plain text without paths',
      'apps/web/foo.ts inline',
      'see apps/web/foo.ts:30 and packages/shared/bar.ts',
      './src/foo.ts at start',
      'end with apps/web/foo.ts',
    ];
    for (const input of inputs) {
      const tokens = tokenizePathsInText(input);
      const round = tokens.map((t) => (t.type === 'text' ? t.value : t.raw)).join('');
      expect(round).toBe(input);
    }
  });

  it('textContainsPath agrees with tokenizePathsInText on positive cases', () => {
    expect(textContainsPath('see apps/web/foo.ts here')).toBe(true);
    expect(textContainsPath('Buffer.byteLength')).toBe(false);
    expect(textContainsPath('plain words')).toBe(false);
  });
});

/**
 * `extractSnippet` slices a 5-line window for the hover preview
 * popover. Both line-anchored and head-of-file modes need to land on
 * stable, 1-indexed positions so the rendered line numbers match
 * what users see in their editor.
 */
describe('extractSnippet', () => {
  const sample = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');

  it('returns the first 5 lines when no target line is given', () => {
    const snippet = extractSnippet(sample, null);
    expect(snippet.startLine).toBe(1);
    expect(snippet.endLine).toBe(5);
    expect(snippet.highlightLine).toBeNull();
    expect(snippet.lines).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(snippet.totalLines).toBe(8);
  });

  it('centres a 5-line window on the target with ±2 radius', () => {
    const snippet = extractSnippet(sample, 5);
    expect(snippet.startLine).toBe(3);
    expect(snippet.endLine).toBe(7);
    expect(snippet.highlightLine).toBe(5);
    expect(snippet.lines).toEqual(['c', 'd', 'e', 'f', 'g']);
  });

  it('clamps the window when the target is near the start', () => {
    const snippet = extractSnippet(sample, 1);
    expect(snippet.startLine).toBe(1);
    expect(snippet.endLine).toBe(3);
    expect(snippet.highlightLine).toBe(1);
    expect(snippet.lines).toEqual(['a', 'b', 'c']);
  });

  it('clamps the window when the target is near the end', () => {
    const snippet = extractSnippet(sample, 8);
    expect(snippet.startLine).toBe(6);
    expect(snippet.endLine).toBe(8);
    expect(snippet.highlightLine).toBe(8);
    expect(snippet.lines).toEqual(['f', 'g', 'h']);
  });

  it('clamps the target to the file length when out of bounds', () => {
    const snippet = extractSnippet(sample, 9999);
    expect(snippet.highlightLine).toBe(8);
    expect(snippet.endLine).toBe(8);
  });

  it('treats invalid line numbers as no-target (head-of-file mode)', () => {
    const snippet = extractSnippet(sample, 0);
    expect(snippet.highlightLine).toBeNull();
    expect(snippet.startLine).toBe(1);
  });

  it('handles a file shorter than the default window', () => {
    const snippet = extractSnippet('only-one-line', null);
    expect(snippet.startLine).toBe(1);
    expect(snippet.endLine).toBe(1);
    expect(snippet.lines).toEqual(['only-one-line']);
    expect(snippet.totalLines).toBe(1);
  });

  it('handles an empty file gracefully', () => {
    const snippet = extractSnippet('', null);
    expect(snippet.startLine).toBe(1);
    expect(snippet.endLine).toBe(1);
    expect(snippet.lines).toEqual(['']);
    expect(snippet.totalLines).toBe(1);
  });

  it('normalises CRLF line endings', () => {
    const crlf = 'alpha\r\nbeta\r\ngamma';
    const snippet = extractSnippet(crlf, 2);
    expect(snippet.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(snippet.highlightLine).toBe(2);
  });
});

/**
 * `extractErrorSummary` powers the red banner shown on failed tool
 * calls. The contract is intentionally narrow: only return when the
 * call is in error, prefer specific shapes (`error.message` over
 * `message`), and clamp to a single line so the banner stays inline
 * in the header without wrapping.
 */
describe('extractErrorSummary', () => {
  it('returns null when the call is not flagged as error', () => {
    expect(extractErrorSummary('anything', false)).toBeNull();
    expect(extractErrorSummary({ error: 'x' }, undefined)).toBeNull();
  });

  it('returns the first non-empty line of a string output', () => {
    expect(extractErrorSummary('oh no\nstack…', true)).toBe('oh no');
  });

  it('skips leading blank lines in stderr-shaped output', () => {
    expect(extractErrorSummary({ stderr: '\n\n  permission denied\n' }, true)).toBe(
      'permission denied',
    );
  });

  it('prefers nested error.message over top-level message', () => {
    expect(
      extractErrorSummary(
        {
          error: { message: 'ENOENT: file not found' },
          message: 'should be ignored',
        },
        true,
      ),
    ).toBe('ENOENT: file not found');
  });

  it('falls back to top-level message when error is missing', () => {
    expect(extractErrorSummary({ message: 'boom' }, true)).toBe('boom');
  });

  it('treats non-zero exitCode as a fallback', () => {
    expect(extractErrorSummary({ exitCode: 137 }, true)).toBe('exit 137');
  });

  it("returns 'exit N' even when exitCode is 0 only if other fields are absent", () => {
    // exit 0 is *not* a failure, so the helper does NOT surface it.
    expect(extractErrorSummary({ exitCode: 0 }, true)).toBe('执行失败');
  });

  it("falls back to '执行失败' when the payload is unrecognised", () => {
    expect(extractErrorSummary({ random: 'noise' }, true)).toBe('执行失败');
    expect(extractErrorSummary(null, true)).toBe('执行失败');
    expect(extractErrorSummary(undefined, true)).toBe('执行失败');
  });

  it('clamps long messages to a single line under the cap', () => {
    const long = `${'x'.repeat(200)} END`;
    const out = extractErrorSummary(long, true);
    expect(out).not.toBeNull();
    expect((out as string).length).toBeLessThanOrEqual(80);
    expect((out as string).endsWith('…')).toBe(true);
  });

  it("returns the string error field as-is for {error: 'msg'} shape", () => {
    expect(extractErrorSummary({ error: 'rate limited' }, true)).toBe('rate limited');
  });

  it('ignores blank string error fields and falls through', () => {
    expect(extractErrorSummary({ error: '   ' }, true)).toBe('执行失败');
  });
});

/**
 * Tests for `decideTimeDivider`: drives whether and what label is
 * rendered above each chat group. We pin `now` so day-rollover
 * transitions are deterministic regardless of when the test runs.
 */
describe('decideTimeDivider', () => {
  // Fixed clock at 2026-04-29 12:00 local. Used as both `now` and
  // the anchor for "today/yesterday/this week" computations.
  const now = new Date(2026, 3, 29, 12, 0, 0).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;

  it('returns hidden when current timestamp is missing', () => {
    expect(decideTimeDivider(null, null, now).show).toBe(false);
    expect(decideTimeDivider(undefined, 123, now).show).toBe(false);
  });

  it('shows an absolute label for the very first group', () => {
    const ts = new Date(2026, 3, 29, 9, 30, 0).getTime();
    const r = decideTimeDivider(ts, null, now);
    expect(r.show).toBe(true);
    // today → just HH:mm
    expect(r.label).toBe('09:30');
  });

  it('hides when the gap is below 5 minutes on the same day', () => {
    const previous = now - 4 * minute;
    expect(decideTimeDivider(now, previous, now).show).toBe(false);
  });

  it("renders '5 分钟前' when gap is exactly 5 minutes", () => {
    const previous = now - 5 * minute;
    const r = decideTimeDivider(now, previous, now);
    expect(r.show).toBe(true);
    expect(r.label).toBe('5 分钟前');
  });

  it("renders '2 小时前' for multi-hour same-day gaps", () => {
    const previous = now - 2 * hour - 30 * minute;
    const r = decideTimeDivider(now, previous, now);
    expect(r.show).toBe(true);
    expect(r.label).toBe('2 小时前');
  });

  it("uses '昨天 HH:mm' for one-day-back gaps", () => {
    const yesterdayMorning = new Date(2026, 3, 28, 9, 15, 0).getTime();
    const r = decideTimeDivider(yesterdayMorning, now - 30 * minute, now);
    expect(r.show).toBe(true);
    expect(r.label).toBe('昨天 09:15');
  });

  it('uses weekday alias for within-a-week gaps', () => {
    // 2026-04-25 is a Saturday → 周六
    const lastSaturday = new Date(2026, 3, 25, 16, 5, 0).getTime();
    const r = decideTimeDivider(lastSaturday, now - 30 * minute, now);
    expect(r.show).toBe(true);
    expect(r.label).toBe('周六 16:05');
  });

  it('falls back to YYYY-MM-DD for >7 day gaps', () => {
    const old = new Date(2026, 2, 1, 8, 0, 0).getTime();
    const r = decideTimeDivider(old, now - hour, now);
    expect(r.show).toBe(true);
    expect(r.label).toBe('2026-03-01 08:00');
  });

  it('treats cross-day under 5 minutes as a divider (different day)', () => {
    // Just before midnight → just after midnight, only 2 minutes
    // apart but on different days. We still want a divider.
    const before = new Date(2026, 3, 28, 23, 59, 0).getTime();
    const after = new Date(2026, 3, 29, 0, 1, 0).getTime();
    const r = decideTimeDivider(after, before, now);
    expect(r.show).toBe(true);
    // "today" relative to `now` (April 29) → label is HH:mm
    expect(r.label).toBe('00:01');
  });
});
