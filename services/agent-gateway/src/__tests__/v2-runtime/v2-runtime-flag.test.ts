import { describe, expect, it } from 'vitest';
import { parseRuntimeVariant, readRuntimeFlags } from '../../v2-runtime/runtime-flag.js';

describe('v2-runtime feature flag', () => {
  describe('parseRuntimeVariant', () => {
    it('returns the fallback when the env value is missing', () => {
      expect(parseRuntimeVariant(undefined, 'v1')).toBe('v1');
      expect(parseRuntimeVariant(undefined, 'v2')).toBe('v2');
    });

    it('returns the fallback when the env value is unrecognised', () => {
      expect(parseRuntimeVariant('garbage', 'v1')).toBe('v1');
      expect(parseRuntimeVariant('v3', 'v1')).toBe('v1');
      expect(parseRuntimeVariant('', 'v2')).toBe('v2');
    });

    it('accepts canonical variants regardless of casing or whitespace', () => {
      expect(parseRuntimeVariant('v1', 'v2')).toBe('v1');
      expect(parseRuntimeVariant('V1', 'v2')).toBe('v1');
      expect(parseRuntimeVariant('  v2  ', 'v1')).toBe('v2');
      expect(parseRuntimeVariant('V2', 'v1')).toBe('v2');
    });
  });

  describe('readRuntimeFlags', () => {
    it('defaults every layer to v1 when no env vars are set', () => {
      const flags = readRuntimeFlags({});
      expect(flags).toMatchObject({
        global: 'v1',
        storage: 'v1',
        upstream: 'v1',
        services: 'v1',
      });
      expect(flags.upstreamProviderAllowlist.size).toBe(0);
    });

    it('propagates the global flag to every layer', () => {
      const flags = readRuntimeFlags({ OPENAWORK_RUNTIME: 'v2' });
      expect(flags).toMatchObject({
        global: 'v2',
        storage: 'v2',
        upstream: 'v2',
        services: 'v2',
      });
    });

    it('lets sub-flags override the global flag per layer', () => {
      const flags = readRuntimeFlags({
        OPENAWORK_RUNTIME: 'v1',
        OPENAWORK_RUNTIME_STORAGE: 'v2',
      });
      expect(flags.global).toBe('v1');
      expect(flags.storage).toBe('v2');
      expect(flags.upstream).toBe('v1');
      expect(flags.services).toBe('v1');
    });

    it('ignores invalid sub-flag values and inherits the global', () => {
      const flags = readRuntimeFlags({
        OPENAWORK_RUNTIME: 'v2',
        OPENAWORK_RUNTIME_UPSTREAM: 'experimental',
      });
      expect(flags.upstream).toBe('v2');
    });

    it('parses the providerType allowlist from a comma list (case-insensitive)', () => {
      const flags = readRuntimeFlags({
        OPENAWORK_RUNTIME: 'v2',
        OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS: ' Anthropic , openai , , Anthropic ',
      });
      const allow = flags.upstreamProviderAllowlist;
      expect(allow.has('anthropic')).toBe(true);
      expect(allow.has('openai')).toBe(true);
      expect(allow.has('moonshot')).toBe(false);
      // Empty entries are dropped; duplicates collapse via Set.
      expect(allow.size).toBe(2);
    });

    it('treats an empty allowlist as "all providers eligible"', () => {
      const flags = readRuntimeFlags({
        OPENAWORK_RUNTIME: 'v2',
        OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS: '',
      });
      expect(flags.upstreamProviderAllowlist.size).toBe(0);
    });
  });
});
