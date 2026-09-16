// @vitest-environment jsdom
/**
 * 面板级页签栏：tablist / tab ARIA 关联、roving tabindex、←/→ 切换与焦点、
 * 收起按钮。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  TerminalPanelTabs,
  terminalPanelPanelElementId,
  terminalPanelTabElementId,
} from './TerminalPanelTabs.js';

afterEach(() => {
  cleanup();
});

const ID_BASE = 'panel-test';

function renderTabs(activeTab: 'terminal' | 'ports' = 'terminal') {
  const onSelectTab = vi.fn();
  const onRequestClose = vi.fn();
  const view = render(
    <TerminalPanelTabs
      idBase={ID_BASE}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
      onRequestClose={onRequestClose}
    />,
  );
  return { onSelectTab, onRequestClose, view };
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

  it('点击页签回调选中项，选中态跟随 activeTab', () => {
    const { onSelectTab, view } = renderTabs();

    fireEvent.click(screen.getByRole('tab', { name: '端口' }));
    expect(onSelectTab).toHaveBeenCalledWith('ports');

    view.rerender(
      <TerminalPanelTabs
        idBase={ID_BASE}
        activeTab="ports"
        onSelectTab={onSelectTab}
        onRequestClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: '端口' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '终端' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '端口' }).getAttribute('tabindex')).toBe('0');
  });

  it('→/← 切换页签并把焦点移到新页签', () => {
    const { onSelectTab, view } = renderTabs();
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onSelectTab).toHaveBeenCalledWith('ports');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '端口' }));

    view.rerender(
      <TerminalPanelTabs
        idBase={ID_BASE}
        activeTab="ports"
        onSelectTab={onSelectTab}
        onRequestClose={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onSelectTab).toHaveBeenLastCalledWith('terminal');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '终端' }));

    view.rerender(
      <TerminalPanelTabs
        idBase={ID_BASE}
        activeTab="terminal"
        onSelectTab={onSelectTab}
        onRequestClose={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onSelectTab).toHaveBeenLastCalledWith('ports');
  });

  it('收起按钮保持既有语义', () => {
    const { onRequestClose } = renderTabs();

    fireEvent.click(screen.getByRole('button', { name: '收起终端面板' }));

    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
