import { afterEach, describe, expect, it } from 'vitest';
import { buildMermaidTheme, MERMAID_FONT_STACK } from './mermaid-theme.js';
import { contrastRatio, parseCssColor, readMarkdownThemeTokens } from './theme-tokens.js';

const NON_COLOR_KEYS = new Set([
  'darkMode',
  'fontFamily',
  'fontSize',
  'pieOpacity',
  'requirementBorderSize',
  'archGroupBorderWidth',
]);

function tokensWith(overrides: Partial<ReturnType<typeof readMarkdownThemeTokens>>) {
  return { ...readMarkdownThemeTokens(), ...overrides };
}

afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('buildMermaidTheme', () => {
  it('只输出 khroma 可解析的绝对颜色，不残留 var() / color-mix()', () => {
    const { themeVariables } = buildMermaidTheme(tokensWith({ mode: 'dark' }));

    for (const [key, value] of Object.entries(themeVariables)) {
      expect(value, key).not.toContain('var(');
      expect(value, key).not.toContain('color-mix');
      if (!NON_COLOR_KEYS.has(key)) {
        expect(parseCssColor(value), `${key}=${value}`).not.toBeNull();
      }
    }
  });

  it('思维导图分支色板固定 12 档且文字可读', () => {
    const { themeVariables } = buildMermaidTheme(tokensWith({ mode: 'dark' }));

    for (let index = 0; index < 12; index += 1) {
      const fill = parseCssColor(themeVariables[`cScale${index}`] ?? '');
      const label = parseCssColor(themeVariables[`cScaleLabel${index}`] ?? '');

      expect(fill, `cScale${index}`).not.toBeNull();
      expect(label, `cScaleLabel${index}`).not.toBeNull();
      expect(contrastRatio(fill!, label!), `cScale${index} 对比度`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('画布底色跟随 --bg-raised，保证与消息气泡同色系', () => {
    const canvas = '#101828';
    const { themeVariables } = buildMermaidTheme(tokensWith({ bgRaised: canvas }));

    expect(themeVariables.background).toBe(canvas);
  });

  it('深色与浅色模式产出不同色板', () => {
    const dark = buildMermaidTheme(tokensWith({ mode: 'dark' })).themeVariables;
    const light = buildMermaidTheme(tokensWith({ mode: 'light' })).themeVariables;

    expect(dark.darkMode).toBe('true');
    expect(light.darkMode).toBe('false');
    expect(dark.mainBkg).not.toBe(light.mainBkg);
    expect(dark.cScale0).not.toBe(light.cScale0);
  });

  it('节点填充由强调色派生，换主题即换色', () => {
    const blue = buildMermaidTheme(tokensWith({ accent: '#3aa0ff' })).themeVariables;
    const pink = buildMermaidTheme(tokensWith({ accent: '#ff6f9c' })).themeVariables;

    expect(blue.mainBkg).not.toBe(pink.mainBkg);
    expect(blue.primaryBorderColor).not.toBe(pink.primaryBorderColor);
    // 色板本身来自主题图表色，不随强调色变化
    expect(blue.cScale0).toBe(pink.cScale0);
  });

  it('缺省图表色板时用兜底色补足，不会产生空值', () => {
    const { themeVariables } = buildMermaidTheme(tokensWith({ chart: [] }));

    expect(parseCssColor(themeVariables.cScale7 ?? '')).not.toBeNull();
    expect(parseCssColor(themeVariables.pie1 ?? '')).not.toBeNull();
  });

  it('字体栈与正文一致，避免图形里出现另一种字体', () => {
    const { themeVariables } = buildMermaidTheme(tokensWith({}));

    expect(themeVariables.fontFamily).toBe(MERMAID_FONT_STACK);
  });

  it('themeCSS 用当前主题色修饰边标签', () => {
    const { themeCSS, themeVariables } = buildMermaidTheme(tokensWith({ bgRaised: '#0c0f15' }));

    expect(themeCSS).toContain('.edgeLabel rect');
    expect(themeCSS).toContain('.node rect');
    expect(themeVariables.background).toBe('#0c0f15');
    expect(themeCSS).toContain(`fill: ${themeVariables.edgeLabelBackground}`);
  });
});
