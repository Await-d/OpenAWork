/**
 * 已安装插件管理面（`ThirdPartyPluginsView`）三视口验收 harness。
 *
 * 渲染真实生产组件，用 fixture 覆盖：
 *   - 活跃第三方插件（含超长 id / 路径，验证 375 下的省略号与不溢出）；
 *   - 激活失败的插件（长错误信息换行不撑破容器 + danger 语义色）；
 *   - 「外部加载」形态（无 installId，不显示重载/卸载）；
 *   - 空态、状态消息行、安装表单；
 *   - 卸载二次确认与安装回调（记录进 window.__thirdPartyPluginsHarness）。
 *
 * 运行方式见同目录 `README.md`。
 */
import { createRoot } from 'react-dom/client';
import type { GatewayPluginInfo } from '@openAwork/web-client';
import { ThirdPartyPluginsView } from '../src/pages/settings/plugins/third-party-plugins-view.js';

declare global {
  interface Window {
    __thirdPartyPluginsHarness?: { calls: string[] };
  }
}

const LONG_ID = 'example.analytics-dashboard-extension-with-a-very-long-plugin-identifier-name';
const LONG_SOURCE =
  '/srv/openawork/plugins/example.analytics-dashboard-extension-with-a-very-long-plugin-identifier-name';
const LONG_ERROR =
  'Plugin setup threw: Cannot find module "@company/private-helper" imported from /srv/plugins/demo-broken/index.mjs —— 这条很长的错误信息用于验证换行后不撑破容器宽度。';

const PLUGINS: GatewayPluginInfo[] = [
  {
    id: 'demo.echo',
    source: '/srv/plugins/demo-echo',
    installId: 'demo-echo',
    state: { status: 'active' },
    guarded: false,
  },
  {
    id: LONG_ID,
    source: LONG_SOURCE,
    installId: 'demo-long',
    state: { status: 'active' },
    guarded: false,
  },
  {
    id: 'demo.broken',
    source: '/srv/plugins/demo-broken',
    installId: 'demo-broken',
    state: { status: 'failed', error: LONG_ERROR },
    guarded: false,
  },
  {
    id: 'demo.paused',
    source: '/srv/plugins/demo-paused',
    installId: 'demo-paused',
    state: { status: 'disabled' },
    guarded: false,
  },
  {
    id: 'legacy.env-plugin',
    source: '/home/dev/plugins/legacy.js',
    state: { status: 'active' },
    guarded: false,
  },
];

function record(entry: string): void {
  window.__thirdPartyPluginsHarness?.calls.push(entry);
}

function PluginsHarness(): React.ReactElement {
  return (
    <ThirdPartyPluginsView
      plugins={PLUGINS}
      loading={false}
      error={null}
      busy={false}
      statusMessage="已安装并激活 demo.echo。"
      onRefresh={() => record('refresh')}
      onInstall={async (path, force) => {
        record(`install:${path}:${String(force)}`);
        return true;
      }}
      onRemove={(installId) => record(`remove:${installId}`)}
      onReload={(installId) => record(`reload:${installId}`)}
      onDisable={(pluginId) => record(`disable:${pluginId}`)}
      onEnable={(pluginId) => record(`enable:${pluginId}`)}
    />
  );
}

function EmptyHarness(): React.ReactElement {
  return (
    <ThirdPartyPluginsView
      plugins={[]}
      loading={false}
      error={null}
      busy={false}
      statusMessage={null}
      onRefresh={() => record('refresh')}
      onInstall={async () => true}
      onRemove={() => undefined}
      onReload={() => undefined}
      onDisable={() => undefined}
      onEnable={() => undefined}
    />
  );
}

function Viewport(props: { label: string; width: number }): React.ReactElement {
  return (
    <div className="viewport" style={{ width: props.width }}>
      <div className="viewport-label">{props.label}</div>
      <div data-case="third-party-plugins">
        <PluginsHarness />
      </div>
      <div data-case="third-party-plugins-empty">
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

window.__thirdPartyPluginsHarness = { calls: [] };

const container = document.getElementById('root');
if (!container) {
  throw new Error('harness root #root not found');
}
createRoot(container).render(<App />);
