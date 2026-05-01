/**
 * Single-line summary builder for the 10 `lsp_*` tools.
 *
 * The user requested that LSP tool calls render as a non-expandable inline
 * pill — `<tool> <position> · <status>` — instead of the default Inline
 * card which auto-expands input + output panels. LSP outputs are usually
 * short structured payloads (one definition location, a hover blurb, a
 * diagnostics map) that can be summarised in ~60 chars without losing
 * useful information.
 *
 * `buildLspInlineSummary()` is the only public entry point. The three
 * helpers (`lspInputDescription` / `lspSuccessSummary` / `lspErrorSnippet`)
 * are exported for unit tests to pin each branch independently.
 */

import { extractTextFromOutput } from './extract-text.js';

export type LspVisualState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'pending'
  | 'cancelled'
  | 'idle';

const SNIPPET_MAX = 60;

function truncate(s: string, max = SNIPPET_MAX): string {
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/**
 * Build the left-hand-side input description: `<filePath>:<line>:<char>`
 * plus any tool-specific extras (newName, scope/query, direction).
 *
 * Returns "" when no recognisable input fields are present (still
 * streaming) — caller renders an empty summary which works fine since
 * the ToolIcon already conveys "running".
 */
export function lspInputDescription(toolName: string, input: Record<string, unknown>): string {
  const normalized = toolName.trim().toLowerCase();

  const filePath =
    typeof input.filePath === 'string' && input.filePath.length > 0
      ? input.filePath
      : typeof input.path === 'string' && input.path.length > 0
        ? input.path
        : '';
  const line = typeof input.line === 'number' ? input.line : null;
  const char = typeof input.character === 'number' ? input.character : null;

  let lhs = '';
  if (filePath && line != null && char != null) {
    lhs = `${filePath}:${line}:${char}`;
  } else if (filePath && line != null) {
    lhs = `${filePath}:${line}`;
  } else if (filePath) {
    lhs = filePath;
  }

  if (normalized === 'lsp_rename') {
    const newName = typeof input.newName === 'string' ? input.newName : '';
    if (newName) lhs += ` → "${newName}"`;
  } else if (normalized === 'lsp_symbols') {
    const scope = typeof input.scope === 'string' ? input.scope : 'document';
    const query = typeof input.query === 'string' ? input.query : '';
    lhs += query ? ` (${scope}, "${query}")` : ` (${scope})`;
  } else if (normalized === 'lsp_call_hierarchy') {
    const direction = typeof input.direction === 'string' ? input.direction : 'both';
    lhs += ` (${direction})`;
  } else if (normalized === 'lsp_find_references') {
    if (input.includeDeclaration === false) lhs += ' (no-decl)';
  }

  return lhs;
}

/**
 * Tool-aware success summary derived from the output schema. Returns ""
 * when the output shape isn't recognised — callers render a neutral
 * "✓ 完成" instead. Schemas mirror the `ToolDefinition` exports in
 * `packages/agent-core/src/tools/lsp.ts` plus the gateway-side richer
 * tools whose outputs aren't statically typed in TS.
 */
export function lspSuccessSummary(toolName: string, output: unknown): string {
  const normalized = toolName.trim().toLowerCase();

  if (normalized === 'lsp_diagnostics') {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const rec = output as Record<string, unknown>;
      const fileCount = Object.keys(rec).length;
      let total = 0;
      for (const arr of Object.values(rec)) {
        if (Array.isArray(arr)) total += arr.length;
      }
      if (fileCount === 0 || total === 0) return '无诊断';
      return `${fileCount} 个文件 · ${total} 个问题`;
    }
  }

  if (normalized === 'lsp_touch') {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const ok = (output as Record<string, unknown>).ok;
      if (ok === true) return 'ok';
      if (ok === false) return 'not-ready';
    }
  }

  if (normalized === 'lsp_find_references') {
    if (Array.isArray(output)) return `${output.length} 个引用`;
    if (output && typeof output === 'object') {
      const rec = output as Record<string, unknown>;
      if (Array.isArray(rec.references)) return `${rec.references.length} 个引用`;
      if (Array.isArray(rec.locations)) return `${rec.locations.length} 个引用`;
    }
  }

  if (normalized === 'lsp_symbols') {
    if (Array.isArray(output)) return `${output.length} 个符号`;
    if (output && typeof output === 'object') {
      const rec = output as Record<string, unknown>;
      if (Array.isArray(rec.symbols)) return `${rec.symbols.length} 个符号`;
    }
  }

  if (normalized === 'lsp_goto_definition' || normalized === 'lsp_goto_implementation') {
    const locs = Array.isArray(output)
      ? output
      : output && typeof output === 'object'
        ? Array.isArray((output as Record<string, unknown>).locations)
          ? ((output as Record<string, unknown>).locations as unknown[])
          : null
        : null;
    if (Array.isArray(locs)) {
      if (locs.length === 0) return '未找到';
      const first = locs[0];
      if (first && typeof first === 'object') {
        const f = first as Record<string, unknown>;
        const fp =
          typeof f.filePath === 'string' ? f.filePath : typeof f.uri === 'string' ? f.uri : '';
        const ln = typeof f.line === 'number' ? f.line : null;
        if (fp && ln != null) {
          const tail = locs.length > 1 ? ` (+${locs.length - 1})` : '';
          return `${fp}:${ln}${tail}`;
        }
      }
      return `${locs.length} 个位置`;
    }
  }

  if (normalized === 'lsp_hover') {
    const text = extractTextFromOutput(output);
    if (text && text.text.length > 0) {
      return `"${truncate(text.text)}"`;
    }
    if (output && typeof output === 'object') {
      const rec = output as Record<string, unknown>;
      const contents =
        typeof rec.contents === 'string'
          ? rec.contents
          : typeof rec.value === 'string'
            ? rec.value
            : '';
      if (contents) return `"${truncate(contents)}"`;
    }
  }

  if (normalized === 'lsp_rename') {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const rec = output as Record<string, unknown>;
      const changes = rec.changes;
      if (Array.isArray(changes)) return `${changes.length} 个修改`;
      if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
        const fileMap = changes as Record<string, unknown>;
        const fileCount = Object.keys(fileMap).length;
        let editCount = 0;
        for (const edits of Object.values(fileMap)) {
          if (Array.isArray(edits)) editCount += edits.length;
        }
        if (editCount > 0) return `${fileCount} 个文件 · ${editCount} 个修改`;
        return `${fileCount} 个文件`;
      }
      if (typeof rec.documentChanges === 'object' && rec.documentChanges) {
        if (Array.isArray(rec.documentChanges)) return `${rec.documentChanges.length} 个文档`;
      }
    }
  }

  if (normalized === 'lsp_prepare_rename') {
    if (output === null) return '不可重命名';
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const rec = output as Record<string, unknown>;
      if (rec.valid === true) return '可重命名';
      if (rec.valid === false) return '不可重命名';
      if (typeof rec.placeholder === 'string' && rec.placeholder.length > 0) {
        return `可重命名 ("${truncate(rec.placeholder, 30)}")`;
      }
      if (typeof rec.range === 'object') return '可重命名';
    }
  }

  if (normalized === 'lsp_call_hierarchy') {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const rec = output as Record<string, unknown>;
      const incoming = Array.isArray(rec.incoming) ? rec.incoming.length : 0;
      const outgoing = Array.isArray(rec.outgoing) ? rec.outgoing.length : 0;
      if (incoming || outgoing) return `↑${incoming} ↓${outgoing}`;
    }
  }

  // Generic fallback: pull text envelope (`{output|content|text|...}`) and
  // return a 60-char snippet so we never expose raw JSON.
  const text = extractTextFromOutput(output);
  if (text && text.text.length > 0) return truncate(text.text);
  return '';
}

/**
 * Extract a short error message from a failed tool's output. Tries the
 * common envelope keys (`error`, `message`, `errorMessage`, `output`)
 * before falling back to "" so the caller can render a neutral "✗ 失败".
 */
export function lspErrorSnippet(output: unknown): string {
  if (typeof output === 'string') return truncate(output);
  if (!output || typeof output !== 'object' || Array.isArray(output)) return '';
  const rec = output as Record<string, unknown>;
  for (const key of ['error', 'message', 'errorMessage', 'output'] as const) {
    const v = rec[key];
    if (typeof v === 'string' && v.length > 0) return truncate(v);
  }
  return '';
}

/**
 * Public entry point — composes the input description with a status
 * suffix. Output examples:
 *
 *   "src/foo.ts:42:8 · ✓ 3 个引用"
 *   "src/foo.ts:42:8 · ✗ connection refused"
 *   "src/foo.ts (document) · 12 个符号"      (visualState=completed, no ✓ when                                              the suffix already conveys success)
 *   "src/foo.ts:42 · …"                      (running)
 *   ""                                       (no input yet, ToolIcon shows running)
 */
export function buildLspInlineSummary(args: {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  visualState: LspVisualState;
  isError?: boolean;
}): string {
  const lhs = lspInputDescription(args.toolName, args.input);

  if (args.isError === true || args.visualState === 'failed') {
    const err = lspErrorSnippet(args.output);
    const suffix = err ? `✗ ${err}` : '✗ 失败';
    return lhs ? `${lhs} · ${suffix}` : suffix;
  }

  if (args.visualState === 'completed') {
    const ok = lspSuccessSummary(args.toolName, args.output);
    const suffix = ok || '✓ 完成';
    return lhs ? `${lhs} · ${suffix}` : suffix;
  }

  if (args.visualState === 'cancelled') {
    return lhs ? `${lhs} · 已取消` : '已取消';
  }

  if (args.visualState === 'paused') {
    return lhs ? `${lhs} · 等待权限` : '等待权限';
  }

  // running / pending / idle — ToolIcon already conveys progress, so we
  // just show the input description (which may be empty mid-stream).
  return lhs;
}
