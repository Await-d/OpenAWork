/**
 * OpenCode Go 会话亲和头注入。
 *
 * 上游(`https://opencode.ai/zen/go/v1`)自 2026-09-05 起强制要求每个请求携带
 * 稳定的 `x-opencode-session`，用于路由亲和与提示缓存；缺失会直接返回
 * HTTP 400 `MissingSessionID`。该值必须「按会话稳定、按会话唯一」，因此它不能
 * 走 `RequestOverrides.headers` 这类静态配置通道，而应由 `sessionId` 在出站
 * 边界动态派生。
 *
 * 注入点刻意选在上游装配的最外层(`run-upstream-generate` / `stream-runner`)，
 * 位于协议分发之前，所以 `chat_completions` / `responses` / `anthropic_messages`
 * 三条 wire 会被同时覆盖——OpenCode Go 同一个 baseUrl 下三种协议按模型混用，
 * 只在某一条协议路径上补头是常见的踩坑点。
 */
import { createHash } from 'node:crypto';
import { isOpencodeGoProvider } from '../../provider/opencode-go.js';

/** 上游要求的会话亲和头。 */
export const OPENCODE_SESSION_HEADER = 'x-opencode-session';

/**
 * 固定盐：仅用于避免把内部会话 UUID 原文透给第三方网关。上游不解析该值，
 * 只要求稳定且唯一，所以无需持久化、也无需轮换。
 */
const SESSION_HASH_SALT = 'openAwork:opencode-go:v1';

/**
 * 由会话 ID 派生稳定的亲和值：同一会话的所有轮次得到同一个值。
 *
 * 没有会话上下文时(如标题生成等辅助调用)返回 `undefined`——此时宁可不注入，
 * 也绝不退化成随机值，否则每次请求都是新值，等价于没有做亲和。
 */
export function opencodeSessionAffinityValue(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim();
  if (!trimmed) {
    return undefined;
  }
  return createHash('sha256').update(`${SESSION_HASH_SALT}:${trimmed}`).digest('hex').slice(0, 32);
}

const hasHeaderIgnoreCase = (headers: Record<string, string> | undefined, name: string): boolean =>
  headers !== undefined && Object.keys(headers).some((key) => key.toLowerCase() === name);

/**
 * 在现有 headers 上补齐会话亲和头。
 *
 * 非 OpenCode Go 请求、缺少 `sessionId`、或调用方已显式提供该头(大小写不敏感)
 * 时原样返回，保证既不污染其它 provider，也不覆盖调用方的显式意图。
 */
export function withOpencodeSessionHeader(
  headers: Record<string, string> | undefined,
  input: {
    readonly providerType?: string | undefined;
    readonly baseUrl?: string | undefined;
    readonly sessionId?: string | undefined;
  },
): Record<string, string> | undefined {
  if (!isOpencodeGoProvider(input) || hasHeaderIgnoreCase(headers, OPENCODE_SESSION_HEADER)) {
    return headers;
  }
  const value = opencodeSessionAffinityValue(input.sessionId);
  if (value === undefined) {
    return headers;
  }
  return { ...(headers ?? {}), [OPENCODE_SESSION_HEADER]: value };
}
