import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolDefinition } from '@openAwork/agent-core';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import { z } from 'zod';
import { buildFileDiff, fileDiffSchema } from './file-diff-format.js';
import { validateWorkspacePath } from './workspace-paths.js';

const applyPatchInputSchema = z.object({
  patchText: z.string().min(1),
});

const applyPatchOutputSchema = z.object({
  diffs: z.array(fileDiffSchema),
  success: z.literal(true),
  files: z.array(
    z.object({
      action: z.enum(['add', 'update', 'delete', 'move']),
      additions: z.number().int().optional(),
      after: z.string().optional(),
      before: z.string().optional(),
      deletions: z.number().int().optional(),
      path: z.string(),
      status: z.enum(['added', 'deleted', 'modified']).optional(),
    }),
  ),
});

type PatchAction =
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | {
      type: 'update';
      path: string;
      moveTo?: string;
      hunks: Array<{ oldText: string; newText: string }>;
    };

type PlannedPatchOperation =
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'write'; path: string; content: string }
  | { type: 'move'; sourcePath: string; targetPath: string; content: string };

function assertPatchPath(path: string): string {
  const safePath = validateWorkspacePath(path);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${path}`);
  }
  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: file "${safePath}" is protected by agentignore rules`);
  }
  return safePath;
}

function extractHunkLineValue(line: string): string {
  if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
    return line.slice(1);
  }
  return line;
}

function parsePatchText(patchText: string): PatchAction[] {
  const lines = patchText.split(/\r?\n/u);
  if (lines[0] !== '*** Begin Patch' || !lines.includes('*** End Patch')) {
    throw new Error('patch rejected: missing *** Begin Patch / *** End Patch envelope');
  }

  const actions: PatchAction[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line === '*** End Patch') {
      return actions;
    }

    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim();
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (current.startsWith('*** ') || current === '*** End Patch') {
          break;
        }
        if (!current.startsWith('+')) {
          throw new Error(`Invalid add-file line for ${path}: ${current}`);
        }
        contentLines.push(current.slice(1));
        index += 1;
      }
      actions.push({ type: 'add', path, content: contentLines.join('\n') });
      continue;
    }

    if (line.startsWith('*** Delete File: ')) {
      const path = line.slice('*** Delete File: '.length).trim();
      actions.push({ type: 'delete', path });
      index += 1;
      continue;
    }

    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim();
      index += 1;
      let moveTo: string | undefined;
      if ((lines[index] ?? '').startsWith('*** Move to: ')) {
        moveTo = (lines[index] ?? '').slice('*** Move to: '.length).trim();
        index += 1;
      }

      const hunks: Array<{ oldText: string; newText: string }> = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (current.startsWith('*** ') || current === '*** End Patch') {
          break;
        }
        if (!current.startsWith('@@')) {
          throw new Error(`Invalid update hunk header for ${path}: ${current}`);
        }
        index += 1;
        const oldLines: string[] = [];
        const newLines: string[] = [];
        while (index < lines.length) {
          const hunkLine = lines[index] ?? '';
          if (
            hunkLine.startsWith('@@') ||
            hunkLine.startsWith('*** ') ||
            hunkLine === '*** End Patch'
          ) {
            break;
          }
          if (hunkLine.startsWith('-')) {
            oldLines.push(extractHunkLineValue(hunkLine));
          } else if (hunkLine.startsWith('+')) {
            newLines.push(extractHunkLineValue(hunkLine));
          } else {
            const value = extractHunkLineValue(hunkLine);
            oldLines.push(value);
            newLines.push(value);
          }
          index += 1;
        }
        hunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n') });
      }

      actions.push({ type: 'update', path, moveTo, hunks });
      continue;
    }

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    throw new Error(`Unsupported patch line: ${line}`);
  }

  throw new Error('patch rejected: missing *** End Patch');
}

async function planUpdateAction(
  action: Extract<PatchAction, { type: 'update' }>,
): Promise<PlannedPatchOperation> {
  const sourcePath = assertPatchPath(action.path);
  const originalContent = await fsp.readFile(sourcePath, 'utf8');
  const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
  let nextContent = originalContent;

  for (const hunk of action.hunks) {
    const oldText = hunk.oldText.replace(/\n/gu, eol);
    const newText = hunk.newText.replace(/\n/gu, eol);
    if (!nextContent.includes(oldText)) {
      throw new Error(`Patch hunk not found in ${sourcePath}`);
    }
    nextContent = nextContent.replace(oldText, newText);
  }

  const targetPath = action.moveTo ? assertPatchPath(action.moveTo) : sourcePath;
  if (targetPath !== sourcePath) {
    return { type: 'move', sourcePath, targetPath, content: nextContent };
  }

  return { type: 'write', path: sourcePath, content: nextContent };
}

async function planPatchText(patchText: string): Promise<PlannedPatchOperation[]> {
  const actions = parsePatchText(patchText);
  const planned: PlannedPatchOperation[] = [];

  for (const action of actions) {
    if (action.type === 'add') {
      const safePath = assertPatchPath(action.path);
      planned.push({ type: 'add', path: safePath, content: action.content });
      continue;
    }

    if (action.type === 'delete') {
      const safePath = assertPatchPath(action.path);
      await fsp.stat(safePath);
      planned.push({ type: 'delete', path: safePath });
      continue;
    }

    planned.push(await planUpdateAction(action));
  }

  return planned;
}

async function applyPlannedOperations(planned: PlannedPatchOperation[]): Promise<
  Array<{
    action: 'add' | 'update' | 'delete' | 'move';
    additions?: number;
    after?: string;
    before?: string;
    deletions?: number;
    path: string;
    status?: 'added' | 'deleted' | 'modified';
  }>
> {
  const outputs: Array<{
    action: 'add' | 'update' | 'delete' | 'move';
    additions?: number;
    after?: string;
    before?: string;
    deletions?: number;
    path: string;
    status?: 'added' | 'deleted' | 'modified';
  }> = [];

  for (const operation of planned) {
    if (operation.type === 'add') {
      await fsp.mkdir(dirname(operation.path), { recursive: true });
      await fsp.writeFile(operation.path, operation.content, 'utf8');
      const filediff = buildFileDiff({
        file: operation.path,
        before: '',
        after: operation.content,
      });
      outputs.push({
        action: 'add',
        path: operation.path,
        before: '',
        after: operation.content,
        additions: filediff.additions,
        deletions: filediff.deletions,
        status: filediff.status,
      });
      continue;
    }

    if (operation.type === 'delete') {
      const previousContent = await fsp.readFile(operation.path, 'utf8');
      await fsp.unlink(operation.path);
      const filediff = buildFileDiff({ file: operation.path, before: previousContent, after: '' });
      outputs.push({
        action: 'delete',
        path: operation.path,
        before: previousContent,
        after: '',
        additions: filediff.additions,
        deletions: filediff.deletions,
        status: filediff.status,
      });
      continue;
    }

    if (operation.type === 'move') {
      const previousContent = await fsp.readFile(operation.sourcePath, 'utf8');
      await fsp.mkdir(dirname(operation.targetPath), { recursive: true });
      await fsp.writeFile(operation.targetPath, operation.content, 'utf8');
      await fsp.unlink(operation.sourcePath);
      const filediff = buildFileDiff({
        file: operation.targetPath,
        before: previousContent,
        after: operation.content,
      });
      outputs.push({
        action: 'move',
        path: operation.targetPath,
        before: previousContent,
        after: operation.content,
        additions: filediff.additions,
        deletions: filediff.deletions,
        status: filediff.status,
      });
      continue;
    }

    const previousContent = await fsp.readFile(operation.path, 'utf8');
    await fsp.writeFile(operation.path, operation.content, 'utf8');
    const filediff = buildFileDiff({
      file: operation.path,
      before: previousContent,
      after: operation.content,
    });
    outputs.push({
      action: 'update',
      path: operation.path,
      before: previousContent,
      after: operation.content,
      additions: filediff.additions,
      deletions: filediff.deletions,
      status: filediff.status,
    });
  }

  return outputs;
}

function buildApplyPatchPermissionScope(patchText: string): string {
  const digest = createHash('sha256').update(patchText).digest('hex').slice(0, 12);
  return `apply_patch:${digest}`;
}

export const applyPatchToolDefinition: ToolDefinition<
  typeof applyPatchInputSchema,
  typeof applyPatchOutputSchema
> = {
  name: 'apply_patch',
  description:
    'Apply a structured patch envelope to workspace files. Supports Add File, Update File, Delete File, and Move to operations inside a Begin/End Patch block.',
  inputSchema: applyPatchInputSchema,
  outputSchema: applyPatchOutputSchema,
  timeout: 120000,
  execute: async (input) => {
    const planned = await planPatchText(input.patchText);
    const files = await applyPlannedOperations(planned);
    return {
      success: true,
      files,
      diffs: files.map((file) =>
        buildFileDiff({ file: file.path, before: file.before ?? '', after: file.after ?? '' }),
      ),
    };
  },
};

export { buildApplyPatchPermissionScope };
