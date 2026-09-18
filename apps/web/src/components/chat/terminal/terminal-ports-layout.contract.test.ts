/**
 * 端口页窄容器重排的 CSS 契约（P0：L1 粘性表头 / L2 两行重排 / L5 端口列左对齐）。
 *
 * 背景：面板可侧停靠到 clamp(280px, 32%, 560px)，1440px 视口下端口表可能只有 300px 宽，
 * 视口 media 测不到 —— 重排必须由 `.terminal-ports` 上的容器查询驱动。jsdom 没有布局
 * 引擎、也不评估 `@container`，所以这里用源码文本锁定「重排由容器查询驱动」「进程列不
 * 再被 display:none」「端口 / 动作 / 地址全部左对齐（VS Code 口径）」这些前提；真实几何
 * （两行行高、表头吸附、280px 无横向溢出）只能在浏览器里验证。
 *
 * 为什么用 fs 读源码而不是 `?raw`：Vitest 的 CSS 管线会把样式文件的 import 换成
 * 空模块，拿不到原始文本；契约测试要的正是源码文本
 * （与 terminal-fit-padding.contract.test.ts 同一手法）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'terminal-panel.css');
const css = readFileSync(cssPath, 'utf8');

/** 取选择器规则的声明块（首个匹配；样式文件里的规则体不含嵌套块，`[^}]` 足够）。 */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match?.[1]) throw new Error(`未找到 CSS 规则 ${selector}`);
  return match[1];
}

/** 取 at-rule 的完整块（含嵌套规则）：按花括号配平截取。 */
function atRuleBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`未找到 at-rule ${marker}`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`at-rule ${marker} 花括号不配平`);
}

const containerBlock = atRuleBlock(css, '@container terminal-ports (max-width: 520px)');

describe('端口页窄容器重排（容器查询契约）', () => {
  it('.terminal-ports 注册为 inline-size 容器：重排跟随面板宽度而非视口', () => {
    const body = ruleBody(css, '.terminal-ports');
    expect(body).toMatch(/container-type:\s*inline-size\s*;/);
    expect(body).toMatch(/container-name:\s*terminal-ports\s*;/);
  });

  it('紧凑布局里进程单元格保留并落到行网格槽位（L2：不再丢字段）', () => {
    expect(containerBlock).toMatch(
      /\.terminal-ports__col-process\s*\{[^}]*grid-area:\s*process[^}]*\}/,
    );
    expect(containerBlock).not.toMatch(/\.terminal-ports__col-process\s*\{[^}]*display:\s*none/);
  });

  it('绑定地址单元格在紧凑布局拆成两个槽位：标注进首行、地址进次行', () => {
    expect(containerBlock).toMatch(/\.terminal-ports__cell--bind\s*\{[^}]*display:\s*contents/);
    expect(containerBlock).toMatch(/\.terminal-ports__bind-tag\s*\{[^}]*grid-area:\s*tag/);
    expect(containerBlock).toMatch(/\.terminal-ports__bind-address\s*\{[^}]*grid-area:\s*address/);
  });

  it('行内两行网格保留端口与动作槽位（首行 = 端口 + 标注 + 操作）', () => {
    expect(containerBlock).toMatch(
      /grid-template-areas:\s*'port tag actions'\s*'process process address'/,
    );
  });

  it('状态槽位独占末行（A/B 状态在 280px 档位仍可达，不与首行抢宽度）', () => {
    expect(containerBlock).toMatch(/grid-template-areas:[\s\S]*'status status status'/);
    expect(containerBlock).toMatch(/\.terminal-ports__cell--status\s*\{[^}]*grid-area:\s*status/);
    expect(containerBlock).toMatch(/\.terminal-ports__th--status[\s\S]*?display:\s*none/);
  });

  it('整份样式里不存在任何隐藏进程列的规则（旧 viewport media 的回归锁）', () => {
    expect(css).not.toMatch(/\.terminal-ports__col-process\s*\{[^}]*display:\s*none/);
  });

  it('窄容器重排不再由 viewport media 驱动', () => {
    const mediaBlocks = [...css.matchAll(/@media[^{]*\{/g)].map((match) => match[0]);
    expect(mediaBlocks.some((block) => block.includes('terminal-ports'))).toBe(false);
  });

  it('表头 sticky（L1）：solid 背景 + 底边线，行滚过时不透出', () => {
    const body = ruleBody(css, '.terminal-ports__table th');
    expect(body).toMatch(/position:\s*sticky\s*;/);
    expect(body).toMatch(/top:\s*0\s*;/);
    expect(body).toMatch(/background:\s*var\(--bg-overlay\)\s*;/);
    expect(body).toMatch(/border-bottom:\s*1px solid var\(--border-default\)\s*;/);
  });

  it('端口列（L5）：左对齐（VS Code 口径）+ tabular-nums，数字与协议分列', () => {
    const alignment = ruleBody(css, '.terminal-ports__cell--port');
    expect(alignment).toMatch(/text-align:\s*left\s*;/);
    expect(alignment).not.toMatch(/text-align:\s*right\s*;/);
    expect(ruleBody(css, '.terminal-ports__port-number')).toMatch(
      /font-variant-numeric:\s*tabular-nums\s*;/,
    );
  });

  it('端口列网格 = auto + minmax(0, 1fr)：数字左缘起排，协议紧随其后', () => {
    expect(css).toMatch(
      /\.terminal-ports__cell--port\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/,
    );
  });

  it('端口页状态 / 空态 / 筛选空态：内容锚左上（flex-start + text-align: left）', () => {
    for (const selector of [
      '.terminal-ports__status',
      '.terminal-ports-empty',
      '.terminal-ports__filter-empty',
    ]) {
      const body = ruleBody(css, selector);
      expect(body).toMatch(/align-items:\s*flex-start\s*;/);
      expect(body).toMatch(/justify-content:\s*flex-start\s*;/);
    }
    for (const selector of [
      '.terminal-ports__status',
      '.terminal-ports-empty__card',
      '.terminal-ports__filter-empty',
    ]) {
      expect(ruleBody(css, selector)).toMatch(/text-align:\s*left\s*;/);
    }
  });

  it('动作列左对齐：宽布局 text-align: left，紧凑重排 justify-content: flex-start', () => {
    const wide = ruleBody(css, '.terminal-ports__cell--actions');
    expect(wide).toMatch(/text-align:\s*left\s*;/);
    expect(wide).not.toMatch(/text-align:\s*right\s*;/);

    expect(containerBlock).toMatch(
      /\.terminal-ports__cell--actions\s*\{[^}]*justify-content:\s*flex-start/,
    );
    expect(containerBlock).not.toMatch(/justify-content:\s*flex-end/);
  });

  it('紧凑重排：表头行与地址槽位左对齐（无 space-between / justify-self: end 残留）', () => {
    expect(containerBlock).toMatch(
      /\.terminal-ports__table thead tr\s*\{[^}]*justify-content:\s*flex-start/,
    );
    expect(containerBlock).not.toMatch(/justify-content:\s*space-between\s*;/);
    expect(containerBlock).toMatch(/\.terminal-ports__bind-address\s*\{[^}]*justify-self:\s*start/);
    expect(containerBlock).toMatch(/\.terminal-ports__bind-address\s*\{[^}]*text-align:\s*left/);
    expect(containerBlock).not.toMatch(/justify-self:\s*end\s*;/);
  });

  it('被改块的旧居中 / 右对齐声明已清干净（回归锁）', () => {
    for (const selector of [
      '.terminal-ports__status',
      '.terminal-ports-empty',
      '.terminal-ports-empty__card',
      '.terminal-ports__filter-empty',
    ]) {
      const body = ruleBody(css, selector);
      expect(body).not.toMatch(/text-align:\s*center/);
      expect(body).not.toMatch(/align-items:\s*center/);
      expect(body).not.toMatch(/justify-content:\s*center/);
    }
    expect(ruleBody(css, '.terminal-ports__cell--port')).not.toMatch(/text-align:\s*right/);
    expect(ruleBody(css, '.terminal-ports__cell--actions')).not.toMatch(/text-align:\s*right/);
  });
});
