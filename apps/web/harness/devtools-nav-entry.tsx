/**
 * `DevtoolsSectionNav` 交互状态验收 harness。
 *
 * 覆盖 jsdom 覆盖不到的部分：
 *   - 真实引擎解析 CSS 变量后的 hover 背景（`--bg-hover`，含 `--bg-subtle` 陷阱守卫）
 *   - focus ring 的计算样式（outline 2px accent + offset）
 *   - 选中态 `aria-pressed` 转移与点击回调
 *   - 导出下拉的打开 / Escape 关闭
 *
 * 运行方式见同目录 `README.md`。断言由 `verify-devtools-nav.ts` 执行。
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DevtoolsSectionNav,
  type DevtoolsSectionId,
  type DevtoolsSectionNavItem,
} from '../src/pages/settings/devtools/devtools-section-nav.js';
import { rowInteractionProps } from '../src/pages/settings/devtools/devtools-workbench-primitives.js';

declare global {
  interface Window {
    __devtoolsNavSelections?: string[];
    __devtoolsNavAutoRefresh?: boolean[];
    __devtoolsNavBundleCopies?: number;
  }
}
window.__devtoolsNavSelections = [];
window.__devtoolsNavAutoRefresh = [];
window.__devtoolsNavBundleCopies = 0;

const ITEMS: DevtoolsSectionNavItem[] = [
  { id: 'overview', label: '总览', count: 1, hasError: true },
  { id: 'diagnostics', label: '诊断', count: 2, hasError: true },
  { id: 'logs', label: '日志', count: 200, hasError: false },
  { id: 'workers', label: 'Worker', count: 0, hasError: false },
];

function Harness() {
  const [active, setActive] = useState<DevtoolsSectionId>('overview');
  const [autoRefresh, setAutoRefresh] = useState(false);

  return (
    <div className="harness-theme" data-case="nav">
      <DevtoolsSectionNav
        activeSection={active}
        items={ITEMS}
        anyRefreshableSourceLoading={false}
        autoRefreshEnabled={autoRefresh}
        lastGlobalRefreshAt={1_700_000_000_000}
        onSelectSection={(id) => {
          window.__devtoolsNavSelections?.push(id);
          setActive(id);
        }}
        onRefreshAllSources={() => undefined}
        onToggleAutoRefresh={(enabled) => {
          window.__devtoolsNavAutoRefresh?.push(enabled);
          setAutoRefresh(enabled);
        }}
        issueCount={3}
        onCopyTroubleshootBundle={async () => {
          window.__devtoolsNavBundleCopies = (window.__devtoolsNavBundleCopies ?? 0) + 1;
          return true;
        }}
        onExportErrorReport={() => undefined}
        onExportDebugBundle={() => undefined}
        onExportMarkdownBundle={() => undefined}
      />

      {/*
        列表行 hover 样例：直接使用 `rowInteractionProps`（列表条目 / 分段按钮的公共路径）。
        守卫点：hover 背景必须解析到真实存在的 `--bg-hover`，而不是历史上写错的 `--bg-subtle`。
      */}
      <div
        data-case="row-hover"
        {...rowInteractionProps({ isActive: false, restBackground: 'transparent' })}
        style={{
          marginTop: 16,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-default)',
          fontSize: 12,
        }}
      >
        列表行 hover 样例
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
