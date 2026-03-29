import { describe, expect, it } from 'vitest';
import { buildFilteredModelGroups, type ModelPickerProvider } from './model-picker-search.js';

const providers: ModelPickerProvider[] = [
  {
    id: 'moonshot',
    name: 'Moonshot',
    type: 'moonshot',
    enabled: true,
    defaultModels: [{ id: 'kimi-k2.5', label: 'Kimi K2.5', enabled: true }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    defaultModels: [
      { id: 'gpt-5', label: 'GPT-5', enabled: true },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', enabled: true },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    enabled: true,
    defaultModels: [{ id: 'claude-sonnet-4', label: 'Claude Sonnet 4', enabled: true }],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    enabled: true,
    defaultModels: [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', enabled: true }],
  },
];

describe('buildFilteredModelGroups', () => {
  it('matches provider name, model label and model id with fuzzysort', () => {
    const providerMatch = buildFilteredModelGroups(providers, 'openai');
    const fuzzyIdMatch = buildFilteredModelGroups(providers, 'gpt5');

    expect(providerMatch).toHaveLength(1);
    expect(providerMatch[0]?.provider.id).toBe('openai');
    expect(providerMatch[0]?.models.map((model) => model.id)).toEqual(['gpt-4.1-mini', 'gpt-5']);

    expect(fuzzyIdMatch).toHaveLength(1);
    expect(fuzzyIdMatch[0]?.models.map((model) => model.id)).toContain('gpt-5');
  });

  it('sorts models by name and lifts popular providers ahead of non-popular ones', () => {
    const groups = buildFilteredModelGroups(providers, '');

    expect(groups.map((group) => group.provider.id)).toEqual([
      'anthropic',
      'openai',
      'gemini',
      'moonshot',
    ]);
    expect(groups[1]?.models.map((model) => model.name)).toEqual(['GPT-4.1 mini', 'GPT-5']);
  });

  it('keeps providers with the same display name separated by provider id', () => {
    const duplicateNameProviders: ModelPickerProvider[] = [
      {
        id: 'openai-primary',
        name: 'OpenAI',
        type: 'openai',
        enabled: true,
        defaultModels: [{ id: 'gpt-5', label: 'GPT-5', enabled: true }],
      },
      {
        id: 'openai-secondary',
        name: 'OpenAI',
        type: 'openai',
        enabled: true,
        defaultModels: [{ id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', enabled: true }],
      },
    ];

    const groups = buildFilteredModelGroups(duplicateNameProviders, 'openai');

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.provider.id))).toEqual(
      new Set(['openai-primary', 'openai-secondary']),
    );
    expect(groups.map((group) => group.models.map((model) => model.id))).toEqual(
      expect.arrayContaining([['gpt-5'], ['gpt-4.1-mini']]),
    );
  });

  it('treats whitespace-only search as empty search', () => {
    const groups = buildFilteredModelGroups(providers, '   ');

    expect(groups.map((group) => group.provider.id)).toEqual([
      'anthropic',
      'openai',
      'gemini',
      'moonshot',
    ]);
  });
});
