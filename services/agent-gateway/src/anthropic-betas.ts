/**
 * Anthropic beta header 构建器。
 *
 * 参考 claude-code restored-src/src/constants/betas.ts + utils/betas.ts 模式：
 * - beta 字符串按模型和功能动态组装
 * - 通过 `anthropic-beta` HTTP 头以逗号分隔发送
 * - 支持 `ANTHROPIC_BETAS` 环境变量自定义追加
 */

// ─── Beta Header Constants ───

/** Prompt caching scope — 扩展缓存范围至全局/组织级 */
export const PROMPT_CACHING_SCOPE_BETA_HEADER = 'prompt-caching-scope-2026-01-05';

/** Interleaved thinking — 交错思考 */
export const INTERLEAVED_THINKING_BETA_HEADER = 'interleaved-thinking-2025-05-14';

/** Fine-grained tool streaming — 细粒度工具流式 */
export const FINE_GRAINED_TOOL_STREAMING_BETA_HEADER = 'fine-grained-tool-streaming-2025-05-14';

// ─── Beta Assembly ───

export interface AnthropicBetaInput {
  model: string;
  supportsThinking?: boolean;
}

/**
 * 为 Anthropic 请求组装 beta header 列表。
 *
 * 策略（参考 opencode + claude-code getAllModelBetas）：
 *   1. 始终包含 prompt-caching-scope（启用缓存范围扩展）
 *   2. 如果模型支持 thinking，添加 interleaved-thinking + fine-grained-tool-streaming
 *   3. 读取 ANTHROPIC_BETAS 环境变量追加自定义 beta
 */
export function buildAnthropicBetas(input: AnthropicBetaInput): string[] {
  const betas: string[] = [];

  betas.push(PROMPT_CACHING_SCOPE_BETA_HEADER);

  if (input.supportsThinking && !isHaikuModel(input.model)) {
    betas.push(INTERLEAVED_THINKING_BETA_HEADER);
    betas.push(FINE_GRAINED_TOOL_STREAMING_BETA_HEADER);
  }

  const envBetas = globalThis.process?.env['ANTHROPIC_BETAS'];
  if (envBetas) {
    const extraBetas = envBetas
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !betas.includes(b));
    betas.push(...extraBetas);
  }

  return betas;
}

/**
 * 将 beta 列表合并为 `anthropic-beta` HTTP 头值。
 */
export function formatAnthropicBetaHeader(betas: string[]): string {
  return betas.join(',');
}

// ─── Helpers ───

function isHaikuModel(model: string): boolean {
  return model.toLowerCase().includes('haiku');
}
