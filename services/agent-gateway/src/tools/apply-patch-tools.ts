import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { FileBackupRef } from '@openAwork/shared';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import { z } from 'zod';
import { buildFileDiff, fileBackupRefSchema, fileDiffSchema } from './file-diff-format.js';
import { deriveUpdatedText, ensureTrailingNewline, parsePatchText } from './patch-text.js';
import { lspManager } from '../lsp/router.js';
import { getPostWriteDiagnostics, postWriteDiagnosticSchema } from './lsp-tools.js';
import { assertSessionWorkspacePath } from '../workspace/workspace-safety.js';

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
      backupBeforeRef: fileBackupRefSchema.optional(),
      before: z.string().optional(),
      deletions: z.number().int().optional(),
      path: z.string(),
      status: z.enum(['added', 'deleted', 'modified']).optional(),
    }),
  ),
  diagnostics: z.array(postWriteDiagnosticSchema).optional(),
});

const APPLY_PATCH_DESCRIPTION = [
  '将结构化补丁应用到工作区文件，一次调用可批量完成新增 / 删除 / 修改 / 重命名。补丁语言是面向文件的精简 diff 格式：',
  '',
  '*** Begin Patch',
  '*** Add File: <路径>',
  '+新文件的内容',
  '*** Update File: <路径>',
  '*** Move to: <新路径>',
  '@@ 可选上下文锚点',
  ' 上下文行',
  '-旧行',
  '+新行',
  '*** Delete File: <路径>',
  '*** End Patch',
  '',
  '要点：每个文件操作都必须带 *** 开头的操作头；新增行以 + 前缀、上下文行以空格前缀；修改块可用 @@ <文本> 指定起始锚点，或用 *** End of File 锚定文件末尾。补丁先整体校验再写入，任何一处匹配失败都不会改动任何文件。',
].join('\n');

type PlannedPatchOperation =
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'write'; path: string; content: string }
  | { type: 'move'; sourcePath: string; targetPath: string; content: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPatchPath(path: string, sessionId: string): string {
  const safePath = assertSessionWorkspacePath({ path, sessionId });
  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: file "${safePath}" is protected by agentignore rules`);
  }
  return safePath;
}

async function readFileForPatch(filePath: string, failureMessage: string): Promise<string> {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`patch verification failed: ${failureMessage}: ${describeError(error)}`);
  }
}

async function assertDeletable(filePath: string): Promise<void> {
  try {
    await fsp.stat(filePath);
  } catch (error) {
    throw new Error(
      `patch verification failed: Failed to delete ${filePath}: ${describeError(error)}`,
    );
  }
}

async function planPatchText(
  patchText: string,
  sessionId: string,
): Promise<PlannedPatchOperation[]> {
  const actions = parsePatchText(patchText);
  if (actions.length === 0) {
    throw new Error('patch rejected: empty patch');
  }

  const planned: PlannedPatchOperation[] = [];
  // 同一文件出现多个 Update 块时，后续块必须基于前一块的结果推导（写盘在
  // 全部校验之后统一进行，不能回读磁盘，否则后面一块会覆盖前面一块）。
  const pendingContent = new Map<string, string>();

  for (const action of actions) {
    if (action.type === 'add') {
      const safePath = assertPatchPath(action.path, sessionId);
      planned.push({ type: 'add', path: safePath, content: ensureTrailingNewline(action.content) });
      continue;
    }

    if (action.type === 'delete') {
      const safePath = assertPatchPath(action.path, sessionId);
      await assertDeletable(safePath);
      planned.push({ type: 'delete', path: safePath });
      continue;
    }

    const sourcePath = assertPatchPath(action.path, sessionId);
    const original =
      pendingContent.get(sourcePath) ??
      (await readFileForPatch(sourcePath, `Failed to read file to update ${sourcePath}`));
    const derived = deriveUpdatedText({ chunks: action.chunks, original, path: sourcePath });
    const targetPath = action.moveTo ? assertPatchPath(action.moveTo, sessionId) : sourcePath;

    if (targetPath !== sourcePath) {
      planned.push({ type: 'move', sourcePath, targetPath, content: derived.content });
      pendingContent.set(targetPath, derived.content);
      continue;
    }

    planned.push({ type: 'write', path: sourcePath, content: derived.content });
    pendingContent.set(sourcePath, derived.content);
  }

  return planned;
}

async function applyPlannedOperations(
  planned: PlannedPatchOperation[],
  options?: {
    beforeWriteBackup?: (input: {
      content: string;
      filePath: string;
    }) => Promise<FileBackupRef | undefined>;
  },
): Promise<
  Array<{
    action: 'add' | 'update' | 'delete' | 'move';
    additions?: number;
    after?: string;
    backupBeforeRef?: FileBackupRef;
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
    backupBeforeRef?: FileBackupRef;
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
      const backupBeforeRef = options?.beforeWriteBackup
        ? await options.beforeWriteBackup({
            filePath: operation.path,
            content: previousContent,
          })
        : undefined;
      await fsp.unlink(operation.path);
      const filediff = buildFileDiff({ file: operation.path, before: previousContent, after: '' });
      outputs.push({
        action: 'delete',
        path: operation.path,
        before: previousContent,
        after: '',
        ...(backupBeforeRef ? { backupBeforeRef } : {}),
        additions: filediff.additions,
        deletions: filediff.deletions,
        status: filediff.status,
      });
      continue;
    }

    if (operation.type === 'move') {
      const previousContent = await fsp.readFile(operation.sourcePath, 'utf8');
      const backupBeforeRef = options?.beforeWriteBackup
        ? await options.beforeWriteBackup({
            filePath: operation.sourcePath,
            content: previousContent,
          })
        : undefined;
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
        ...(backupBeforeRef ? { backupBeforeRef } : {}),
        additions: filediff.additions,
        deletions: filediff.deletions,
        status: filediff.status,
      });
      continue;
    }

    const previousContent = await fsp.readFile(operation.path, 'utf8');
    const backupBeforeRef = options?.beforeWriteBackup
      ? await options.beforeWriteBackup({
          filePath: operation.path,
          content: previousContent,
        })
      : undefined;
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
      ...(backupBeforeRef ? { backupBeforeRef } : {}),
      additions: filediff.additions,
      deletions: filediff.deletions,
      status: filediff.status,
    });
  }

  return outputs;
}

export async function executeApplyPatch(
  input: z.infer<typeof applyPatchInputSchema>,
  options?: {
    beforeWriteBackup?: (input: {
      content: string;
      filePath: string;
    }) => Promise<FileBackupRef | undefined>;
    sessionId?: string;
  },
): Promise<z.infer<typeof applyPatchOutputSchema>> {
  if (!options?.sessionId) {
    throw new Error('patch requires session workspace context');
  }
  const planned = await planPatchText(input.patchText, options.sessionId);
  const files = await applyPlannedOperations(planned, options);

  const modifiedPaths = files.filter((f) => f.status !== 'deleted').map((f) => f.path);
  for (const filePath of modifiedPaths) {
    lspManager.touchFile(filePath, true).catch((_e: unknown) => undefined);
  }
  const diagnostics = await getPostWriteDiagnostics(modifiedPaths);

  return {
    success: true,
    files,
    diffs: files.map((file) => ({
      ...buildFileDiff({ file: file.path, before: file.before ?? '', after: file.after ?? '' }),
      ...(file.backupBeforeRef ? { backupBeforeRef: file.backupBeforeRef } : {}),
    })),
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

function buildApplyPatchPermissionScope(patchText: string): string {
  const digest = createHash('sha256').update(patchText).digest('hex').slice(0, 12);
  return `patch:${digest}`;
}

export const applyPatchToolDefinition: ToolDefinition<
  typeof applyPatchInputSchema,
  typeof applyPatchOutputSchema
> = {
  name: 'patch',
  description: APPLY_PATCH_DESCRIPTION,
  inputSchema: applyPatchInputSchema,
  outputSchema: applyPatchOutputSchema,
  timeout: 120000,
  execute: async () => {
    throw new Error('patch must execute through the gateway-managed sandbox path');
  },
};

export { buildApplyPatchPermissionScope };
