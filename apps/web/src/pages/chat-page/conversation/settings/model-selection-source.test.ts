import { describe, expect, it } from 'vitest';
import {
  resolveModelSelectionSourceFromMetadata,
  shouldAdoptSessionModelSelectionDefaults,
  shouldSendExplicitStreamModelSelection,
} from './model-selection-source.js';

describe('model-selection-source', () => {
  it('仅当 metadata 同时带 providerId 与 modelId 时才视为绑定', () => {
    expect(
      resolveModelSelectionSourceFromMetadata({
        providerId: 'openai',
        modelId: 'gpt-5.4',
        modelSelectionSource: 'manual',
      }),
    ).toBe('manual');
    expect(
      resolveModelSelectionSourceFromMetadata({
        providerId: 'openai',
        modelId: 'gpt-5.4',
        modelSelectionSource: 'defaults',
      }),
    ).toBe('defaults');
    expect(
      resolveModelSelectionSourceFromMetadata({
        providerId: 'openai',
        modelId: 'gpt-5.4',
      }),
    ).toBe('metadata');
    expect(
      resolveModelSelectionSourceFromMetadata({
        providerId: 'openai',
        modelId: '',
      }),
    ).toBeNull();
  });

  it('仅在已有会话且 metadata 没有模型绑定时接管默认选择', () => {
    expect(
      shouldAdoptSessionModelSelectionDefaults({
        sessionId: 'sess-1',
        source: null,
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5.4',
      }),
    ).toBe(true);
    expect(
      shouldAdoptSessionModelSelectionDefaults({
        sessionId: 'sess-1',
        source: 'manual',
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5.4',
      }),
    ).toBe(false);
  });

  it('只有手动选型才显式透传 provider/model', () => {
    expect(shouldSendExplicitStreamModelSelection('manual')).toBe(true);
    expect(shouldSendExplicitStreamModelSelection('metadata')).toBe(false);
    expect(shouldSendExplicitStreamModelSelection('defaults')).toBe(false);
    expect(shouldSendExplicitStreamModelSelection(null)).toBe(false);
  });
});
