// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useScrollActiveSessionIntoView } from './use-scroll-active-session.js';

function Harness({ activeSessionId }: { activeSessionId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useScrollActiveSessionIntoView(containerRef, activeSessionId);

  return (
    <div ref={containerRef}>
      <div data-session-id="target-session" />
    </div>
  );
}

function installRects(targetTop: number, targetBottom: number): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const hasSessionId =
      this instanceof HTMLElement && this.getAttribute('data-session-id') === 'target-session';
    const top = hasSessionId ? targetTop : 0;
    const bottom = hasSessionId ? targetBottom : 100;

    return {
      bottom,
      height: bottom - top,
      left: 0,
      right: 100,
      top,
      width: 100,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };

  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

afterEach(() => {
  cleanup();
});

describe('useScrollActiveSessionIntoView', () => {
  it('激活会话在可视区外时滚动到 nearest', () => {
    const restoreRects = installRects(200, 220);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(<Harness activeSessionId="target-session" />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      restoreRects();
    }
  });

  it('激活会话已可见时不滚动', () => {
    const restoreRects = installRects(10, 30);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(<Harness activeSessionId="target-session" />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      restoreRects();
    }
  });

  it('无激活会话或找不到行时安全跳过', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<Harness activeSessionId={null} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    cleanup();
    render(<Harness activeSessionId="missing-session" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
