// @vitest-environment jsdom
/**
 * T-19 端到端渲染覆盖：`tool_result.attachments`（computer_use 最终截图）
 * 从消息 parts 一路透传到 `ComputerUseToolCard` 的截图区。
 *
 * 这里只替身两处重依赖：
 *   - `@openAwork/shared-ui` 的视觉状态判定 / 图标（vitest 的全局 mock 不含）；
 *   - `ToolCallImagePreview`（真实实现会在挂载后向网关请求产物）。
 * 其余链路（ChatPageSections → renderToolCallContent → ToolCallDisplay →
 * ComputerUseToolCard → ScreenshotSection → resolveToolCallImageSource）
 * 全部走真实实现。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputImageContent } from '@openAwork/shared';

vi.mock('@openAwork/shared-ui', () => ({
  BashTerminalCard: () => null,
  GenerativeUIRenderer: () => null,
  ToolGlyph: () => <span data-testid="tool-glyph" />,
  UnifiedCodeDiff: () => null,
  getProviderUiList: () => [],
  resolveToolCallCardDisplayData: () => ({
    displayToolName: 'tool',
    summary: 'tool',
    showInputField: true,
    hasDetails: true,
  }),
  resolveToolVisualStatus: ({ status, isError }: { status?: string; isError?: boolean }) => {
    if (isError === true) return 'failed';
    switch ((status ?? '').trim().toLowerCase()) {
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'paused':
        return 'paused';
      case 'running':
        return 'running';
      default:
        return 'running';
    }
  },
}));

vi.mock('../tool-call/io/ToolCallImagePreview.js', () => ({
  ToolCallImagePreview: ({
    source,
  }: {
    source: { kind: string; artifactId?: string; alt: string } | null;
  }) =>
    source ? (
      <div
        data-testid="tool-image-preview"
        data-kind={source.kind}
        data-artifact-id={source.artifactId ?? ''}
        data-alt={source.alt}
      />
    ) : null,
}));

import type { ChatMessage, ChatToolPart } from '../../conversation-runtime/messages/support.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from './ChatPageSections.js';

/** 网关对 computer_use 最终截图回传的附件形态（只含 artifactId，无 base64）。 */
const GUI_SNAPSHOT: InputImageContent = {
  type: 'input_image',
  artifactId: 'artifact-gui-1',
  fileName: 'computer-use-final.png',
  mimeType: 'image/png',
};

const SUCCESS_OUTPUT = JSON.stringify({
  success: true,
  steps: 2,
  summary: '已完成：打开了系统设置',
  history: [
    { step: 1, thought: '点击开始菜单', action: 'click', success: true },
    { step: 2, thought: '在搜索框输入“设置”', action: 'type', success: true },
  ],
});

function buildComputerUsePart(overrides?: Partial<ChatToolPart>): ChatToolPart {
  return {
    id: 'tool-call-gui-1',
    type: 'tool',
    toolCallId: 'tool-call-gui-1',
    toolName: 'computer_use',
    input: { instruction: '打开系统设置' },
    output: SUCCESS_OUTPUT,
    status: 'completed',
    ...overrides,
  };
}

function expandCard(): void {
  fireEvent.click(screen.getByRole('button', { expanded: false }));
}

afterEach(() => {
  cleanup();
});

describe('tool_result attachments → computer_use 最终截图', () => {
  it('parts 路径把 attachments 解析为 artifact 预览并渲染出来', () => {
    const message: ChatMessage = {
      id: 'assistant-computer-use',
      role: 'assistant',
      content: '',
      parts: [buildComputerUsePart({ attachments: [GUI_SNAPSHOT] })],
      status: 'completed',
    };

    render(<>{renderChatMessageContentWithOptions(message)}</>);
    expandCard();

    const preview = screen.getByTestId('tool-image-preview');
    expect(preview.getAttribute('data-kind')).toBe('artifact');
    expect(preview.getAttribute('data-artifact-id')).toBe('artifact-gui-1');
    expect(preview.getAttribute('data-alt')).toBe('GUI 操作截图');
  });

  it('流式路径（renderStreamingChatMessageContentWithOptions）同样渲染最终截图', () => {
    const message: ChatMessage = {
      id: 'assistant-computer-use-streaming',
      role: 'assistant',
      content: '',
      parts: [
        buildComputerUsePart({ status: 'running', output: undefined, attachments: [GUI_SNAPSHOT] }),
      ],
      status: 'streaming',
    };

    render(<>{renderStreamingChatMessageContentWithOptions(message)}</>);
    expandCard();

    expect(screen.getByTestId('tool-image-preview').getAttribute('data-artifact-id')).toBe(
      'artifact-gui-1',
    );
  });

  it('没有 attachments 的 computer_use 仍给占位，不渲染预览', () => {
    const message: ChatMessage = {
      id: 'assistant-computer-use-empty',
      role: 'assistant',
      content: '',
      parts: [buildComputerUsePart()],
      status: 'completed',
    };

    render(<>{renderChatMessageContentWithOptions(message)}</>);
    expandCard();

    expect(screen.queryByTestId('tool-image-preview')).toBeNull();
    expect(screen.getByText('本次任务未返回截图')).toBeTruthy();
  });

  it('read 等其它工具即使带 attachments 也不会渲染 computer_use 截图预览', () => {
    const message: ChatMessage = {
      id: 'assistant-read',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'tool-call-read-1',
          type: 'tool',
          toolCallId: 'tool-call-read-1',
          toolName: 'read',
          input: { file_path: '/workspace/src/index.ts' },
          output: 'export const answer = 42;',
          status: 'completed',
          attachments: [GUI_SNAPSHOT],
        },
      ],
      status: 'completed',
    };

    render(<>{renderChatMessageContentWithOptions(message)}</>);

    expect(screen.queryByTestId('tool-image-preview')).toBeNull();
    expect(document.querySelector('[data-tool-name="computer_use"]')).toBeNull();
    // 卡片仍按 read 的正常路径（InlineToolCall）渲染，未因 attachments 崩溃。
    expect(document.querySelector('.tool-call-inline')).not.toBeNull();
  });

  it('desktop_control 的截图仍来自 output，attachments 不会改写图片来源', () => {
    const message: ChatMessage = {
      id: 'assistant-desktop-control',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'tool-call-desktop-1',
          type: 'tool',
          toolCallId: 'tool-call-desktop-1',
          toolName: 'desktop_control',
          input: { action: 'screenshot' },
          output: JSON.stringify({ artifactId: 'artifact-desktop-1', mimeType: 'image/png' }),
          status: 'completed',
          attachments: [GUI_SNAPSHOT],
        },
      ],
      status: 'completed',
    };

    render(<>{renderChatMessageContentWithOptions(message)}</>);
    expandCard();

    const preview = screen.getByTestId('tool-image-preview');
    expect(preview.getAttribute('data-artifact-id')).toBe('artifact-desktop-1');
    expect(preview.getAttribute('data-alt')).toBe('桌面截图');
  });
});
