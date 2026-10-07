// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePathHoverPreview } from './use-path-hover-preview.js';

function Probe({ enabled = true }: { enabled?: boolean }) {
  const hover = usePathHoverPreview({ enabled });
  return (
    <div>
      <button type="button" ref={hover.anchorRef} {...hover.triggerHandlers}>
        trigger
      </button>
      {hover.open && (
        <div data-testid="panel" {...hover.panelHandlers}>
          panel
        </div>
      )}
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe('usePathHoverPreview', () => {
  it('悬停超过开启延迟后才展开弹层', () => {
    const view = render(<Probe />);
    const trigger = view.getByRole('button');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    expect(view.queryByTestId('panel')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(view.queryByTestId('panel')).not.toBeNull();
  });

  it('光标快速掠过（未达开启延迟）不展开弹层', () => {
    const view = render(<Probe />);
    const trigger = view.getByRole('button');

    act(() => {
      fireEvent.mouseEnter(trigger);
      vi.advanceTimersByTime(100);
      fireEvent.mouseLeave(trigger);
      vi.advanceTimersByTime(250);
    });

    expect(view.queryByTestId('panel')).toBeNull();
  });

  it('离开后经关闭延迟收起，光标进入弹层则保持展开（桥）', () => {
    const view = render(<Probe />);
    const trigger = view.getByRole('button');

    act(() => {
      fireEvent.mouseEnter(trigger);
      vi.advanceTimersByTime(250);
    });
    const panel = view.getByTestId('panel');

    act(() => {
      fireEvent.mouseLeave(trigger);
      vi.advanceTimersByTime(60);
    });
    // 桥接窗口内弹层仍在。
    expect(view.queryByTestId('panel')).not.toBeNull();

    act(() => {
      fireEvent.mouseEnter(panel);
      vi.advanceTimersByTime(500);
    });
    expect(view.queryByTestId('panel')).not.toBeNull();

    act(() => {
      fireEvent.mouseLeave(panel);
      vi.advanceTimersByTime(120);
    });
    expect(view.queryByTestId('panel')).toBeNull();
  });

  it('键盘 focus 同样展开，blur 收起', () => {
    const view = render(<Probe />);
    const trigger = view.getByRole('button');

    act(() => {
      fireEvent.focus(trigger);
      vi.advanceTimersByTime(250);
    });
    expect(view.queryByTestId('panel')).not.toBeNull();

    act(() => {
      fireEvent.blur(trigger);
      vi.advanceTimersByTime(120);
    });
    expect(view.queryByTestId('panel')).toBeNull();
  });

  it('enabled 为 false 时永不展开', () => {
    const view = render(<Probe enabled={false} />);
    const trigger = view.getByRole('button');

    act(() => {
      fireEvent.mouseEnter(trigger);
      vi.advanceTimersByTime(1000);
    });

    expect(view.queryByTestId('panel')).toBeNull();
  });

  it('enabled 由 true 变 false 时立即收起已展开的弹层', () => {
    const view = render(<Probe />);
    const trigger = view.getByRole('button');

    act(() => {
      fireEvent.mouseEnter(trigger);
      vi.advanceTimersByTime(250);
    });
    expect(view.queryByTestId('panel')).not.toBeNull();

    view.rerender(<Probe enabled={false} />);
    expect(view.queryByTestId('panel')).toBeNull();
  });
});
