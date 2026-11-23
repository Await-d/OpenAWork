// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRef } from 'react';
import {
  ACTIVE_TAB_SCROLL_MARGIN_PX,
  computeTitlebarTabScrollLeft,
  useScrollActiveTitlebarTab,
} from './use-scroll-active-titlebar-tab.js';
import {
  installTabScrollLayout,
  installTrackedScrollLeft,
} from './titlebar-tab-scroll.test-utils.js';

function Harness({ activeTabId }: { readonly activeTabId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useScrollActiveTitlebarTab(containerRef, activeTabId);

  return (
    <div ref={containerRef} role="tablist">
      <div
        role="tab"
        data-tab-id="tab-a"
        data-active={activeTabId === 'tab-a' ? 'true' : 'false'}
      />
      <div
        role="tab"
        data-tab-id="tab-b"
        data-active={activeTabId === 'tab-b' ? 'true' : 'false'}
      />
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('computeTitlebarTabScrollLeft', () => {
  it('完全可见时返回 null（不重置用户滚动位置）', () => {
    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 400,
        tabLeft: 100,
        tabRight: 220,
        currentScrollLeft: 0,
      }),
    ).toBeNull();
  });

  it('右侧溢出时追加「溢出量 + 呼吸间距」', () => {
    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 200,
        tabLeft: 220,
        tabRight: 320,
        currentScrollLeft: 40,
      }),
    ).toBe(40 + 120 + ACTIVE_TAB_SCROLL_MARGIN_PX);
  });

  it('左侧溢出时回退「溢出量 + 呼吸间距」，且不小于 0', () => {
    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 200,
        tabLeft: -90,
        tabRight: 10,
        currentScrollLeft: 100,
      }),
    ).toBe(100 - 90 - ACTIVE_TAB_SCROLL_MARGIN_PX);

    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 200,
        tabLeft: -4,
        tabRight: 96,
        currentScrollLeft: 0,
      }),
    ).toBe(0);
  });

  it('标签比容器还宽时贴左，避免图标与标题开头永久出视野', () => {
    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 100,
        tabLeft: -40,
        tabRight: 240,
        currentScrollLeft: 200,
      }),
    ).toBe(200 - 40 - ACTIVE_TAB_SCROLL_MARGIN_PX);
  });

  it('标签比容器宽但左边界已可见时保持不动', () => {
    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 100,
        tabLeft: 0,
        tabRight: 280,
        currentScrollLeft: 0,
      }),
    ).toBeNull();
  });

  it('容器尚未布局（宽度为 0）时不滚动', () => {
    expect(
      computeTitlebarTabScrollLeft({
        containerLeft: 0,
        containerRight: 0,
        tabLeft: 0,
        tabRight: 200,
        currentScrollLeft: 0,
      }),
    ).toBeNull();
  });
});

describe('useScrollActiveTitlebarTab', () => {
  it('激活标签在可视区右侧外时滚进来', () => {
    const restoreLayout = installTabScrollLayout(
      { left: 0, right: 200 },
      {
        'tab-a': { left: 0, right: 100 },
        'tab-b': { left: 220, right: 320 },
      },
    );
    const scroll = installTrackedScrollLeft();

    try {
      render(<Harness activeTabId="tab-b" />);

      expect(scroll.read()).toBe(120 + ACTIVE_TAB_SCROLL_MARGIN_PX);
    } finally {
      scroll.restore();
      restoreLayout();
    }
  });

  it('切换到另一个标签时按新位置重新定位', () => {
    const restoreLayout = installTabScrollLayout(
      { left: 0, right: 200 },
      {
        'tab-a': { left: 0, right: 100 },
        'tab-b': { left: 400, right: 500 },
      },
    );
    const scroll = installTrackedScrollLeft();

    try {
      const { rerender } = render(<Harness activeTabId="tab-a" />);
      expect(scroll.read()).toBe(0);

      rerender(<Harness activeTabId="tab-b" />);

      expect(scroll.read()).toBe(300 + ACTIVE_TAB_SCROLL_MARGIN_PX);
    } finally {
      scroll.restore();
      restoreLayout();
    }
  });

  it('激活标签已完整可见时保留用户手动滚动的位置', () => {
    const restoreLayout = installTabScrollLayout(
      { left: 0, right: 200 },
      {
        'tab-a': { left: 0, right: 100 },
        'tab-b': { left: 50, right: 150 },
      },
    );
    const scroll = installTrackedScrollLeft();

    try {
      const { rerender } = render(<Harness activeTabId="tab-a" />);
      const container = screen.getByRole('tablist');

      // 模拟用户手动往右滚了一段（两个标签仍在可视区内）。
      container.scrollLeft = 72;
      rerender(<Harness activeTabId="tab-b" />);

      expect(container.scrollLeft).toBe(72);
      expect(scroll.read()).toBe(72);
    } finally {
      scroll.restore();
      restoreLayout();
    }
  });

  it('没有激活标签时安全跳过', () => {
    const restoreLayout = installTabScrollLayout(
      { left: 0, right: 200 },
      {
        'tab-b': { left: 400, right: 500 },
      },
    );
    const scroll = installTrackedScrollLeft();

    try {
      render(<Harness activeTabId={null} />);

      expect(scroll.read()).toBe(0);
    } finally {
      scroll.restore();
      restoreLayout();
    }
  });
});
