import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestLinkPreview } from './link-preview.js';
import { useLinkPreviewRequest } from './use-link-preview-request.js';

afterEach(() => {
  cleanup();
});

describe('useLinkPreviewRequest', () => {
  it('enabled 为 true 时派发到处理器并认领事件', () => {
    const handler = vi.fn();
    renderHook(() => useLinkPreviewRequest(true, handler));

    expect(requestLinkPreview('https://example.com')).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('https://example.com');
  });

  it('enabled 为 false 时不派发处理器，也不认领事件', () => {
    const handler = vi.fn();
    renderHook(() => useLinkPreviewRequest(false, handler));

    expect(requestLinkPreview('https://example.com')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
