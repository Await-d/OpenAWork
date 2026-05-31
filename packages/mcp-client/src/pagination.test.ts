import { describe, expect, it, vi } from 'vitest';
import {
  collectPaginated,
  MCP_PAGINATION_MAX_ITEMS,
  MCP_PAGINATION_MAX_PAGES,
  MCPPaginationError,
} from './adapter.js';

/**
 * Regression coverage for the cursor-paginated MCP listing guards.
 *
 * Background: `listTools` / `listResources` / `listPrompts` previously
 * trusted whatever `nextCursor` the upstream MCP server returned. A
 * buggy or hostile server could spin the gateway in an infinite
 * `do { ... } while (cursor)` loop while the in-memory accumulator
 * grew without bound. `collectPaginated` adds three independent
 * termination guards (max pages, max items, repeated cursor).
 */
describe('collectPaginated', () => {
  it('合法分页正常终止', async () => {
    const fetchPage = vi
      .fn<(cursor?: string) => Promise<{ items: number[]; next?: string }>>()
      .mockImplementationOnce(async () => ({ items: [1, 2], next: 'p2' }))
      .mockImplementationOnce(async () => ({ items: [3, 4], next: 'p3' }))
      .mockImplementationOnce(async () => ({ items: [5], next: undefined }));

    const out = await collectPaginated(
      'srv',
      'listTools',
      fetchPage,
      (page) => page.items,
      (page) => page.next,
    );

    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[0]?.[0]).toBeUndefined();
    expect(fetchPage.mock.calls[1]?.[0]).toBe('p2');
    expect(fetchPage.mock.calls[2]?.[0]).toBe('p3');
  });

  it('上游回放重复 cursor 时按 cursor_loop 终止，不会无限循环', async () => {
    let calls = 0;
    const fetchPage = vi.fn(async (_cursor?: string) => {
      calls += 1;
      // Always returns the same cursor — would loop forever otherwise.
      return { items: [`item-${calls}`], next: 'same-cursor' };
    });

    await expect(
      collectPaginated(
        'srv-loop',
        'listResources',
        fetchPage,
        (page) => page.items,
        (page) => page.next,
      ),
    ).rejects.toMatchObject({
      name: 'MCPPaginationError',
      reason: 'cursor_loop',
      serverId: 'srv-loop',
      operation: 'listResources',
    });
    // First call cursor=undefined, second cursor='same-cursor', third
    // would be 'same-cursor' again — guard fires before the third fetch.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('页数超过上限时按 max_pages 终止', async () => {
    let n = 0;
    const fetchPage = vi.fn(async (_cursor?: string) => {
      n += 1;
      // Always advance cursor so cursor_loop guard does not fire first.
      return { items: [n], next: `c-${n}` };
    });

    const err = await collectPaginated(
      'srv-pages',
      'listPrompts',
      fetchPage,
      (page) => page.items,
      (page) => page.next,
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MCPPaginationError);
    expect((err as MCPPaginationError).reason).toBe('max_pages');
    expect(fetchPage).toHaveBeenCalledTimes(MCP_PAGINATION_MAX_PAGES);
  });

  it('累计条目超过上限时按 max_items 终止', async () => {
    // Pack a single page over the item ceiling — verifies the guard
    // checks the next page's contribution before push, even when only
    // one fetch happens.
    const oversized = new Array(MCP_PAGINATION_MAX_ITEMS + 5).fill(0).map((_, i) => i);
    const fetchPage = vi.fn(async () => ({ items: oversized, next: undefined }));

    await expect(
      collectPaginated(
        'srv-items',
        'listTools',
        fetchPage,
        (page) => page.items,
        (page) => page.next,
      ),
    ).rejects.toMatchObject({
      name: 'MCPPaginationError',
      reason: 'max_items',
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('上游 fetchPage 抛错原样冒泡', async () => {
    const boom = new Error('upstream EPIPE');
    const fetchPage = vi.fn<(cursor?: string) => Promise<{ items: number[]; next?: string }>>(
      async () => {
        throw boom;
      },
    );

    await expect(
      collectPaginated(
        'srv-throw',
        'listTools',
        fetchPage,
        (page) => page.items,
        (page) => page.next,
      ),
    ).rejects.toBe(boom);
  });
});
