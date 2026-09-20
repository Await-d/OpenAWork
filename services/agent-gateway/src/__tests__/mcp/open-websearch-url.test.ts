import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl as isUpstreamPublicHttpUrl } from 'open-websearch/build/utils/urlSafety.js';
import { isPublicHttpUrl } from '../../mcp/open-websearch-url.js';

const CLASSIFICATION_CASES = [
  'http://127.0.0.1/',
  'http://10.0.0.1/',
  'http://100.64.0.1/',
  'http://198.18.0.1/',
  'http://192.0.2.1/',
  'http://[fd00::1]/',
  'http://[fe80::1]/',
  'http://8.8.8.8/',
  'https://example.com/',
  'ftp://example.com/',
] as const;

describe('isPublicHttpUrl upstream contract', () => {
  it.each(CLASSIFICATION_CASES)('classifies %s exactly like open-websearch', (url) => {
    expect(isPublicHttpUrl(url)).toBe(isUpstreamPublicHttpUrl(url));
  });

  it('rejects non-unicast ranges that the hand-rolled guard previously allowed', () => {
    expect(isPublicHttpUrl('http://100.64.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://198.18.0.1/')).toBe(false);
  });
});
