/**
 * MultiEdit Tool
 *
 * Ported from opencode's tool/multiedit.ts.
 * Applies multiple sequential edit operations to a single file in one tool call.
 * Each edit uses the same fuzzy replacer chain as the single edit tool.
 */

import { promises as fsp } from 'node:fs';
import type { ToolDefinition } from '@openAwork/agent-core';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import { z } from 'zod';
import { buildFileDiff, fileDiffSchema } from './file-diff-format.js';
import { getPostWriteDiagnostics, postWriteDiagnosticSchema } from './lsp-tools.js';
import { captureBeforeWriteBackup } from '../session/session-file-backup-store.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { lspManager } from '../lsp/router.js';
import {
  fuzzyReplace,
  normalizeLineEndings,
  detectLineEnding,
  convertToLineEnding,
} from './edit-replacers.js';
import { formatFileAfterWrite } from './post-write-formatter.js';
import { getSessionWorkspaceRoot } from '../workspace/workspace-safety.js';
import { getProjectWideDiagnostics } from './project-diagnostics.js';

const EDIT_ERROR_RECOVERY_SUFFIX =
  'STOP: Read the file immediately to see its actual current state before retrying the edit. Your assumption about the file content was wrong.';

const multiEditInputSchema = z.object({
  filePath: z.string().min(1),
  edits: z.array(
    z.object({
      oldString: z.string(),
      newString: z.string(),
      replaceAll: z.boolean().optional().default(false),
    }),
  ),
});

const multiEditOutputSchema = z.object({
  before: z.string(),
  after: z.string(),
  filediff: fileDiffSchema,
  success: z.literal(true),
  path: z.string(),
  editsApplied: z.number().int().min(1),
  diagnostics: z.array(postWriteDiagnosticSchema).optional(),
  projectDiagnostics: z
    .array(
      z.object({
        file: z.string(),
        severity: z.string(),
        line: z.number().int(),
        message: z.string(),
      }),
    )
    .optional(),
});

function assertEditableWorkspacePath(filePath: string): string {
  const safePath = validateWorkspacePath(filePath);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${filePath}`);
  }
  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: file "${safePath}" is protected by agentignore rules`);
  }
  return safePath;
}

export function createMultiEditTool(
  sessionId: string,
  userId: string,
  requestId: string,
  toolCallId = 'multi_edit',
): ToolDefinition<typeof multiEditInputSchema, typeof multiEditOutputSchema> {
  return {
    name: 'multi_edit',
    description:
      'Apply multiple sequential edits to a single file. Each edit replaces oldString with newString using fuzzy matching. Edits are applied in order; each edit sees the result of the previous one. Read the file first.',
    inputSchema: multiEditInputSchema,
    outputSchema: multiEditOutputSchema,
    timeout: 15000,
    execute: async (input) => {
      const safePath = assertEditableWorkspacePath(input.filePath);

      if (!input.edits || input.edits.length === 0) {
        throw new Error('At least one edit is required.');
      }

      let currentContent: string;
      try {
        currentContent = await fsp.readFile(safePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`File not found: ${safePath}`);
        }
        throw error;
      }

      const originalContent = currentContent;

      const backupBeforeRef = await captureBeforeWriteBackup({
        sessionId,
        userId,
        requestId,
        toolCallId,
        toolName: 'multi_edit',
        filePath: safePath,
        content: currentContent,
        kind: 'before_write',
      });

      let appliedCount = 0;
      for (const edit of input.edits) {
        if (edit.oldString === edit.newString) {
          throw new Error(
            `Edit #${appliedCount + 1}: newString must be different from oldString. ${EDIT_ERROR_RECOVERY_SUFFIX}`,
          );
        }

        const ending = detectLineEnding(currentContent);
        const normalizedOld = convertToLineEnding(normalizeLineEndings(edit.oldString), ending);
        const normalizedNew = convertToLineEnding(normalizeLineEndings(edit.newString), ending);

        try {
          currentContent = fuzzyReplace(
            currentContent,
            normalizedOld,
            normalizedNew,
            edit.replaceAll,
          );
        } catch (err) {
          throw new Error(
            `Edit #${appliedCount + 1}: ${err instanceof Error ? err.message : String(err)} ${EDIT_ERROR_RECOVERY_SUFFIX}`,
          );
        }

        appliedCount++;
      }

      await fsp.writeFile(safePath, currentContent, 'utf8');
      try {
        const wsRoot = getSessionWorkspaceRoot(sessionId);
        if (wsRoot) await formatFileAfterWrite(safePath, wsRoot);
      } catch {
        /* best-effort formatting */
      }
      try {
        await lspManager.touchFile(safePath, true);
      } catch {
        /* ignore */
      }

      const diagnostics = await getPostWriteDiagnostics([safePath]);
      const projDiags = await getProjectWideDiagnostics(true, [safePath]);

      return {
        before: originalContent,
        after: currentContent,
        filediff: {
          ...buildFileDiff({ file: safePath, before: originalContent, after: currentContent }),
          backupBeforeRef,
        },
        success: true,
        path: safePath,
        editsApplied: appliedCount,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        projectDiagnostics: projDiags.length > 0 ? projDiags : undefined,
      };
    },
  };
}
