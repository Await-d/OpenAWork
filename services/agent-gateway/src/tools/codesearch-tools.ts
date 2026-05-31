import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import {
  readResponseTextWithLimit,
  resolveHttpBodyLimitBytes,
} from '../infra/http-body-limit.js';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

// Memory bound for the Exa code-search response. The 30s tool timeout caps
// wall-clock but NOT memory — a fast or oversized SSE stream could buffer
// unboundedly and OOM the gateway. Cap the read like webfetch / skill content
// (§0.85/§0.86); override via OPENAWORK_CODESEARCH_MAX_BYTES, 0 disables.
const DEFAULT_CODESEARCH_MAX_BYTES = 8 * 1024 * 1024;
function resolveCodesearchMaxResponseBytes(): number {
  return resolveHttpBodyLimitBytes(
    'OPENAWORK_CODESEARCH_MAX_BYTES',
    DEFAULT_CODESEARCH_MAX_BYTES,
  );
}

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
      const errBody = await readResponseTextWithLimit(
        response,
        resolveCodesearchMaxResponseBytes(),
      ).catch(() => '');
      throw new Error(`Code search error (${response.status}): ${errBody}`);
    }

    const raw = await readResponseTextWithLimit(response, resolveCodesearchMaxResponseBytes());
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
