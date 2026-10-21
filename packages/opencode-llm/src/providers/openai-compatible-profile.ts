/**
 * OpenAI 兼容供应商的默认端点表（对齐上游 `providers/*.ts` 的 `baseURL`）。
 *
 * 只收录「端点本身是 OpenAI 兼容协议」的供应商：`minimax`（`/anthropic/v1`）、
 * `mistral`（原生协议）走各自协议；`cloudflare-*` 与 `google-vertex*` 的 URL 含
 * 账号 / 项目变量，无法作为静态默认值。
 */
export interface OpenAICompatibleProfile {
  readonly provider: string;
  readonly baseURL: string;
}

export const profiles = {
  baseten: { provider: 'baseten', baseURL: 'https://inference.baseten.co/v1' },
  cerebras: { provider: 'cerebras', baseURL: 'https://api.cerebras.ai/v1' },
  cohere: { provider: 'cohere', baseURL: 'https://api.cohere.ai/compatibility/v1' },
  deepinfra: { provider: 'deepinfra', baseURL: 'https://api.deepinfra.com/v1/openai' },
  deepseek: { provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1' },
  digitalocean: { provider: 'digitalocean', baseURL: 'https://inference.do-ai.run/v1' },
  fireworks: { provider: 'fireworks', baseURL: 'https://api.fireworks.ai/inference/v1' },
  groq: { provider: 'groq', baseURL: 'https://api.groq.com/openai/v1' },
  meta: { provider: 'meta', baseURL: 'https://api.meta.ai/v1' },
  moonshot: { provider: 'moonshot', baseURL: 'https://api.moonshot.ai/v1' },
  opencode: { provider: 'opencode', baseURL: 'https://opencode.ai/inference/v1' },
  openrouter: { provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1' },
  togetherai: { provider: 'togetherai', baseURL: 'https://api.together.xyz/v1' },
  'typesafe-ai': { provider: 'typesafe-ai', baseURL: 'https://api.typesafe.ai/v1' },
  venice: { provider: 'venice', baseURL: 'https://api.venice.ai/api/v1' },
  'vercel-ai-gateway': {
    provider: 'vercel-ai-gateway',
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  },
  xai: { provider: 'xai', baseURL: 'https://api.x.ai/v1' },
  zai: { provider: 'zai', baseURL: 'https://api.z.ai/api/paas/v4' },
  'zai-coding-plan': {
    provider: 'zai-coding-plan',
    baseURL: 'https://api.z.ai/api/coding/paas/v4',
  },
} as const satisfies Record<string, OpenAICompatibleProfile>;

export const byProvider: Record<string, OpenAICompatibleProfile> = Object.fromEntries(
  Object.values(profiles).map((profile) => [profile.provider, profile]),
);
