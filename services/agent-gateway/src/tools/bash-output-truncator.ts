/**
 * Bash Output Truncator — port of opencode's `tool/truncate.ts`.
 *
 * When bash command output exceeds line/byte limits, truncates the output and
 * writes the full content to a tool-output directory inside the workspace
 * so that follow-up `read` / `grep` calls (which are restricted to the
 * workspace by `validateWorkspacePath`) can still inspect it. This mirrors
 * opencode's `Truncate.write()` + `Truncate.output()` contract while
 * matching opencode's UTF-8 boundary-safe `tail` algorithm in `bash.ts`.
 *
 * Behaviour highlights kept aligned with opencode:
 *   - `MAX_OUTPUT_LINES = 2000`, `MAX_OUTPUT_BYTES = 50 * 1024`
 *   - When exceeding either bound, the saved file path is referenced in the
 *     truncation hint so the model can read it back.
 *   - `direction: 'head' | 'tail'` selects which end of the output to keep.
 *   - The single-line-too-long edge case is handled by walking back to the
 *     nearest UTF-8 codepoint boundary.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_ROOT } from '../infra/db.js';

export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

/**
 * Tool output is persisted under a hidden folder *inside the workspace* so
 * that the model's follow-up `read` / `grep` calls — which go through
 * `validateWorkspacePath` and refuse anything outside the workspace when
 * `WORKSPACE_ACCESS_RESTRICTED=true` — can still reach the saved file.
 * Mirrors opencode's `TRUNCATION_DIR = Global.Path.data/tool-output`,
 * adapted to OpenAWork's per-workspace layout.
 */
export const TRUNCATION_DIR = path.join(WORKSPACE_ROOT, '.openAwork', 'tool-output');

let dirEnsured = false;

async function ensureTruncationDir(): Promise<void> {
  if (dirEnsured) return;
  try {
    await fsp.mkdir(TRUNCATION_DIR, { recursive: true });
    dirEnsured = true;
  } catch {
    // may already exist or be unwritable; the next writeFile call will surface
    // the real error to the caller. Set the flag anyway to avoid re-mkdir storms.
    dirEnsured = true;
  }
}

async function writeFullOutput(text: string): Promise<string> {
  await ensureTruncationDir();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const file = path.join(TRUNCATION_DIR, `bash_${ts}_${rand}.txt`);
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
 * full output to `TRUNCATION_DIR` and returns the path. The returned hint
 * tells the model how to inspect the saved file with workspace-safe tools.
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
