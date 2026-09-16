// @vitest-environment jsdom
/**
 * 260531 · TeamTabBar smoke
 *
 * 覆盖统一 tab 栏的核心交互：主 tab / 子 tab 点击回调、3D 办公按钮、
 * badge 渲染、对话主 tab 的子视图（含跨层线程）展示。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TeamTabBar } from './TeamTabBar.js';

afterEach(() => cleanup());

function renderBar(overrides: Partial<Parameters<typeof TeamTabBar>[0]> = {}) {
  const onPrimaryChange = vi.fn();
  const onMiddleChange = vi.fn();
  const onOfficeClick = vi.fn();
  render(
    <div className="team-v2-root">
      <TeamTabBar
        activePrimary="overview"
        middleTab="dashboard"
        onPrimaryChange={onPrimaryChange}
        onMiddleChange={onMiddleChange}
        unreadCount={0}
        clarificationPending={0}
        showOffice
        officeActive={false}
        onOfficeClick={onOfficeClick}
        {...overrides}
      />
    </div>,
  );
  return { onPrimaryChange, onMiddleChange, onOfficeClick };
}

describe('TeamTabBar', () => {
  it('渲染 5 个主 tab 与 3D 办公按钮', () => {
    renderBar();
    for (const label of ['概览', '对话', '任务', '度量', '治理']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('3D 办公')).toBeTruthy();
  });

  it('点击主 tab 触发 onPrimaryChange', () => {
    const { onPrimaryChange } = renderBar();
    fireEvent.click(screen.getByText('任务'));
    expect(onPrimaryChange).toHaveBeenCalledWith('tasks');
  });

  it('overview 主 tab 显示子 tab（仪表盘/关系图谱/健康度）并可点击', () => {
    const { onMiddleChange } = renderBar();
    expect(screen.getByText('关系图谱')).toBeTruthy();
    fireEvent.click(screen.getByText('健康度'));
    expect(onMiddleChange).toHaveBeenCalledWith('health');
  });

  it('对话主 tab 子视图含「层级流动」与「当前对话」', () => {
    renderBar({ activePrimary: 'conversation', middleTab: 'conversation' });
    expect(screen.getByText('层级流动')).toBeTruthy();
    expect(screen.getByText('当前对话')).toBeTruthy();
  });

  it('度量主 tab 子视图含「用量」「耗时」「工具调用」', () => {
    renderBar({ activePrimary: 'metrics', middleTab: 'usage' });
    expect(screen.getByText('用量')).toBeTruthy();
    expect(screen.getByText('耗时')).toBeTruthy();
    expect(screen.getByText('工具调用')).toBeTruthy();
  });

  it('3D 办公按钮点击触发回调', () => {
    const { onOfficeClick } = renderBar();
    fireEvent.click(screen.getByText('3D 办公'));
    expect(onOfficeClick).toHaveBeenCalledTimes(1);
  });

  it('officeActive 时不显示子 tab 行', () => {
    renderBar({ officeActive: true });
    // office 视图下隐藏子 tab（仪表盘等不应出现）
    expect(screen.queryByText('仪表盘')).toBeNull();
  });

  it('对话主 tab 上渲染未读 badge', () => {
    renderBar({ activePrimary: 'conversation', unreadCount: 3 });
    // badge 同时出现在「对话」主 tab 与「消息」子 tab 上
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
  });

  it('showOffice=false 时不渲染 3D 按钮', () => {
    renderBar({ showOffice: false });
    expect(screen.queryByText('3D 办公')).toBeNull();
  });
});

describe('TeamTabBar · variant="single"（方案 G 单行超级栏）', () => {
  function renderSingle(overrides: Partial<Parameters<typeof TeamTabBar>[0]> = {}) {
    const onPrimaryChange = vi.fn();
    const onMiddleChange = vi.fn();
    const onOfficeClick = vi.fn();
    render(
      <div className="team-v2-root">
        <TeamTabBar
          variant="single"
          activePrimary="overview"
          middleTab="dashboard"
          onPrimaryChange={onPrimaryChange}
          onMiddleChange={onMiddleChange}
          unreadCount={0}
          clarificationPending={0}
          showOffice
          officeActive={false}
          onOfficeClick={onOfficeClick}
          leadingSlot={<span>工作区切换器</span>}
          centerSlot={<span>状态栏</span>}
          {...overrides}
        />
      </div>,
    );
    return { onPrimaryChange, onMiddleChange, onOfficeClick };
  }

  it('渲染 leadingSlot / centerSlot 与 5 个主 tab', () => {
    renderSingle();
    expect(screen.getByText('工作区切换器')).toBeTruthy();
    expect(screen.getByText('状态栏')).toBeTruthy();
    // 主 tab 以 role="tab" 渲染（排除隐藏测量行的同名文本）。
    for (const label of ['概览', '对话', '任务', '度量', '治理']) {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('宽度充足（未降级）时：状态栏合并进上下文行，nav 行不重复渲染', () => {
    renderSingle();
    const status = screen.getByText('状态栏');
    expect(status.closest('.team-tab-bar__center')).toBeTruthy();
    expect(status.closest('.team-tab-bar__status')).toBeNull();
    // 状态栏只渲染一次（不再出现「上下文行 + nav 行」双份）
    expect(screen.getAllByText('状态栏')).toHaveLength(1);
  });

  it('stackCenterSlot=true 时：状态栏独占独立状态行', () => {
    renderSingle({ stackCenterSlot: true });
    const status = screen.getByText('状态栏');
    expect(status.closest('.team-tab-bar__status')).toBeTruthy();
    expect(status.closest('.team-tab-bar__center')).toBeNull();
    // 上下文行仍保留 leading
    expect(screen.getByText('工作区切换器')).toBeTruthy();
  });

  it('子 tab 常驻第二行直接可见（无需点击主 tab）', () => {
    renderSingle();
    // overview 主 tab 激活 → 其子视图「仪表盘/关系图谱/健康度」常驻可见
    expect(screen.getByRole('tab', { name: /关系图谱/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /健康度/ })).toBeTruthy();
  });

  it('点击常驻子 tab 一键切换', () => {
    const { onMiddleChange } = renderSingle();
    fireEvent.click(screen.getByRole('tab', { name: /关系图谱/ }));
    expect(onMiddleChange).toHaveBeenCalledWith('graph');
  });

  it('点击主 tab 直接切换（不再走两步下拉）', () => {
    const { onPrimaryChange } = renderSingle();
    fireEvent.click(screen.getByRole('tab', { name: /任务/ }));
    expect(onPrimaryChange).toHaveBeenCalledWith('tasks');
  });

  it('office 视图下不显示子 tab 行', () => {
    renderSingle({ officeActive: true });
    expect(screen.queryByRole('tab', { name: /关系图谱/ })).toBeNull();
  });

  it('键盘 ArrowRight 在主 tab 间移动到下一个', () => {
    const { onPrimaryChange } = renderSingle();
    fireEvent.keyDown(screen.getByRole('tab', { name: /概览/ }), { key: 'ArrowRight' });
    expect(onPrimaryChange).toHaveBeenCalledWith('files');
  });

  it('键盘 End 跳到最后一个主 tab', () => {
    const { onPrimaryChange } = renderSingle();
    fireEvent.keyDown(screen.getByRole('tab', { name: /概览/ }), { key: 'End' });
    expect(onPrimaryChange).toHaveBeenCalledWith('governance');
  });

  it('键盘 ArrowRight 切换到下一个子 tab', () => {
    const { onMiddleChange } = renderSingle();
    fireEvent.keyDown(screen.getByRole('tab', { name: /仪表盘/ }), { key: 'ArrowRight' });
    expect(onMiddleChange).toHaveBeenCalledWith('graph');
  });

  it('键盘 ArrowLeft 从首个循环到最后一个子 tab', () => {
    const { onMiddleChange } = renderSingle();
    fireEvent.keyDown(screen.getByRole('tab', { name: /仪表盘/ }), { key: 'ArrowLeft' });
    expect(onMiddleChange).toHaveBeenCalledWith('health');
  });

  it('非导航键不触发切换', () => {
    const { onPrimaryChange, onMiddleChange } = renderSingle();
    fireEvent.keyDown(screen.getByRole('tab', { name: /概览/ }), { key: 'a' });
    expect(onPrimaryChange).not.toHaveBeenCalled();
    expect(onMiddleChange).not.toHaveBeenCalled();
  });
});

describe('TeamTabBar · variant=single · 子 tab 并入 nav 行', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  afterEach(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    }
    cleanup();
  });

  function mockLayout(navWidth: number) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => navWidth,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 60,
    });
  }

  function renderMergedBar() {
    const onMiddleChange = vi.fn();
    render(
      <div className="team-v2-root">
        <TeamTabBar
          variant="single"
          activePrimary="overview"
          middleTab="dashboard"
          onPrimaryChange={vi.fn()}
          onMiddleChange={onMiddleChange}
          unreadCount={0}
          clarificationPending={0}
          showOffice
          officeActive={false}
          onOfficeClick={vi.fn()}
          leadingSlot={<span>工作区切换器</span>}
          centerSlot={<span>状态栏</span>}
        />
      </div>,
    );
    return { onMiddleChange };
  }

  it('宽度充足时：子 tab 并入 nav 行，无独立子 tab 行', () => {
    mockLayout(1400);
    renderMergedBar();
    expect(document.querySelector('.team-tab-bar__sub-inline')).toBeTruthy();
    expect(document.querySelector('.team-tab-bar__sub-row')).toBeNull();
    expect(document.querySelector('.team-tab-bar__nav')?.getAttribute('data-merged-sub')).toBe(
      'true',
    );
  });

  it('宽度不足时：子 tab 保持独立行', () => {
    mockLayout(400);
    renderMergedBar();
    expect(document.querySelector('.team-tab-bar__sub-inline')).toBeNull();
    expect(document.querySelector('.team-tab-bar__sub-row')).toBeTruthy();
    expect(
      document.querySelector('.team-tab-bar__nav')?.getAttribute('data-merged-sub'),
    ).toBeNull();
  });

  it('合并态下子 tab 仍可一键切换', () => {
    mockLayout(1400);
    const { onMiddleChange } = renderMergedBar();
    fireEvent.click(screen.getByRole('tab', { name: /关系图谱/ }));
    expect(onMiddleChange).toHaveBeenCalledWith('graph');
  });
});

describe('TeamTabBar · 窄屏主 tab 横向滚动（不折叠）', () => {
  function renderSingle(overrides: Partial<Parameters<typeof TeamTabBar>[0]> = {}) {
    const onPrimaryChange = vi.fn();
    render(
      <div className="team-v2-root">
        <TeamTabBar
          variant="single"
          activePrimary="overview"
          middleTab="dashboard"
          onPrimaryChange={onPrimaryChange}
          onMiddleChange={vi.fn()}
          unreadCount={0}
          clarificationPending={0}
          showOffice
          officeActive={false}
          onOfficeClick={vi.fn()}
          {...overrides}
        />
      </div>,
    );
    return { onPrimaryChange };
  }

  function scrollContainer(): HTMLElement {
    const el = document.querySelector('.team-tab-bar__tab-scroll');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  it('没有「更多」折叠按钮，6 个主 tab 全部常驻可点', () => {
    renderSingle();
    expect(screen.queryByRole('button', { name: /更多/ })).toBeNull();
    for (const label of ['概览', '文件', '对话', '任务', '度量', '治理']) {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
    // 6 个主 tab + 3 个子 tab（仪表盘 / 关系图谱 / 健康度）
    expect(screen.getAllByRole('tab').length).toBe(9);
  });

  it('主 tab 组是横向滚动容器：overflow-x auto、不换行、隐藏滚动条', () => {
    renderSingle();
    const group = scrollContainer();
    expect(group.style.overflowX).toBe('auto');
    expect(group.style.flexWrap).toBe('nowrap');
    expect(group.style.scrollbarWidth).toBe('none');
  });

  it('隐藏测量行零尺寸且裁切，不会撑出可滚区域', () => {
    renderSingle();
    const ghost = scrollContainer().firstElementChild as HTMLElement;
    const styleAttr = ghost.getAttribute('style') ?? '';
    expect(styleAttr).toContain('width: 0');
    expect(styleAttr).toContain('height: 0');
    expect(styleAttr).toContain('overflow: hidden');
  });

  it('无可滚动内容时两端渐隐遮罩保持隐藏', () => {
    renderSingle();
    const masks = Array.from(document.querySelectorAll<HTMLElement>('.team-tab-bar__edge-mask'));
    expect(masks).toHaveLength(2);
    for (const mask of masks) {
      expect(mask.style.opacity).toBe('0');
      expect(mask.style.pointerEvents).toBe('none');
    }
  });

  it('窄屏下主 tab 依然一击直达（无二级下拉）', () => {
    const { onPrimaryChange } = renderSingle();
    fireEvent.click(screen.getByRole('tab', { name: /治理/ }));
    expect(onPrimaryChange).toHaveBeenCalledWith('governance');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('TeamTabBar · 主 tab 滚动提示', () => {
  const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalScrollLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
  let scrollLeft = 0;

  /** 模拟「内容 800 / 视口 300」的可滚动布局。 */
  function mockScrollable() {
    scrollLeft = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 300,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });
  }

  afterEach(() => {
    const restore = (
      key: 'scrollWidth' | 'clientWidth' | 'scrollLeft',
      descriptor: PropertyDescriptor | undefined,
    ) => {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
      }
    };
    restore('scrollWidth', originalScrollWidth);
    restore('clientWidth', originalClientWidth);
    restore('scrollLeft', originalScrollLeft);
    cleanup();
  });

  function masks(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.team-tab-bar__edge-mask'));
  }

  it('内容溢出时右端渐隐打开，滚到中段两端都亮，到尾部只剩左端', () => {
    mockScrollable();
    render(
      <div className="team-v2-root">
        <TeamTabBar
          variant="single"
          activePrimary="overview"
          middleTab="dashboard"
          onPrimaryChange={vi.fn()}
          onMiddleChange={vi.fn()}
          unreadCount={0}
          clarificationPending={0}
          showOffice
          officeActive={false}
          onOfficeClick={vi.fn()}
        />
      </div>,
    );
    const group = document.querySelector('.team-tab-bar__tab-scroll') as HTMLElement;
    // 停在左端：只提示右侧还有内容
    expect(masks()[0]?.style.opacity).toBe('0');
    expect(masks()[1]?.style.opacity).toBe('1');

    scrollLeft = 200;
    fireEvent.scroll(group);
    expect(masks()[0]?.style.opacity).toBe('1');
    expect(masks()[1]?.style.opacity).toBe('1');

    scrollLeft = 500;
    fireEvent.scroll(group);
    expect(masks()[0]?.style.opacity).toBe('1');
    expect(masks()[1]?.style.opacity).toBe('0');
  });
});
