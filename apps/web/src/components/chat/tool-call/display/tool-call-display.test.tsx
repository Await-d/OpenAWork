// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 路由单测只关心「谁被选中」，各卡片自身的行为由各自的测试覆盖，
 * 因此这里把全部卡片替身化，避免拉起 Monaco / 产物请求等重依赖。
 */
vi.mock('../cards/batch-tool-call-card.js', () => ({
  BatchToolCallCard: () => <div data-testid="batch-card" />,
}));
vi.mock('../cards/generate-image-tool-card.js', () => ({
  GenerateImageToolCard: () => <div data-testid="generate-image-card" />,
}));
vi.mock('../cards/convert-media-tool-card.js', () => ({
  ConvertMediaToolCard: () => <div data-testid="convert-media-card" />,
}));
vi.mock('../cards/generate-audio-tool-card.js', () => ({
  GenerateAudioToolCard: () => <div data-testid="generate-audio-card" />,
}));
vi.mock('../cards/extract-video-frame-tool-card.js', () => ({
  ExtractVideoFrameToolCard: () => <div data-testid="extract-video-frame-card" />,
}));
vi.mock('../cards/computer-use-tool-card.js', () => ({
  ComputerUseToolCard: ({ attachments }: { attachments?: readonly unknown[] }) => (
    <div data-testid="computer-use-card" data-attachment-count={attachments?.length ?? 0} />
  ),
}));
vi.mock('./inline-tool-call.js', () => ({
  InlineToolCall: () => <div data-testid="inline-tool-call" />,
}));
vi.mock('./block-tool-call.js', () => ({
  BlockToolCall: () => <div data-testid="block-tool-call" />,
}));

import { ToolCallDisplay } from './tool-call-display.js';

afterEach(() => {
  cleanup();
});

describe('ToolCallDisplay 路由', () => {
  it('computer_use → ComputerUseToolCard，而不是 BlockToolCall / InlineToolCall', () => {
    render(
      <ToolCallDisplay
        toolName="computer_use"
        input={{ instruction: '打开系统设置' }}
        status="running"
      />,
    );

    expect(screen.getByTestId('computer-use-card')).toBeTruthy();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();
    expect(screen.queryByTestId('inline-tool-call')).toBeNull();
  });

  it('工具名大小写与首尾空白归一后仍命中 computer_use', () => {
    render(<ToolCallDisplay toolName="  COMPUTER_USE " input={{ instruction: '打开系统设置' }} />);

    expect(screen.getByTestId('computer-use-card')).toBeTruthy();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();
  });

  it('isInlineTool 名单里的工具仍走 InlineToolCall', () => {
    render(<ToolCallDisplay toolName="read" input={{ file_path: 'src/a.ts' }} />);

    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();
  });

  it('未登记的工具仍走 BlockToolCall 兜底', () => {
    render(<ToolCallDisplay toolName="bash" input={{ command: 'ls' }} />);

    expect(screen.getByTestId('block-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();
  });

  it('batch 仍走 BatchToolCallCard', () => {
    render(<ToolCallDisplay toolName="batch" input={{ tool_calls: [] }} />);

    expect(screen.getByTestId('batch-card')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();
  });

  it('computer_use 的 attachments 会透传给 ComputerUseToolCard', () => {
    const attachments = [
      { type: 'input_image' as const, artifactId: 'artifact-gui-1', mimeType: 'image/png' },
    ];

    render(<ToolCallDisplay toolName="computer_use" input={{}} attachments={attachments} />);

    expect(screen.getByTestId('computer-use-card').getAttribute('data-attachment-count')).toBe('1');
  });

  it('desktop_control / read 传入 attachments 时仍走各自卡片，不影响既有路由', () => {
    const attachments = [
      { type: 'input_image' as const, artifactId: 'artifact-gui-1', mimeType: 'image/png' },
    ];

    render(<ToolCallDisplay toolName="desktop_control" input={{}} attachments={attachments} />);
    expect(screen.getByTestId('block-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();

    cleanup();

    render(
      <ToolCallDisplay toolName="read" input={{ file_path: 'a.ts' }} attachments={attachments} />,
    );
    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();
  });
});
