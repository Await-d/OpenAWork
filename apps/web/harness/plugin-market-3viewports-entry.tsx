/**
 * 插件市场三视口验收 harness。
 *
 * 渲染真实生产组件 `PluginMarketView`，用 fixture 覆盖：
 *   - 多来源（含超长 repo/ref，验证 375 下的省略号与不溢出）；
 *   - 长描述 / 根目录单插件（fallback 徽章）/ 版本与来源徽章；
 *   - 失败来源提示（contrast 语义色）；
 *   - 信任确认（安装 → 确认安装）、详情（README 渲染 + 关闭）、
 *     来源面板（添加 / 移除）与空态；
 *   - 回调记录进 window.__pluginMarketHarness（供 verify 断言）。
 *
 * 运行方式见同目录 `README.md`。
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  PluginMarketDetail,
  PluginMarketEntry,
  PluginMarketSource,
} from '@openAwork/web-client';
import { PluginMarketView } from '../src/pages/settings/plugins/plugin-market-view.js';

declare global {
  interface Window {
    __pluginMarketHarness?: { calls: string[] };
  }
}

const LONG_REPO = 'very-long-org-name/very-long-repo-name-for-truncation-check';
const LONG_PATH = 'packages/plugins/analytics-dashboard-extension-with-a-very-long-directory-name';
const LONG_DESCRIPTION =
  '用于验证长描述在窄视口下自动换行而不是把卡片撑破：这里继续追加文字，让描述超过一行的高度，观察换行、间距与卡片边界是否稳定。';

const SOURCES: PluginMarketSource[] = [
  {
    id: 'acme/plugins',
    name: 'Acme 插件集',
    repo: 'acme/plugins',
    enabled: true,
    createdAt: '2026-09-24',
  },
  {
    id: LONG_REPO,
    name: LONG_REPO,
    repo: LONG_REPO,
    ref: 'feature/very-long-branch-name-for-truncation',
    enabled: true,
    createdAt: '2026-09-24',
  },
];

const ENTRIES: PluginMarketEntry[] = [
  {
    id: 'acme/plugins/echo',
    name: 'echo',
    description: '回声插件：把输入原样返回，用于连通性验证。',
    version: '1.0.0',
    author: 'Acme',
    path: 'plugins/echo',
    sourceId: 'acme/plugins',
    sourceName: 'Acme 插件集',
    repo: 'acme/plugins',
    fallback: false,
  },
  {
    id: `${LONG_REPO}/analytics-dashboard-extension-with-a-very-long-name`,
    name: 'analytics-dashboard-extension-with-a-very-long-name',
    description: LONG_DESCRIPTION,
    version: '2.14.0',
    path: LONG_PATH,
    sourceId: LONG_REPO,
    sourceName: LONG_REPO,
    repo: LONG_REPO,
    ref: 'feature/very-long-branch-name-for-truncation',
    fallback: false,
  },
  {
    id: 'acme/plugins/root-plugin',
    name: 'root-plugin',
    description: '',
    path: '',
    sourceId: 'acme/plugins',
    sourceName: 'Acme 插件集',
    repo: 'acme/plugins',
    fallback: true,
  },
];

const FAILED_SOURCES = [
  {
    sourceId: 'acme/broken',
    error:
      '插件清单格式无效：https://raw.githubusercontent.com/acme/broken/HEAD/openawork-plugins.json（期望 { plugins: [{ name, path?, ... }] }）',
  },
];

const DETAIL: PluginMarketDetail = {
  entry: ENTRIES[0]!,
  readme: '# echo\n\n把输入原样返回。\n\n## 用法\n\n安装后在「已安装插件」中管理。\n',
  repoUrl: 'https://github.com/acme/plugins',
};

function record(entry: string): void {
  window.__pluginMarketHarness?.calls.push(entry);
}

function MarketHarness(): React.ReactElement {
  const [detail, setDetail] = useState<PluginMarketDetail | null>(null);

  return (
    <PluginMarketView
      sources={SOURCES}
      entries={ENTRIES}
      failedSources={FAILED_SOURCES}
      loading={false}
      error={null}
      busy={false}
      statusMessage="已添加源 acme/plugins。"
      detail={detail}
      detailLoading={false}
      onRefresh={(query) => record(`refresh:${query ?? ''}`)}
      onOpenEntry={(entry) => {
        record(`open:${entry.id}`);
        setDetail(DETAIL);
      }}
      onCloseDetail={() => {
        record('close-detail');
        setDetail(null);
      }}
      onInstall={(entry) => record(`install:${entry.id}`)}
      onAddSource={async (repo, ref) => {
        record(`add:${repo}:${ref ?? ''}`);
        return true;
      }}
      onRemoveSource={(sourceId) => record(`remove-source:${sourceId}`)}
    />
  );
}

function EmptyHarness(): React.ReactElement {
  return (
    <PluginMarketView
      sources={[]}
      entries={[]}
      failedSources={[]}
      loading={false}
      error={null}
      busy={false}
      statusMessage={null}
      detail={null}
      detailLoading={false}
      onRefresh={() => record('refresh')}
      onOpenEntry={() => undefined}
      onCloseDetail={() => undefined}
      onInstall={() => undefined}
      onAddSource={async () => true}
      onRemoveSource={() => undefined}
    />
  );
}

function Viewport(props: { label: string; width: number }): React.ReactElement {
  return (
    <div className="viewport" style={{ width: props.width }}>
      <div className="viewport-label">{props.label}</div>
      <div data-case="plugin-market">
        <MarketHarness />
      </div>
      <div data-case="plugin-market-empty">
        <EmptyHarness />
      </div>
    </div>
  );
}

function App(): React.ReactElement {
  return (
    <div className="themed">
      <Viewport label="375px" width={375} />
      <Viewport label="768px" width={768} />
      <Viewport label="1280px" width={1280} />
    </div>
  );
}

window.__pluginMarketHarness = { calls: [] };

const container = document.getElementById('root');
if (!container) {
  throw new Error('harness root #root not found');
}
createRoot(container).render(<App />);
