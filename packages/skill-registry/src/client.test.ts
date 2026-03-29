import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillRegistryClientImpl } from './client.js';
import { RegistrySourceManager } from './source.js';

describe('SkillRegistryClientImpl.fetchSourceSnapshot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('只拉取指定来源并透传查询分页参数', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'skill-a',
              name: 'skill-a',
              displayName: 'Skill A',
              version: '1.0.0',
              description: 'Alpha skill',
              category: 'automation',
              tags: ['alpha'],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const client = new SkillRegistryClientImpl(
      new RegistrySourceManager([
        {
          id: 'community-a',
          name: 'Community A',
          url: 'https://example.com/registry',
          type: 'community',
          trust: 'verified',
          enabled: true,
          priority: 10,
        },
      ]),
    );

    const items = await client.fetchSourceSnapshot('community-a', {
      query: 'alpha',
      limit: 10,
      offset: 5,
    });

    const requestInfo = fetchSpy.mock.calls[0]?.[0];
    const url =
      typeof requestInfo === 'string'
        ? new URL(requestInfo)
        : requestInfo instanceof URL
          ? requestInfo
          : new URL(requestInfo?.url ?? 'https://invalid.local');
    expect(url.pathname).toBe('/registry/skills/search.json');
    expect(url.searchParams.get('q')).toBe('alpha');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('5');
    expect(items[0]).toMatchObject({
      id: 'skill-a',
      sourceId: 'community-a',
    });
  });

  it('来源不存在或禁用时直接报错', async () => {
    const client = new SkillRegistryClientImpl(
      new RegistrySourceManager([
        {
          id: 'community-b',
          name: 'Community B',
          url: 'https://example.com/registry',
          type: 'community',
          trust: 'verified',
          enabled: false,
          priority: 10,
        },
      ]),
    );

    await expect(client.fetchSourceSnapshot('community-b')).rejects.toThrow(
      'Registry source not found or disabled: community-b',
    );
  });
});
