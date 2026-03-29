import { promises as fsp } from 'node:fs';
import type { ToolDefinition } from '@openAwork/agent-core';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import { z } from 'zod';
import { buildFileDiff, fileDiffSchema } from './file-diff-format.js';
import { sqliteAll } from './db.js';
import { lspManager } from './lsp/router.js';
import { validateWorkspacePath } from './workspace-paths.js';

const editInputSchema = z.object({
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
});

interface AuditLogRow {
  input_json: string | null;
  output_json: string | null;
}

function assertEditableWorkspaceFilePath(filePath: string): string {
  const safePath = validateWorkspacePath(filePath);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${filePath}`);
  }

  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: file "${safePath}" is protected by agentignore rules`);
  }

  return safePath;
}

function countOccurrences(content: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;
  while (true) {
    const foundAt = content.indexOf(search, startIndex);
    if (foundAt === -1) {
      return count;
    }
    count += 1;
    startIndex = foundAt + search.length;
  }
}

function hasReadEvidenceForPath(sessionId: string, filePath: string): boolean {
  const rows = sqliteAll<AuditLogRow>(
    `SELECT input_json, output_json
     FROM audit_logs
     WHERE session_id = ?
       AND is_error = 0
       AND tool_name IN ('read', 'workspace_read_file')
     ORDER BY id DESC
     LIMIT 50`,
    [sessionId],
  );

  return rows.some((row) => {
    try {
      const input =
        typeof row.input_json === 'string'
          ? (JSON.parse(row.input_json) as Record<string, unknown>)
          : null;
      const output =
        typeof row.output_json === 'string'
          ? (JSON.parse(row.output_json) as Record<string, unknown>)
          : null;
      return (
        input?.['path'] === filePath ||
        input?.['filePath'] === filePath ||
        output?.['path'] === filePath
      );
    } catch {
      return false;
    }
  });
}

async function touchEditedFile(filePath: string): Promise<void> {
  try {
    await lspManager.touchFile(filePath, false);
  } catch {
    return;
  }
}

export function createEditTool(
  sessionId: string,
): ToolDefinition<typeof editInputSchema, typeof editOutputSchema> {
  return {
    name: 'edit',
    description:
      'Edit a workspace file by replacing oldString with newString. Read the file first, match oldString exactly, and use replaceAll only when every occurrence should change.',
    inputSchema: editInputSchema,
    outputSchema: editOutputSchema,
    timeout: 10000,
    execute: async (input) => {
      const safePath = assertEditableWorkspaceFilePath(input.filePath);
      if (input.oldString === input.newString) {
        throw new Error('newString must be different from oldString');
      }

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
        await fsp.writeFile(safePath, input.newString, 'utf8');
        await touchEditedFile(safePath);
        return {
          before: currentContent,
          after: input.newString,
          filediff: buildFileDiff({
            file: safePath,
            before: currentContent,
            after: input.newString,
          }),
          success: true,
          path: safePath,
          replacements: 1,
          created: !exists,
        };
      }

      if (!exists) {
        throw new Error(`File not found: ${safePath}`);
      }

      if (!hasReadEvidenceForPath(sessionId, safePath)) {
        throw new Error(`You must read file "${safePath}" before editing it`);
      }

      const occurrences = countOccurrences(currentContent, input.oldString);
      if (occurrences === 0) {
        throw new Error('oldString not found in file');
      }
      if (occurrences > 1 && input.replaceAll !== true) {
        throw new Error(
          'oldString appears multiple times in the file; provide more context or set replaceAll to true',
        );
      }

      const nextContent = input.replaceAll
        ? currentContent.split(input.oldString).join(input.newString)
        : currentContent.replace(input.oldString, input.newString);

      await fsp.writeFile(safePath, nextContent, 'utf8');
      await touchEditedFile(safePath);

      return {
        before: currentContent,
        after: nextContent,
        filediff: buildFileDiff({ file: safePath, before: currentContent, after: nextContent }),
        success: true,
        path: safePath,
        replacements: input.replaceAll ? occurrences : 1,
        created: false,
      };
    },
  };
}
