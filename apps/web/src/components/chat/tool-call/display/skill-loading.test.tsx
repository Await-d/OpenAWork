// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { ToolCallDisplay } from './tool-call-display.js';
import type { ToolCallDisplayProps } from './tool-call-display.js';

const output = '<skill_content name="frontend"># 指南\n\n**检查**布局。</skill_content>';

beforeEach(() => {
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});
afterEach(cleanup);

describe('ToolCallDisplay Skill 真实链路', () => {
  it.each([
    ['running', '正在加载技能 frontend'],
    ['completed', '已加载技能 frontend'],
    ['failed', '技能加载失败 frontend'],
    ['cancelled', '已取消加载技能 frontend'],
  ] as const)('%s 只陈述加载状态', (status, summary) => {
    render(
      <ToolCallDisplay
        toolName="skill"
        input={{ name: 'frontend' }}
        output={output}
        // resolver 支持 wire cancelled，公共卡片类型尚未纳入该值。
        status={status as ToolCallDisplayProps['status']}
      />,
    );
    expect(screen.getByText(summary)).toBeTruthy();
    expect(screen.queryByText(/执行了/)).toBeNull();
  });

  it('Enter 展开 Markdown，Space 收起，成功预览隐藏重复参数', () => {
    render(
      <ToolCallDisplay
        toolName="skill"
        input={{ name: 'frontend' }}
        output={output}
        status="completed"
      />,
    );
    const row = screen.getByRole('button');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByRole('heading', { name: '指南' })).toBeTruthy();
    expect(screen.queryByText('参数')).toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row, { key: ' ' });
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it.each(['failed', 'cancelled'] as const)('%s 保留参数与信封原文，不展示成功文档', (status) => {
    render(
      <ToolCallDisplay
        toolName="skill"
        input={{ name: 'frontend' }}
        output={output}
        status={status as ToolCallDisplayProps['status']}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('参数')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '指南' })).toBeNull();
    expect(screen.getByText(output, { normalizer: (text) => text })).toBeTruthy();
  });

  it('isError 优先于完成状态并保留错误详情', () => {
    render(
      <ToolCallDisplay
        toolName="skill"
        input={{ skill: 'frontend' }}
        output="Error: 技能不存在"
        status="completed"
        isError
      />,
    );
    expect(screen.getByText('技能加载失败 frontend')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('参数')).toBeTruthy();
    expect(screen.getAllByText(/技能不存在/).length).toBeGreaterThan(0);
  });

  it('无法识别的完整输出保留参数和原文', () => {
    render(
      <ToolCallDisplay
        toolName="skill"
        input={{ name: 'frontend' }}
        output="旧版原始输出"
        status="completed"
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('参数')).toBeTruthy();
    expect(screen.getByText('旧版原始输出')).toBeTruthy();
  });

  it('快照截断仍给出可见提示', () => {
    render(
      <ToolCallDisplay
        toolName="skill"
        input={{ name: 'frontend' }}
        output={
          '<skill_content name="frontend"># 指南\n…[truncated, 120 chars omitted]</skill_content>'
        }
        status="completed"
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/内容已截断/)).toBeTruthy();
  });
});
