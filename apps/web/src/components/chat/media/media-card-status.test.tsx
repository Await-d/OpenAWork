// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaCardStatus } from './media-card-status.js';

afterEach(() => {
  cleanup();
});

describe('MediaCardStatus', () => {
  it('pending 显示徽章、文件名与「加载中…」，且没有重试按钮', () => {
    render(<MediaCardStatus fileName="demo.mp4" kind="pending" />);

    const status = document.querySelector('.media-card-status[data-kind="pending"]');
    expect(status).not.toBeNull();
    expect(screen.getByText('MP4')).toBeTruthy();
    expect(screen.getByText('demo.mp4')).toBeTruthy();
    expect(screen.getByText('加载中…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('error 显示错误详情与重试按钮，点击回调生效', () => {
    const onRetry = vi.fn();
    render(
      <MediaCardStatus fileName="demo.mp4" kind="error" detail="网络异常" onRetry={onRetry} />,
    );

    expect(document.querySelector('.media-card-status[data-kind="error"]')).not.toBeNull();
    expect(screen.getByText('加载失败：网络异常')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error 无详情时只显示「加载失败」', () => {
    render(<MediaCardStatus fileName="demo.mp4" kind="error" />);

    expect(screen.getByText('加载失败')).toBeTruthy();
  });

  it('error 且未提供 onRetry 时不渲染按钮（纯展示）', () => {
    render(<MediaCardStatus fileName="demo.mp4" kind="error" detail="x" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('没有文件名时退化为通用文案（结构化媒体 part 不一定带名字）', () => {
    render(<MediaCardStatus kind="pending" />);

    expect(screen.getByText('媒体文件')).toBeTruthy();
    expect(screen.getByText('FILE')).toBeTruthy();
  });
});
