import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountIslandApp } from './mount-island.js';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));

vi.mock('./IslandApp.js', () => ({
  IslandApp: () => null,
}));

const islandCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'island.css'),
  'utf8',
);

let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = islandCss;
  document.head.append(style);
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});

afterEach(() => {
  style.remove();
  document.body.replaceChildren();
  document.body.className = '';
  document.documentElement.classList.remove('island-html');
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.style.colorScheme = '';
  vi.unstubAllGlobals();
});

describe('灵动岛页面样式隔离', () => {
  it.each([false, true])('展开状态为 %s 时，内容区动画不影响页面 body', (expanded) => {
    mountIslandApp();

    const island = document.createElement('div');
    island.className = expanded ? 'island is-expanded' : 'island';
    const content = document.createElement('div');
    content.className = 'island-body';
    island.append(content);
    document.getElementById('root')?.append(island);

    const bodyStyle = getComputedStyle(document.body);
    expect(document.body.classList.contains('island-body')).toBe(false);
    expect(document.body.classList.contains('island-page-body')).toBe(true);
    expect(bodyStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    const pageRule = Array.from(style.sheet?.cssRules ?? []).find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText.includes('body.island-page-body'),
    );
    expect(pageRule?.style.getPropertyValue('width')).toBe('100%');
    expect(pageRule?.style.getPropertyValue('height')).toBe('100%');
    expect(pageRule?.style.getPropertyValue('overflow')).toBe('hidden');
    expect(Number(bodyStyle.opacity || '1')).toBe(1);
    expect(['', 'none']).toContain(bodyStyle.transform);
    expect(bodyStyle.pointerEvents).not.toBe('none');

    const contentStyle = getComputedStyle(content);
    expect(contentStyle.opacity).toBe(expanded ? '1' : '0.01');
    expect(contentStyle.transform).toBe(expanded ? 'none' : 'translateY(10px)');
    expect(contentStyle.pointerEvents).toBe(expanded ? 'auto' : 'none');
  });
});
