import type { ResourceCenterItem } from './resource-center-utils.js';
import { resourceBoundaryNotice } from './resources-page-boundaries.js';
import { areaLabel, integrationLabel, usageLabel } from './resources-page-labels.js';

interface ResourcesPreviewPanelProps {
  readonly deletingId: string | null;
  readonly selectedItem: ResourceCenterItem | null;
  readonly onRemoveResource: (id: string) => void;
}

export function ResourcesPreviewPanel({
  deletingId,
  selectedItem,
  onRemoveResource,
}: ResourcesPreviewPanelProps) {
  const boundary = selectedItem ? resourceBoundaryNotice(selectedItem) : null;

  return (
    <article className="resources-preview resources-panel">
      {selectedItem ? (
        <>
          <div className="resources-preview-header">
            <div>
              <span>{areaLabel(selectedItem.area)}</span>
              <h2>{selectedItem.title}</h2>
            </div>
            {selectedItem.removable ? (
              <button
                type="button"
                className="resources-danger-button"
                disabled={deletingId === selectedItem.id}
                onClick={() => onRemoveResource(selectedItem.id)}
              >
                {deletingId === selectedItem.id ? '删除中' : '删除'}
              </button>
            ) : null}
          </div>
          <p>{selectedItem.description || '暂无描述'}</p>
          <dl className="resources-meta">
            <div>
              <dt>模式</dt>
              <dd>{integrationLabel(selectedItem)}</dd>
            </div>
            <div>
              <dt>用途</dt>
              <dd>{usageLabel(selectedItem)}</dd>
            </div>
            <div>
              <dt>信息</dt>
              <dd>{selectedItem.meta}</dd>
            </div>
            <div>
              <dt>路径</dt>
              <dd>{selectedItem.path}</dd>
            </div>
          </dl>
          {boundary ? (
            <section className="resources-boundary-notice" aria-label="运行时管理边界">
              <div>
                <span>管理边界</span>
                <strong>{boundary.title}</strong>
                <p>{boundary.description}</p>
              </div>
              <div className="resources-boundary-actions">
                {boundary.links.map((link) => (
                  <a key={link.href} href={link.href} className="resources-boundary-link">
                    {link.label}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          <pre>{selectedItem.content || '此资源没有文本预览。'}</pre>
        </>
      ) : (
        <div className="resources-empty">选择一个资源查看详情</div>
      )}
    </article>
  );
}
