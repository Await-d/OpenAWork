import type { ToolDefinition } from '@openAwork/agent-core';
import { webSearchTool } from '@openAwork/agent-core';
import { promises as fsp } from 'node:fs';
import { validateWorkspacePath } from './workspace-paths.js';
import { readTool, writeTool } from './workspace-tools.js';
import { z } from 'zod';

export const websearchTool: ToolDefinition<
  typeof webSearchTool.inputSchema,
  typeof webSearchTool.outputSchema
> = {
  ...webSearchTool,
  name: 'websearch',
  description:
    'Search the web for current information, news, and live facts. When searching for recent information, include the current year in the query.',
};

const legacyReadInputSchema = z.object({
  filePath: z.string().min(1),
  offset: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const legacyWriteInputSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
});

async function runLegacyRead(
  input: z.infer<typeof legacyReadInputSchema>,
  _signal: AbortSignal,
): Promise<z.infer<typeof readTool.outputSchema>> {
  const safePath = validateWorkspacePath(input.filePath);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${input.filePath}`);
  }

  const stats = await fsp.stat(safePath);
  const offset = input.offset ?? 1;
  const limit = input.limit ?? 2000;

  if (stats.isDirectory()) {
    const entries = (await fsp.readdir(safePath)).sort((left, right) => left.localeCompare(right));
    const start = offset - 1;
    const slice = entries.slice(start, start + limit);
    return {
      path: safePath,
      content: slice.join('\n'),
      truncated: start + slice.length < entries.length,
    };
  }

  const lines = (await fsp.readFile(safePath, 'utf8')).split('\n');
  const start = offset - 1;
  const slice = lines.slice(start, start + limit);
  return {
    path: safePath,
    content: slice.map((line, index) => `${offset + index}: ${line}`).join('\n'),
    truncated: start + slice.length < lines.length,
  };
}

export const fileReadTool: ToolDefinition<
  typeof legacyReadInputSchema,
  typeof readTool.outputSchema
> = {
  name: 'file_read',
  description: 'Legacy alias for read. Read a UTF-8 workspace file by path.',
  inputSchema: legacyReadInputSchema,
  outputSchema: readTool.outputSchema,
  timeout: readTool.timeout,
  execute: runLegacyRead,
};

export const readFileTool: ToolDefinition<
  typeof legacyReadInputSchema,
  typeof readTool.outputSchema
> = {
  name: 'read_file',
  description: 'Legacy alias for read. Read a UTF-8 workspace file by path.',
  inputSchema: legacyReadInputSchema,
  outputSchema: readTool.outputSchema,
  timeout: readTool.timeout,
  execute: runLegacyRead,
};

export const fileWriteTool: ToolDefinition<
  typeof legacyWriteInputSchema,
  typeof writeTool.outputSchema
> = {
  name: 'file_write',
  description: 'Legacy alias for write. Write UTF-8 content into a workspace file.',
  inputSchema: legacyWriteInputSchema,
  outputSchema: writeTool.outputSchema,
  timeout: writeTool.timeout,
  execute: async (input, signal) =>
    writeTool.execute({ path: input.filePath, content: input.content }, signal),
};

export const writeFileTool: ToolDefinition<
  typeof legacyWriteInputSchema,
  typeof writeTool.outputSchema
> = {
  name: 'write_file',
  description: 'Legacy alias for write. Write UTF-8 content into a workspace file.',
  inputSchema: legacyWriteInputSchema,
  outputSchema: writeTool.outputSchema,
  timeout: writeTool.timeout,
  execute: async (input, signal) =>
    writeTool.execute({ path: input.filePath, content: input.content }, signal),
};
