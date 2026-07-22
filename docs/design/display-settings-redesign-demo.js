const scenarios = {
  everyday: {
    label: '日常问答',
    hint: '普通工作场景: 信息够用，但不要把每个细节都顶到首屏。',
    user: '帮我把显示设置里的开关理顺一下，别让聊天界面变得太吵。',
    assistant: '我会把“是否显示”和“默认展开”拆开，再用即时预览确认效果。',
    reasoning: [
      '先把消息元信息和正文层级分开。',
      '再把推理与工具的展开策略从布尔开关改成三态。',
      '折叠后保留摘要，避免用户失去上下文。',
    ],
    summary: ['保留模型、耗时和时间。', '推理先给摘要。', '短工具结果直接展开。'],
    tools: [
      {
        title: '读取设置页',
        path: 'display-tab-content.tsx',
        detail: '确认当前是扁平 toggle 列表。',
        short: true,
      },
      {
        title: '读取偏好 store',
        path: 'display-preferences.ts',
        detail: '确认默认开启项较多。',
        short: true,
      },
    ],
    meta: {
      timestamp: '10:42',
      model: 'GPT-5.1',
      provider: 'OpenAI',
      duration: '3.1s',
      stop: '正常结束',
      token: '842 tok',
      estimate: '~320 tok',
    },
    composer: { context: '8 条', tokens: '1.1k', cost: '¥0.34' },
  },
  debug: {
    label: '长推理排障',
    hint: '排障场景: 细节有价值，但不能让长推理和工具输出把正文压到下面。',
    user: '为什么 display settings 里的开启和折叠会让人不知道自己到底改了什么？',
    assistant: '问题不在开关数量本身，而在“显示”和“展开”被拆成了同一种交互语言。',
    reasoning: [
      '当前页面把消息元信息、推理过程、工具调用、输入区和顶栏入口放在同一种 row 结构里。',
      '用户无法快速判断哪些设置互相依赖，哪些只是展示偏好。',
      '“显示推理过程”关闭后，“推理默认展开”仍然像一个独立选择。',
      '工具调用也只有展开和折叠，无法表达短结果与长结果的差异。',
      '因此需要先按决策类型分组，再把复杂度交给预设。',
      '右侧预览必须显示真实消息结构，而不是只显示一个状态文字。',
    ],
    summary: [
      '父子关系被合并到一个策略卡。',
      '工具调用支持摘要、自动、展开。',
      '设置结果直接映射到消息。',
    ],
    tools: [
      {
        title: '读取显示设置页面',
        path: 'apps/web/src/pages/settings/display/display-tab-content.tsx',
        detail: '找到 14 个展示相关设置。',
        short: false,
      },
      {
        title: '读取偏好状态',
        path: 'apps/web/src/stores/settings/display-preferences.ts',
        detail: '确认 store 默认值和依赖关系。',
        short: false,
      },
      {
        title: '读取设计 token',
        path: 'packages/shared-ui/DESIGN-TOKENS.md',
        detail: '对齐颜色、间距和动效层级。',
        short: true,
      },
      {
        title: '输出交互原型',
        path: 'docs/design/display-settings-redesign-demo.html',
        detail: '生成可直接打开的 A/B demo。',
        short: true,
      },
    ],
    meta: {
      timestamp: '11:08',
      model: 'GPT-5.1',
      provider: 'OpenAI',
      duration: '12.8s',
      stop: '工具调用结束',
      token: '2.6k tok',
      estimate: '~1.1k tok',
    },
    composer: { context: '18 条', tokens: '3.8k', cost: '¥1.26' },
  },
  batch: {
    label: '批量工具调用',
    hint: '工具密集场景: 重点是保留结果摘要，同时让重要卡片能按需打开。',
    user: '这组工具卡一多，真正有用的结果就被折叠摘要淹没了。',
    assistant: '我会让短结果自动展开，长结果先收起，并在摘要中保留关键动作和结果。',
    reasoning: [
      '批量调用不是单一的“展开或折叠”问题。',
      '短结果适合直接读，长结果适合保留状态和摘要。',
      '用户通常先看完成了什么，再决定要不要检查原始输出。',
      '所以自动策略需要区分工具长度，而不是统一处理。',
      '摘要必须包含动作、目标和结果，而不是只显示“4 个工具调用”。',
    ],
    summary: ['短结果直接可读。', '长结果只保留状态和关键摘要。', '所有动作仍然可以继续展开。'],
    tools: [
      {
        title: '扫描工作区',
        path: 'workspace/tree?depth=2',
        detail: '返回 32 个目录节点。',
        short: false,
      },
      {
        title: '读取 package.json',
        path: 'package.json',
        detail: '发现 pnpm monorepo。',
        short: true,
      },
      {
        title: '读取设计 token',
        path: 'packages/shared-ui/DESIGN-TOKENS.md',
        detail: '确认 E · Nebula 规范。',
        short: true,
      },
      {
        title: '检查路由引用',
        path: 'rg display-preferences apps packages',
        detail: '找到 9 个使用点。',
        short: true,
      },
      {
        title: '生成对照结果',
        path: 'scripts/render-preview.mjs',
        detail: '输出桌面和移动视口截图。',
        short: false,
      },
      {
        title: '整理差异摘要',
        path: 'artifacts/display-settings-diff.json',
        detail: '归纳首屏占用与展开次数。',
        short: false,
      },
    ],
    meta: {
      timestamp: '11:26',
      model: 'GPT-5.1',
      provider: 'OpenAI',
      duration: '18.4s',
      stop: '正常结束',
      token: '4.2k tok',
      estimate: '~2.3k tok',
    },
    composer: { context: '26 条', tokens: '5.4k', cost: '¥1.86' },
  },
};

const legacyRows = [
  ['消息元信息', 'timestamp', '消息时间戳', '在每条消息头部显示发送 / 接收时间。'],
  ['消息元信息', 'model', '模型名称', '在助手消息上显示模型名称标签。'],
  ['消息元信息', 'provider', 'Provider 标签', '模型名与提供商名不一致时显示。'],
  ['消息元信息', 'duration', '消息耗时', '显示每轮回复的生成耗时。'],
  ['消息元信息', 'stop', '停止原因', '显示本轮回复的结束原因。'],
  ['消息元信息', 'token', 'Token 用量分项', '显示精确的输入 / 输出 Token 明细。'],
  ['消息元信息', 'estimate', '估算 Token 数', '无精确用量数据时显示估算值。'],
  ['推理与工具调用', 'showReasoning', '显示推理过程', '关闭后整个推理块消失。'],
  [
    '推理与工具调用',
    'reasoningExpanded',
    '推理过程默认展开',
    '和上一行是父子关系，但看起来完全独立。',
    '依赖上方',
  ],
  [
    '推理与工具调用',
    'toolExpanded',
    '工具调用默认展开',
    '所有工具卡统一处理，没有自动状态。',
    '只有二态',
  ],
  ['输入区与界面', 'composerStats', '输入框统计栏', '显示完整上下文、耗时和费用摘要。'],
  ['输入区与界面', 'commandButton', '命令面板按钮', '在顶栏显示命令面板入口。'],
  ['输入区与界面', 'gatewayDot', '网关状态指示点', '在 Logo 旁显示网关连接状态。'],
  ['输入区与界面', 'terminalButton', '顶栏终端按钮', '在顶栏显示终端入口。'],
];

const presets = {
  focus: {
    label: '专注',
    description: '正文优先，诊断信息最少。',
    meta: ['model'],
    reasoningMode: 'summary',
    toolMode: 'summary',
    composerStats: false,
    commandButton: true,
    gatewayDot: false,
    terminalButton: false,
  },
  balanced: {
    label: '平衡',
    description: '默认推荐，保留必要上下文。',
    meta: ['timestamp', 'model', 'duration'],
    reasoningMode: 'summary',
    toolMode: 'auto',
    composerStats: true,
    commandButton: true,
    gatewayDot: true,
    terminalButton: true,
  },
  diagnostic: {
    label: '诊断',
    description: '排障使用，尽可能保留细节。',
    meta: ['timestamp', 'model', 'provider', 'duration', 'stop', 'token', 'estimate'],
    reasoningMode: 'full',
    toolMode: 'full',
    composerStats: true,
    commandButton: true,
    gatewayDot: true,
    terminalButton: true,
  },
};

const themes = [
  { value: 'nebula', label: 'Nebula', swatches: ['#080b12', '#5cd4c0', '#f0b429'] },
  { value: 'linear', label: 'Linear', swatches: ['#0b0d14', '#6471f0', '#a06bff'] },
  { value: 'forest', label: 'Forest', swatches: ['#0a0f0d', '#4ade80', '#f97316'] },
  { value: 'carbon', label: 'Carbon', swatches: ['#08090a', '#3aa0ff', '#ffaa00'] },
];

const state = {
  scenario: 'debug',
  device: 'desktop',
  mode: 'dark',
  legacy: {
    meta: {
      timestamp: true,
      model: true,
      provider: true,
      duration: true,
      stop: true,
      token: true,
      estimate: true,
    },
    showReasoning: true,
    reasoningExpanded: false,
    toolExpanded: false,
    composerStats: true,
    commandButton: true,
    gatewayDot: true,
    terminalButton: true,
  },
  modern: {
    preset: 'balanced',
    meta: ['timestamp', 'model', 'duration'],
    reasoningMode: 'summary',
    toolMode: 'auto',
    composerStats: true,
    commandButton: true,
    gatewayDot: true,
    terminalButton: true,
    themeStyle: 'nebula',
  },
};

const el = {
  scenarioTabs: document.getElementById('scenario-tabs'),
  deviceTabs: document.getElementById('device-tabs'),
  modeTabs: document.getElementById('mode-tabs'),
  scenarioHint: document.getElementById('scenario-hint'),
  legacySettings: document.getElementById('legacy-settings'),
  modernSettings: document.getElementById('modern-settings'),
  insights: document.getElementById('insights'),
  compareGrid: document.getElementById('compare-grid'),
  compareDescription: document.getElementById('compare-description'),
  deltaBanner: document.getElementById('delta-banner'),
  modernLabel: document.getElementById('modern-label'),
  legacyVisible: document.getElementById('legacy-visible'),
  modernVisible: document.getElementById('modern-visible'),
  clickDelta: document.getElementById('click-delta'),
  noiseDelta: document.getElementById('noise-delta'),
};

const esc = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const scenario = () => scenarios[state.scenario];
const legacyMetaKeys = () =>
  Object.entries(state.legacy.meta)
    .filter(([, on]) => on)
    .map(([k]) => k);
const reasoningLabel = (v) => (v === 'off' ? '关闭' : v === 'summary' ? '摘要' : '展开');
const toolLabel = (v) => (v === 'summary' ? '摘要' : v === 'auto' ? '自动' : '展开');

const activePreset = () =>
  Object.entries(presets).find(
    ([, p]) =>
      JSON.stringify(p.meta) === JSON.stringify(state.modern.meta) &&
      p.reasoningMode === state.modern.reasoningMode &&
      p.toolMode === state.modern.toolMode &&
      p.composerStats === state.modern.composerStats &&
      p.commandButton === state.modern.commandButton &&
      p.gatewayDot === state.modern.gatewayDot &&
      p.terminalButton === state.modern.terminalButton,
  )?.[0] || 'custom';

const setPreset = (key) => {
  const p = presets[key];
  state.modern = {
    ...state.modern,
    preset: key,
    meta: [...p.meta],
    reasoningMode: p.reasoningMode,
    toolMode: p.toolMode,
    composerStats: p.composerStats,
    commandButton: p.commandButton,
    gatewayDot: p.gatewayDot,
    terminalButton: p.terminalButton,
  };
};

function metrics(kind) {
  const s = scenario();
  const legacy = kind === 'legacy';
  const metaCount = legacy ? legacyMetaKeys().length : state.modern.meta.length;
  const reasoningRows = legacy
    ? state.legacy.showReasoning
      ? state.legacy.reasoningExpanded
        ? s.reasoning.length
        : 1
      : 0
    : state.modern.reasoningMode === 'off'
      ? 0
      : state.modern.reasoningMode === 'summary'
        ? 2
        : s.reasoning.length;
  const shortTools = s.tools.filter((t) => t.short).length;
  const toolRows = legacy
    ? state.legacy.toolExpanded
      ? s.tools.length
      : 1
    : state.modern.toolMode === 'summary'
      ? 1
      : state.modern.toolMode === 'auto'
        ? Math.max(2, shortTools + 1)
        : s.tools.length;
  const composerRows = legacy
    ? state.legacy.composerStats
      ? 3
      : 1
    : state.modern.composerStats
      ? 2
      : 1;
  const topbar = legacy
    ? [state.legacy.commandButton, state.legacy.gatewayDot, state.legacy.terminalButton].filter(
        Boolean,
      ).length
    : [state.modern.commandButton, state.modern.gatewayDot, state.modern.terminalButton].filter(
        Boolean,
      ).length;
  const visible = Math.max(
    4,
    18 - metaCount - reasoningRows - toolRows - composerRows - Math.max(0, topbar - 1),
  );
  const clicks = legacy
    ? (state.legacy.showReasoning ? (state.legacy.reasoningExpanded ? 0 : 1) : 1) +
      (state.legacy.toolExpanded ? 0 : 1)
    : (state.modern.reasoningMode === 'full' ? 0 : 1) +
      (state.modern.toolMode === 'full' ? 0 : 1) +
      (state.modern.preset === 'custom' ? 0 : 1);
  const noise = metaCount * 5 + reasoningRows * 4 + toolRows * 3 + composerRows * 2 + topbar * 2;
  return { metaCount, reasoningRows, toolRows, composerRows, visible, clicks, noise, topbar };
}

function renderTabs() {
  el.scenarioTabs.innerHTML = Object.entries(scenarios)
    .map(
      ([k, v]) =>
        `<button type="button" data-scenario="${k}" aria-pressed="${state.scenario === k}">${v.label}</button>`,
    )
    .join('');
  el.deviceTabs.innerHTML = [
    ['desktop', '桌面'],
    ['mobile', '移动'],
  ]
    .map(
      ([k, v]) =>
        `<button type="button" data-device="${k}" aria-pressed="${state.device === k}">${v}</button>`,
    )
    .join('');
  el.modeTabs.innerHTML = [
    ['dark', '深色'],
    ['light', '浅色'],
  ]
    .map(
      ([k, v]) =>
        `<button type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${v}</button>`,
    )
    .join('');
  el.scenarioHint.textContent = scenario().hint;
}

function renderLegacy() {
  const groups = [...new Set(legacyRows.map((r) => r[0]))];
  el.legacySettings.innerHTML = groups
    .map((group) => {
      const rows = legacyRows.filter((r) => r[0] === group);
      return `
              <section class="group">
                <div class="group-title">${group}</div>
                ${rows
                  .map(([g, id, label, desc, warn]) => {
                    const on = g === '消息元信息' ? state.legacy.meta[id] : state.legacy[id];
                    const badge = warn ? `<span class="tag">${warn}</span>` : '';
                    return `
                      <div class="row">
                        <div class="copy">
                          <strong>${label}</strong>
                          <span>${desc}</span>
                          ${badge}
                        </div>
                        <button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${label}" data-legacy="${id}"></button>
                      </div>
                    `;
                  })
                  .join('')}
              </section>
            `;
    })
    .join('');
}

function renderModern() {
  el.modernLabel.textContent =
    activePreset() === 'custom' ? '自定义' : presets[activePreset()].label;
  el.modernSettings.innerHTML = `
          <div class="preset-grid">
            ${Object.entries(presets)
              .map(
                ([k, p]) => `
                  <button type="button" class="preset" data-preset="${k}" aria-pressed="${activePreset() === k}">
                    <strong>${p.label}</strong>
                    <span>${p.description}</span>
                  </button>
                `,
              )
              .join('')}
          </div>

          <section class="modern-section">
            <div class="modern-head">
              <div>
                <strong>消息信息层级</strong>
                <span>只选择真正需要出现在消息头的字段。</span>
              </div>
              <span class="tag good">${state.modern.meta.length}/7</span>
            </div>
            <div class="meta-grid">
              ${[
                ['timestamp', '时间', '回溯时间线'],
                ['model', '模型', '知道回复来自谁'],
                ['provider', 'Provider', '排查来源差异'],
                ['duration', '耗时', '感知生成速度'],
                ['stop', '停止原因', '检查截断状态'],
                ['token', 'Token 明细', '看成本构成'],
                ['estimate', '估算 Token', '没有精确值时兜底'],
              ]
                .map(
                  ([id, label, desc]) => `
                    <button type="button" class="meta" data-meta="${id}" aria-pressed="${state.modern.meta.includes(id)}">
                      <strong>${label}</strong>
                      <span>${desc}</span>
                    </button>
                  `,
                )
                .join('')}
            </div>
          </section>

          <section class="modern-section">
            <div class="modern-head">
              <div>
                <strong>展开策略</strong>
                <span>显示和展开被放在同一个决策块里。</span>
              </div>
              <span class="tag good">三态</span>
            </div>
            <div class="strategy-list">
              ${renderStrategy('reasoningMode', '推理过程', '控制它以什么姿态进入消息，而不是拆成两个 toggle。', ['off', 'summary', 'full'], state.modern.reasoningMode)}
              ${renderStrategy('toolMode', '工具调用', '让短结果和长结果拥有不同的默认行为。', ['summary', 'auto', 'full'], state.modern.toolMode)}
            </div>
          </section>

          <section class="modern-section">
            <div class="modern-head">
              <div>
                <strong>输入区与工作台</strong>
                <span>入口开关仍然保留，但集中在一个区域。</span>
              </div>
              <span class="tag good">${[state.modern.composerStats, state.modern.commandButton, state.modern.gatewayDot, state.modern.terminalButton].filter(Boolean).length}/4</span>
            </div>
            <div class="switch-grid">
              ${[
                ['composerStats', '输入框统计', '保留详细统计栏'],
                ['commandButton', '命令面板', '保留顶栏入口'],
                ['gatewayDot', '网关状态', '保留连接指示'],
                ['terminalButton', '顶栏终端', '保留终端入口'],
              ]
                .map(
                  ([key, label, desc]) => `
                    <div class="switch-row">
                      <div class="copy">
                        <strong>${label}</strong>
                        <span>${desc}</span>
                      </div>
                      <button type="button" class="switch" role="switch" aria-checked="${state.modern[key]}" aria-label="${label}" data-modern-switch="${key}"></button>
                    </div>
                  `,
                )
                .join('')}
            </div>
          </section>

          <section class="modern-section">
            <div class="modern-head">
              <div>
                <strong>外观</strong>
                <span>主题降到次要层级，不再和信息结构抢注意力。</span>
              </div>
              <span class="tag">${state.modern.themeStyle}</span>
            </div>
            <div class="theme-grid">
              ${themes
                .map(
                  (theme) => `
                    <button type="button" class="theme" data-theme="${theme.value}" aria-pressed="${state.modern.themeStyle === theme.value}">
                      <div class="swatches">${theme.swatches.map((c) => `<span class="swatch" style="background:${c};"></span>`).join('')}</div>
                      <strong>${theme.label}</strong>
                    </button>
                  `,
                )
                .join('')}
            </div>
          </section>
        `;
}

function renderStrategy(id, title, desc, values, current) {
  const labels =
    id === 'reasoningMode'
      ? { off: '关闭', summary: '摘要', full: '展开' }
      : { summary: '摘要', auto: '自动', full: '展开' };
  const help = {
    reasoningMode: { off: '只留一句状态', summary: '先看摘要，按需展开', full: '直接显示完整块' },
    toolMode: { summary: '先看结果摘要', auto: '短结果开，长结果收', full: '全部卡片直接展开' },
  };
  return `
          <div class="strategy">
            <div class="strategy-head">
              <div>
                <strong>${title}</strong>
                <span>${desc}</span>
              </div>
              <span class="tag good">${labels[current]}</span>
            </div>
            <div class="option-grid">
              ${values
                .map(
                  (value) => `
                    <button type="button" class="option" data-choice="${id}" data-value="${value}" aria-pressed="${current === value}">
                      <strong>${labels[value]}</strong>
                      <span>${help[id][value]}</span>
                    </button>
                  `,
                )
                .join('')}
            </div>
          </div>
        `;
}

function renderInsights() {
  const legacy = metrics('legacy');
  const modern = metrics('modern');
  const diff = modern.visible - legacy.visible;
  const clickDiff = legacy.clicks - modern.clicks;
  const noiseDiff = legacy.noise - modern.noise;
  el.legacyVisible.textContent = `${legacy.visible} 行`;
  el.modernVisible.textContent = `${modern.visible} 行`;
  el.clickDelta.textContent = `${clickDiff >= 0 ? '-' : '+'}${Math.abs(clickDiff)} 次`;
  el.noiseDelta.textContent = `${noiseDiff >= 0 ? '-' : '+'}${Math.abs(noiseDiff)} 分`;
  el.insights.innerHTML = `
          <div class="insight">
            <h3>首屏空间</h3>
            <p>看同一场景里，正文有多少空间能在第一次打开时直接读到。</p>
            <div class="metrics">
              <div class="metric"><span>当前实现</span><strong>${legacy.visible} 行</strong></div>
              <div class="metric good"><span>重设计方案</span><strong>${modern.visible} 行</strong></div>
            </div>
            <div class="bars">
              <div class="bar-row">
                <span>当前版</span><div class="bar bad"><i style="width:${(legacy.visible / 20) * 100}%"></i></div><span>${legacy.visible}/20</span>
              </div>
              <div class="bar-row">
                <span>新版</span><div class="bar"><i style="width:${(modern.visible / 20) * 100}%"></i></div><span>${modern.visible}/20</span>
              </div>
            </div>
          </div>

          <div class="insight">
            <h3>需要主动展开几次</h3>
            <p>用户想把细节看全时，需要再点多少次，而不是把所有东西默认摊开。</p>
            <div class="metrics">
              <div class="metric"><span>当前实现</span><strong>${legacy.clicks} 次</strong></div>
              <div class="metric good"><span>重设计方案</span><strong>${modern.clicks} 次</strong></div>
            </div>
          </div>

          <div class="insight">
            <h3>这个场景具体发生了什么</h3>
            <ul class="changes">
              <li>${scenario().label} 下，当前版消息头显示 ${legacy.metaCount} 项，新版显示 ${modern.metaCount} 项。</li>
              <li>${diff >= 0 ? `新版首屏多保留 ${diff} 行正文。` : `新版首屏少占用 ${Math.abs(diff)} 行。`}</li>
              <li>${clickDiff >= 0 ? `少 ${clickDiff} 次展开动作。` : `多 ${Math.abs(clickDiff)} 次展开动作。`}</li>
              <li>${noiseDiff >= 0 ? `信息噪声估算下降 ${noiseDiff} 点。` : `当前新版信息量增加 ${Math.abs(noiseDiff)} 点。`}</li>
            </ul>
          </div>
        `;
}

function metaPills(kind) {
  const s = scenario();
  const keys = kind === 'legacy' ? legacyMetaKeys() : state.modern.meta;
  return keys.length
    ? keys.map((k) => `<span>${esc(s.meta[k])}</span>`).join('')
    : '<span>只显示正文</span>';
}

function reasoningBlock(kind) {
  const s = scenario();
  if (kind === 'legacy') {
    if (!state.legacy.showReasoning) {
      return `
              <div class="block issue">
                <div class="block-head"><strong>推理过程</strong><span>已隐藏</span></div>
                <div class="block-copy">关闭后整块消失，用户看不到它原本是否存在。</div>
              </div>
            `;
    }
    if (!state.legacy.reasoningExpanded) {
      return `
              <div class="block issue">
                <div class="block-head"><strong>推理过程</strong><span>已折叠</span></div>
                <div class="block-copy">共 ${s.reasoning.length} 行。点击“展开思考”后才能看到为什么这样处理。</div>
              </div>
            `;
    }
    return `
            <div class="block issue">
              <div class="block-head"><strong>推理过程</strong><span>默认展开</span></div>
              <div class="lines">${s.reasoning.map((line) => `<span>${esc(line)}</span>`).join('')}</div>
            </div>
          `;
  }

  if (state.modern.reasoningMode === 'off') {
    return `
            <div class="block">
              <div class="block-head"><strong>推理过程</strong><span>关闭</span></div>
              <div class="block-copy">保留一句状态提示，正文继续保持干净。</div>
            </div>
          `;
  }

  if (state.modern.reasoningMode === 'summary') {
    return `
            <div class="block good">
              <div class="block-head"><strong>推理摘要</strong><span>${s.summary.length} 个要点</span></div>
              <div class="lines">${s.summary.map((line) => `<span>${esc(line)}</span>`).join('')}</div>
              <div class="block-copy">点击后展开完整推理，不需要先猜这块里面有什么。</div>
            </div>
          `;
  }

  return `
          <div class="block good">
            <div class="block-head"><strong>推理过程</strong><span>默认展开</span></div>
            <div class="lines">${s.reasoning.map((line) => `<span>${esc(line)}</span>`).join('')}</div>
          </div>
        `;
}

function toolsBlock(kind) {
  const s = scenario();
  if (kind === 'legacy') {
    if (!state.legacy.toolExpanded) {
      return `
              <div class="block issue">
                <div class="block-head"><strong>工具调用</strong><span>已折叠</span></div>
                <div class="block-copy">${s.tools.length} 次调用被压成一条摘要: 读取设置页、读取 store、输出结果。</div>
              </div>
            `;
    }
    return `
            <div class="block issue">
              <div class="block-head"><strong>工具调用</strong><span>全部展开</span></div>
              <div class="tool-list">
                ${s.tools
                  .map(
                    (tool) => `
                      <div class="tool">
                        <div><strong>${esc(tool.title)}</strong><code>${esc(tool.path)}</code></div>
                        <span class="tool-status"></span>
                      </div>
                    `,
                  )
                  .join('')}
              </div>
            </div>
          `;
  }

  if (state.modern.toolMode === 'summary') {
    return `
            <div class="summary">
              <div class="summary-head"><span>工具结果摘要</span><strong>${s.tools.length} 次</strong></div>
              <div class="block-copy">${esc(s.tools[0].title)}、${esc(s.tools[1]?.title || '后续动作')}已完成；剩余内容按需展开。</div>
            </div>
          `;
  }

  if (state.modern.toolMode === 'auto') {
    const shortTools = s.tools.filter((tool) => tool.short);
    const longTools = s.tools.filter((tool) => !tool.short);
    return `
            <div class="block good">
              <div class="block-head"><strong>工具调用</strong><span>自动</span></div>
              <div class="tool-list">
                ${shortTools
                  .slice(0, 3)
                  .map(
                    (tool) => `
                      <div class="tool">
                        <div><strong>${esc(tool.title)}</strong><code>${esc(tool.detail)}</code></div>
                        <span class="tool-status"></span>
                      </div>
                    `,
                  )
                  .join('')}
                ${
                  longTools.length
                    ? `<div class="summary-head"><span>${longTools.length} 个长结果已收起</span><strong>查看摘要</strong></div>`
                    : ''
                }
              </div>
            </div>
          `;
  }

  return `
          <div class="block good">
            <div class="block-head"><strong>工具调用</strong><span>全部展开</span></div>
            <div class="tool-list">
              ${s.tools
                .map(
                  (tool) => `
                    <div class="tool">
                      <div><strong>${esc(tool.title)}</strong><code>${esc(tool.path)}</code></div>
                      <span class="tool-status"></span>
                    </div>
                  `,
                )
                .join('')}
            </div>
          </div>
        `;
}

function composer(kind) {
  const s = scenario();
  const on = kind === 'legacy' ? state.legacy.composerStats : state.modern.composerStats;
  if (!on) {
    return `
            <div class="summary">
              <div class="summary-head"><span>输入区</span><strong>紧凑摘要</strong></div>
              <div class="block-copy">上下文 ${s.composer.context} · 预计 ${s.composer.tokens} tokens</div>
            </div>
          `;
  }
  return `
          <div class="summary">
            <div class="summary-head"><span>输入区统计栏</span><strong>${kind === 'legacy' ? '完整显示' : '保留但降权'}</strong></div>
            <div class="summary-grid">
              <div>上下文<strong>${s.composer.context}</strong></div>
              <div>Token<strong>${s.composer.tokens}</strong></div>
              <div>费用<strong>${s.composer.cost}</strong></div>
            </div>
          </div>
        `;
}

function preview(kind) {
  const s = scenario();
  const m = metrics(kind);
  const isLegacy = kind === 'legacy';
  const title = isLegacy ? '当前实现' : '重设计方案';
  const annotation = isLegacy
    ? `当前版：${m.metaCount} 个消息头字段、${m.clicks} 次展开动作，折叠后信息摘要不够具体。`
    : `新版：${m.metaCount} 个消息头字段、${m.clicks} 次展开动作，摘要和自动策略都保留了上下文。`;
  const config = isLegacy ? state.legacy : state.modern;
  return `
          <div class="compare-card">
            <div class="compare-card-head">
              <strong>${title}</strong>
              <span class="tag ${isLegacy ? 'bad' : 'good'}">${isLegacy ? '原始行为' : '策略行为'}</span>
            </div>
            <div class="mock-shell" data-device="${state.device}">
              <div class="mock-topbar">
                <div class="mock-brand">
                  <span class="dot ${config.gatewayDot ? '' : 'off'}"></span>
                  <div>
                    <strong>Chat / ${s.label}</strong>
                    <span>${isLegacy ? '设置项直接影响消息形态' : '设置结果可被即时理解'}</span>
                  </div>
                </div>
                <div class="mock-actions">
                  ${config.commandButton ? '<span class="mock-action">命令面板</span>' : ''}
                  ${config.terminalButton ? '<span class="mock-action">终端</span>' : ''}
                </div>
              </div>
              <div class="mock-body">
                <div class="msg user"><div class="bubble">${esc(s.user)}</div></div>
                <div class="msg">
                  <div class="meta-line">${metaPills(kind)}</div>
                  <div class="bubble">${esc(s.assistant)}</div>
                  ${reasoningBlock(kind)}
                  ${toolsBlock(kind)}
                  ${composer(kind)}
                </div>
              </div>
              <div class="mock-foot ${isLegacy ? 'bad' : 'good'}">${annotation}</div>
            </div>
          </div>
        `;
}

function compare() {
  const s = scenario();
  const legacy = metrics('legacy');
  const modern = metrics('modern');
  const diff = modern.visible - legacy.visible;
  const clickDiff = legacy.clicks - modern.clicks;
  el.compareDescription.textContent = `${s.hint} 当前实现和重设计方案共享同一段用户输入、同一批工具调用，只改变显示策略。`;
  el.deltaBanner.innerHTML = `${diff >= 0 ? `新版首屏多保留 ${diff} 行正文` : `新版首屏少占用 ${Math.abs(diff)} 行`}<br><span style="font-weight:500;">展开动作 ${legacy.clicks} → ${modern.clicks}</span>`;
  el.compareGrid.innerHTML = `${preview('legacy')}${preview('modern')}`;
}

function update() {
  document.body.dataset.mode = state.mode;
  document.body.dataset.style = state.modern.themeStyle;
  renderTabs();
  renderLegacy();
  renderModern();
  renderInsights();
  compare();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;

  if (target.dataset.scenario) {
    state.scenario = target.dataset.scenario;
    update();
    return;
  }
  if (target.dataset.device) {
    state.device = target.dataset.device;
    update();
    return;
  }
  if (target.dataset.mode) {
    state.mode = target.dataset.mode;
    update();
    return;
  }
  if (target.dataset.legacy) {
    const key = target.dataset.legacy;
    if (key in state.legacy.meta) {
      state.legacy.meta[key] = !state.legacy.meta[key];
    } else {
      state.legacy[key] = !state.legacy[key];
    }
    update();
    return;
  }
  if (target.dataset.preset) {
    setPreset(target.dataset.preset);
    update();
    return;
  }
  if (target.dataset.meta) {
    const key = target.dataset.meta;
    state.modern.meta = state.modern.meta.includes(key)
      ? state.modern.meta.filter((item) => item !== key)
      : [...state.modern.meta, key];
    state.modern.preset = 'custom';
    update();
    return;
  }
  if (target.dataset.choice) {
    state.modern[target.dataset.choice] = target.dataset.value;
    state.modern.preset = 'custom';
    update();
    return;
  }
  if (target.dataset.modernSwitch) {
    const key = target.dataset.modernSwitch;
    state.modern[key] = !state.modern[key];
    state.modern.preset = 'custom';
    update();
    return;
  }
  if (target.dataset.theme) {
    state.modern.themeStyle = target.dataset.theme;
    state.modern.preset = 'custom';
    update();
  }
});

update();
