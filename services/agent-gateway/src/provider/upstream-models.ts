/**
 * 拉取 provider 上游「实际可用模型清单」——对一个已配置的接口(provider)
 * 发起 `GET {baseUrl}/models`,把上游真实暴露的模型 id 拿回来,供用户在设置页
 * 一键同步进当前接口的模型列表。
 *
 * 设计要点:
 *   - 复用 `resolveModelRouteFromProvider`(解析 apiKey / baseUrl / 协议 /
 *     requestOverrides.headers),与真实聊天、连通性自检走同一套 provider 工厂,
 *     确保「看到的上游」与「实际调用的上游」一致。
 *   - 兼容两类上游:OpenAI 兼容(chat_completions / responses,`Authorization:
 *     Bearer`)与 Anthropic(`x-api-key` + `anthropic-version`)——响应体都取
 *     `data[]` 数组,条目字段做宽松映射(id / name / display_name)。
 *   - 永不抛出:把任何失败(网络 / 认证 / 限流 / 超时 / 端点缺失)归类为结构化
 *     结果,交由路由层透传给前端面板显示。
 *   - 只读:该模块不写库、不改配置,合并进模型列表由调用方决定。
 */

import type { AIModelConfig, AIProvider } from '@openAwork/agent-core';
import { resolveModelRouteFromProvider } from './model-router.js';
import { classifyUpstreamError } from './retry-classify.js';

/** 拉取上游模型清单的状态分类,前端据此用不同颜色/文案展示。 */
export type UpstreamModelsStatus =
  'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'unsupported' | 'error';

/**
 * 本地同名模型可迁移的元数据(上下文 / 输出上限 / 价格 / 能力 / 推理选项)。
 *
 * 上游 `/models` 端点通常**只返回模型 id**,不含上下文与能力;因此拉取后用
 * 本地已配置或内置目录里同名模型的这些字段补齐,避免同步进来的模型「没有上下文
 * 大小、没有能力标记」而不可用。
 */
export interface LocalModelMetadata {
  contextWindow?: number;
  maxOutputTokens?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  supportsImageGeneration?: boolean;
  supportsImageGeneration4K?: boolean;
  reasoningOptions?: { type: string; values?: string[] }[];
}

/** 上游暴露的单个模型条目(仅保留同步所需字段)。 */
export interface UpstreamModelInfo {
  id: string;
  /** 上游给出的显示名(Anthropic 为 display_name);缺省时回退为 id。 */
  label: string;
  /** 归属方(OpenAI 兼容的 owned_by),便于展示来源。 */
  ownedBy?: string;
  /** 由本地同名模型迁移而来的元数据(上游未提供这些字段)。 */
  meta?: LocalModelMetadata;
}

export interface UpstreamModelsResult {
  ok: boolean;
  status: UpstreamModelsStatus;
  /** 面向用户的中文提示。 */
  message: string;
  /** 上游返回的模型清单(ok 时才有意义)。 */
  models: UpstreamModelInfo[];
  /** 实际命中的上游协议。 */
  protocol?: string;
  /** 实际请求的 baseUrl(便于用户核对自己填的地址)。 */
  baseUrl?: string;
  /** 端到端耗时(毫秒)。 */
  latencyMs?: number;
}

export interface FetchUpstreamModelsInput {
  provider: AIProvider;
  /** wall-clock 超时(毫秒),默认 20s。 */
  timeoutMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const MAX_MODELS = 2_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** 把 baseUrl 规整到 `/models` 端点(避免重复追加,兼容已带 `/models` 的地址)。 */
function buildModelsUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return '/models';
  }
  if (/\/models$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/models`;
}

/** 从上游响应体里宽松提取模型数组(OpenAI / Anthropic 均为 `data[]`)。 */
function extractModelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  for (const key of ['data', 'models', 'result']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

/**
 * 把上游条目映射为 `UpstreamModelInfo`,过滤无效项并按 id 去重。
 * 去重按**大小写不敏感**判定,避免上游同时给出 `gpt-4o` / `GPT-4o` 造成重复项。
 */
function mapModelEntries(entries: unknown[]): UpstreamModelInfo[] {
  const seen = new Set<string>();
  const models: UpstreamModelInfo[] = [];
  for (const entry of entries) {
    if (models.length >= MAX_MODELS) {
      break;
    }
    if (typeof entry === 'string') {
      const id = entry.trim();
      const key = normalizeModelIdKey(id);
      if (id.length === 0 || seen.has(key)) continue;
      seen.add(key);
      models.push({ id, label: id });
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const id = readString(record, 'id') ?? readString(record, 'model');
    if (!id) continue;
    const key = normalizeModelIdKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    const label =
      readString(record, 'display_name') ??
      readString(record, 'name') ??
      readString(record, 'label') ??
      id;
    const ownedBy = readString(record, 'owned_by') ?? readString(record, 'owner');
    models.push({ id, label, ...(ownedBy ? { ownedBy } : {}) });
  }
  return models;
}

/** 依据协议拼装上游鉴权/内容头(provider 级自定义 headers 优先保留)。 */
function buildRequestHeaders(input: {
  apiKey: string;
  protocol: string;
  overrides?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(input.overrides ?? {}),
  };
  if (input.protocol === 'anthropic_messages') {
    headers['x-api-key'] = input.apiKey;
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${input.apiKey}`;
  }
  return headers;
}

function classifyStatus(status: number): UpstreamModelsStatus {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status === 404 || status === 405 || status === 501) return 'not_found';
  return 'error';
}

function describeHttpError(status: number, protocol: string, bodyText: string): string {
  const detail = bodyText.trim().slice(0, 200);
  if (status === 401 || status === 403) {
    return '鉴权失败:API Key 无效或无权读取模型列表,请检查 Key。';
  }
  if (status === 429) {
    return '触发限流(rate limit):凭证有效但请求过于频繁,稍后再试。';
  }
  if (status === 404 || status === 405 || status === 501) {
    const hint =
      protocol === 'anthropic_messages'
        ? 'Anthropic 端点通常形如 `{base}/v1/models`'
        : 'OpenAI 兼容端点通常形如 `{base}/v1/models`';
    return `该接口未提供模型列表端点(HTTP ${status}):能连上服务器,但 \`/models\` 路径不存在。${hint},请核对 Base URL 是否带对了 \`/v1\`。${
      detail ? ` 上游返回:${detail}` : ''
    }`;
  }
  return `读取上游模型列表失败(HTTP ${status})。${detail ? ` 上游返回:${detail}` : ''}`;
}

/** 从单个模型配置里挑出可迁移元数据,未定义的字段不写入(避免覆盖本地已有取值)。 */
function pickModelMetadata(model: AIModelConfig): LocalModelMetadata {
  const meta: LocalModelMetadata = {};
  if (typeof model.contextWindow === 'number') meta.contextWindow = model.contextWindow;
  if (typeof model.maxOutputTokens === 'number') meta.maxOutputTokens = model.maxOutputTokens;
  if (typeof model.inputPricePerMillion === 'number') {
    meta.inputPricePerMillion = model.inputPricePerMillion;
  }
  if (typeof model.outputPricePerMillion === 'number') {
    meta.outputPricePerMillion = model.outputPricePerMillion;
  }
  if (typeof model.supportsTools === 'boolean') meta.supportsTools = model.supportsTools;
  if (typeof model.supportsVision === 'boolean') meta.supportsVision = model.supportsVision;
  if (typeof model.supportsThinking === 'boolean') meta.supportsThinking = model.supportsThinking;
  if (typeof model.supportsImageGeneration === 'boolean') {
    meta.supportsImageGeneration = model.supportsImageGeneration;
  }
  if (typeof model.supportsImageGeneration4K === 'boolean') {
    meta.supportsImageGeneration4K = model.supportsImageGeneration4K;
  }
  if (Array.isArray(model.reasoningOptions) && model.reasoningOptions.length > 0) {
    meta.reasoningOptions = model.reasoningOptions;
  }
  return meta;
}

/**
 * 模型 id 的匹配键:上游与本地的大小写 / 首尾空白差异不应阻止「同名模型」匹配
 * (例如上游返回 `GPT-4o`、本地配置为 `gpt-4o`)。**仅用于匹配**,写回时保留原始 id。
 */
export function normalizeModelIdKey(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * 构建「model id → 本地元数据」索引,用于把上游裸 id 补全为可用的模型配置。
 *
 * `providerGroups` 按**优先级从高到低**传入:例如 `[用户已配置的 providers, 内置目录]`。
 * 低优先级先写入,高优先级后写入并逐字段覆盖(仅覆盖已定义字段),从而保证
 * 用户显式配置 > 内置目录。索引键为 {@link normalizeModelIdKey}(大小写不敏感)。
 */
export function buildLocalModelMetadataIndex(
  providerGroups: AIProvider[][],
): Map<string, LocalModelMetadata> {
  const index = new Map<string, LocalModelMetadata>();
  for (const providers of [...providerGroups].reverse()) {
    for (const provider of providers) {
      for (const model of provider.defaultModels) {
        const picked = pickModelMetadata(model);
        if (Object.keys(picked).length === 0) {
          continue;
        }
        const key = normalizeModelIdKey(model.id);
        const existing = index.get(key);
        index.set(key, existing ? { ...existing, ...picked } : picked);
      }
    }
  }
  return index;
}

/** 用本地同名模型的元数据补齐上游返回的模型条目(无匹配则原样保留)。 */
export function enrichUpstreamModels(
  models: UpstreamModelInfo[],
  index: Map<string, LocalModelMetadata>,
): UpstreamModelInfo[] {
  return models.map((model) => {
    const meta = index.get(normalizeModelIdKey(model.id));
    if (!meta || Object.keys(meta).length === 0) {
      return model;
    }
    return { ...model, meta };
  });
}

/**
 * 对单个 provider 拉取上游模型清单。永不抛出。
 */
export async function fetchUpstreamModels(
  input: FetchUpstreamModelsInput,
): Promise<UpstreamModelsResult> {
  // 传一个哨兵 modelId:该函数只用它做协议/路由解析,不要求模型存在于列表。
  const route = resolveModelRouteFromProvider(input.provider, 'default', {
    maxTokens: 1,
    temperature: 0,
  });
  const protocol = route.upstreamProtocol;
  const modelsUrl = buildModelsUrl(route.apiBaseUrl);

  if (!route.apiKey) {
    return {
      ok: false,
      status: 'auth_error',
      message: '未提供 API Key:请先填写该 provider 的 API Key(或配置对应环境变量)。',
      models: [],
      protocol,
      baseUrl: route.apiBaseUrl,
    };
  }

  const timeoutMs =
    typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  const startedAt = Date.now();
  try {
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: buildRequestHeaders({
        apiKey: route.apiKey,
        protocol,
        overrides: route.requestOverrides.headers,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return {
        ok: false,
        status: classifyStatus(response.status),
        message: describeHttpError(response.status, protocol, bodyText),
        models: [],
        protocol,
        baseUrl: route.apiBaseUrl,
        latencyMs,
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const models = mapModelEntries(extractModelEntries(payload));
    if (models.length === 0) {
      return {
        ok: true,
        status: 'ok',
        message: '上游返回的模型列表为空,请确认该接口是否暴露了可用模型。',
        models: [],
        protocol,
        baseUrl: route.apiBaseUrl,
        latencyMs,
      };
    }

    return {
      ok: true,
      status: 'ok',
      message: `已从上游拉取到 ${models.length} 个模型。`,
      models,
      protocol,
      baseUrl: route.apiBaseUrl,
      latencyMs,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startedAt;
    if (timedOut) {
      return {
        ok: false,
        status: 'timeout',
        message: '连接超时:上游在限定时间内没有响应,请检查网络或 Base URL 是否可达。',
        models: [],
        protocol,
        baseUrl: route.apiBaseUrl,
        latencyMs,
      };
    }
    const classification = classifyUpstreamError(error);
    if (classification.category === 'network') {
      return {
        ok: false,
        status: 'error',
        message: '无法连接上游:请检查网络与 Base URL 是否可达。',
        models: [],
        protocol,
        baseUrl: route.apiBaseUrl,
        latencyMs,
      };
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 'error',
      message: `拉取上游模型列表失败:${rawMessage.slice(0, 300)}`,
      models: [],
      protocol,
      baseUrl: route.apiBaseUrl,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
