// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ResizeHandle } from './resize-handle.js';

const BOUNDS = { min: 200, max: 400, default: 280 } as const;

function clamp(width: number): number {
  return Math.min(BOUNDS.max, Math.max(BOUNDS.min, Math.round(width)));
}

function Harness() {
  const [width, setWidth] = useState<number>(BOUNDS.default);
  const [committed, setCommitted] = useState<number | null>(null);

  return (
    <div style={{ position: 'relative' }}>
      <ResizeHandle
        width={width}
        bounds={BOUNDS}
        clamp={clamp}
        ariaLabel="调整侧栏宽度"
        onWidthChange={setWidth}
        onWidthCommit={(next) => {
          setCommitted(next);
          setWidth(next);
        }}
      />
      <output data-testid="committed">{committed ?? ''}</output>
    </div>
  );
}

function getHandle(): HTMLElement {
  return screen.getByRole('separator', { name: '调整侧栏宽度' });
}

function installPointerCaptureStubs(): void {
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}

beforeEach(() => {
  installPointerCaptureStubs();
});

afterEach(() => {
  cleanup();
});

describe('ResizeHandle', () => {
  it('暴露分隔条语义与取值范围', () => {
    render(<Harness />);

    const handle = getHandle();
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe(String(BOUNDS.min));
    expect(handle.getAttribute('aria-valuemax')).toBe(String(BOUNDS.max));
    expect(handle.getAttribute('aria-valuenow')).toBe(String(BOUNDS.default));
  });

  it('拖拽实时更新宽度，松手时提交', () => {
    render(<Harness />);
    const handle = getHandle();

    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 350, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe('330');

    fireEvent.pointerUp(handle, { clientX: 350, pointerId: 1 });
    expect(screen.getByTestId('committed').textContent).toBe('330');
  });

  it('拖拽超出边界时按 clamp 收敛', () => {
    render(<Harness />);
    const handle = getHandle();

    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });

    expect(handle.getAttribute('aria-valuenow')).toBe(String(BOUNDS.max));
  });

  it('键盘方向键微调并提交，Shift 加倍步长', () => {
    render(<Harness />);
    const handle = getHandle();

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('296');

    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(handle.getAttribute('aria-valuenow')).toBe('232');
  });

  it('双击与 Enter 复位默认宽度', () => {
    render(<Harness />);
    const handle = getHandle();

    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle.getAttribute('aria-valuenow')).toBe(String(BOUNDS.max));

    fireEvent.doubleClick(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe(String(BOUNDS.default));

    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(handle.getAttribute('aria-valuenow')).toBe(String(BOUNDS.default));
  });
});
