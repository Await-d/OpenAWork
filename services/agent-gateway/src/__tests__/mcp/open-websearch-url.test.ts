import { afterEach, describe, expect, it } from 'vitest';
import {
  __setDnsLookupForTests,
  isPublicHttpUrl as isUpstreamPublicHttpUrl,
} from 'open-websearch/build/utils/urlSafety.js';
import {
  PUBLIC_HTTP_URL_MESSAGE,
  isPublicHttpUrl,
  readPublicUrlError,
} from '../../mcp/open-websearch-url.js';

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

describe('readPublicUrlError 诊断后缀', () => {
  afterEach(() => {
    __setDnsLookupForTests();
  });

  it('字面量私有地址 / 非 HTTP 协议只返回通用文案，不做 DNS 解析', async () => {
    __setDnsLookupForTests(async () => {
      throw new Error('字面量私有地址不应走到 DNS 解析');
    });

    await expect(readPublicUrlError('http://127.0.0.1/', PUBLIC_HTTP_URL_MESSAGE)).resolves.toBe(
      PUBLIC_HTTP_URL_MESSAGE,
    );
    await expect(readPublicUrlError('ftp://example.com/', PUBLIC_HTTP_URL_MESSAGE)).resolves.toBe(
      PUBLIC_HTTP_URL_MESSAGE,
    );
  });

  it('解析到非公网地址时补充 fake-IP 提示（Clash 198.18.0.0/15）', async () => {
    __setDnsLookupForTests(async () => [{ address: '198.18.6.204', family: 4 }]);

    const message = await readPublicUrlError(
      'https://opencode.ai/v2/install',
      PUBLIC_HTTP_URL_MESSAGE,
    );

    expect(message).toContain(PUBLIC_HTTP_URL_MESSAGE);
    expect(message).toContain('FAKE_IP_CIDRS=198.18.0.0/15');
  });

  it('域名解析失败时补充 DNS 提示', async () => {
    __setDnsLookupForTests(async () => {
      throw new Error('ENOTFOUND');
    });

    const message = await readPublicUrlError(
      'https://opencode.ai/v2/install',
      PUBLIC_HTTP_URL_MESSAGE,
    );

    expect(message).toContain(PUBLIC_HTTP_URL_MESSAGE);
    expect(message).toContain('域名解析失败');
  });

  it('解析到公网地址时放行', async () => {
    __setDnsLookupForTests(async () => [{ address: '93.184.216.34', family: 4 }]);

    await expect(
      readPublicUrlError('https://example.com/', PUBLIC_HTTP_URL_MESSAGE),
    ).resolves.toBeNull();
  });
});
