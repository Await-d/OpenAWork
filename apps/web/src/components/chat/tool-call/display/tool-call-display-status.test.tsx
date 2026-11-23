// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { ToolCallDisplay } from './tool-call-display.js';
import type { ToolCallDisplayProps } from './tool-call-display.js';

beforeEach(() => {
  useDisplayPreferencesStore.setState({
    toolCallsExpandedByDefault: false,
  });
});
afterEach(cleanup);

const STATES = [
  ['running', '执行中…'],
  ['completed', '已完成'],
  ['failed', '执行失败'],
  ['cancelled', '已取消'],
  ['paused', '等待权限'],
  ['pending', '待执行'],
] as const;

describe('真实 ToolCallDisplay 名称与状态', () => {
  for (const toolName of ['tool', '', '  TOOL  ', 'vendor_custom_tool', 'grep', 'read']) {
    it.each(STATES)(`${JSON.stringify(toolName)} 的 %s 状态可读且不误报完成`, (status, label) => {
      const { container } = render(
        <ToolCallDisplay
          toolName={toolName}
          // 入参必须非空：空 `{}` 现在表示「参数还没收到」→ 会被占位卡接管，
          // 本用例断言的是各状态下的真实卡片文案，与参数内容无关。
          input={{ query: 'keyword' }}
          // resolver 支持 cancelled/pending，公共卡片类型尚未纳入 wire 值。
          status={status as ToolCallDisplayProps['status']}
        />,
      );
      expect(screen.getByText(label)).toBeTruthy();
      expect(container.firstElementChild?.getAttribute('data-tool-status')).toBe(status);
      const summary = container.querySelector(
        '.tool-call-block-title, .tool-call-inline-summary',
      )?.textContent;
      if (!toolName.trim() || toolName.trim().toLowerCase() === 'tool') {
        expect(summary).toBe('工具调用');
        expect(container.textContent).not.toMatch(/已执行了\s*tool/i);
      } else if (toolName === 'vendor_custom_tool') {
        expect(summary).toContain('vendor_custom_tool');
      }
      if (status !== 'completed') {
        expect(summary).not.toMatch(/^已|^(调用|执行)了/);
        expect(screen.queryByText('已完成')).toBeNull();
      }
    });
  }

  it.each(['tool', 'vendor_custom_tool', 'grep'])('%s 的 isError 优先于 completed', (toolName) => {
    const { container } = render(
      <ToolCallDisplay
        toolName={toolName}
        input={{}}
        output="permission denied"
        status="completed"
        isError
      />,
    );
    expect(screen.getByText('执行失败')).toBeTruthy();
    expect(screen.queryByText('已完成')).toBeNull();
    expect(container.textContent).not.toMatch(/已执行了|已搜索了/);
  });

  it('没有显式状态时仍按真实 resolver 从输出推断完成，否则执行中', () => {
    const { rerender } = render(<ToolCallDisplay toolName="tool" input={{ query: 'keyword' }} />);
    expect(screen.getByText('执行中…')).toBeTruthy();
    rerender(<ToolCallDisplay toolName="tool" input={{ query: 'keyword' }} output="raw result" />);
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('已有部分输出时仍保留显式的执行中状态', () => {
    render(<ToolCallDisplay toolName="tool" input={{}} output="partial result" status="running" />);
    expect(screen.getByText('执行中…')).toBeTruthy();
    expect(screen.queryByText('已完成')).toBeNull();
  });

  it.each([
    ['ExitPlanMode', '等待确认'],
    ['vendor_custom_tool', '等待权限'],
  ])('%s 暂停时说明等待的操作', (toolName, label) => {
    render(<ToolCallDisplay toolName={toolName} input={{}} status="paused" />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('已完成')).toBeNull();
  });

  /**
   * 契约变更：AskUserQuestion 在**等待回答期间**不得在消息流里渲染任何工具条目——
   * 唯一入口是 composer 上方的专属提问面板（`InlineQuestionPanel`，等待态由面板自身
   * 表达）。此前这里断言它显示「等待回答」，那正是「先算工具调用、随后跳成提问面板」
   * 的时序跳变来源。
   *
   * 但等待期间由 composer 上方的 `InlineQuestionPanel` 承载，消息流不立项；**结算后
   * 必须恢复可见**（历史回看唯一依据）——历史会话没有 pending 面板，这条只读问答摘要
   * 是用户回看「当时问了什么、答了什么」的唯一凭据，不允许为了「干净」把它一起藏掉。
   */
  it('AskUserQuestion 等待期间不立项，结算后恢复可见并保留问答摘要', () => {
    const { container, rerender } = render(
      <ToolCallDisplay toolName="AskUserQuestion" input={{}} status="paused" />,
    );

    // 等待回答：只剩 composer 上方的提问面板，消息流里不产出任何条目。
    expect(container.firstElementChild).toBeNull();
    expect(screen.queryByText('等待回答')).toBeNull();

    // 结算（output 到达 + completed）：条目必须重新出现，摘要不复述「等待回答」。
    rerender(
      <ToolCallDisplay
        toolName="AskUserQuestion"
        input={{}}
        output={'用哪种方案?="方案 A"'}
        status="completed"
      />,
    );

    const root = container.firstElementChild;
    expect(root?.getAttribute('data-tool-status')).toBe('completed');
    expect(container.textContent).toContain('AskUserQuestion');

    // 展开后可回看问答记录（`question-answer-preview` 的行卡形态）。
    fireEvent.click(screen.getByRole('button', { name: /AskUserQuestion/ }));
    expect(screen.getByText('用哪种方案?')).toBeTruthy();
    expect(screen.getByText('方案 A')).toBeTruthy();
  });

  it('未知工具保留按钮展开、原始输出和复制入口', () => {
    render(
      <ToolCallDisplay
        toolName="tool"
        input={{ request: 'original input' }}
        output="original raw output"
        status={'cancelled' as ToolCallDisplayProps['status']}
      />,
    );
    const disclosure = screen.getByRole('button', { name: /工具调用/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('original raw output')).toBeTruthy();
    expect(screen.getByText('original input')).toBeTruthy();
    expect(screen.getByTitle('Copy')).toBeTruthy();
    fireEvent.click(disclosure);
    expect(screen.queryByText('original raw output')).toBeNull();
  });

  it('内联工具仍支持 Enter 和空格展开原始输出', () => {
    render(<ToolCallDisplay toolName="read" input={{}} output="retained output" status="failed" />);
    const disclosure = screen.getByRole('button', { name: /read/ });
    fireEvent.keyDown(disclosure, { key: 'Enter' });
    // 失败态走结构化失败卡：结论行与「原始输出」都会给出这段文本。
    expect(screen.getAllByText('retained output').length).toBeGreaterThan(0);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(disclosure, { key: ' ' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  });

  it('已完成的已知工具保留原有过去式摘要，非完成状态不改写路径', () => {
    const { container, rerender } = render(
      <ToolCallDisplay toolName="read" input={{ path: '已创建了目录/file.ts' }} status="running" />,
    );
    expect(container.querySelector('.tool-call-inline-summary')?.textContent).toBe(
      '查看 已创建了目录/file.ts',
    );
    rerender(<ToolCallDisplay toolName="grep" input={{}} status="completed" />);
    expect(screen.getByText('已搜索了内容')).toBeTruthy();
    rerender(<ToolCallDisplay toolName="vendor_custom_tool" input={{}} status="completed" />);
    expect(screen.getByText('已执行了 vendor_custom_tool')).toBeTruthy();
  });

  it('Skill 完成仍表达加载指令', () => {
    render(<ToolCallDisplay toolName="Skill" input={{ skill: 'frontend' }} status="completed" />);
    expect(screen.getByText('已加载技能 frontend')).toBeTruthy();
    expect(screen.queryByText(/任务成功|技能执行成功/)).toBeNull();
  });
});
