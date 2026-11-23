import { promises as fsp } from 'node:fs';
import type { ToolDefinition } from '@openAwork/agent-core';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import { formatAgentIgnoreDenial } from '../workspace/agentignore-denial.js';
import { z } from 'zod';
import { buildFileDiff, fileDiffSchema } from './file-diff-format.js';
import { hasFileReadEvidence } from '../session/session-file-reads.js';
import { lspManager } from '../lsp/router.js';
import { getPostWriteDiagnostics, postWriteDiagnosticSchema } from './lsp-tools.js';
import { captureBeforeWriteBackup } from '../session/session-file-backup-store.js';
import {
  fuzzyReplace,
  normalizeLineEndings,
  detectLineEnding,
  convertToLineEnding,
} from './edit-replacers.js';
import { formatFileAfterWrite } from './post-write-formatter.js';
import {
  assertRegularFileIfExists,
  assertSessionWorkspacePath,
  getSessionWorkspaceRoot,
} from '../workspace/workspace-safety.js';
import { getProjectWideDiagnostics } from './project-diagnostics.js';

// Edit error recovery suffix (oh-my-opencode editErrorRecovery pattern)
// Injected into edit tool error messages to guide the LLM to read the file
// before retrying, preventing repeated edit failures.
const EDIT_ERROR_RECOVERY_SUFFIX =
  'STOP: Read the file immediately to see its actual current state before retrying the edit. Your assumption about the file content was wrong.';

export const editInputSchema = z.object({
  filePath: z.string().min(1),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional().default(false),
});

const editOutputSchema = z.object({
  after: z.string(),
  before: z.string(),
  filediff: fileDiffSchema,
  success: z.literal(true),
  path: z.string(),
  replacements: z.number().int().min(1),
  created: z.boolean(),
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

function assertEditableWorkspaceFilePath(sessionId: string, filePath: string): string {
  const safePath = assertSessionWorkspacePath({ path: filePath, sessionId });
  // 写语义用 `shouldProtect`（跳过 `.gitignore`）：`.gitignore` 只表达「不进版本库」，
  // 不应阻断编辑。真正需要保护的是内置敏感模式与 `.agentignore`。
  if (defaultIgnoreManager.shouldProtect(safePath)) {
    throw new Error(formatAgentIgnoreDenial('file', safePath));
  }

  return safePath;
}

export function hasReadEvidenceForPath(sessionId: string, filePath: string): boolean {
  // 证据口径见 `session/session-file-reads.ts`：专用表精确记账（read 成功即
  // upsert）+ `audit_logs` 旧会话兜底。此前只扫审计日志最近 50 条，工具密集
  // 会话里必然滚出窗口，导致「读过却报 must read」。
  return hasFileReadEvidence(sessionId, filePath);
}

async function touchEditedFile(filePath: string): Promise<void> {
  try {
    await lspManager.touchFile(filePath, true);
  } catch {
    return;
  }
}

export function createEditTool(
  sessionId: string,
  userId: string,
  requestId: string,
  toolCallId = 'edit',
): ToolDefinition<typeof editInputSchema, typeof editOutputSchema> {
  return {
    name: 'edit',
    description:
      'Edit a workspace file by replacing oldString with newString. Read the file first, match oldString exactly, and use replaceAll only when every occurrence should change.',
    inputSchema: editInputSchema,
    outputSchema: editOutputSchema,
    timeout: 10000,
    execute: async (input) => {
      const safePath = assertEditableWorkspaceFilePath(sessionId, input.filePath);
      if (input.oldString === input.newString) {
        throw new Error(
          'newString must be different from oldString. ' + EDIT_ERROR_RECOVERY_SUFFIX,
        );
      }

      await assertRegularFileIfExists(safePath);

      let exists = true;
      let currentContent = '';
      try {
        currentContent = await fsp.readFile(safePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          exists = false;
        } else {
          throw error;
        }
      }

      if (input.oldString.length === 0) {
        const backupBeforeRef = exists
          ? await captureBeforeWriteBackup({
              sessionId,
              userId,
              requestId,
              toolCallId,
              toolName: 'edit',
              filePath: safePath,
              content: currentContent,
              kind: 'before_write',
            })
          : undefined;
        await fsp.writeFile(safePath, input.newString, 'utf8');
        try {
          const wsRoot = getSessionWorkspaceRoot(sessionId);
          if (wsRoot) await formatFileAfterWrite(safePath, wsRoot);
        } catch {
          /* best-effort formatting */
        }
        await touchEditedFile(safePath);
        const diagnostics = await getPostWriteDiagnostics([safePath]);
        const projDiags = await getProjectWideDiagnostics(true, [safePath]);
        return {
          before: currentContent,
          after: input.newString,
          filediff: {
            ...buildFileDiff({
              file: safePath,
              before: currentContent,
              after: input.newString,
            }),
            ...(backupBeforeRef ? { backupBeforeRef } : {}),
          },
          success: true,
          path: safePath,
          replacements: 1,
          created: !exists,
          diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
          projectDiagnostics: projDiags.length > 0 ? projDiags : undefined,
        };
      }

      if (!exists) {
        throw new Error(`File not found: ${safePath}`);
      }

      if (!hasReadEvidenceForPath(sessionId, safePath)) {
        throw new Error(`You must read file "${safePath}" before editing it`);
      }

      // Use fuzzy replacer chain (ported from opencode) to handle minor whitespace,
      // indentation, escape, and boundary mismatches from the LLM.
      const ending = detectLineEnding(currentContent);
      const normalizedOld = convertToLineEnding(normalizeLineEndings(input.oldString), ending);
      const normalizedNew = convertToLineEnding(normalizeLineEndings(input.newString), ending);

      let nextContent: string;
      let replacementCount: number;
      try {
        const result = fuzzyReplace(currentContent, normalizedOld, normalizedNew, input.replaceAll);
        nextContent = result.content;
        replacementCount = result.replacements;
      } catch (err) {
        throw new Error(
          (err instanceof Error ? err.message : String(err)) + ' ' + EDIT_ERROR_RECOVERY_SUFFIX,
        );
      }

      const backupBeforeRef = await captureBeforeWriteBackup({
        sessionId,
        userId,
        requestId,
        toolCallId,
        toolName: 'edit',
        filePath: safePath,
        content: currentContent,
        kind: 'before_write',
      });
      await fsp.writeFile(safePath, nextContent, 'utf8');
      try {
        const wsRoot = getSessionWorkspaceRoot(sessionId);
        if (wsRoot) await formatFileAfterWrite(safePath, wsRoot);
      } catch {
        /* best-effort formatting */
      }
      await touchEditedFile(safePath);
      const diagnostics = await getPostWriteDiagnostics([safePath]);
      const projDiags = await getProjectWideDiagnostics(true, [safePath]);

      return {
        before: currentContent,
        after: nextContent,
        filediff: {
          ...buildFileDiff({ file: safePath, before: currentContent, after: nextContent }),
          backupBeforeRef,
        },
        success: true,
        path: safePath,
        replacements: replacementCount,
        created: false,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        projectDiagnostics: projDiags.length > 0 ? projDiags : undefined,
      };
    },
  };
}
