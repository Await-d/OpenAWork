import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDispatches } from './use-dispatches.js';

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: {
    getState: () => ({
      gatewayUrl: 'https://gateway.example',
      email: 'test@example.com',
      accessToken: 'token',
    }),
  },
}));

const activation = vi.hoisted(() => ({ active: true }));
vi.mock('../../components/common/routing/CachedRouteOutlet.js', () => ({
  usePageActivation: () => activation.active,
}));

afterEach(() => {
  cleanup();
  activation.active = true;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('clears list and detail when a refresh returns 401', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ enabled: true, entries: [], nextCursor: null }))
      .mockResolvedValueOnce(Response.json({ id: 'draft' }))
      .mockResolvedValueOnce(Response.json({ message: 'expired' }, { status: 401 })),
  );
  const { result } = renderHook(() =>
    useDispatches('https://gateway.example', 'test@example.com', 'draft'),
  );
  await waitFor(() => expect(result.current.detail?.id).toBe('draft'));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.error).toContain('重新登录'));
  expect(result.current.list).toBeNull();
  expect(result.current.detail).toBeNull();
});

it('does not expose the previous page cursor while a different page is loading or has failed', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let respond: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ enabled: true, entries: [], nextCursor: 'older' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
  );
  const { result } = renderHook(() => useDispatches('https://gateway.example', 'test@example.com'));
  await waitFor(() => expect(result.current.nextCursor).toBe('older'));
  act(() => result.current.setCursor('older'));
  expect(result.current.nextCursor).toBeNull();
  expect(result.current.pageLoading).toBe(true);
  respond?.(Response.json({ message: 'unavailable' }, { status: 503 }));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.pageLoading).toBe(false);
  expect(result.current.nextCursor).toBeNull();
});

it('does not navigate when a draft finishes after leaving and returning to the cached page', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ enabled: true, entries: [], nextCursor: null })),
  );
  const navigate = vi.fn();
  const { result, rerender } = renderHook(() =>
    useDispatches('https://gateway.example', 'test@example.com'),
  );
  let complete: ((detail: NonNullable<typeof result.current.detail>) => void) | undefined;
  let write: Promise<unknown> | undefined;
  act(() => {
    write = result.current.mutate(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      navigate,
    );
  });
  activation.active = false;
  rerender();
  activation.active = true;
  rerender();
  await act(async () => {
    complete?.({
      id: 'draft',
      status: 'draft',
      title: '纪要',
      total: 0,
      succeeded: 0,
      updatedAt: 0,
      request: '摘要',
      excerpt: '',
      revision: 1,
      selection: { providerId: 'p', modelId: 'm' },
      draftItems: [],
      items: [],
    });
    await write;
  });
  expect(navigate).not.toHaveBeenCalled();
});

it('starts only when visible and aborts an in-flight refresh when hidden', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const fetch = vi.fn(
    (_url: string, _init: RequestInit) =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  let respond: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDispatches('https://gateway.example', 'test@example.com'));
  expect(fetch).not.toHaveBeenCalled();

  const changeVisibility = (state: DocumentVisibilityState) => {
    visibility.mockReturnValue(state);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
  };
  changeVisibility('visible');
  expect(fetch).toHaveBeenCalledTimes(1);
  const signal = fetch.mock.calls[0]?.[1].signal;
  changeVisibility('hidden');
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  respond?.(Response.json({ enabled: false, entries: [], nextCursor: null }));

  changeVisibility('visible');
  expect(fetch).toHaveBeenCalledTimes(2);
  respond?.(Response.json({ enabled: true, entries: [], nextCursor: null }));
  await waitFor(() => expect(result.current.list?.enabled).toBe(true));
});
