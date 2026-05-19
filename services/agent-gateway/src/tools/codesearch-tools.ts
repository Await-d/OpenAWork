import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

interface ExaCodeSearchResponse {
  result?: {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
}

const codeSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('搜索关键词：用于查找 API、库、SDK 或真实代码使用示例的上下文。'),
  tokensNum: z
    .number()
    .int()
    .min(1000)
    .max(50000)
    .optional()
    .default(5000)
    .describe('从 Exa code context 搜索返回的 token 数量。'),
});

export const codesearchToolDefinition: ToolDefinition<typeof codeSearchInputSchema, z.ZodString> = {
  name: 'codesearch',
  description: '通过 Exa code context 搜索查找真实代码示例与 API 使用上下文。',
  inputSchema: codeSearchInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input, signal) => {
    const response = await fetch(EXA_MCP_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_code_context_exa',
          arguments: {
            query: input.query,
            tokensNum: input.tokensNum,
          },
        },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Code search error (${response.status}): ${await response.text()}`);
    }

    const raw = await response.text();
    const line = raw
      .split('\n')
      .find((entry) => entry.startsWith('data: ') && entry.includes('"content"'));
    if (!line) {
      return 'No code snippets or documentation found. Please try a different query.';
    }

    const payload = JSON.parse(line.slice('data: '.length)) as ExaCodeSearchResponse;
    const text = payload.result?.content
      ?.find((item) => typeof item.text === 'string')
      ?.text?.trim();
    return text && text.length > 0
      ? text
      : 'No code snippets or documentation found. Please try a different query.';
  },
};
