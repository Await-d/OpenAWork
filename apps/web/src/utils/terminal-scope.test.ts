import { describe, expect, it } from 'vitest';
import { TERMINAL_SCOPE_ATTR, isEditableTarget, isWithinTerminalScope } from './terminal-scope.js';

describe('terminal-scope', () => {
  it('位于 [data-terminal-scope] 内的元素返回 true', () => {
    const root = document.createElement('div');
    root.setAttribute(TERMINAL_SCOPE_ATTR, '');
    const child = document.createElement('span');
    root.appendChild(child);

    expect(isWithinTerminalScope(child)).toBe(true);
    expect(isWithinTerminalScope(root)).toBe(true);
  });

  it('移除标记后同一元素返回 false', () => {
    const root = document.createElement('div');
    root.setAttribute(TERMINAL_SCOPE_ATTR, '');
    const child = document.createElement('span');
    root.appendChild(child);
    expect(isWithinTerminalScope(child)).toBe(true);

    root.removeAttribute(TERMINAL_SCOPE_ATTR);
    expect(isWithinTerminalScope(child)).toBe(false);
  });

  it('null 与非 Element 目标返回 false', () => {
    expect(isWithinTerminalScope(null)).toBe(false);
    expect(isWithinTerminalScope(window)).toBe(false);
    expect(isWithinTerminalScope(document)).toBe(false);
  });

  it('作用域外的元素返回 false', () => {
    expect(isWithinTerminalScope(document.createElement('div'))).toBe(false);
  });

  it('input / textarea 判定为可编辑', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
  });

  it('contentEditable 元素判定为可编辑', () => {
    const attributeTrue = document.createElement('div');
    attributeTrue.setAttribute('contenteditable', 'true');
    expect(isEditableTarget(attributeTrue)).toBe(true);

    const attributeEmpty = document.createElement('div');
    attributeEmpty.setAttribute('contenteditable', '');
    expect(isEditableTarget(attributeEmpty)).toBe(true);

    const viaDomApi = document.createElement('div');
    Object.defineProperty(viaDomApi, 'isContentEditable', { value: true });
    expect(isEditableTarget(viaDomApi)).toBe(true);
  });

  it('普通 div 与非 Element 目标判定为不可编辑', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
