// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSidePanel } from './SessionSidePanel.js';

afterEach(() => {
  cleanup();
});

describe('SessionSidePanel', () => {
  it('桌面停靠面板渲染 代码/预览/审查/子代理/会话概览 五个一级 tab', () => {
    const onTabChange = vi.fn();

    render(
      <SessionSidePanel activeTab="review" onTabChange={onTabChange}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '代码',
      '预览',
      '审查',
      '子代理',
      '会话概览',
    ]);
    expect(screen.queryByRole('tab', { name: '工作区' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '文件' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '浏览器' })).toBeNull();

    const codeTab = screen.getByRole('tab', { name: '代码' });
    const previewTab = screen.getByRole('tab', { name: '预览' });
    expect(codeTab.getAttribute('aria-selected')).toBe('false');
    expect(previewTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(codeTab);
    expect(onTabChange).toHaveBeenCalledWith('code');

    fireEvent.click(previewTab);
    expect(onTabChange).toHaveBeenLastCalledWith('preview');
  });

  it('键盘左右循环按 代码→预览→审查→子代理→会话概览 顺序移动', () => {
    const onTabChange = vi.fn();

    render(
      <SessionSidePanel activeTab="review" onTabChange={onTabChange}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    const codeTab = screen.getByRole('tab', { name: '代码' });
    const previewTab = screen.getByRole('tab', { name: '预览' });
    const reviewTab = screen.getByRole('tab', { name: '审查' });
    const agentTab = screen.getByRole('tab', { name: '子代理' });
    const contextTab = screen.getByRole('tab', { name: '会话概览' });

    // 审查 位于代码/预览之后：左移回到预览，右移进入子代理。
    reviewTab.focus();
    fireEvent.keyDown(reviewTab, { key: 'ArrowLeft' });

    expect(onTabChange).toHaveBeenCalledWith('preview');
    expect(document.activeElement).toBe(previewTab);

    fireEvent.keyDown(previewTab, { key: 'ArrowLeft' });

    expect(onTabChange).toHaveBeenLastCalledWith('code');
    expect(document.activeElement).toBe(codeTab);

    // 首位左移循环到末位，末位右移循环回首位的代码。
    fireEvent.keyDown(codeTab, { key: 'ArrowLeft' });

    expect(onTabChange).toHaveBeenLastCalledWith('context');
    expect(document.activeElement).toBe(contextTab);

    fireEvent.keyDown(contextTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenLastCalledWith('code');
    expect(document.activeElement).toBe(codeTab);

    fireEvent.keyDown(codeTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenLastCalledWith('preview');
    expect(document.activeElement).toBe(previewTab);

    fireEvent.keyDown(previewTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenLastCalledWith('review');
    expect(document.activeElement).toBe(reviewTab);

    fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenLastCalledWith('agent');
    expect(document.activeElement).toBe(agentTab);

    fireEvent.keyDown(agentTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenLastCalledWith('context');
    expect(document.activeElement).toBe(contextTab);
  });

  it('子代理 tab 按 subAgentCount 渲染数量徽章，数量为 0 时不渲染', () => {
    const view = render(
      <SessionSidePanel activeTab="review" onTabChange={() => undefined} subAgentCount={3}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    const agentTab = screen.getByRole('tab', { name: /子代理\s*3/ });
    expect(agentTab.querySelector('.session-side-panel__tab-badge')?.textContent).toBe('3');

    view.rerender(
      <SessionSidePanel activeTab="review" onTabChange={() => undefined} subAgentCount={0}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    expect(
      screen.getByRole('tab', { name: '子代理' }).querySelector('.session-side-panel__tab-badge'),
    ).toBeNull();
  });

  it('Home/End 聚焦首尾 tab（代码 / 会话概览）', () => {
    const onTabChange = vi.fn();

    render(
      <SessionSidePanel activeTab="code" onTabChange={onTabChange}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    const codeTab = screen.getByRole('tab', { name: '代码' });
    const contextTab = screen.getByRole('tab', { name: '会话概览' });

    codeTab.focus();
    fireEvent.keyDown(codeTab, { key: 'End' });

    expect(onTabChange).toHaveBeenLastCalledWith('context');
    expect(document.activeElement).toBe(contextTab);

    contextTab.focus();
    fireEvent.keyDown(contextTab, { key: 'Home' });

    expect(onTabChange).toHaveBeenLastCalledWith('code');
    expect(document.activeElement).toBe(codeTab);
  });

  it('trailingAction 槽位渲染在 tab 条内（与 tablist 同级）', () => {
    render(
      <SessionSidePanel
        activeTab="code"
        onTabChange={() => undefined}
        trailingAction={
          <button type="button" data-testid="panel-action">
            更多操作
          </button>
        }
      >
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    expect(screen.getByTestId('panel-action')).not.toBeNull();
  });
});
