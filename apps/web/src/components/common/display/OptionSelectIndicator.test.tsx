// @vitest-environment jsdom
/**
 * OptionSelectIndicator：单选 / 多选用不同形状的指示器，且暴露
 * data-select-mode 供上层测试稳定断言。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { OptionSelectIndicator } from './OptionSelectIndicator.js';

afterEach(() => {
  cleanup();
});

describe('OptionSelectIndicator', () => {
  it('多选渲染 checkbox（data-select-mode=multiple）', () => {
    const { container } = render(<OptionSelectIndicator selected={false} multiple />);
    expect(container.querySelector('[data-select-mode="multiple"]')).toBeTruthy();
    expect(container.querySelector('[data-select-mode="single"]')).toBeNull();
  });

  it('单选渲染 radio（data-select-mode=single）', () => {
    const { container } = render(<OptionSelectIndicator selected={false} multiple={false} />);
    expect(container.querySelector('[data-select-mode="single"]')).toBeTruthy();
    expect(container.querySelector('[data-select-mode="multiple"]')).toBeNull();
  });

  it('多选选中时渲染对勾 svg', () => {
    const { container } = render(<OptionSelectIndicator selected multiple />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('多选未选中时不渲染对勾 svg', () => {
    const { container } = render(<OptionSelectIndicator selected={false} multiple />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('单选未选中时不渲染圆点子元素', () => {
    const { container } = render(<OptionSelectIndicator selected={false} multiple={false} />);
    const indicator = container.querySelector('[data-select-mode="single"]');
    expect(indicator?.childElementCount).toBe(0);
  });

  it('单选选中时渲染圆点子元素', () => {
    const { container } = render(<OptionSelectIndicator selected multiple={false} />);
    const indicator = container.querySelector('[data-select-mode="single"]');
    expect(indicator?.childElementCount).toBe(1);
  });
});
