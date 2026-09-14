/**
 * OpenCode Go 平台事实的单一来源：provider 类型、端点域名、模型 → 上游协议映射。
 *
 * 端点表见 https://opencode.ai/docs/go/#endpoints —— OpenCode Go 在同一个
 * baseUrl 下按模型混用三种协议(`/responses`、`/messages`、`/chat/completions`)。
 * 协议路由(provider plugins)与会话亲和头(v2-runtime)都从这里取值，避免在各处
 * 复制模型清单。
 */
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';

export const OPENCODE_GO_PROVIDER_TYPE = 'opencode-go';
export const OPENCODE_GO_HOSTNAME = 'opencode.ai';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

/** 走 `/responses`(`@ai-sdk/openai`)的模型。 */
const RESPONSES_MODELS: ReadonlySet<string> = new Set([
  'grok-4.6',
  'gpt-5.6-luna',
  'muse-spark-1.3-contributor',
  'muse-spark-1.2-contributor',
]);

/** 走 `/messages`(`@ai-sdk/anthropic`)的模型。 */
const ANTHROPIC_MESSAGES_MODELS: ReadonlySet<string> = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
]);

/**
 * 解析某模型在 OpenCode Go 上应使用的上游协议。
 * 未知模型一律回落到 `chat_completions`(端点表里的多数派)。
 */
export function resolveOpencodeGoProtocol(modelId: string): UpstreamProtocol {
  const id = modelId.trim().toLowerCase();
  if (RESPONSES_MODELS.has(id) || id.startsWith('muse-spark-') || id.startsWith('grok-')) {
    return 'responses';
  }
  if (ANTHROPIC_MESSAGES_MODELS.has(id) || id.startsWith('minimax-') || id.startsWith('qwen3.')) {
    return 'anthropic_messages';
  }
  return 'chat_completions';
}

const hostnameOf = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

/** 判定某 baseUrl 是否指向 OpenCode 端点。 */
export function isOpencodeGoEndpoint(value: string | undefined): boolean {
  return hostnameOf(value) === OPENCODE_GO_HOSTNAME;
}

/**
 * 判定一次出站请求/一个 provider 是否属于 OpenCode Go。
 * 同时认 provider 类型与 baseUrl 域名，覆盖「custom + OpenCode 端点」的接入方式。
 */
export function isOpencodeGoProvider(input: {
  readonly providerType?: string | undefined;
  readonly baseUrl?: string | undefined;
}): boolean {
  if (input.providerType?.trim().toLowerCase() === OPENCODE_GO_PROVIDER_TYPE) {
    return true;
  }
  return isOpencodeGoEndpoint(input.baseUrl);
}
