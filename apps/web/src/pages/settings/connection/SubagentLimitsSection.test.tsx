// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubagentLimitsSection } from './SubagentLimitsSection.js';

const LIMITS = { maxRunningPerRoot: 4, maxTotalPerRoot: 24, maxNestingDepth: 1 };

afterEach(() => {
  cleanup();
});

describe('SubagentLimitsSection', () => {
  it('渲染三项限制输入并回显当前值', () => {
    render(<SubagentLimitsSection limits={LIMITS} onChange={() => undefined} />);

    expect((screen.getByLabelText('子代理同时运行上限') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('子代理任务树累计上限') as HTMLInputElement).value).toBe('24');
    expect((screen.getByLabelText('子代理嵌套深度上限') as HTMLInputElement).value).toBe('1');
  });

  it('修改并发上限时回传完整限制对象', () => {
    const onChange = vi.fn();
    render(<SubagentLimitsSection limits={LIMITS} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('子代理同时运行上限'), { target: { value: '6' } });

    expect(onChange).toHaveBeenCalledWith({ ...LIMITS, maxRunningPerRoot: 6 });
  });

  it('越界输入不触发回调（保留上一次有效值）', () => {
    const onChange = vi.fn();
    render(<SubagentLimitsSection limits={LIMITS} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('子代理嵌套深度上限'), { target: { value: '99' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled 时输入不可编辑', () => {
    render(<SubagentLimitsSection limits={LIMITS} onChange={() => undefined} disabled />);

    expect((screen.getByLabelText('子代理同时运行上限') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('子代理任务树累计上限') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('子代理嵌套深度上限') as HTMLInputElement).disabled).toBe(true);
  });
});
