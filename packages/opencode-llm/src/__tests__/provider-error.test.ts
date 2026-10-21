/**
 * 上游错误识别契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-12：上下文超限措辞矩阵（Cloudflare Workers AI / Amazon Nova /
 * DeepInfra / Novita / Together TGI / Z.ai）、输出上限排除项，以及 AWS
 * `Message` 与 RFC 9457 `detail` 错误体布局的消息提取。
 */

import { describe, it, expect } from 'vitest';
import {
  isContextOverflow,
  providerErrorText,
  providerFailureClassification,
} from '../provider-error.js';

describe('isContextOverflow 措辞矩阵', () => {
  it.each([
    ['Cloudflare Workers AI', 'exceeded this model context window limit'],
    ['Amazon Nova', 'The number of input tokens exceeds maximum length'],
    ['DeepInfra', 'requested input length 9000 exceeds maximum input length 8192'],
    ['Novita（省略 token 计数）', "input is longer than the model's context length"],
    ['Together / HF TGI', '`inputs` tokens + `max_new_tokens` must be <= 8192'],
    ['Z.ai 英文', 'Prompt too long'],
    ['Z.ai 中文', 'Prompt 超长'],
    ['range of input length', 'range of input length should be 1 to 8192'],
    ['既有措辞', 'model_context_window_exceeded'],
    ['无响应体的 400/413', '413 (no body)'],
  ])('%s 判定为上下文超限', (_label, message) => {
    expect(isContextOverflow(message)).toBe(true);
  });

  it.each([
    ['限流前缀', 'Throttling error: slow down'],
    ['rate limit', 'rate limit exceeded, retry later'],
    ['too many requests', 'too many requests'],
    ['Cohere 输出上限（压缩无法修复）', 'too many tokens: max_tokens must be less than 4096'],
  ])('%s 判定为非上下文超限', (_label, message) => {
    expect(isContextOverflow(message)).toBe(false);
  });
});

describe('providerErrorText 错误体布局', () => {
  it('支持 AWS 风格的首字母大写 Message', () => {
    expect(providerErrorText('{"Message":"quota exceeded"}')).toBe('quota exceeded');
  });

  it('支持 AWS 风格的嵌套 Message', () => {
    expect(providerErrorText('{"Message":{"message":"nested reason"}}')).toBe('nested reason');
  });

  it('支持 RFC 9457 problem details 的 detail', () => {
    expect(providerErrorText('{"detail":"invalid field"}')).toBe('invalid field');
  });

  it('仍然解析转义的非 ASCII 文本', () => {
    expect(providerErrorText('{"Message":"\\u4F60\\u597D"}')).toBe('你好');
  });

  it('无法解析时回退为去除转义的原文', () => {
    expect(providerErrorText('{not json')).toBe('{not json');
  });
});

/**
 * `payload-too-large` 与 `context-overflow` 的区分（对齐上游 `provider-error.ts`）。
 *
 * 两类失败都表现为 400/413，但修复手段不同：上下文超限压缩有效，请求体过大压缩无效。
 * 顺序必须是「先上下文、后请求体」——413 也可能携带明确的长上下文线索。
 */
describe('providerFailureClassification', () => {
  it('`request entity too large` 归请求体过大（不再误判为上下文超限）', () => {
    expect(providerFailureClassification('request entity too large')).toBe('payload-too-large');
    expect(isContextOverflow('request entity too large')).toBe(false);
  });

  it('`payload too large` / `request too large` 归请求体过大', () => {
    expect(providerFailureClassification('Payload too large')).toBe('payload-too-large');
    expect(providerFailureClassification('Request too large')).toBe('payload-too-large');
  });

  it('`request_too_large`（下划线，OpenAI 错误码）仍归上下文超限', () => {
    expect(providerFailureClassification('request_too_large')).toBe('context-overflow');
  });

  it('HTTP 413 归请求体过大', () => {
    expect(providerFailureClassification('something went wrong', 413)).toBe('payload-too-large');
  });

  it('413 但报文明确是上下文超限时，仍归上下文超限（顺序优先）', () => {
    expect(providerFailureClassification('context length exceeded', 413)).toBe('context-overflow');
  });

  it('上下文超限措辞归上下文超限', () => {
    expect(providerFailureClassification('prompt is too long')).toBe('context-overflow');
    expect(providerFailureClassification('maximum context length is 8192 tokens')).toBe(
      'context-overflow',
    );
  });

  it('无匹配线索返回 undefined', () => {
    expect(providerFailureClassification('connection reset')).toBeUndefined();
    expect(providerFailureClassification('', 500)).toBeUndefined();
  });
});
