import { describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { ReasoningEffort } from '../ids.js';
import * as Gemini from '../../protocols/gemini.js';
import { ToolSchemaProjection } from '../../protocols/utils/tool-schema.js';
import { Model } from '../index.js';

describe('P1-7 ReasoningEffort 放宽', () => {
  it('接受已知档位', () => {
    expect(Schema.decodeUnknownSync(ReasoningEffort)('xhigh')).toBe('xhigh');
  });

  it('接受供应商自定义档位（不再被解码期拒绝）', () => {
    expect(Schema.decodeUnknownSync(ReasoningEffort)('ultra-turbo')).toBe('ultra-turbo');
  });
});

describe('P1-6 协议级 sanitizer 作为路由默认档', () => {
  it('Gemini 协议的模型即使 id 不含 gemini 也按 Gemini 规则投影', () => {
    // 直接读路由上的 sanitizer：应由 Protocol.sanitizer 兜底填充。
    const model = Gemini.route.model({ id: 'custom-deploy' });

    expect(model.route.sanitizer).toBe('gemini');
    const projected = ToolSchemaProjection.modelCompatibility(
      { not: { type: 'null' }, properties: { a: { type: 'string' } }, additionalProperties: false },
      model,
    );
    expect(projected).not.toHaveProperty('additionalProperties');
  });

  it('路由显式声明的规则族优先于协议默认', () => {
    const route = Gemini.route.with({ sanitizer: 'moonshot' });

    expect(route.sanitizer).toBe('moonshot');
  });
});
