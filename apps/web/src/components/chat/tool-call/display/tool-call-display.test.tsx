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
vi.mock('../cards/desktop-tool-card.js', () => ({
  DesktopToolCard: () => <div data-testid="desktop-tool-card" />,
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

  it('虚拟 LSP MCP 与内置 lsp_* 一样走 InlineToolCall', () => {
    render(
      <ToolCallDisplay
        toolName="mcp__lsp__find_references"
        input={{ filePath: 'src/a.ts', line: 3, character: 1 }}
      />,
    );

    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();
  });

  it('未登记的工具仍走 BlockToolCall 兜底', () => {
    render(<ToolCallDisplay toolName="bash" input={{ command: 'ls' }} />);

    expect(screen.getByTestId('block-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();
  });

  it('渠道发图工具走 BlockToolCall——缩略图由 block 卡的 imageSource 渲染', () => {
    // 这是「发图结果可视化」实现的**前提**：渠道发图不在 INLINE_TOOLS 名单里。
    // 一旦有人把它加进 inline 名单，缩略图会静默消失（inline 卡不渲染 imageSource），
    // 因此用路由断言把它钉住。
    render(
      <ToolCallDisplay
        toolName="WeixinSendImage"
        input={{ file_path: 'https://example.com/assets/photo.png' }}
        status="completed"
      />,
    );

    expect(screen.getByTestId('block-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('inline-tool-call')).toBeNull();
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

    // 入参必须非空：空 `{}` 现在表示「参数还没收到」→ 会被占位卡接管，
    // 本用例要断言的是 attachments 透传后的路由结果。
    render(
      <ToolCallDisplay
        toolName="computer_use"
        input={{ instruction: '打开系统设置' }}
        attachments={attachments}
      />,
    );

    expect(screen.getByTestId('computer-use-card').getAttribute('data-attachment-count')).toBe('1');
  });

  it('desktop_control / read 传入 attachments 时仍走各自卡片，不影响既有路由', () => {
    const attachments = [
      { type: 'input_image' as const, artifactId: 'artifact-gui-1', mimeType: 'image/png' },
    ];

    render(
      <ToolCallDisplay
        toolName="desktop_control"
        input={{ action: 'screenshot' }}
        attachments={attachments}
      />,
    );
    expect(screen.getByTestId('desktop-tool-card')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();

    cleanup();

    render(
      <ToolCallDisplay
        toolName="read"
        input={{ file_path: '/tmp/a.md' }}
        attachments={attachments}
      />,
    );
    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-card')).toBeNull();
  });

  it('desktop_automation / desktop_control → DesktopToolCard，不走 BlockToolCall', () => {
    render(<ToolCallDisplay toolName="desktop_automation" input={{ action: 'status' }} />);
    expect(screen.getByTestId('desktop-tool-card')).toBeTruthy();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();

    cleanup();

    render(<ToolCallDisplay toolName="desktop_control" input={{ action: 'screenshot' }} />);
    expect(screen.getByTestId('desktop-tool-card')).toBeTruthy();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();
  });
});

/**
 * 流式入参未收全时的路由：`tool_call_delta` 的 JSON 还没闭合，协议层会退化成
 * `{ raw: '<半截 JSON>' }`。此刻必须走骨架占位，而不是把半截原文铺进真实卡片；
 * 一旦有结算信号（`tool_result` / 终态），必须立刻回到真实卡片。
 */
describe('ToolCallDisplay 参数接收中的路由', () => {
  const HALF_JSON = '{"patchText":"*** Begin Patch';

  it('半截 JSON + running + 无输出 → 占位卡，不渲染真实 block 卡', () => {
    const { container } = render(
      <ToolCallDisplay toolName="bash" input={{ raw: HALF_JSON }} status="running" />,
    );

    expect(container.querySelector('.tool-call-pending')).not.toBeNull();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();
    // 半截原始 JSON 绝不能被铺出来。
    expect(container.textContent).not.toContain('patchText');
  });

  it('半截 JSON 但已有输出 → 结算信号优先，回到真实卡片', () => {
    const { container } = render(
      <ToolCallDisplay
        toolName="bash"
        input={{ raw: HALF_JSON }}
        output={{ ok: true }}
        status="running"
      />,
    );

    expect(container.querySelector('.tool-call-pending')).toBeNull();
    expect(screen.getByTestId('block-tool-call')).toBeTruthy();
  });

  it('完整对象入参 + running → 仍走真实卡片，不进占位态', () => {
    const { container } = render(
      <ToolCallDisplay toolName="read" input={{ file_path: '/tmp/a.md' }} status="running" />,
    );

    expect(container.querySelector('.tool-call-pending')).toBeNull();
    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
  });
});

/**
 * 提问工具（`question` 网关名 / `AskUserQuestion` 显示名）的流内显隐。
 *
 * 现象回归：此前同一个提问会先在消息流里以工具条目（甚至骨架卡）出现，等
 * `question_asked` + `listPending` 拿到选项后再在 composer 上方弹出专属面板，
 * 用户看到的是「先算工具调用、随后跳成提问面板」的跳变，且等待期间界面上有两份。
 * 现在等待回答期间流内不产出任何条目，专属面板是唯一入口。
 */
describe('ToolCallDisplay 提问工具的流内显隐', () => {
  const QUESTION_INPUT = {
    questions: [{ header: '方案选择', question: '用哪种方案?', options: [{ label: '方案 A' }] }],
  };

  it('等待回答（running + 无输出）→ 不渲染任何工具条目', () => {
    const { container } = render(
      <ToolCallDisplay toolName="question" input={QUESTION_INPUT} status="running" />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('inline-tool-call')).toBeNull();
    expect(screen.queryByTestId('block-tool-call')).toBeNull();
  });

  it('入参还没收全（空 input + running）→ 也不出骨架卡', () => {
    const { container } = render(
      <ToolCallDisplay toolName="question" input={{}} status="running" />,
    );

    expect(container.querySelector('.tool-call-pending')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('模型侧显示名 AskUserQuestion 同样生效', () => {
    const { container } = render(
      <ToolCallDisplay toolName="AskUserQuestion" input={QUESTION_INPUT} status="paused" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('已回答（有 output）→ 回到 inline pill，保留只读问答记录', () => {
    render(
      <ToolCallDisplay
        toolName="question"
        input={QUESTION_INPUT}
        output={'用哪种方案?="方案 A"'}
        status="completed"
      />,
    );

    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
  });

  it('completed 但结果被裁剪（无 output）→ 仍可见，不允许从历史里消失', () => {
    render(<ToolCallDisplay toolName="question" input={QUESTION_INPUT} status="completed" />);

    expect(screen.getByTestId('inline-tool-call')).toBeTruthy();
  });
});
