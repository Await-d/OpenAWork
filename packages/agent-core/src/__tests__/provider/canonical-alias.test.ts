import { describe, expect, it } from 'vitest';
import {
  applyCanonicalModelAliases,
  buildCanonicalAliasIndex,
  deriveCanonicalLab,
  isOfficialProviderHost,
  resolveCanonicalModelId,
} from '../../provider/canonical-alias.js';
import type { CanonicalModelsData } from '../../provider/canonical-models.js';
import type { AIModelConfig } from '../../provider/types.js';

const canonical: CanonicalModelsData = {
  'deepseek/deepseek-v4.1-flash': {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
  },
  'deepseek/deepseek-v4-flash': { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  'deepseek/deepseek-v4-pro': { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  'google/gemini-3-pro-image-preview': {
    id: 'google/gemini-3-pro-image-preview',
    name: 'Nano Banana Pro Preview',
  },
  'google/gemini-3-pro-image': { id: 'google/gemini-3-pro-image', name: 'Nano Banana Pro' },
};

const index = buildCanonicalAliasIndex(canonical);

const model = (id: string, label: string): AIModelConfig =>
  ({ id, label, enabled: true }) as AIModelConfig;

describe('isOfficialProviderHost', () => {
  it('host 相同视为官方，不同或无法解析时不改写', () => {
    expect(isOfficialProviderHost('https://api.deepseek.com/v1', 'https://api.deepseek.com')).toBe(
      true,
    );
    expect(isOfficialProviderHost('https://relay.example.com/v1', 'https://api.deepseek.com')).toBe(
      false,
    );
    expect(isOfficialProviderHost('', 'https://api.deepseek.com')).toBe(true);
  });
});

describe('deriveCanonicalLab', () => {
  it('按精确 id 命中数取多数 lab', () => {
    expect(deriveCanonicalLab(index, ['deepseek-v4-flash', 'deepseek-v4-pro'])).toBe('deepseek');
  });

  it('无任何命中时返回 null', () => {
    expect(deriveCanonicalLab(index, ['some-unknown-id'])).toBeNull();
  });
});

describe('resolveCanonicalModelId', () => {
  it('别名在 lab 内按 name 唯一命中时改写为规范 id', () => {
    expect(
      resolveCanonicalModelId(index, 'deepseek', model('deepseek-flash', 'DeepSeek V4.1 Flash')),
    ).toBe('deepseek-v4.1-flash');
  });

  it('本身就是规范 id 时不改写（preview 与 GA 同名场景）', () => {
    expect(
      resolveCanonicalModelId(
        index,
        'google',
        model('gemini-3-pro-image-preview', 'Nano Banana Pro'),
      ),
    ).toBeNull();
    expect(
      resolveCanonicalModelId(index, 'google', model('gemini-3-pro-image', 'Nano Banana Pro')),
    ).toBeNull();
  });

  it('lab 内无同名规范条目时保持原样', () => {
    expect(
      resolveCanonicalModelId(
        index,
        'openai',
        model('text-embedding-3-small', 'Text Embedding 3 Small'),
      ),
    ).toBeNull();
  });

  it('同名对应多个规范 id 时不做改写', () => {
    const ambiguousIndex = buildCanonicalAliasIndex({
      'deepseek/deepseek-v4.1-flash': {
        id: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
      },
      'deepseek/deepseek-v4.1-flash-v2': {
        id: 'deepseek/deepseek-v4.1-flash-v2',
        name: 'DeepSeek V4.1 Flash',
      },
    });
    expect(
      resolveCanonicalModelId(
        ambiguousIndex,
        'deepseek',
        model('deepseek-flash', 'DeepSeek V4.1 Flash'),
      ),
    ).toBeNull();
  });
});

describe('applyCanonicalModelAliases', () => {
  it('改写别名并去掉与规范 id 重复的条目', () => {
    const result = applyCanonicalModelAliases(
      [
        model('deepseek-v4-flash', 'DeepSeek V4 Flash'),
        model('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'),
        model('deepseek-flash', 'DeepSeek V4.1 Flash'),
      ],
      index,
      'deepseek',
    );

    expect(result.map((item) => item.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4.1-flash']);
  });
});
