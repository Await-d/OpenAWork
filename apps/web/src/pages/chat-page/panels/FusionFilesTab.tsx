import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';

export interface FusionFilesTabProps {
  readonly effectiveWorkingDirectory: string | null;
  readonly onOpenWorkspace: () => void;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function FusionFilesTab({
  effectiveWorkingDirectory,
  onOpenWorkspace,
  workspaceFileItems,
}: FusionFilesTabProps) {
  return (
    <div className="fusion-side-panel__scroll">
      <div className="fusion-side-panel__section-head">
        <div>
          <div className="fusion-side-panel__eyebrow">文件上下文</div>
          <div className="fusion-side-panel__title">
            {workspaceFileItems.length > 0 ? `${workspaceFileItems.length} 个索引文件` : '暂无文件'}
          </div>
        </div>
        <button type="button" className="fusion-side-panel__ghost-button" onClick={onOpenWorkspace}>
          选择工作区
        </button>
      </div>

      <div className="fusion-side-panel__meta-card">
        <span>当前工作区</span>
        <strong title={effectiveWorkingDirectory ?? undefined}>
          {effectiveWorkingDirectory ? basename(effectiveWorkingDirectory) : '未绑定'}
        </strong>
      </div>

      {workspaceFileItems.length > 0 ? (
        <ul className="fusion-side-panel__file-list" aria-label="文件上下文列表">
          {workspaceFileItems.map((item) => (
            <li key={item.path}>
              <div className="fusion-side-panel__file-row" title={item.path}>
                <span className="fusion-side-panel__file-icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </span>
                <span className="fusion-side-panel__file-main">
                  <span>{item.label}</span>
                  <small>{item.relativePath || dirname(item.path)}</small>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="fusion-side-panel__empty">
          <strong>还没有注入文件上下文</strong>
          <span>在输入框使用 @ 文件或先选择工作区后，这里会显示可被模型引用的文件。</span>
        </div>
      )}
    </div>
  );
}
