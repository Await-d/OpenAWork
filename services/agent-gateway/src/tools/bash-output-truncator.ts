/**
 * Bash Output Truncator — port of opencode's `tool/truncate.ts`.
 *
 * When bash command output exceeds line/byte limits, truncates the output and
 * writes the full content to a tool-output directory so that follow-up `read` /
 * `grep` calls can still inspect it. This mirrors opencode's `Truncate.write()`
 * + `Truncate.output()` contract while matching opencode's UTF-8 boundary-safe
 * `tail` algorithm in `bash.ts`.
 *
 * Behaviour highlights kept aligned with opencode:
 *   - `MAX_OUTPUT_LINES = 2000`, `MAX_OUTPUT_BYTES = 50 * 1024`
 *   - When exceeding either bound, the saved file path is referenced in the
 *     truncation hint so the model can read it back.
 *   - `direction: 'head' | 'tail'` selects which end of the output to keep.
 *   - The single-line-too-long edge case is handled by walking back to the
 *     nearest UTF-8 codepoint boundary.
 *
 * Directory selection:
 *   In restricted mode we only write under configured workspace roots so the
 *   returned `outputPath` remains reachable by `Read` / `Grep`. In
 *   unrestricted mode we still prefer workspace storage first, then fall back
 *   to `{OPENAWORK_DATA_DIR}/tool-output`, then
 *   `os.tmpdir()/openAwork/tool-output`.
 */

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKSPACE_ACCESS_RESTRICTED, WORKSPACE_ROOT, WORKSPACE_ROOTS } from '../infra/db.js';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';

export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

/**
 * @deprecated **Do not use this to read/write/check actual truncation files.**
 * This is a static path derived from the single `WORKSPACE_ROOT` at module
 * load time. The real write location is chosen dynamically at call time by
 * {@link resolveWritableTruncationDir}, which iterates `WORKSPACE_ROOTS` (all
 * configured workspace roots, not just the first) and falls back to the
 * gateway data dir or the OS tmp dir when the preferred candidate isn't
 * writable — see {@link listTruncationDirCandidates}. When there are multiple
 * workspace roots, or the first root is not writable, `TRUNCATION_DIR` will
 * NOT match where files actually end up.
 *
 * Kept only as a stable "primary candidate" reference for tests/docs (e.g.
 * asserting it's first in {@link listTruncationDirCandidates}'s output).
 * Production code that needs to locate, read, or verify existence of a
 * truncation file MUST call {@link resolveWritableTruncationDir} (async)
 * instead of assuming this constant.
 */
export const TRUNCATION_DIR = path.join(WORKSPACE_ROOT, '.openAwork', 'tool-output');

function workspaceTruncationDirs(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const dir = path.resolve(workspaceRoot, '.openAwork', 'tool-output');
    if (seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    result.push(dir);
  }

  return result;
}

/** Candidate dirs in preference order (deduped, absolute). */
export function listTruncationDirCandidates(): string[] {
  const workspaceCandidates = workspaceTruncationDirs();
  const candidates = WORKSPACE_ACCESS_RESTRICTED
    ? workspaceCandidates
    : [
        ...workspaceCandidates,
        path.join(resolveGatewayDataDir(), 'tool-output'),
        path.join(tmpdir(), 'openAwork', 'tool-output'),
      ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

let cachedWritableDir: string | undefined;

/**
 * Ensure a writable truncation directory exists. Tries each candidate until
 * mkdir + a probe write succeed. Caches the first success for the process
 * lifetime; cache is cleared only when every candidate fails so a later retry
 * can recover after permissions change.
 */
export async function resolveWritableTruncationDir(): Promise<string> {
  if (cachedWritableDir) {
    return cachedWritableDir;
  }

  const errors: string[] = [];
  for (const dir of listTruncationDirCandidates()) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const probe = path.join(
        dir,
        `.write-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      await fsp.writeFile(probe, '', 'utf-8');
      await fsp.rm(probe).catch(() => undefined);
      cachedWritableDir = dir;
      return dir;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${dir}: ${message}`);
    }
  }

  throw new Error(
    `Unable to create a writable bash tool-output directory. Tried:\n${errors.join('\n')}`,
  );
}

/** @internal test helper — reset the cached writable dir between cases. */
export function resetTruncationDirCacheForTests(): void {
  cachedWritableDir = undefined;
}

async function writeFullOutput(text: string): Promise<string> {
  const dir = await resolveWritableTruncationDir();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const file = path.join(dir, `bash_${ts}_${rand}.txt`);
  await fsp.writeFile(file, text, 'utf-8');
  return file;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  outputPath?: string;
}

/**
 * UTF-8 boundary-safe single-line truncator. Mirrors opencode's `tail()`
 * fallback when an individual line exceeds `maxBytes`: take the trailing
 * `maxBytes` portion, then walk forward until the start byte is no longer
 * a UTF-8 continuation byte (`0b10xxxxxx`) so we never split mid-codepoint.
 */
function trimLineToBytes(line: string, maxBytes: number): string {
  const buf = Buffer.from(line, 'utf-8');
  if (buf.length <= maxBytes) return line;
  let start = buf.length - maxBytes;
  if (start < 0) start = 0;
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start += 1;
  return buf.subarray(start).toString('utf-8');
}

/**
 * Truncate bash output if it exceeds line/byte limits.
 *
 * Returns the (possibly truncated) content and, when truncated, saves the
 * full output to a writable truncation dir and returns the path. The returned
 * hint tells the model how to inspect the saved file with workspace-safe tools.
 */
export async function truncateBashOutput(
  text: string,
  direction: 'head' | 'tail' = 'tail',
  maxLines = MAX_OUTPUT_LINES,
  maxBytes = MAX_OUTPUT_BYTES,
): Promise<TruncationResult> {
  const lines = text.split('\n');
  const totalBytes = Buffer.byteLength(text, 'utf-8');

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false };
  }

  const out: string[] = [];
  let bytes = 0;
  let hitBytes = false;

  if (direction === 'head') {
    for (let i = 0; i < lines.length && i < maxLines; i += 1) {
      const size = Buffer.byteLength(lines[i]!, 'utf-8') + (i > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.push(lines[i]!);
      bytes += size;
    }
  } else {
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i -= 1) {
      const size = Buffer.byteLength(lines[i]!, 'utf-8') + (out.length > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        // opencode parity: when the *first* candidate line is itself larger
        // than maxBytes, keep its tail slice (UTF-8 boundary-aligned) so we
        // surface *something* rather than returning an empty preview.
        if (out.length === 0) {
          out.unshift(trimLineToBytes(lines[i]!, maxBytes));
        }
        hitBytes = true;
        break;
      }
      out.unshift(lines[i]!);
      bytes += size;
    }
  }

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length;
  const unit = hitBytes ? 'bytes' : 'lines';
  const preview = out.join('\n');

  const file = await writeFullOutput(text);
  const hint =
    `Output truncated (${removed} ${unit} omitted). Full output saved to: ${file}\n` +
    `Use Grep to search the full content or Read with offset/limit to view specific sections.`;

  const content =
    direction === 'head'
      ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
      : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`;

  return { content, truncated: true, outputPath: file };
}
