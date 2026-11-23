// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallPendingCard } from './tool-call-pending-card.js';

afterEach(() => {
  cleanup();
});

describe('ToolCallPendingCard', () => {
  it('展示中文动作 + 接收提示，且不铺任何原始入参', () => {
    render(<ToolCallPendingCard toolName="patch" />);

    expect(screen.getByText('应用补丁')).toBeTruthy();
    expect(screen.getByText('正在接收参数…')).toBeTruthy();
    // 半截 JSON / 原始字段名绝不能出现在占位卡里。
    expect(document.body.textContent).not.toContain('patchText');
    expect(document.body.textContent).not.toContain('raw');
    expect(document.body.textContent).not.toContain('{');
  });

  it('未知工具名回退到通用动作文案，不暴露英文原始键', () => {
    render(<ToolCallPendingCard toolName="mcp__custom__thing" />);

    // `mcp__` 命名空间的工具在 presentation 层会被泛化成「调用 MCP 工具」，
    // 断言真实输出即可；原始英文命名空间绝不能透出到界面。
    expect(screen.getByText('调用 MCP 工具')).toBeTruthy();
    expect(document.body.textContent).not.toContain('mcp__custom__thing');
    expect(document.body.textContent).not.toContain('{');
    expect(document.body.textContent).not.toContain('raw');
  });

  it('挂 aria-busy 供读屏识别为「仍在加载」', () => {
    const { container } = render(<ToolCallPendingCard toolName="edit" />);

    const root = container.querySelector('.tool-call-pending');
    expect(root?.getAttribute('aria-busy')).toBe('true');
    expect(root?.getAttribute('data-tool-status')).toBe('running');
  });
});
