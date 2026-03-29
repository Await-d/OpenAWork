import { describe, it, expect, vi, afterEach } from 'vitest';
import { lspDiagnosticsTool, lspTouchTool } from '../tools/lsp.js';

const ABORT = new AbortController();

function mockFetch(response: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => response,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('lspDiagnosticsTool', () => {
  it('returns all diagnostics when no filePath given', async () => {
    mockFetch({ diagnostics: { '/src/foo.ts': [{ message: 'error A' }] } });
    const result = await lspDiagnosticsTool.execute({ filePath: undefined }, ABORT.signal);
    expect(result).toEqual({ '/src/foo.ts': [{ message: 'error A' }] });
  });

  it('filters by filePath suffix', async () => {
    mockFetch({
      diagnostics: {
        '/project/src/foo.ts': [{ message: 'error A' }],
        '/project/src/bar.ts': [{ message: 'error B' }],
      },
    });
    const result = await lspDiagnosticsTool.execute({ filePath: 'foo.ts' }, ABORT.signal);
    expect(Object.keys(result)).toHaveLength(1);
    expect(Object.keys(result)[0]).toContain('foo.ts');
  });

  it('returns empty object when filePath not found', async () => {
    mockFetch({ diagnostics: { '/src/bar.ts': [] } });
    const result = await lspDiagnosticsTool.execute({ filePath: 'nonexistent.ts' }, ABORT.signal);
    expect(result).toEqual({});
  });

  it('throws on non-ok response', async () => {
    mockFetch({}, false);
    await expect(lspDiagnosticsTool.execute({ filePath: undefined }, ABORT.signal)).rejects.toThrow(
      'LSP diagnostics request failed',
    );
  });
});

describe('lspTouchTool', () => {
  it('returns ok:true on success', async () => {
    mockFetch({ ok: true });
    const result = await lspTouchTool.execute(
      { path: '/src/foo.ts', waitForDiagnostics: true },
      ABORT.signal,
    );
    expect(result).toEqual({ ok: true });
  });

  it('sends correct request body', async () => {
    const spy = mockFetch({ ok: true });
    await lspTouchTool.execute({ path: '/src/bar.ts', waitForDiagnostics: false }, ABORT.signal);
    const callArgs = spy.mock.calls[0]!;
    const body = JSON.parse(callArgs[1]?.body as string);
    expect(body.path).toBe('/src/bar.ts');
    expect(body.waitForDiagnostics).toBe(false);
  });

  it('throws on non-ok response', async () => {
    mockFetch({}, false);
    await expect(
      lspTouchTool.execute({ path: '/src/foo.ts', waitForDiagnostics: false }, ABORT.signal),
    ).rejects.toThrow('LSP touch request failed');
  });
});
