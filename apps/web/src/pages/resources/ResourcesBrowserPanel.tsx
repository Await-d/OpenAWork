import type { ChangeEvent } from 'react';
import type { ResourceArea } from '@openAwork/web-client';
import type { ResourceCenterItem, ResourceCenterScope } from './resource-center-utils.js';
import { areaLabel, featureLabel, integrationLabel } from './resources-page-labels.js';

interface ResourceAreaOption {
  readonly value: ResourceArea | 'all';
  readonly label: string;
}

interface ResourcesBrowserPanelProps {
  readonly activeArea: ResourceArea | 'all';
  readonly activeScope: ResourceCenterScope;
  readonly areaOptions: readonly ResourceAreaOption[];
  readonly filteredItems: readonly ResourceCenterItem[];
  readonly loading: boolean;
  readonly query: string;
  readonly selectedItem: ResourceCenterItem | null;
  readonly onAreaChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectItem: (id: string) => void;
}

export function ResourcesBrowserPanel({
  activeArea,
  activeScope,
  areaOptions,
  filteredItems,
  loading,
  query,
  selectedItem,
  onAreaChange,
  onQueryChange,
  onSelectItem,
}: ResourcesBrowserPanelProps) {
  return (
    <section className="resources-browser resources-panel" aria-label="资源列表">
      <div className="resources-panel-heading compact">
        <span>{activeScope === 'catalog' ? 'Catalog' : 'Feature resources'}</span>
        <h2>{activeScope === 'catalog' ? '主资源目录' : '功能专用资源'}</h2>
        <p>
          {activeScope === 'catalog'
            ? '这里保留可直接管理或接入的资源。'
            : '这里展示被特定功能读取的资源，不再混入主目录。'}
        </p>
      </div>
      <div className="resources-toolbar">
        <label>
          分类
          <select value={activeArea} onChange={onAreaChange}>
            {areaOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索
          <input
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="按名称、标题、路径搜索"
          />
        </label>
      </div>

      <div className="resources-list" aria-live="polite">
        {loading ? <div className="resources-empty">正在读取资源目录</div> : null}
        {!loading && filteredItems.length === 0 ? (
          <div className="resources-empty">没有匹配资源</div>
        ) : null}
        {filteredItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === selectedItem?.id ? 'resources-row active' : 'resources-row'}
            onClick={() => onSelectItem(item.id)}
          >
            <span>
              <strong>{item.title}</strong>
              <small>
                {areaLabel(item.area)} · {featureLabel(item)} · {item.name}
              </small>
            </span>
            <span className="resources-row-badges">
              <span className={`resources-badge ${item.integration}`}>
                {integrationLabel(item)}
              </span>
              {item.visibility === 'feature' ? (
                <span className="resources-badge feature">专用</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
