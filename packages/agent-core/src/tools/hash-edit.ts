import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export interface LineHash {
  lineNumber: number;
  hash: string;
  content: string;
}

export interface AnchoredEdit {
  filePath: string;
  lineNumber: number;
  expectedHash: string;
  oldContent: string;
  newContent: string;
}

export interface HashAnchoredEditor {
  computeLineHashes(filePath: string): Promise<LineHash[]>;
  formatWithHashes(filePath: string): Promise<string>;
  applyEdit(edit: AnchoredEdit): Promise<{ success: boolean; error?: string }>;
  applyEdits(
    edits: AnchoredEdit[],
  ): Promise<{ success: boolean; failed: number[]; error?: string }>;
}

interface ParsedFile {
  lines: string[];
  eol: '\n' | '\r\n';
  hasTrailingNewline: boolean;
}

interface FileState {
  originalContent: string;
  parsed: ParsedFile;
}

function lineHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function parseContent(content: string): ParsedFile {
  const eol: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (hasTrailingNewline) {
    lines.pop();
  }
  return { lines, eol, hasTrailingNewline };
}

function stringifyContent(parsed: ParsedFile): string {
  const body = parsed.lines.join(parsed.eol);
  return parsed.hasTrailingNewline ? `${body}${parsed.eol}` : body;
}

function validateLineRange(lines: string[], lineNumber: number): boolean {
  return Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= lines.length;
}

export class HashAnchoredEditorImpl implements HashAnchoredEditor {
  async computeLineHashes(filePath: string): Promise<LineHash[]> {
    const content = await readFile(filePath, 'utf8');
    const parsed = parseContent(content);
    return parsed.lines.map((line, index) => ({
      lineNumber: index + 1,
      hash: lineHash(line),
      content: line,
    }));
  }

  async formatWithHashes(filePath: string): Promise<string> {
    const lines = await this.computeLineHashes(filePath);
    return lines.map((line) => `${line.lineNumber}#${line.hash}| ${line.content}`).join('\n');
  }

  async applyEdit(edit: AnchoredEdit): Promise<{ success: boolean; error?: string }> {
    const result = await this.applyEdits([edit]);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true };
  }

  async applyEdits(
    edits: AnchoredEdit[],
  ): Promise<{ success: boolean; failed: number[]; error?: string }> {
    if (edits.length === 0) {
      return { success: true, failed: [] };
    }

    const fileStates = new Map<string, FileState>();
    for (const edit of edits) {
      if (!fileStates.has(edit.filePath)) {
        const originalContent = await readFile(edit.filePath, 'utf8');
        fileStates.set(edit.filePath, {
          originalContent,
          parsed: parseContent(originalContent),
        });
      }
    }

    const failed: number[] = [];
    let firstError: string | undefined;

    for (const [index, edit] of edits.entries()) {
      const state = fileStates.get(edit.filePath);
      if (!state) {
        failed.push(index);
        firstError ??= `unable to load file: ${edit.filePath}`;
        continue;
      }

      if (!validateLineRange(state.parsed.lines, edit.lineNumber)) {
        failed.push(index);
        firstError ??= `line out of range: ${edit.lineNumber}`;
        continue;
      }

      const lineIndex = edit.lineNumber - 1;
      const currentLine = state.parsed.lines[lineIndex]!;
      if (lineHash(currentLine) !== edit.expectedHash) {
        failed.push(index);
        firstError ??= 'hash mismatch: file changed since read';
        continue;
      }

      if (currentLine !== edit.oldContent) {
        failed.push(index);
        firstError ??= 'old content mismatch: file changed since read';
      }
    }

    if (failed.length > 0) {
      return { success: false, failed, error: firstError };
    }

    for (const edit of edits) {
      const state = fileStates.get(edit.filePath)!;
      const lineIndex = edit.lineNumber - 1;
      state.parsed.lines[lineIndex] = edit.newContent;
    }

    const writtenFiles: string[] = [];
    try {
      for (const [filePath, state] of fileStates) {
        await writeFile(filePath, stringifyContent(state.parsed), 'utf8');
        writtenFiles.push(filePath);
      }
    } catch (error) {
      await Promise.all(
        writtenFiles.map(async (filePath) => {
          const original = fileStates.get(filePath)?.originalContent;
          if (original === undefined) {
            return;
          }
          try {
            await writeFile(filePath, original, 'utf8');
          } catch {
            return;
          }
        }),
      );

      return {
        success: false,
        failed: [],
        error: `failed to apply edits atomically: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return { success: true, failed: [] };
  }
}
