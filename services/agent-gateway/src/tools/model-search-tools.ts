/**
 * `models` 工具：搜索当前账号已配置的 Provider 下的可用模型。
 *
 * 数据源以用户已配置的 provider 为准（`getCatalog` 的 providers，已由
 * models.dev 同步补充元数据）。输出按 provider 分组，当前会话自身所在
 * provider 的模型优先，并按 model family 去重（同一 family 只保留最新版本）。
 */
import type { ToolDefinition, AIModelConfig } from '@openAwork/agent-core';
import { z } from 'zod';
import { getCatalog } from '../provider/provider-catalog.js';

const modelSearchInputSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe('要在模型名称与 ID 中搜索的文本，按空白拆分为多个关键词（全部命中才算匹配）。'),
  provider: z
    .string()
    .max(200)
    .optional()
    .describe('按 Provider ID 或名称过滤；建议先试自身所在 Provider。'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('返回的模型数量上限，默认 20。'),
  offset: z.number().int().min(0).optional().default(0).describe('分页偏移量，默认 0。'),
});

export type ModelSearchInput = z.infer<typeof modelSearchInputSchema>;

export interface ModelSearchModelEntry {
  /** providerID/modelID 组合引用。 */
  id: string;
  name: string;
  /** 发布日期（Unix 毫秒时间戳）；未知时为 0。 */
  released: number;
  /** 该模型可用的变体 id 列表（当前目录未建模变体，恒为空数组）。 */
  variants: string[];
  /** 以美元 / 百万 token 计的定价。 */
  cost: Array<{
    input: number;
    output: number;
    cache: { read: number; write: number };
  }>;
  status: 'active' | 'deprecated';
}

export interface ModelSearchProviderGroup {
  id: string;
  name: string;
  /** 同 provider 下按（family 去重后的）发布时间倒序排列。 */
  models: ModelSearchModelEntry[];
}

export interface ModelSearchOutput {
  /** 匹配到的模型按 provider 分组；当前会话自身 provider 排在最前。 */
  providers: ModelSearchProviderGroup[];
  /** 全部匹配（去重后）的模型总数。 */
  total: number;
  /** 下一页偏移量；没有更多时为 null。 */
  next: number | null;
}

interface ModelCandidate {
  providerId: string;
  providerName: string;
  model: AIModelConfig;
}

function parseReleased(releaseDate: string | undefined): number {
  if (!releaseDate) {
    return 0;
  }
  const parsed = Date.parse(releaseDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toModelEntry(candidate: ModelCandidate): ModelSearchModelEntry {
  const model = candidate.model;
  return {
    id: `${candidate.providerId}/${model.id}`,
    name: model.label,
    released: parseReleased(model.releaseDate),
    variants: [],
    cost: [
      {
        input: model.inputPricePerMillion ?? 0,
        output: model.outputPricePerMillion ?? 0,
        cache: {
          read: model.cacheReadPricePerMillion ?? 0,
          write: model.cacheWritePricePerMillion ?? 0,
        },
      },
    ],
    status: model.enabled === false ? 'deprecated' : 'active',
  };
}

/**
 * 收集用户已启用 provider 下的全部模型候选。禁用 provider 整体跳过，但保留
 * provider 内被禁用的模型（以 `status: 'deprecated'` 暴露，便于模型判断不可用原因）。
 */
function collectCandidates(
  providers: Awaited<ReturnType<typeof getCatalog>>['providers'],
): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }
    for (const model of provider.defaultModels) {
      candidates.push({ providerId: provider.id, providerName: provider.name, model });
    }
  }
  return candidates;
}

function matchesProviderFilter(
  candidate: ModelCandidate,
  providerFilter: string | undefined,
): boolean {
  if (providerFilter === undefined) {
    return true;
  }
  return (
    candidate.providerId.toLowerCase() === providerFilter ||
    candidate.providerName.toLowerCase() === providerFilter
  );
}

function matchesQuery(candidate: ModelCandidate, terms: readonly string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const text =
    `${candidate.providerId}/${candidate.model.id} ${candidate.model.label}`.toLowerCase();
  return terms.every((term) => text.includes(term));
}

/**
 * 按 family 去重：同一 provider 下相同 family 只保留排序后的首个（即最新版本）。
 * `family` 缺失的模型不做去重，与上游语义一致。
 */
function dedupeByFamily(candidates: ModelCandidate[]): ModelCandidate[] {
  return candidates.filter((candidate, index) => {
    const family = candidate.model.family;
    if (!family) {
      return true;
    }
    return (
      candidates.findIndex(
        (other) => other.providerId === candidate.providerId && other.model.family === family,
      ) === index
    );
  });
}

function groupByProvider(page: readonly ModelCandidate[]): ModelSearchProviderGroup[] {
  const groups = new Map<string, ModelSearchProviderGroup>();
  for (const candidate of page) {
    const existing = groups.get(candidate.providerId);
    if (existing) {
      existing.models.push(toModelEntry(candidate));
      continue;
    }
    groups.set(candidate.providerId, {
      id: candidate.providerId,
      name: candidate.providerName,
      models: [toModelEntry(candidate)],
    });
  }
  return [...groups.values()];
}

export async function runModelSearchTool(
  userId: string,
  input: ModelSearchInput,
  options: { ownProviderId?: string | undefined } = {},
): Promise<ModelSearchOutput> {
  const catalog = await getCatalog(userId);
  const ownProviderId = options.ownProviderId;
  const terms = input.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const providerFilter = input.provider?.toLowerCase();

  const matching = collectCandidates(catalog.providers)
    .filter((candidate) => matchesProviderFilter(candidate, providerFilter))
    .filter((candidate) => matchesQuery(candidate, terms))
    .sort((left, right) => {
      // 当前会话自身 provider 优先，其次按 provider id 字典序，最后按发布时间倒序。
      const ownDiff =
        Number(right.providerId === ownProviderId) - Number(left.providerId === ownProviderId);
      if (ownDiff !== 0) {
        return ownDiff;
      }
      const providerDiff = left.providerId.localeCompare(right.providerId);
      if (providerDiff !== 0) {
        return providerDiff;
      }
      return parseReleased(right.model.releaseDate) - parseReleased(left.model.releaseDate);
    });

  const deduped = dedupeByFamily(matching);
  const total = deduped.length;
  const page = deduped.slice(input.offset, input.offset + input.limit);

  return {
    providers: groupByProvider(page),
    total,
    next: input.offset + input.limit < total ? input.offset + input.limit : null,
  };
}

export const modelSearchToolDefinition: ToolDefinition<
  typeof modelSearchInputSchema,
  z.ZodUnknown
> = {
  name: 'models',
  description:
    '搜索当前账号可用的模型。用于把用户提到的模型名转成精确的 provider/model 引用，或在派发子代理前确认可用模型；建议先确认自身所在的 Provider。',
  inputSchema: modelSearchInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('models must execute through the gateway-managed sandbox path');
  },
};
