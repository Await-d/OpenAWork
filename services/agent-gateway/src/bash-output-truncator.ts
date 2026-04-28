/**
 * Bash Output Truncator
 *
 * Ported from opencode's tool/truncate.ts.
 * When bash command output exceeds size limits, truncates the output and
 * saves the full content to a temporary file for later inspection.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

const TRUNCATION_DIR = path.join(os.tmpdir(), 'openAwork-truncated-output');

let dirEnsured = false;

async function ensureTruncationDir(): Promise<void> {
  if (dirEnsured) return;
  try {
    await fsp.mkdir(TRUNCATION_DIR, { recursive: true });
    dirEnsured = true;
  } catch {
    // may already exist
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
 * Truncate bash output if it exceeds line/byte limits.
 * Returns the (possibly truncated) content and, when truncated,
 * saves full output to a file and returns the path.
 *
 * @param text - The raw output text
 * @param direction - 'head' keeps first N lines, 'tail' keeps last N lines
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
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const size = Buffer.byteLength(lines[i]!, 'utf-8') + (i > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.push(lines[i]!);
      bytes += size;
    }
  } else {
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i]!, 'utf-8') + (out.length > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
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
