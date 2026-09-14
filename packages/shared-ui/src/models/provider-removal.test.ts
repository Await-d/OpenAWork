import { describe, expect, it } from 'vitest';
import { canRemoveProvider } from './provider-removal.js';

const providers = [
  { id: 'anthropic', type: 'anthropic' },
  { id: 'openai', type: 'openai' },
  { id: 'openai-duplicate', type: 'openai' },
  { id: 'my-custom', type: 'custom' },
];

describe('canRemoveProvider', () => {
  it('allows removing a custom provider', () => {
    expect(canRemoveProvider(providers, 'my-custom')).toBe(true);
  });

  it('rejects the only provider of a builtin type', () => {
    expect(canRemoveProvider(providers, 'anthropic')).toBe(false);
  });

  it('allows removing a builtin provider when a same-type sibling remains', () => {
    expect(canRemoveProvider(providers, 'openai')).toBe(true);
    expect(canRemoveProvider(providers, 'openai-duplicate')).toBe(true);
  });

  it('rejects an unknown provider id', () => {
    expect(canRemoveProvider(providers, 'missing')).toBe(false);
  });
});
