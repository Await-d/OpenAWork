import { describe, expect, it } from 'vitest';
import { TERMINAL_SCOPE_ATTR, isWithinTerminalScope } from './terminal-scope.js';

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
});
