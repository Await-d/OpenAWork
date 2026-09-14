#!/usr/bin/env node
/**
 * 生成「多主题富内容矩阵」预览页：demo/markdown-theme-matrix.html
 *
 * 用途：把 Markdown 表格与 Mermaid 图表（含思维导图）在 8 套主题 × 明暗模式下的
 * 真实渲染结果摆在一起，用于人工核对配色是否与主题协调。
 *
 * 关键点是**不复制任何样式或配色逻辑**：
 *   - 主题变量从 apps/web/src/index.css 的 :root 规则里原样抽取；
 *   - 表格 / 代码块样式从 chat-message.css 里按 `.chat-markdown` 前缀抽取；
 *   - Mermaid 的 themeVariables / themeCSS 直接调用真实的 buildMermaidTheme()；
 *   - 图形渲染使用仓库内真实的 mermaid 依赖（打包成单文件内联，离线可用）。
 * 因此这份预览页和运行时看到的效果一致，主题改动后重新生成即可。
 *
 * 用法：node scripts/markdown-theme-demo.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_FILE = path.join(ROOT, 'demo', 'markdown-theme-matrix.html');
const WORK_DIR = path.join(ROOT, 'temp', 'markdown-theme-demo');

const INDEX_CSS = path.join(ROOT, 'apps/web/src/index.css');
const CHAT_CSS = path.join(ROOT, 'apps/web/src/components/chat/message/chat-message.css');
const TOKENS_TS = path.join(ROOT, 'apps/web/src/components/chat/markdown/theme-tokens.ts');
const MERMAID_THEME_TS = path.join(ROOT, 'apps/web/src/components/chat/markdown/mermaid-theme.ts');
const MERMAID_ENTRY = path.join(
  ROOT,
  'node_modules/.pnpm/mermaid@12.0.0/node_modules/mermaid/dist/mermaid.core.mjs',
);

const ESBUILD = path.join(
  ROOT,
  'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js',
);

const THEME_STYLES = [
  'nebula',
  'aurora',
  'linear',
  'forest',
  'sakura',
  'carbon',
  'sunset',
  'ocean',
];
const THEME_LABELS = {
  nebula: 'Nebula · 靛青琥珀',
  aurora: 'Aurora · 极光毛玻璃',
  linear: 'Linear · 极简靛蓝',
  forest: 'Forest · 森林暖橙',
  sakura: 'Sakura · 樱花玫红',
  carbon: 'Carbon · 碳灰电光蓝',
  sunset: 'Sunset · 暮光紫橙',
  ocean: 'Ocean · 深海青蓝',
};

/** token 字段 → CSS 变量名，与 theme-tokens.ts 的读取顺序保持一致。 */
const TOKEN_VARS = {
  bgBase: '--bg-base',
  bgRaised: '--bg-raised',
  bgOverlay: '--bg-overlay',
  bgSurface: '--bg-surface',
  bgElevated: '--bg-elevated',
  fgStrong: '--fg-strong',
  fgDefault: '--fg-default',
  fgMuted: '--fg-muted',
  fgSubtle: '--fg-subtle',
  fgOnAccent: '--fg-on-accent',
  accent: '--accent',
  accentHover: '--accent-hover',
  accentBorder: '--accent-border',
  contrast: '--contrast',
  contrastBorder: '--contrast-border',
  complement: '--complement',
  aux: '--aux',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  borderSubtle: '--border-subtle',
  borderDefault: '--border-default',
  borderEmphasis: '--border-emphasis',
  borderStrong: '--border-strong',
};

const FALLBACK_TOKENS = {
  bgBase: '#0b1020',
  bgRaised: '#0f1428',
  bgOverlay: '#141a33',
  bgSurface: '#1a2140',
  bgElevated: '#212a4d',
  fgStrong: '#f2f4ff',
  fgDefault: '#c3c9e8',
  fgMuted: '#8b93bd',
  fgSubtle: '#5c6490',
  fgOnAccent: '#0b1020',
  accent: '#7c8cff',
  accentHover: '#9aa6ff',
  accentBorder: 'rgba(124, 140, 255, 0.4)',
  contrast: '#a06bff',
  contrastBorder: 'rgba(160, 107, 255, 0.4)',
  complement: '#ff6f9c',
  aux: '#3aa0ff',
  success: '#38e2c1',
  warning: '#a06bff',
  danger: '#ff6f9c',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderDefault: 'rgba(255, 255, 255, 0.1)',
  borderEmphasis: 'rgba(255, 255, 255, 0.16)',
  borderStrong: 'rgba(255, 255, 255, 0.24)',
};

const FALLBACK_CHART = [
  '#7c8cff',
  '#a06bff',
  '#3aa0ff',
  '#ff6f9c',
  '#c084fc',
  '#38e2c1',
  '#67e8f9',
  '#f0abfc',
];

/**
 * 抽取顶层、非嵌套的 CSS 规则（选择器 + 声明块）。
 *
 * 用「零宽后顾」而不是消费 `}`：消费会让正则跳过紧随其后的那条规则
 * （每条规则都要以前一条的 `}` 作为前缀），导致只能取到一半的规则。
 */
function extractTopLevelRules(css) {
  const rules = [];
  const pattern = /(?<=^|\})\s*([^{}@;][^{}]*?)\s*\{([^{}]*)\}/gu;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const selector = stripComments(match[1] ?? '').trim();
    if (selector === '') {
      continue;
    }
    rules.push({ selector, body: match[2] ?? '' });
  }
  return rules;
}

function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//gu, ' ');
}

function parseDeclarations(body) {
  const declarations = {};
  for (const line of body.split(';')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.startsWith('--')) {
      declarations[name] = value;
    }
  }
  return declarations;
}

function tokensFromDeclarations(declarations, mode, style) {
  const tokens = { mode, style, chart: [] };
  for (const [field, cssVar] of Object.entries(TOKEN_VARS)) {
    tokens[field] = declarations[cssVar] ?? FALLBACK_TOKENS[field];
  }
  for (let index = 0; index < 8; index += 1) {
    tokens.chart.push(declarations[`--chart-${index + 1}`] ?? FALLBACK_CHART[index]);
  }
  return tokens;
}

async function bundle({ entrySource, entryName, format, global = null, outName }) {
  const esbuild = await import(pathToFileURL(ESBUILD).href);
  const entryFile = path.join(WORK_DIR, entryName);
  await writeFile(entryFile, entrySource, 'utf8');
  const outFile = path.join(WORK_DIR, outName);
  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    format,
    platform: 'browser',
    minify: true,
    target: 'es2022',
    outfile: outFile,
    logLevel: 'warning',
    ...(global ? { globalName: global } : {}),
  });
  return outFile;
}

async function main() {
  await mkdir(WORK_DIR, { recursive: true });

  const [indexCss, chatCss] = await Promise.all([
    readFile(INDEX_CSS, 'utf8'),
    readFile(CHAT_CSS, 'utf8'),
  ]);

  // ── 1. 主题变量：原样抽取 :root 规则，并把 :root 改写成 .theme-scope，
  //      这样同一页面可以并排展示多套主题。
  const themeRules = extractTopLevelRules(indexCss)
    .filter((rule) => rule.selector.includes(':root'))
    .map((rule) => ({
      selector: rule.selector.replace(/:root/gu, '.theme-scope'),
      body: rule.body,
    }));
  const themeCss = themeRules.map((rule) => `${rule.selector} {\n${rule.body}\n}`).join('\n\n');

  // ── 2. 富内容样式：按 .chat-markdown 前缀抽取，不改写。
  const markdownRules = extractTopLevelRules(chatCss).filter((rule) =>
    rule.selector.includes('.chat-markdown'),
  );
  const markdownCss = markdownRules
    .map((rule) => `${rule.selector} {\n${rule.body}\n}`)
    .join('\n\n');

  // ── 3. 用真实实现计算 16 套主题的 Mermaid 配置。
  const builderOut = await bundle({
    entrySource: `export { buildMermaidTheme } from ${JSON.stringify(MERMAID_THEME_TS)};\nexport { readMarkdownThemeTokens } from ${JSON.stringify(TOKENS_TS)};\n`,
    entryName: 'theme-builder-entry.ts',
    format: 'esm',
    outName: 'theme-builder.mjs',
  });
  const { buildMermaidTheme } = await import(pathToFileURL(builderOut).href);

  const declarationsByTheme = new Map();
  for (const rule of themeRules) {
    const declarations = parseDeclarations(rule.body);
    for (const style of THEME_STYLES) {
      if (!rule.selector.includes(`[data-theme='${style}']`)) {
        continue;
      }
      for (const mode of ['dark', 'light']) {
        if (rule.selector.includes(`[data-mode='${mode}']`)) {
          declarationsByTheme.set(`${style}|${mode}`, declarations);
        }
      }
    }
  }

  const matrix = [];
  for (const style of THEME_STYLES) {
    for (const mode of ['dark', 'light']) {
      const declarations = declarationsByTheme.get(`${style}|${mode}`);
      if (!declarations) {
        throw new Error(`未在 index.css 中找到主题变量：${style} / ${mode}`);
      }
      const tokens = tokensFromDeclarations(declarations, mode, style);
      const theme = buildMermaidTheme(tokens);
      matrix.push({
        style,
        mode,
        label: `${THEME_LABELS[style] ?? style}`,
        themeVariables: theme.themeVariables,
        themeCSS: theme.themeCSS,
        canvas: tokens.bgRaised,
      });
    }
  }

  // ── 4. 打包 mermaid 为单文件，离线可用。
  const mermaidOut = await bundle({
    entrySource: `import mermaid from ${JSON.stringify(MERMAID_ENTRY)};\nglobalThis.mermaid = mermaid;\n`,
    entryName: 'mermaid-entry.mjs',
    format: 'iife',
    outName: 'mermaid.bundle.js',
  });
  const mermaidBundle = await readFile(mermaidOut, 'utf8');

  const html = buildHtml({ matrix, themeCss, markdownCss, mermaidBundle });
  await writeFile(OUT_FILE, html, 'utf8');

  const sizeMb = (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2);
  process.stdout.write(`已生成 ${path.relative(ROOT, OUT_FILE)}（${sizeMb} MB）\n`);
}

const TABLE_HEADERS = ['能力', '状态', '覆盖范围', '本轮改动', '收益'];
const TABLE_ROWS = [
  [
    '表格',
    '<span class="pill pill-on">已上线</span>',
    '表格 / 工作表',
    '<br>工具栏 + 导出<br>粘性表头',
    '宽表不再撑破消息列',
  ],
  [
    '思维导图',
    '<span class="pill pill-on">已上线</span>',
    'mindmap / mmd',
    '12 档分支色板',
    '分支配色跟随主题',
  ],
  [
    '流程图',
    '<span class="pill pill-wip">进行中</span>',
    'flowchart / graph',
    '节点圆角 + 连线端点',
    '与代码块同一套视觉语言',
  ],
  [
    '时序图',
    '<span class="pill pill-wip">进行中</span>',
    'sequenceDiagram',
    'actor / note 取色',
    '深色主题下不再灰蒙蒙',
  ],
  [
    '甘特图',
    '<span class="pill pill-todo">待排期</span>',
    'gantt',
    '任务条 / 今日线',
    '任务状态色可读',
  ],
];

function renderTableShell({ density, rowCount, columnCount }) {
  const head = TABLE_HEADERS.map(
    (title, index) =>
      `<th class="chat-markdown-th" scope="col" data-align="${
        index === 1 ? 'center' : index === 4 ? 'right' : 'left'
      }">${title}</th>`,
  ).join('');

  const body = TABLE_ROWS.slice(0, rowCount)
    .map(
      (row) =>
        `<tr>${row
          .slice(0, columnCount)
          .map(
            (cell, index) =>
              `<td class="chat-markdown-td" data-align="${
                index === 1 ? 'center' : index === 4 ? 'right' : 'left'
              }">${cell}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');

  return `<div class="chat-markdown-table-shell" data-density="${density}">
  <div class="chat-markdown-code-toolbar chat-markdown-table-toolbar">
    <div class="chat-markdown-code-toolbar-meta">
      <div class="chat-markdown-code-label">表格</div>
      <span class="chat-markdown-table-meta">${rowCount} 行 × ${columnCount} 列</span>
    </div>
    <div class="chat-markdown-code-actions">
      <button type="button" class="chat-markdown-code-copy">复制表格</button>
      <button type="button" class="chat-markdown-code-copy">下载 CSV</button>
    </div>
  </div>
  <div class="chat-markdown-table-viewport">
    <div class="chat-markdown-table-wrap">
      <table class="chat-markdown-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
  </div>
</div>`;
}

function buildHtml({ matrix, themeCss, markdownCss, mermaidBundle }) {
  const diagrams = {
    mindmap: [
      'mindmap',
      '  root((消息渲染))',
      '    表格',
      '      列对齐',
      '      粘性表头',
      '      导出 CSV',
      '    思维导图',
      '      主题色板',
      '      缩放适应',
      '    代码块',
      '      语法高亮',
      '      折叠',
    ].join('\n'),
    flowchart: [
      'flowchart LR',
      '  A[消息内容] --> B{围栏语言}',
      '  B -->|表格| C[表格卡片]',
      '  B -->|mermaid| D[图表预览]',
      '  C --> E[复制 / 导出]',
      '  D --> F[缩放 / 下载 SVG]',
    ].join('\n'),
  };

  const cards = matrix
    .map(
      (entry) => `
    <section class="theme-scope card" data-theme="${entry.style}" data-mode="${entry.mode}">
      <header class="card-head">
        <span class="card-title">${entry.label}</span>
        <span class="card-mode">${entry.mode === 'dark' ? '深色' : '浅色'}</span>
      </header>
      <div class="card-body chat-markdown">
        <div class="card-label">表格 · 常规密度</div>
        ${renderTableShell({ density: 'comfortable', rowCount: 3, columnCount: 5 })}
        <div class="card-label">表格 · 紧凑密度（列数 ≥ 6）</div>
        ${renderTableShell({ density: 'compact', rowCount: 5, columnCount: 5 })}
        <div class="card-label">思维导图</div>
        <div class="chat-markdown-code-block" data-diagram-kind="mindmap">
          <div class="chat-markdown-code-toolbar">
            <div class="chat-markdown-code-toolbar-meta">
              <div class="chat-markdown-code-label">MINDMAP</div>
              <span class="chat-markdown-preview-badge">思维导图</span>
            </div>
            <div class="chat-markdown-code-actions">
              <div class="chat-markdown-mermaid-zoom">
                <button type="button" class="chat-markdown-code-copy">−</button>
                <button type="button" class="chat-markdown-code-copy chat-markdown-mermaid-zoom-value">100%</button>
                <button type="button" class="chat-markdown-code-copy">＋</button>
                <button type="button" class="chat-markdown-code-copy">适应宽度</button>
              </div>
              <button type="button" class="chat-markdown-code-copy">下载 SVG</button>
            </div>
          </div>
          <div class="chat-markdown-mermaid-figure" data-render="${entry.style}-${entry.mode}-mindmap"></div>
        </div>
        <div class="card-label">流程图</div>
        <div class="chat-markdown-code-block" data-diagram-kind="flowchart">
          <div class="chat-markdown-code-toolbar">
            <div class="chat-markdown-code-toolbar-meta">
              <div class="chat-markdown-code-label">FLOWCHART</div>
              <span class="chat-markdown-preview-badge">流程图</span>
            </div>
          </div>
          <div class="chat-markdown-mermaid-figure" data-render="${entry.style}-${entry.mode}-flowchart"></div>
        </div>
      </div>
    </section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenAWork · 富内容多主题渲染矩阵</title>
<style>
${themeCss}
</style>
<style>
${markdownCss}
</style>
<style>
  /* 仅本预览页的外壳样式，不属于应用代码 */
  :root {
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 28px 64px;
    background: #0b0d12;
    color: #e6e8f0;
    font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
    font-size: 14px;
  }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 650; }
  .lead { margin: 0 0 4px; color: #98a0b8; font-size: 13px; line-height: 1.6; max-width: 900px; }
  .lead code { background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .matrix { display: grid; gap: 22px; margin-top: 26px; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
  .matrix.single { grid-template-columns: minmax(0, 1fr); max-width: 1040px; }
  .card {
    background: var(--bg-base);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
  }
  .card-title { font-size: 13px; font-weight: 650; color: #e9ebf5; }
  .card-mode { font-size: 11px; color: #98a0b8; }
  .card-body {
    padding: 14px;
    gap: 10px;
    font-size: 13px;
    color: var(--fg-default);
    flex: 1;
  }
  .card-label { font-size: 11px; color: #7f879e; letter-spacing: 0.02em; margin-top: 4px; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .pill-on { background: var(--success-muted); color: var(--success); border: 1px solid var(--success-border); }
  .pill-wip { background: var(--accent-muted); color: var(--accent); border: 1px solid var(--accent-border); }
  .pill-todo { background: var(--contrast-muted); color: var(--contrast); border: 1px solid var(--contrast-border); }
</style>
</head>
<body>
<h1>富内容多主题渲染矩阵</h1>
<p class="lead">同一份 Markdown 表格与 Mermaid 图表，在 8 套主题 × 明暗模式下的真实渲染结果。
主题变量取自 <code>index.css</code>，富内容样式取自 <code>chat-message.css</code>，
图表配色由 <code>buildMermaidTheme()</code> 实时计算，均非手写副本。</p>

<main class="matrix">
${cards}
</main>

<script>${mermaidBundle}</script>
<script>
const MATRIX = ${JSON.stringify(matrix)};
const DIAGRAMS = ${JSON.stringify(diagrams)};
</script>
<script>
(async function () {
  const mermaid = globalThis.mermaid;
  if (!mermaid) return;

  // 支持 ?only=carbon:dark 聚焦单张卡片，便于放大核对某个主题的细节。
  const only = new URLSearchParams(location.search).get('only');
  if (only) {
    const [style, mode] = only.split(':');
    for (const card of document.querySelectorAll('.card')) {
      if (card.dataset.theme !== style || card.dataset.mode !== mode) {
        card.remove();
      }
    }
    document.querySelector('.matrix')?.classList.add('single');
  }

  for (const entry of MATRIX) {
    const themeCSS = entry.themeCSS;
    for (const kind of Object.keys(DIAGRAMS)) {
      const host = document.querySelector('[data-render="' + entry.style + '-' + entry.mode + '-' + kind + '"]');
      if (!host) continue;
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          darkMode: entry.themeVariables.darkMode === 'true',
          fontFamily: entry.themeVariables.fontFamily,
          themeVariables: { ...entry.themeVariables, background: 'transparent' },
          themeCSS,
          flowchart: { curve: 'basis', padding: 12, nodeSpacing: 44, rankSpacing: 52 },
          mindmap: { padding: 12 },
        });
        const id = 'demo-' + entry.style + '-' + entry.mode + '-' + kind;
        await mermaid.parse(DIAGRAMS[kind]);
        const { svg } = await mermaid.render(id, DIAGRAMS[kind]);
        host.innerHTML = svg;
        const node = host.querySelector('svg');
        if (node) {
          node.style.maxWidth = '100%';
          node.style.height = 'auto';
        }
      } catch (error) {
        host.innerHTML = '<div class="chat-markdown-mermaid-error">' + String(error && error.message ? error.message : error) + '</div>';
      }
    }
  }
})();
</script>
</body>
</html>
`;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
