import { describe, expect, it } from 'vitest';
import {
  normalizeUpdateChannel,
  primaryLatestJsonForChannel,
  RELEASE_ENDPOINTS,
  updaterJsonEndpointsForChannel,
} from './release-endpoints.js';

describe('release-endpoints', () => {
  it('exposes stable and preview latest.json URLs under the OpenAWork repo', () => {
    expect(RELEASE_ENDPOINTS.previewLatestJson).toContain('desktop-latest-preview/latest.json');
    expect(RELEASE_ENDPOINTS.stableLatestJson).toContain('/releases/latest/download/latest.json');
    expect(RELEASE_ENDPOINTS.githubLatestApi).toContain('api.github.com/repos/Await-d/OpenAWork');
  });

  it('returns channel-specific updater endpoints', () => {
    expect(updaterJsonEndpointsForChannel('preview')).toEqual([
      RELEASE_ENDPOINTS.previewLatestJson,
    ]);
    expect(updaterJsonEndpointsForChannel('stable', { includeCn: true })).toEqual([
      RELEASE_ENDPOINTS.stableLatestJson,
      RELEASE_ENDPOINTS.stableLatestCnJson,
    ]);
    expect(primaryLatestJsonForChannel('stable')).toBe(RELEASE_ENDPOINTS.stableLatestJson);
  });

  it('normalizes unknown channels to the fallback', () => {
    expect(normalizeUpdateChannel('preview')).toBe('preview');
    expect(normalizeUpdateChannel('stable')).toBe('stable');
    expect(normalizeUpdateChannel('nightly')).toBe('preview');
    expect(normalizeUpdateChannel(undefined, 'stable')).toBe('stable');
  });
});
