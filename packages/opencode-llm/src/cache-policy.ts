// Apply an `LLMRequest.cache` policy by injecting `CacheHint`s onto the parts
// the policy designates. Runs once at compile time, before the per-protocol
// body builder, so the existing inline-hint lowering path handles the rest.
//
// The default `"auto"` shape places breakpoints at the last tool definition,
// the first and last distinct system parts, and the conversation tail. This
// exposes reusable tool, base-agent, project, and session prefixes while
// advancing the tail after each tool result keeps recent conversation prefixes
// reusable during long agent runs.
//
// Manual `cache: CacheHint` placements on individual parts are preserved and
// count against the four-breakpoint budget; auto only fills remaining slots.
import { CacheHint, type CachePolicy, type CachePolicyObject } from './schema/options.js';
import { LLMRequest, Message, ToolDefinition, type ContentPart } from './schema/messages.js';
import { effortUpdate } from './effort-updates.js';

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: { tail: 1 },
};

const NONE: CachePolicyObject = {};
const BREAKPOINT_CAP = 4;

// Resolution rules:
//   - undefined   → "auto" — caching is on by default. The math favors it:
//                   Anthropic 5m-cache write is 1.25x base, read is 0.1x,
//                   so a single reuse within 5 minutes already wins.
//   - "auto"      → tools + first/last system + final message boundary.
//   - "none"      → no auto placement; manual `CacheHint`s still flow.
//   - object form → exactly what the caller asked for.
const resolve = (policy: CachePolicy | undefined): CachePolicyObject => {
  if (policy === undefined || policy === 'auto') return AUTO;
  if (policy === 'none') return NONE;
  return policy;
};

// Protocols whose wire format ignores inline cache markers (OpenAI's implicit
// prefix caching, Gemini's implicit + out-of-band CachedContent). Skip the
// whole policy pass for these — emitting hints would be harmless but pointless.
const RESPECTS_INLINE_HINTS = new Set([
  'alibaba-chat',
  'alibaba-messages',
  'anthropic-messages',
  'anthropic-compatible-messages',
  'bedrock-mantle-messages',
  'cloudflare-ai-gateway-messages',
  'google-vertex-messages',
  'meta-messages',
  'minimax-messages',
  'moonshot-messages',
  'vercel-ai-gateway-messages',
  'zai-coding-messages',
  'bedrock-converse',
  'openrouter',
  'digitalocean',
]);

// OpenRouter 与 Vercel AI Gateway 上除 Anthropic 与 Alibaba Qwen 之外的上游都不靠断点缓存。
// Gemini 只使用最后一个断点，因此会话尾断点在每步都会写入新缓存，成本高于不写。
// Qwen 忽略工具定义上的断点，其工具定义随 system 一起缓存。
const QWEN: CachePolicyObject = { system: true, messages: { tail: 1 } };
const gatewayPolicy = (modelID: string): CachePolicyObject => {
  // `~anthropic/claude-sonnet-latest` 这类 ID 是 OpenRouter 家族最新模型的别名。
  const id = modelID.replace(/^~/, '');
  if (id.startsWith('anthropic/')) return AUTO;
  if (id.startsWith('qwen/') || id.startsWith('alibaba/qwen')) return QWEN;
  return NONE;
};

const makeHint = (ttlSeconds: number | undefined): CacheHint =>
  ttlSeconds !== undefined
    ? new CacheHint({ type: 'ephemeral', ttlSeconds })
    : new CacheHint({ type: 'ephemeral' });

interface Budget {
  remaining: number;
}

const markLastTool = (
  tools: ReadonlyArray<ToolDefinition>,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<ToolDefinition> => {
  const target = tools[tools.length - 1];
  if (target === undefined) return tools;
  if (target.cache || budget.remaining === 0) return tools;
  budget.remaining -= 1;
  return [...tools.slice(0, -1), new ToolDefinition({ ...target, cache: hint })];
};

const countToolHints = (tools: ReadonlyArray<ToolDefinition>): number =>
  tools.reduce((count, tool) => count + (tool.cache === undefined ? 0 : 1), 0);

const markSystemBoundaries = (
  system: LLMRequest['system'],
  hint: CacheHint,
  budget: Budget,
): LLMRequest['system'] => {
  if (system.length === 0) return system;
  let changed = false;
  const next = system.map((part, index) => {
    if ((index !== 0 && index !== system.length - 1) || part.cache || budget.remaining === 0)
      return part;
    budget.remaining -= 1;
    changed = true;
    return { ...part, cache: hint };
  });
  return changed ? next : system;
};

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message['role']): number => {
  // findLastIndex polyfill for older TypeScript versions
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) return i;
  }
  return -1;
};

const lastTextContentIndex = (parts: ReadonlyArray<ContentPart>): number => {
  // findLastIndex polyfill for older TypeScript versions
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.type === 'text') return i;
  }
  return -1;
};

// Mark the last text part of `messages[index]`. If no text part exists, mark
// the last content part regardless of type — that's the breakpoint position
// in tool-result-only messages too.
const markMessageAt = (
  messages: ReadonlyArray<Message>,
  index: number,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages;
  const target = messages[index]!;
  if (target.content.length === 0) return messages;
  const lastTextIndex = lastTextContentIndex(target.content);
  const markAt = lastTextIndex >= 0 ? lastTextIndex : target.content.length - 1;
  const existing = target.content[markAt]!;
  if (('cache' in existing && existing.cache) || budget.remaining === 0) return messages;
  budget.remaining -= 1;
  const nextContent = target.content.map((part, i) =>
    i === markAt ? ({ ...part, cache: hint } as ContentPart) : part,
  );
  const next = new Message({ ...target, content: nextContent });
  // Single pass over `messages`, substituting the one updated entry. Long
  // conversations call this on every request, so avoid `.map()` here — its
  // closure dispatch and identity copies show up in profiling.
  const result = messages.slice();
  result[index] = next;
  return result;
};

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject['messages']>,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (messages.length === 0) return messages;
  if (strategy === 'latest-user-message')
    return markMessageAt(messages, lastIndexOfRole(messages, 'user'), hint, budget);
  if (strategy === 'latest-assistant')
    return markMessageAt(messages, lastIndexOfRole(messages, 'assistant'), hint, budget);
  // 会话尾策略：从末尾回退数满 `tail` 条「非 effort 更新」消息，再逐条落断点。
  // effort 更新标记不是真实对话内容，占位会让尾断点落在错误位置。
  let start = messages.length;
  let remaining = strategy.tail;
  while (remaining > 0 && start > 0) {
    start -= 1;
    if (effortUpdate(messages[start]!) === undefined) remaining -= 1;
  }
  let next = messages;
  for (let i = start; i < messages.length; i++) {
    if (effortUpdate(messages[i]!) === undefined) next = markMessageAt(next, i, hint, budget);
  }
  return next;
};

const countHints = (request: LLMRequest) =>
  countToolHints(request.tools) +
  request.system.reduce((count, part) => count + (part.cache === undefined ? 0 : 1), 0) +
  request.messages.reduce(
    (count, message) =>
      count +
      message.content.reduce(
        (contentCount, part) =>
          contentCount + ('cache' in part && part.cache !== undefined ? 1 : 0),
        0,
      ),
    0,
  );

export const applyCachePolicy = (request: LLMRequest): LLMRequest => {
  const policy = selectPolicy(request);
  if (!policy.tools && !policy.system && !policy.messages) return request;

  const hint = makeHint(policy.ttlSeconds);
  const budget: Budget = { remaining: Math.max(0, BREAKPOINT_CAP - countHints(request)) };
  const tools = policy.tools ? markLastTool(request.tools, hint, budget) : request.tools;
  const system = policy.system
    ? markSystemBoundaries(request.system, hint, budget)
    : request.system;
  const messages = policy.messages
    ? markMessages(request.messages, policy.messages, hint, budget)
    : request.messages;

  if (tools === request.tools && system === request.system && messages === request.messages)
    return request;
  return LLMRequest.update(request, { tools, system, messages });
};

// 显式声明的缓存格式覆盖路由白名单与模型名启发式。
const selectPolicy = (request: LLMRequest): CachePolicyObject => {
  const format = request.model.compatibility?.cacheFormat;
  const route = request.model.route.id;
  const auto = request.cache === undefined || request.cache === 'auto';
  if (format === 'alibaba') return auto ? QWEN : { ...resolve(request.cache), tools: false };
  if (format === 'anthropic') return resolve(request.cache);
  if (!RESPECTS_INLINE_HINTS.has(route)) return NONE;
  if (!auto) return resolve(request.cache);
  if (route === 'openrouter' || route === 'vercel-ai-gateway-messages')
    return gatewayPolicy(request.model.id);
  if (route === 'alibaba-chat')
    return request.model.id.toLowerCase().startsWith('qwen') ? QWEN : NONE;
  return AUTO;
};
