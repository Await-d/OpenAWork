import { describe, expect, it } from 'vitest';
import type { AIProviderRef } from '@openAwork/shared-ui';
import { removeProvider } from './provider-model-mutations.js';

function makeProvider(id: string, type = 'custom'): AIProviderRef {
  return {
    id,
    type,
    name: id,
    enabled: true,
    defaultModels: [],
  };
}

describe('removeProvider', () => {
  it('removes the matching provider by id', () => {
    const providers = [makeProvider('first'), makeProvider('target'), makeProvider('last')];

    expect(removeProvider(providers, 'target')).toEqual([providers[0], providers[2]]);
  });

  it('returns an equal-length list with the same members for an unknown id', () => {
    const providers = [makeProvider('first'), makeProvider('second')];

    expect(removeProvider(providers, 'unknown')).toEqual(providers);
  });

  it('preserves other providers and does not mutate the original array', () => {
    const first = makeProvider('first');
    const target = makeProvider('target');
    const last = makeProvider('last');
    const providers = [first, target, last];

    const result = removeProvider(providers, 'target');

    expect(result).not.toBe(providers);
    expect(result).toEqual([first, last]);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(last);
    expect(providers).toEqual([first, target, last]);
  });
});
