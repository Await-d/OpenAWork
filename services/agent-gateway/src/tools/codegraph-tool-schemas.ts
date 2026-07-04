import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { buildDefinitionFallback } from './codegraph-tool-workspace.js';

export const CODEGRAPH_TOOL_NAMES = [
  'codegraph_status',
  'codegraph_index',
  'codegraph_search',
  'codegraph_node',
  'codegraph_callers',
  'codegraph_impact',
] as const;

export type CodegraphToolName = (typeof CODEGRAPH_TOOL_NAMES)[number];

const MAX_RESULT_LIMIT = 100;
const DEFAULT_RESULT_LIMIT = 20;
const DEFAULT_IMPACT_DEPTH = 2;
const MAX_IMPACT_DEPTH = 5;

const workspaceRootInputSchema = z.object({
  workspaceRoot: z.string().min(1).optional(),
});

export const codegraphStatusInputSchema = workspaceRootInputSchema;

export const codegraphIndexInputSchema = workspaceRootInputSchema.extend({
  path: z.string().min(1).optional(),
  force: z.boolean().optional().default(false),
});

export const codegraphSearchInputSchema = workspaceRootInputSchema.extend({
  query: z.string().min(1).max(240),
  kind: z
    .enum(['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'])
    .optional(),
  limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).optional().default(DEFAULT_RESULT_LIMIT),
});

export const codegraphNodeInputSchema = workspaceRootInputSchema
  .extend({
    symbol: z.string().min(1).max(240).optional(),
    file: z.string().min(1).max(800).optional(),
    includeCode: z.boolean().optional().default(false),
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    symbolsOnly: z.boolean().optional().default(false),
  })
  .refine((value) => Boolean(value.symbol ?? value.file), {
    message: 'Either symbol or file is required',
  });

export const codegraphCallersInputSchema = workspaceRootInputSchema.extend({
  symbol: z.string().min(1).max(240),
  file: z.string().min(1).max(800).optional(),
  limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).optional().default(DEFAULT_RESULT_LIMIT),
});

export const codegraphImpactInputSchema = workspaceRootInputSchema.extend({
  symbol: z.string().min(1).max(240),
  file: z.string().min(1).max(800).optional(),
  maxDepth: z.number().int().min(1).max(MAX_IMPACT_DEPTH).optional().default(DEFAULT_IMPACT_DEPTH),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESULT_LIMIT)
    .optional()
    .default(DEFAULT_RESULT_LIMIT),
});

export const boundedDegradedOutputSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'not_available']),
  workspaceRoot: z.string(),
  cachePath: z.string(),
  freshness: z.object({
    status: z.enum(['not_indexed', 'stale', 'unknown']),
    staleFiles: z.array(z.string()),
  }),
  degradedReason: z.string(),
  nextAction: z.string(),
});

type BoundedDegradedOutputSchema = typeof boundedDegradedOutputSchema;

function defineCodegraphTool<TInput extends z.ZodTypeAny>(input: {
  name: CodegraphToolName;
  description: string;
  inputSchema: TInput;
  timeout: number;
}): ToolDefinition<TInput, BoundedDegradedOutputSchema> {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: boundedDegradedOutputSchema,
    timeout: input.timeout,
    execute: async (rawInput: z.infer<TInput>) =>
      buildDefinitionFallback(readWorkspaceRoot(rawInput)),
  };
}

function readWorkspaceRoot(value: unknown): string | undefined {
  const parsed = workspaceRootInputSchema.safeParse(value);
  return parsed.success ? parsed.data.workspaceRoot : undefined;
}

export const CODEGRAPH_TOOL_DEFINITIONS = [
  defineCodegraphTool({
    name: 'codegraph_status',
    description:
      '查看当前工作区 codegraph 缓存状态、启动自检/依赖健康、stale 文件和降级原因。codegraph 是发现缓存，不是正确性证明。',
    inputSchema: codegraphStatusInputSchema,
    timeout: 5000,
  }),
  defineCodegraphTool({
    name: 'codegraph_index',
    description:
      '为当前工作区触发 codegraph 索引。只允许写入 gateway data dir 下的 codegraph 缓存，不会在项目根创建 .codegraph。',
    inputSchema: codegraphIndexInputSchema,
    timeout: 30000,
  }),
  defineCodegraphTool({
    name: 'codegraph_search',
    description:
      '按名称搜索当前工作区 codegraph 符号索引，返回 bounded 结果和 freshness metadata；不可用时回退 LSP/grep/read。',
    inputSchema: codegraphSearchInputSchema,
    timeout: 10000,
  }),
  defineCodegraphTool({
    name: 'codegraph_node',
    description:
      '查看当前工作区内某个符号或文件的 codegraph 节点、关系和 bounded 源码片段；遇到 stale 时用 read/LSP 确认。',
    inputSchema: codegraphNodeInputSchema,
    timeout: 10000,
  }),
  defineCodegraphTool({
    name: 'codegraph_callers',
    description:
      '查看当前工作区中调用/引用某符号的 bounded codegraph 边；结果是发现缓存，编辑前仍需 fallback 确认 stale 文件。',
    inputSchema: codegraphCallersInputSchema,
    timeout: 10000,
  }),
  defineCodegraphTool({
    name: 'codegraph_impact',
    description:
      '从某符号出发做 bounded impact traversal，用于变更影响面发现；maxDepth/maxResults 有硬上限。',
    inputSchema: codegraphImpactInputSchema,
    timeout: 10000,
  }),
] as const;

export const CODEGRAPH_TOOL_NAME_SET = new Set<string>(CODEGRAPH_TOOL_NAMES);
