/**
 * OpenAI ServiceTier 档位契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-22：`scale` / `fast` / `ultrafast` 三档必须被接受并透传；
 * 未知档位仍然丢弃（本地保留白名单校验，而不是照搬上游的「任意字符串都收」）。
 */

import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import * as OpenAIResponses from '../openai-responses.js';
import { serviceTier } from '../utils/openai-options.js';

const request = (tier: string) =>
  LLM.request({
    model: OpenAIResponses.route.model({ id: 'gpt-5' }),
    prompt: 'hi',
    providerOptions: { openai: { serviceTier: tier } },
  });

describe('OpenAI serviceTier', () => {
  it.each(['auto', 'default', 'flex', 'priority', 'scale', 'fast', 'ultrafast'])(
    '透传已知档位 %s',
    (tier) => {
      expect(serviceTier(request(tier))).toBe(tier);
    },
  );

  it('未知档位不转发', () => {
    expect(serviceTier(request('not-a-tier'))).toBeUndefined();
  });
});
