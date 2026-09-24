import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import * as AnthropicMessages from '../anthropic-messages.js';

/**
 * Anthropic SDK 顶层透传字段对齐（对齐 opencode 参考库）：
 * `service_tier` / `metadata` / `container` / `inference_geo` /
 * `cache_control` / `output_config`，双拼写（snake_case 优先）。
 */

const bodyFor = async (providerOptions: Record<string, unknown>) => {
  const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
  const request = LLM.request({
    model,
    prompt: 'hello',
    providerOptions: { anthropic: providerOptions },
  });
  return Effect.runPromise(AnthropicMessages.protocol.body.from(request));
};

describe('Anthropic 顶层 provider options 透传', () => {
  it('service_tier 双拼写透传', async () => {
    const snake = await bodyFor({ service_tier: 'standard_only' });
    expect(snake.service_tier).toBe('standard_only');

    const camel = await bodyFor({ serviceTier: 'auto' });
    expect(camel.service_tier).toBe('auto');
  });

  it('metadata / inference_geo 透传', async () => {
    const body = await bodyFor({
      metadata: { user_id: 'user-1' },
      inference_geo: 'us',
    });

    expect(body.metadata).toEqual({ user_id: 'user-1' });
    expect(body.inference_geo).toBe('us');
  });

  it('container 支持字符串与对象两种形态', async () => {
    const byId = await bodyFor({ container: 'container-1' });
    expect(byId.container).toBe('container-1');

    const byParams = await bodyFor({
      container: { id: 'container-2', skills: [{ type: 'skill', name: 'demo' }] },
    });
    expect(byParams.container).toEqual({
      id: 'container-2',
      skills: [{ type: 'skill', name: 'demo' }],
    });
  });

  it('cache_control 透传到顶层（双拼写）', async () => {
    const snake = await bodyFor({ cache_control: { type: 'ephemeral', ttl: '1h' } });
    expect(snake.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    const camel = await bodyFor({ cacheControl: { type: 'ephemeral' } });
    expect(camel.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('output_config 透传 effort / format', async () => {
    const body = await bodyFor({
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
    });

    expect(body.output_config).toEqual({
      effort: 'high',
      format: { type: 'json_schema', schema: { type: 'object' } },
    });
  });

  it('非法 cache_control 在边界报错', async () => {
    await expect(bodyFor({ cache_control: { type: 'wrong' } })).rejects.toThrow(/cache_control/);
  });
});
