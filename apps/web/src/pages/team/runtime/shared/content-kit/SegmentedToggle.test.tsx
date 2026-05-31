// @vitest-environment jsdom
/**
 * 260531 · SegmentedToggle smoke
 *
 * 覆盖受控 segmented 控件：渲染选项、选中态 aria、点击回调。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SegmentedToggle } from './SegmentedToggle.js';

afterEach(() => cleanup());

describe('SegmentedToggle', () => {
  it('渲染所有选项并标记选中态', () => {
    render(
      <SegmentedToggle<'a' | 'b'>
        ariaLabel="模式"
        value="a"
        onChange={() => {}}
        options={[
          { value: 'a', label: '甲' },
          { value: 'b', label: '乙' },
        ]}
      />,
    );
    const tabA = screen.getByText('甲').closest('button');
    const tabB = screen.getByText('乙').closest('button');
    expect(tabA?.getAttribute('aria-selected')).toBe('true');
    expect(tabB?.getAttribute('aria-selected')).toBe('false');
  });

  it('点击未选中项触发 onChange', () => {
    const onChange = vi.fn();
    render(
      <SegmentedToggle<'a' | 'b'>
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: '甲' },
          { value: 'b', label: '乙' },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('乙'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
