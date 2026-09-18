// @vitest-environment jsdom
/**
 * 面板级页签栏：tablist / tab ARIA 关联、roving tabindex、←/→ 切换与焦点、
 * 收起按钮、最大化/还原切换按钮，以及 rail 右键菜单（最大化/还原 + 隐藏面板）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  TerminalPanelTabs,
  terminalPanelPanelElementId,
  terminalPanelTabElementId,
  type TerminalPanelTabsProps,
} from './TerminalPanelTabs.js';

afterEach(() => {
  cleanup();
});

const ID_BASE = 'panel-test';

function renderTabs(
  activeTab: 'terminal' | 'ports' = 'terminal',
  overrides: Partial<TerminalPanelTabsProps> = {},
) {
  const onSelectTab = vi.fn();
  const onRequestClose = vi.fn();
  const onToggleMaximized = vi.fn();
  const onMovePosition = vi.fn();
  const view = render(
    <TerminalPanelTabs
      idBase={ID_BASE}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
      onRequestClose={onRequestClose}
      maximized={false}
      onToggleMaximized={onToggleMaximized}
      position="bottom"
      onMovePosition={onMovePosition}
      dockingDisabledReason={null}
      {...overrides}
    />,
  );
  return { onSelectTab, onRequestClose, onToggleMaximized, onMovePosition, view };
}

/** rerender 需要完整 props：集中一处，避免每个用例抄一遍。 */
function tabsElement(overrides: Partial<TerminalPanelTabsProps>) {
  return (
    <TerminalPanelTabs
      idBase={ID_BASE}
      activeTab="terminal"
      onSelectTab={vi.fn()}
      onRequestClose={vi.fn()}
      maximized={false}
      onToggleMaximized={vi.fn()}
      position="bottom"
      onMovePosition={vi.fn()}
      dockingDisabledReason={null}
      {...overrides}
    />
  );
}

describe('TerminalPanelTabs', () => {
  it('渲染 终端/端口 两个页签并暴露 tablist/tab ARIA 关联', () => {
    renderTabs();

    const tablist = screen.getByRole('tablist', { name: '终端面板视图' });
    expect(tablist).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    const terminalTab = screen.getByRole('tab', { name: '终端' });
    expect(terminalTab.getAttribute('aria-selected')).toBe('true');
    expect(terminalTab.getAttribute('tabindex')).toBe('0');
    expect(terminalTab.getAttribute('aria-controls')).toBe(terminalPanelPanelElementId(ID_BASE));
    expect(terminalTab.id).toBe(terminalPanelTabElementId(ID_BASE, 'terminal'));

    const portsTab = screen.getByRole('tab', { name: '端口' });
    expect(portsTab.getAttribute('aria-selected')).toBe('false');
    // roving tabindex：整组页签只占一个 Tab 停靠点。
    expect(portsTab.getAttribute('tabindex')).toBe('-1');
    expect(portsTab.id).toBe(terminalPanelTabElementId(ID_BASE, 'ports'));
  });

  it('视图页签是纯文本（无 svg 图标），rail 操作按钮的图标不受影响', () => {
    renderTabs();

    for (const name of ['终端', '端口']) {
      expect(screen.getByRole('tab', { name }).querySelectorAll('svg')).toHaveLength(0);
    }
    expect(screen.getByTestId('terminal-panel-collapse').querySelectorAll('svg')).toHaveLength(1);
    expect(
      screen.getByTestId('terminal-panel-maximize-toggle').querySelectorAll('svg'),
    ).toHaveLength(1);
  });

  it('点击页签回调选中项，选中态跟随 activeTab', () => {
    const { onSelectTab, onRequestClose, onToggleMaximized, view } = renderTabs();

    fireEvent.click(screen.getByRole('tab', { name: '端口' }));
    expect(onSelectTab).toHaveBeenCalledWith('ports');

    view.rerender(
      tabsElement({ activeTab: 'ports', onSelectTab, onRequestClose, onToggleMaximized }),
    );

    expect(screen.getByRole('tab', { name: '端口' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '终端' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '端口' }).getAttribute('tabindex')).toBe('0');
  });

  it('→/← 切换页签并把焦点移到新页签', () => {
    const { onSelectTab, onRequestClose, onToggleMaximized, view } = renderTabs();
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onSelectTab).toHaveBeenCalledWith('ports');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '端口' }));

    view.rerender(
      tabsElement({ activeTab: 'ports', onSelectTab, onRequestClose, onToggleMaximized }),
    );

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onSelectTab).toHaveBeenLastCalledWith('terminal');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '终端' }));

    view.rerender(
      tabsElement({ activeTab: 'terminal', onSelectTab, onRequestClose, onToggleMaximized }),
    );

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onSelectTab).toHaveBeenLastCalledWith('ports');
  });

  it('收起按钮保持既有语义', () => {
    const { onRequestClose } = renderTabs();

    fireEvent.click(screen.getByRole('button', { name: '收起终端面板' }));

    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('最大化切换按钮：aria-label / title / data-maximized 随状态切换', () => {
    const { onToggleMaximized, view } = renderTabs();

    const maximizeButton = screen.getByRole('button', { name: '最大化终端面板' });
    expect(maximizeButton.getAttribute('title')).toBe('最大化终端面板');
    expect(maximizeButton.getAttribute('data-maximized')).toBe('false');
    expect(maximizeButton.getAttribute('data-testid')).toBe('terminal-panel-maximize-toggle');

    fireEvent.click(maximizeButton);
    expect(onToggleMaximized).toHaveBeenCalledTimes(1);

    view.rerender(tabsElement({ maximized: true, onToggleMaximized }));

    const restoreButton = screen.getByRole('button', { name: '还原终端面板' });
    expect(restoreButton.getAttribute('title')).toBe('还原终端面板');
    expect(restoreButton.getAttribute('data-maximized')).toBe('true');
  });

  it('右键 rail（含空白区）打开面板菜单：最大化面板 + 隐藏面板', () => {
    const { onToggleMaximized, onRequestClose } = renderTabs();

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 40,
      clientY: 80,
    });

    expect(screen.getByTestId('terminal-context-menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '最大化面板' }));
    expect(onToggleMaximized).toHaveBeenCalledTimes(1);
    // 点击菜单项后菜单自行关闭（TerminalContextMenu 既有语义）。
    expect(screen.queryByTestId('terminal-context-menu')).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 12,
      clientY: 24,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '隐藏面板' }));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('右键页签同样打开面板菜单（事件冒泡到 rail，属预期行为）', () => {
    renderTabs();

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-terminal'), {
      clientX: 20,
      clientY: 30,
    });

    expect(screen.getByTestId('terminal-context-menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '最大化面板' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '隐藏面板' })).toBeTruthy();
  });

  it('maximized=true 时菜单项文案切换为还原面板', () => {
    const { onToggleMaximized } = renderTabs('terminal', { maximized: true });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 20,
      clientY: 30,
    });

    expect(screen.queryByRole('menuitem', { name: '最大化面板' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '还原面板' }));
    expect(onToggleMaximized).toHaveBeenCalledTimes(1);
  });

  it('底部：菜单列出「移动到左右」，title 说明同侧侧栏会自动收起', () => {
    const { onMovePosition, onRequestClose } = renderTabs();

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 40,
      clientY: 80,
    });

    // 当前位置是底部，因此目的地只有左右两侧。
    expect(screen.queryByRole('menuitem', { name: '移动面板到底部' })).toBeNull();
    const moveLeft = screen.getByRole('menuitem', { name: '移动面板到左侧' });
    expect(moveLeft.getAttribute('title')).toContain('左侧边栏会自动收起');
    expect(screen.getByRole('menuitem', { name: '移动面板到右侧' })).toBeTruthy();
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    fireEvent.click(moveLeft);
    expect(onMovePosition).toHaveBeenCalledWith('left');
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('terminal-context-menu')).toBeNull();
  });

  it('侧停靠：只列出与当前位置不同的目的地，最大化项禁用并说明原因', () => {
    const { onMovePosition } = renderTabs('terminal', { position: 'left' });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 10,
      clientY: 10,
    });

    expect(screen.queryByRole('menuitem', { name: '移动面板到左侧' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '移动面板到右侧' })).toBeTruthy();

    const maximizeItem = screen.getByRole('menuitem', { name: '最大化面板' }) as HTMLButtonElement;
    expect(maximizeItem.disabled).toBe(true);
    expect(maximizeItem.getAttribute('title')).toContain('无需最大化');

    fireEvent.click(screen.getByRole('menuitem', { name: '移动面板到底部' }));
    expect(onMovePosition).toHaveBeenCalledWith('bottom');
  });

  it('侧停靠：最大化切换按钮禁用并给出原因', () => {
    renderTabs('terminal', { position: 'right' });

    const maximizeButton = screen.getByRole('button', {
      name: '最大化终端面板',
    }) as HTMLButtonElement;
    expect(maximizeButton.disabled).toBe(true);
    expect(maximizeButton.getAttribute('title')).toContain('侧停靠');
  });

  it('停靠不可用：停靠项禁用、title 为调用方给的原因、点击不触发回调', () => {
    const reason = '视口不足 768px，侧停靠会把工作台挤到无法使用';
    const { onMovePosition } = renderTabs('terminal', { dockingDisabledReason: reason });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 10,
      clientY: 10,
    });

    for (const name of ['移动面板到左侧', '移动面板到右侧']) {
      const item = screen.getByRole('menuitem', { name }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      expect(item.getAttribute('title')).toBe(reason);
      fireEvent.click(item);
    }
    expect(onMovePosition).not.toHaveBeenCalled();
  });
});
