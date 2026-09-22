import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { LLMRequest } from '../../schema/index.js';
import { ProviderShared } from '../shared.js';
import { BedrockMedia } from '../utils/bedrock-media.js';
import { GeminiToolSchema } from '../utils/gemini-tool-schema.js';
import { OpenAIResponses } from '../openai-responses.js';
import * as OpenAIOptions from '../utils/openai-options.js';

const makeRequest = (providerOptions?: Record<string, Record<string, unknown>>) =>
  new LLMRequest({
    model: OpenAIResponses.route.model({ id: 'gpt-4.1' }),
    system: [],
    messages: [],
    tools: [],
    ...(providerOptions === undefined ? {} : { providerOptions }),
  });

describe('协议 utils 恢复', () => {
  it('promptCacheKey 超过 64 字符时安全截断', () => {
    const key = 'x'.repeat(100);
    const request = makeRequest({ openai: { promptCacheKey: key } });

    const value = OpenAIOptions.promptCacheKey(request);
    expect(value).toHaveLength(64);
    expect(value).toBe('x'.repeat(64));
  });

  it('gemini 工具 schema 把 type 数组展开为 anyOf 并标记 nullable', () => {
    const converted = GeminiToolSchema.convert({
      type: 'object',
      properties: {
        maybe: { type: ['string', 'null'] },
        choice: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    });

    const properties = converted?.properties as Record<string, Record<string, unknown>>;
    expect(properties.maybe).toMatchObject({ nullable: true, anyOf: [{ type: 'string' }] });
    expect(properties.choice).toMatchObject({ nullable: true, type: 'string' });
  });

  it('bedrock 文档标签在同一请求内唯一', async () => {
    const bytes = Buffer.from('hello').toString('base64');
    const names = new Set<string>();
    const first = await Effect.runPromise(
      BedrockMedia.lower(
        { type: 'media', mediaType: 'text/plain', data: bytes, filename: 'report.txt' },
        names,
      ),
    );
    const second = await Effect.runPromise(
      BedrockMedia.lower(
        { type: 'media', mediaType: 'text/plain', data: bytes, filename: 'report.txt' },
        names,
      ),
    );

    expect(first.document?.name).toBe('report');
    expect(second.document?.name).toBe('report 2');
  });

  it('parseJson 失败时保留底层异常为 cause', async () => {
    const error = await Effect.runPromise(
      Effect.flip(ProviderShared.parseJson('test-route', '{not json', 'bad payload')),
    );

    expect(error.reason._tag).toBe('InvalidProviderOutput');
    const cause = error.reason._tag === 'InvalidProviderOutput' ? error.reason.cause : undefined;
    expect(cause).toBeDefined();
    expect(typeof (cause as { message?: unknown }).message).toBe('string');
  });

  it('incompleteStreamError 带 incomplete-stream 分类', () => {
    const error = ProviderShared.incompleteStreamError('openai-chat');
    expect(error.reason._tag).toBe('InvalidProviderOutput');
    expect(error.reason._tag === 'InvalidProviderOutput' && error.reason.classification).toBe(
      'incomplete-stream',
    );
  });
});
