/**
 * `/agents` + `/skills` 真机走查用的 mock 网关（端口 3101，与 vite dev server 跨域互通）。
 *
 * 用法：
 *   node .agentdocs/runtime/261103-Agent管理页与技能页布局落地/evidence/mock-gateway.mjs
 * 然后把浏览器 auth-store 的 gatewayUrl 指向 http://127.0.0.1:3101
 * （agent-browser 步骤见同目录 walkthrough.md）。
 *
 * 数据覆盖本轮改动涉及的全部状态分支：
 *   Agents：内置（无覆盖）/ 内置（提示词覆盖）/ 内置（已禁用）/ 自定义（全字段 + 已修改）
 *           / 超长名称 / 无角色 / 仅提示词的自定义
 *   Skills：市场 26 条（触发分页）/ 含不可安装来源 / 已安装 5 条（含系统预装 + 可更新 + 已禁用）
 *           / 本地工作区 2 条 / 注册源 3 个（含 1 个已停用）/ 详情含 README + 权限 + 更新日志
 */
import { createServer } from 'node:http';

const PORT = 3101;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'content-type': 'application/json',
};

const DEFAULT_PROMPT = [
  '你是通用型软件工程助手，负责把用户的模糊需求落实为可运行的改动。',
  '工作时先确认约束与不变量，再给出最小可行改动，最后自测并汇报证据。',
  '禁止跳过门禁：格式、类型、测试三项必须全绿才算完成。',
].join('\n');

const AGENTS = [
  {
    id: 'general',
    label: '通用',
    description: '默认主智能体，负责统筹执行与结果交付。',
    aliases: ['general', '通用助手'],
    canonicalRole: { coreRole: 'executor', preset: 'general' },
    model: 'anthropic/claude-opus-4.1',
    variant: 'high',
    fallbackModels: ['anthropic/claude-sonnet-4.5'],
    systemPrompt: DEFAULT_PROMPT,
    promptMetadata: { hasPromptOverride: false, defaultText: DEFAULT_PROMPT },
    note: '默认入口，改动前先确认是否真的需要新建 Agent。',
    color: '#7c8cf8',
    enabled: true,
    origin: 'builtin',
    source: 'builtin',
    removable: false,
    resettable: false,
    hasOverrides: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'build',
    label: '构建与验证',
    description: '编译、跑测试、定位构建失败的最小修复路径。',
    aliases: ['build', 'builder'],
    canonicalRole: { coreRole: 'executor', preset: 'builder' },
    model: 'anthropic/claude-opus-4.1',
    variant: 'high',
    fallbackModels: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.1'],
    systemPrompt:
      '你负责让仓库回到「可构建 + 可测试」的绿色状态。\n先复现失败，再定位，再最小修复。',
    promptMetadata: {
      hasPromptOverride: true,
      defaultText: '你负责构建与验证，遇到失败先复现再定位。',
    },
    enabled: true,
    origin: 'builtin',
    source: 'builtin',
    removable: false,
    resettable: true,
    hasOverrides: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-11-02T09:12:00.000Z',
  },
  {
    id: 'plan',
    label: '方案规划',
    description: '把需求拆成可执行任务，标注依赖与风险。',
    aliases: ['plan', 'planner'],
    canonicalRole: { coreRole: 'planner' },
    model: 'openai/gpt-5.1',
    systemPrompt: '你负责把需求拆成可执行任务，并标出依赖、风险与验收标准。',
    promptMetadata: {
      hasPromptOverride: false,
      defaultText: '你负责把需求拆成可执行任务，并标出依赖、风险与验收标准。',
    },
    enabled: false,
    origin: 'builtin',
    source: 'builtin',
    removable: false,
    resettable: false,
    hasOverrides: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'architect-advisor',
    label: '架构顾问',
    description: '负责架构评审、边界划分与设计权衡，偏好可回滚的小步演进。',
    aliases: ['arch', '架构审查', 'architect'],
    canonicalRole: { coreRole: 'planner', preset: 'architect' },
    model: 'anthropic/claude-opus-4.1',
    variant: 'max',
    fallbackModels: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.1', 'deepseek/deepseek-v3.2'],
    systemPrompt: '你是架构评审者：先问清约束与不变量，再给方案与代价对比，最后给出回滚路径。',
    note: '大重构评审专用；小改动不要动用。',
    color: '#f0b429',
    enabled: true,
    origin: 'custom',
    source: 'configured',
    removable: true,
    resettable: true,
    hasOverrides: true,
    createdAt: '2026-10-18T03:20:00.000Z',
    updatedAt: '2026-11-02T14:08:00.000Z',
  },
  {
    id: 'data-steward-with-a-deliberately-long-identifier',
    label: '数据治理与合规审计助手（超长名称用于验证目录行截断）',
    description: '负责数据血缘梳理、合规检查与审计留痕。',
    aliases: ['data', 'compliance'],
    canonicalRole: { coreRole: 'reviewer', preset: 'security-review' },
    model: 'openai/gpt-5.1',
    systemPrompt: '你负责数据治理与合规审计，输出必须带证据链与可复核步骤。',
    enabled: true,
    origin: 'custom',
    source: 'configured',
    removable: true,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-10-20T06:00:00.000Z',
    updatedAt: '2026-10-20T06:00:00.000Z',
  },
  {
    id: 'legacy-helper',
    label: 'Legacy Helper',
    description: '未设置角色的历史条目，用于验证角色徽章缺省。',
    aliases: [],
    model: 'deepseek/deepseek-v3.2',
    enabled: true,
    origin: 'custom',
    source: 'configured',
    removable: true,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-08-11T01:00:00.000Z',
    updatedAt: '2026-08-11T01:00:00.000Z',
  },
  {
    id: 'prompt-only',
    label: '仅提示词覆盖',
    description: '只改过提示词的自定义 Agent，用于验证检视栏覆盖情况。',
    aliases: ['prompt-only'],
    canonicalRole: { coreRole: 'reviewer' },
    systemPrompt: '你只做一件事：把结论压缩成三条以内的要点。',
    enabled: false,
    origin: 'custom',
    source: 'configured',
    removable: true,
    resettable: true,
    hasOverrides: true,
    createdAt: '2026-10-25T08:30:00.000Z',
    updatedAt: '2026-10-30T11:45:00.000Z',
  },
];

const MARKET_CATEGORIES = ['development', 'document', 'data', 'ops', 'design'];
const MARKET_NAMES = [
  ['web-search-plus', '多引擎检索与结果去重，附带引用整理与可信度排序。'],
  ['pdf-vision-extract', '扫描件版面还原与表格抽取，支持跨页表头合并。'],
  ['git-commit-craft', '按仓库约定生成提交信息，自动校验 scope 与类型合法性。'],
  ['k8s-runbook', '集群排障手册：按症状定位到具体资源与命令，输出处置步骤。'],
  ['sql-explain-critic', '读执行计划找全表扫描、隐式类型转换与缺失索引。'],
  ['design-token-audit', '审计硬编码色值与间距，给出 token 化替换建议。'],
  ['repo-conventions', '从 AGENTS.md 提炼本仓库的提交规范、测试门禁与体积限制。'],
  ['perf-lab', '本地压测与火焰图采集脚本封装，产出可比对的基线报告。'],
  ['api-contract-guard', '对比 OpenAPI 契约与实现，标出破坏性变更。'],
  ['changelog-writer', '从提交历史生成面向用户的变更说明。'],
  ['test-gap-finder', '按覆盖率热点找出缺少断言的模块。'],
  ['incident-timeline', '把日志与告警拼成事故时间线并输出复盘要点。'],
];

const MARKET = Array.from({ length: 26 }, (_, index) => {
  const [baseName, baseDesc] = MARKET_NAMES[index % MARKET_NAMES.length];
  const suffix =
    index < MARKET_NAMES.length ? '' : `-${Math.floor(index / MARKET_NAMES.length) + 1}`;
  const id = index === 25 ? 'legacy-jquery-migrator' : `${baseName}${suffix}`;
  const builtinSource = index % 9 === 4; // 少量条目来自不可安装来源
  return {
    id,
    displayName: index === 25 ? 'legacy-jquery-migrator' : id,
    version: `1.${index % 9}.${index % 4}`,
    description:
      index === 25
        ? '实验源中的迁移脚本生成器，暂不支持在产品内直接安装。'
        : `${baseDesc}${index > 11 ? '（衍生条目，用于验证分页与长列表滚动）' : ''}`,
    category: MARKET_CATEGORIES[index % MARKET_CATEGORIES.length],
    tags:
      index % 3 === 0
        ? ['检索', '网络']
        : index % 3 === 1
          ? ['文档', 'OCR', '表格', '跨页', '长标签测试']
          : ['编程', 'Git'],
    downloads: 12033 - index * 317,
    verified: index % 4 !== 3,
    sourceId: builtinSource ? 'builtin' : index % 5 === 0 ? 'team/internal' : 'openAwork/market',
    author: index % 2 === 0 ? 'openAwork' : 'community-labs',
  };
});

const LOCAL_SKILLS = [
  {
    id: 'repo-conventions',
    displayName: 'repo-conventions',
    version: '0.1.0',
    description: '从 AGENTS.md 提炼本仓库的提交规范、测试门禁与体积限制。',
    category: 'development',
    tags: ['约定'],
    sourceId: 'local-workspace',
    dirPath: '/repo/skills/repo-conventions',
    manifestPath: '/repo/skills/repo-conventions/skill.json',
    workspaceRelativePath: 'skills/repo-conventions',
    installed: true,
  },
  {
    id: 'perf-lab',
    displayName: 'perf-lab',
    version: '0.3.2',
    description: '本地压测与火焰图采集脚本封装，产出可比对的基线报告。',
    category: 'ops',
    tags: ['性能'],
    sourceId: 'local-workspace',
    dirPath: '/repo/skills/perf-lab',
    manifestPath: '/repo/skills/perf-lab/skill.json',
    workspaceRelativePath: 'skills/perf-lab',
    installed: false,
  },
];

const INSTALLED = [
  {
    skillId: 'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
    manifest: { name: 'agentdocs-orchestrator', version: '2.3.0' },
    sourceId: 'github:Await-d/agentdocs-orchestrator',
    enabled: true,
    latestVersion: null,
  },
  {
    skillId: 'web-search-plus',
    manifest: { name: 'web-search-plus', version: '1.2.0' },
    sourceId: 'openAwork/market',
    enabled: true,
    latestVersion: '1.3.0',
  },
  {
    skillId: 'sql-explain-critic',
    manifest: { name: 'sql-explain-critic', version: '0.6.3' },
    sourceId: 'openAwork/market',
    enabled: true,
    latestVersion: '0.7.0',
  },
  {
    skillId: 'perf-lab',
    manifest: { name: 'perf-lab', version: '0.3.2' },
    sourceId: 'local-workspace',
    enabled: false,
    latestVersion: null,
  },
  {
    skillId: 'code-review',
    manifest: { name: 'code-review', version: '1.0.0' },
    sourceId: 'local-system:~/.claude/skills',
    enabled: true,
    latestVersion: null,
  },
];

const SOURCES = [
  {
    id: 'openAwork/market',
    name: 'openAwork 官方市场',
    url: 'https://skills.openawork.dev/index.json',
    type: 'official',
    enabled: true,
    trust: 'full',
    readonly: true,
  },
  {
    id: 'team/internal',
    name: '团队私有源',
    url: 'https://git.internal/skills/index.json',
    type: 'enterprise',
    enabled: true,
    trust: 'verified',
    readonly: false,
  },
  {
    id: 'community/experimental',
    name: '社区实验源（已停用）',
    url: 'https://community.example/skills.json',
    type: 'community',
    enabled: false,
    trust: 'untrusted',
    readonly: false,
  },
];

function detailFor(skillId) {
  const entry = MARKET.find((skill) => skill.id === skillId) ?? MARKET[0];
  return {
    ...entry,
    id: skillId,
    license: 'MIT',
    readme: [
      `# ${entry.displayName}`,
      '',
      entry.description,
      '',
      '## 用法',
      '',
      '1. 在需要外部事实的任务里显式启用；',
      '2. 结论必须附来源，无法核实的部分标注「未验证」；',
      '3. 单次检索上限 4 个引擎，避免压垮上游配额。',
    ].join('\n'),
    permissions: ['出站 HTTPS（引擎域名白名单）', '读取环境变量中的检索密钥', '写入会话级缓存'],
    changelog: '## 1.3.0\n- 新增可信度排序\n- 修复去重漏判\n\n## 1.2.0\n- 支持引用整理',
  };
}

function send(res, status, body) {
  res.writeHead(status, CORS);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // ── agents ────────────────────────────────────────────────────────────
  if (path === '/agents' && req.method === 'GET') {
    send(res, 200, { agents: AGENTS });
    return;
  }
  if (path === '/agents/reset-all' && req.method === 'POST') {
    send(res, 200, { agents: AGENTS });
    return;
  }
  if (path.startsWith('/agents/')) {
    const agentId = decodeURIComponent(path.slice('/agents/'.length).replace(/\/reset$/, ''));
    const found = AGENTS.find((agent) => agent.id === agentId) ?? AGENTS[0];
    if (path.endsWith('/reset')) {
      send(res, 200, { agent: found });
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    send(res, 200, { agent: found });
    return;
  }

  // ── skills（固定路径必须先于 /skills/:id 匹配）────────────────────────
  if (path === '/skills/search') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '24');
    const filtered = q
      ? MARKET.filter((skill) =>
          [skill.id, skill.displayName, skill.description, ...skill.tags]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : MARKET;
    send(res, 200, { skills: filtered.slice(offset, offset + limit), total: filtered.length });
    return;
  }
  if (path === '/skills/installed') {
    send(res, 200, { skills: INSTALLED });
    return;
  }
  if (path === '/skills/local/discover') {
    send(res, 200, { skills: LOCAL_SKILLS });
    return;
  }
  if (path === '/skills/registry-sources' && req.method === 'GET') {
    send(res, 200, { sources: SOURCES });
    return;
  }
  if (path.startsWith('/skills/registry-sources')) {
    send(res, 200, { sources: SOURCES, ok: true });
    return;
  }
  if (
    path === '/skills/install' ||
    path === '/skills/local/install' ||
    path === '/skills/system/resync'
  ) {
    send(res, 200, { ok: true, added: 0, updated: 1, removed: 0, total: INSTALLED.length });
    return;
  }
  if (path.startsWith('/skills/installed/')) {
    send(res, 200, { ok: true });
    return;
  }
  if (path.startsWith('/skills/') && req.method === 'GET') {
    send(res, 200, detailFor(decodeURIComponent(path.slice('/skills/'.length))));
    return;
  }

  // 其它请求（会话、通知、遥测等）一律给最小可用响应，避免页面报错。
  if (path === '/sessions') {
    send(res, 200, { sessions: [] });
    return;
  }
  send(res, 200, { ok: true });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock gateway on http://127.0.0.1:${PORT}`);
});
