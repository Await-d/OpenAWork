/**
 * 插件 / 技能 / MCP 管理面三视口验收 harness。
 *
 * 用真实 Chromium 渲染重写后的三个核心列表组件，覆盖 jsdom 覆盖不到的部分：
 *   - 375 / 768 / 1280 下不产生横向溢出；
 *   - 长名称按省略号截断（真实布局，含 flex min-width:0 链路）；
 *   - 语义色在真实 CSS 变量下解析为实际颜色（不是 transparent / inherit）；
 *   - focus ring 的计算样式；
 *   - 行内编辑 / 新增表单 / 开关等交互在真实布局里可用。
 *
 * 运行方式见同目录 `README.md`。
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InstalledSkillsManager, McpServerManager, SkillMarketHome } from '@openAwork/shared-ui';
import type {
  MCPServerEntry,
  MCPServerStatus,
  MarketInstalledSkill,
  MarketSkill,
} from '@openAwork/shared-ui';

const LONG_SKILL_NAME = '超长技能名称用于验证窄视口省略号截断是否真实生效而不是把行撑破或换行';
const LONG_MCP_ERROR =
  'connect ECONNREFUSED 127.0.0.1:65535 — 无法连接到本地 stdio 服务器，请检查 command 与 args 是否正确';

const SKILLS: MarketInstalledSkill[] = [
  {
    id: 'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
    name: LONG_SKILL_NAME,
    version: '1.0.0',
    latestVersion: '1.2.0',
    source: 'github:Await-d/agentdocs-orchestrator',
    enabled: true,
  },
  {
    id: 'local-system:/home/await/.claude/skills/notes',
    name: 'Notes',
    version: '0.3.1',
    latestVersion: '0.3.1',
    source: 'local-system:/home/await/.claude/skills',
    enabled: false,
  },
  {
    id: 'github:Await-d/agentdocs-orchestrator/schema-architect',
    name: 'Schema Architect',
    version: '2.0.0',
    latestVersion: '2.0.0',
    source: 'github:Await-d/agentdocs-orchestrator',
    enabled: true,
    preinstalled: true,
  },
];

const MARKET_SKILLS: MarketSkill[] = [
  {
    id: 'foo',
    name: LONG_SKILL_NAME,
    version: '1.0.0',
    description:
      '很长的技能描述，用于验证两行截断是否生效：这里继续追加文字让描述超过两行的高度上限，观察是否被裁剪。',
    category: 'writing',
    tags: ['长标签一', '长标签二', '标签三'],
    downloads: 12345,
    verified: true,
    installable: true,
  },
  {
    id: 'bar',
    name: 'Bar',
    version: '0.1.0',
    description: '短描述',
    category: 'coding',
    tags: [],
    downloads: 3,
    verified: false,
    installable: false,
  },
];

const MCP_SERVERS: MCPServerEntry[] = [
  {
    id: 'codegraph',
    name: 'codegraph',
    transport: 'stdio',
    builtin: true,
    builtinKind: 'virtual',
    source: 'builtin',
    enabled: true,
  },
  {
    id: 'fs',
    name: 'filesystem',
    transport: 'stdio',
    command: 'mcp-server-fs',
    enabled: true,
    disabledTools: ['fs_delete'],
  },
  {
    id: 'broken',
    name: 'broken-server',
    transport: 'sse',
    url: 'https://mcp.invalid/sse',
    enabled: true,
  },
];

const MCP_STATUSES: MCPServerStatus[] = [
  { id: 'codegraph', name: 'codegraph', status: 'connected', toolCount: 4, builtin: true },
  { id: 'fs', name: 'filesystem', status: 'connected', toolCount: 12 },
  { id: 'broken', name: 'broken-server', status: 'error', toolCount: 0, error: LONG_MCP_ERROR },
];

function McpHarness() {
  const [servers, setServers] = useState(MCP_SERVERS);
  const [statuses, setStatuses] = useState(MCP_STATUSES);
  return (
    <McpServerManager
      servers={servers}
      statuses={statuses}
      onAdd={(entry) => setServers((prev) => [...prev, entry])}
      onRemove={(id) => setServers((prev) => prev.filter((server) => server.id !== id))}
      onUpdate={(id, entry) =>
        setServers((prev) => prev.map((server) => (server.id === id ? entry : server)))
      }
      onRetry={(id) =>
        setStatuses((prev) =>
          prev.map((status) =>
            status.id === id ? { ...status, retryFeedback: { kind: 'pending' } } : status,
          ),
        )
      }
    />
  );
}

function SkillsHarness() {
  const [skills, setSkills] = useState(SKILLS);
  return (
    <InstalledSkillsManager
      skills={skills}
      onUninstall={(id) => setSkills((prev) => prev.filter((skill) => skill.id !== id))}
      onUpdate={() => undefined}
      onCheckUpdates={() => undefined}
      onToggle={(id, next) =>
        setSkills((prev) =>
          prev.map((skill) => (skill.id === id ? { ...skill, enabled: next } : skill)),
        )
      }
      toggleDisabledReason={(skill) => (skill.preinstalled ? '系统预装技能，不允许禁用' : null)}
    />
  );
}

function Viewport(props: { label: string; width: number }) {
  return (
    <div className="viewport" style={{ width: props.width }}>
      <div className="viewport-label">{props.label}</div>
      <div data-case="installed-skills">
        <SkillsHarness />
      </div>
      <div data-case="mcp-manager">
        <McpHarness />
      </div>
      <div data-case="skill-market">
        <SkillMarketHome
          skills={MARKET_SKILLS}
          categories={['writing', 'coding']}
          currentPage={1}
          pageSize={24}
          total={2}
          onInstall={() => undefined}
          onSelect={() => undefined}
          onSearch={() => undefined}
          onPageChange={() => undefined}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="themed">
      <Viewport label="375px" width={375} />
      <Viewport label="768px" width={768} />
      <Viewport label="1280px" width={1280} />
    </div>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('harness root #root not found');
}
createRoot(container).render(<App />);
