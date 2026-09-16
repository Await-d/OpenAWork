// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerPermissionModeSelect } from './ComposerPermissionModeSelect.js';
import type { ComposerPermissionMode } from './ComposerPermissionModeSelect.js';

type SelectProps = React.ComponentProps<typeof ComposerPermissionModeSelect>;

// 项目未开启 vitest globals，testing-library 的自动清理不会生效，这里显式清理。
afterEach(() => {
  cleanup();
});

function renderSelect(overrides: Partial<SelectProps> = {}): { onChange: SelectProps['onChange'] } {
  const onChange = overrides.onChange ?? vi.fn();
  render(<ComposerPermissionModeSelect value="ask" {...overrides} onChange={onChange} />);
  return { onChange };
}

/** 浮层关闭时，只有触发按钮的可访问名包含档位文案。 */
function openMenu(): HTMLElement {
  const trigger = screen.getByRole('button', { name: /每次询问|免审批/ });
  fireEvent.click(trigger);
  return trigger;
}

/** 受控包装：确认开启后由外层真正更新 value，覆盖「已确认过免审批」的后续流程。 */
function ControlledSelect() {
  const [value, setValue] = useState<ComposerPermissionMode>('ask');
  return <ComposerPermissionModeSelect value={value} onChange={setValue} />;
}

describe('ComposerPermissionModeSelect', () => {
  it('默认档位渲染「每次询问」，不带警示色标记', () => {
    renderSelect();

    const trigger = screen.getByRole('button', { name: '每次询问' });
    expect(trigger.getAttribute('data-tone')).toBe('default');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('打开后以 menu / menuitemradio 语义展示三档，并标记当前档位与警示色', () => {
    renderSelect({ value: 'yolo' });

    expect(screen.getByRole('button', { name: '免审批（YOLO）' }).getAttribute('data-tone')).toBe(
      'warning',
    );

    openMenu();

    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('工具调用审批方式');
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
    const yoloItem = screen.getByRole('menuitemradio', { name: /免审批/ });
    expect(yoloItem.getAttribute('aria-checked')).toBe('true');
    expect(yoloItem.getAttribute('data-tone')).toBe('warning');
    // 轮转 tabindex：仅当前档位可 Tab 进入。
    expect(yoloItem.getAttribute('tabindex')).toBe('0');
    const autoEditItem = screen.getByRole('menuitemradio', { name: /编辑自动/ });
    expect(autoEditItem.getAttribute('aria-checked')).toBe('false');
    // 中档保持中性色：琥珀警示语义只属于免审批。
    expect(autoEditItem.getAttribute('data-tone')).toBe('default');
    expect(autoEditItem.getAttribute('tabindex')).toBe('-1');
    const askItem = screen.getByRole('menuitemradio', { name: /每次询问/ });
    expect(askItem.getAttribute('aria-checked')).toBe('false');
    expect(askItem.getAttribute('tabindex')).toBe('-1');
    expect(
      screen.getByRole('button', { name: '免审批（YOLO）' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('选择「编辑自动」直接回调 onChange("auto-edit")，不经过内联确认', () => {
    const { onChange } = renderSelect();

    const trigger = openMenu();
    const autoEditItem = screen.getByRole('menuitemradio', { name: /编辑自动/ });
    fireEvent.click(autoEditItem);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('auto-edit');
    expect(screen.queryByRole('button', { name: '确认开启' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('首次切到免审批时在浮层内展示内联确认行', () => {
    renderSelect();

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));

    expect(screen.getByRole('button', { name: '确认开启' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('取消确认不触发 onChange，并收起确认行', () => {
    const { onChange } = renderSelect();

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '确认开启' })).toBeNull();
  });

  it('取消确认后把焦点还给触发按钮', () => {
    renderSelect();

    const trigger = openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(document.activeElement).toBe(trigger);
  });

  it('确认开启后调用 onChange("yolo") 并关闭浮层', () => {
    const { onChange } = renderSelect();

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认开启' }));

    expect(onChange).toHaveBeenCalledWith('yolo');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('已确认过免审批后，再次切回免审批不再重复确认', () => {
    render(<ControlledSelect />);

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认开启' }));
    expect(screen.getByRole('button', { name: '免审批（YOLO）' })).toBeTruthy();

    // 先切回「每次询问」，再切回免审批：第二次不再弹确认行。
    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /每次询问/ }));
    expect(screen.getByRole('button', { name: '每次询问' })).toBeTruthy();

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /免审批/ }));
    expect(screen.queryByRole('button', { name: '确认开启' })).toBeNull();
    expect(screen.getByRole('button', { name: '免审批（YOLO）' })).toBeTruthy();
  });

  it('Escape 关闭浮层并把焦点还给触发按钮', () => {
    renderSelect();

    const trigger = openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // 焦点已进入某一项时，Escape 仍由容器冒泡处理。
    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    const item = screen.getByRole('menuitemradio', { name: /编辑自动/ });
    expect(document.activeElement).toBe(item);
    fireEvent.keyDown(item, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('方向键把焦点移到目标档位项', () => {
    renderSelect({ value: 'yolo' });

    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /每次询问/ }));
  });

  it('焦点已在某一项时方向键继续移动并支持回绕', () => {
    renderSelect();

    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    const autoEditItem = screen.getByRole('menuitemradio', { name: /编辑自动/ });
    const yoloItem = screen.getByRole('menuitemradio', { name: /免审批/ });
    const askItem = screen.getByRole('menuitemradio', { name: /每次询问/ });
    expect(document.activeElement).toBe(autoEditItem);

    // 焦点在项上时继续下移：落到下一档。
    fireEvent.keyDown(autoEditItem, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(yoloItem);

    // 从末档继续下移：回绕到第一项。
    fireEvent.keyDown(yoloItem, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(askItem);

    // ArrowUp 反向移动（从首档向上回绕到末档）。
    fireEvent.keyDown(askItem, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(yoloItem);

    // 确认行可见时方向键不生效：档位高亮保持不变。
    fireEvent.click(yoloItem);
    const activeBefore = yoloItem.getAttribute('data-active');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(yoloItem.getAttribute('data-active')).toBe(activeBefore);
  });

  it('Home / End 把焦点移到首项 / 末项并同步高亮', () => {
    renderSelect({ value: 'yolo' });

    openMenu();
    const askItem = screen.getByRole('menuitemradio', { name: /每次询问/ });
    const yoloItem = screen.getByRole('menuitemradio', { name: /免审批/ });

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(document.activeElement).toBe(askItem);
    expect(askItem.getAttribute('data-active')).toBe('true');

    fireEvent.keyDown(askItem, { key: 'End' });
    expect(document.activeElement).toBe(yoloItem);
    expect(yoloItem.getAttribute('data-active')).toBe('true');
  });

  it('单次 Enter 只触发一次 onChange', () => {
    const { onChange } = renderSelect({ value: 'yolo' });

    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    const askItem = screen.getByRole('menuitemradio', { name: /每次询问/ });
    expect(document.activeElement).toBe(askItem);

    // 浏览器对聚焦按钮的原生 Enter 激活 = keydown + click；容器不得重复处理 Enter。
    fireEvent.keyDown(askItem, { key: 'Enter' });
    fireEvent.click(askItem);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ask');
  });

  it('点击浮层外部关闭并把焦点还给触发按钮', () => {
    renderSelect();

    const trigger = openMenu();
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('disabled 时渲染禁用触发按钮，title 展示原因且不打开浮层', () => {
    renderSelect({ disabled: true, disabledReason: '当前会话已锁定审批方式' });

    const trigger = screen.getByRole('button', { name: '每次询问' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('title')).toBe('当前会话已锁定审批方式');

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('busy 时禁用触发按钮并展示 spinner', () => {
    renderSelect({ busy: true });

    const trigger = screen.getByRole('button', { name: '每次询问' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.querySelector('.composer-permission-trigger__spinner')).toBeTruthy();
  });
});
