// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSidePanel } from './SessionSidePanel.js';

afterEach(() => {
  cleanup();
});

describe('SessionSidePanel', () => {
  it('渲染浏览器预览 tab，并可通过点击上报切换', () => {
    const onTabChange = vi.fn();

    render(
      <SessionSidePanel activeTab="review" onTabChange={onTabChange}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    const browserTab = screen.getByRole('tab', { name: '浏览器预览' });
    expect(browserTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(browserTab);

    expect(onTabChange).toHaveBeenCalledWith('browser');
  });

  it('键盘左右循环覆盖浏览器预览 tab', () => {
    const onTabChange = vi.fn();

    render(
      <SessionSidePanel activeTab="context" onTabChange={onTabChange}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    const contextTab = screen.getByRole('tab', { name: 'Context' });
    const browserTab = screen.getByRole('tab', { name: '浏览器预览' });

    contextTab.focus();
    fireEvent.keyDown(contextTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('browser');
    expect(document.activeElement).toBe(browserTab);

    fireEvent.keyDown(browserTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('review');
  });

  it('End 聚焦最后一个 tab（浏览器预览）', () => {
    const onTabChange = vi.fn();

    render(
      <SessionSidePanel activeTab="review" onTabChange={onTabChange}>
        <div>面板内容</div>
      </SessionSidePanel>,
    );

    const reviewTab = screen.getByRole('tab', { name: '审查' });

    reviewTab.focus();
    fireEvent.keyDown(reviewTab, { key: 'End' });

    expect(onTabChange).toHaveBeenCalledWith('browser');
  });
});
