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
    .describe(
      'Search query to find relevant context for APIs, libraries, SDKs, or real-world code usage.',
    ),
  tokensNum: z
    .number()
    .int()
    .min(1000)
    .max(50000)
    .optional()
    .default(5000)
    .describe('Number of tokens to return from Exa code context search.'),
});

export const codesearchToolDefinition: ToolDefinition<typeof codeSearchInputSchema, z.ZodString> = {
  name: 'codesearch',
  description:
    'Search real-world code examples and API usage context through Exa code context search.',
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
