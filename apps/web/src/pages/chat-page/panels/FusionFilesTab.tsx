import type { EditorBrowserWorkspaceProps } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { EditorBrowserWorkspace } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { WorkspaceFileTreePanel } from '../../../components/layout/sidebar/WorkspaceFileTreePanel.js';
import type { WorkspaceFileTreePanelProps } from '../../../components/layout/sidebar/WorkspaceFileTreePanel.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';
import type { OpenFile, RevealTarget } from '../../../hooks/editor/useFileEditor.js';
import { getParentPath, getPathBasename, getRelativePath } from '../../../utils/workspace-path.js';

export interface FusionFilesEditorState {
  readonly activeFile: OpenFile | null;
  readonly activeFilePath: string | null;
  readonly closeFile: (path: string) => void;
  readonly isDirty: (path: string) => boolean;
  readonly openFiles: readonly OpenFile[];
  readonly saveError: string | null;
  readonly setActiveFilePath: (path: string | null) => void;
  readonly updateContent: (path: string, content: string) => void;
  readonly reorderFiles?: (fromIndex: number, toIndex: number) => void;
  readonly revealTarget?: RevealTarget | null;
  readonly clearRevealTarget?: () => void;
}

export interface FusionFilesTabProps {
  readonly activeEditorFilePath: string | null;
  readonly currentSessionId: string | null;
  readonly editorMode: boolean;
  readonly editorFileState: FusionFilesEditorState;
  readonly editorOpenFilePaths: readonly string[];
  readonly effectiveWorkingDirectory: string | null;
  readonly fetchTree: WorkspaceFileTreePanelProps['fetchTree'];
  readonly handleSaveFile: (path: string) => Promise<void>;
  readonly onOpenFileInEditor: (path: string) => void;
  readonly onOpenWorkspace: () => void;
  readonly onShowEditor: () => void;
  readonly saving: boolean;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
}

function basename(path: string): string {
  return getPathBasename(path, path);
}

function dirname(path: string): string {
  return getParentPath(path) ?? path;
}

function toWorkspaceRelativePath(path: string, workspacePath: string | null): string {
  return workspacePath ? (getRelativePath(path, workspacePath) ?? path) : path;
}

export function FusionFilesTab({
  activeEditorFilePath,
  currentSessionId,
  editorMode,
  editorFileState,
  editorOpenFilePaths,
  effectiveWorkingDirectory,
  fetchTree,
  handleSaveFile,
  onOpenFileInEditor,
  onOpenWorkspace,
  onShowEditor,
  saving,
  workspaceFileItems,
}: FusionFilesTabProps) {
  const editorWorkspaceState: EditorBrowserWorkspaceProps['fileEditor'] = {
    ...editorFileState,
    openFiles: [...editorFileState.openFiles],
  };
  const activeEditorTitle = activeEditorFilePath
    ? toWorkspaceRelativePath(activeEditorFilePath, effectiveWorkingDirectory)
    : undefined;
  const activeEditorLabel = activeEditorFilePath
    ? basename(activeEditorFilePath)
    : editorMode
      ? '主编辑器已展开'
      : '当前未打开文件';
  const editorStatusHint = activeEditorFilePath
    ? `${editorOpenFilePaths.length} 个已打开文件，可在下方侧面板继续编辑`
    : editorMode
      ? '主内容区编辑器已展开；下方侧面板也可同步浏览与切换文件'
      : '在下方文件树打开文件后，可直接在当前 Tab 内编辑';

  return (
    <div className="fusion-side-panel__scroll">
      <div className="fusion-side-panel__section-head">
        <div>
          <div className="fusion-side-panel__eyebrow">文件工作台</div>
          <div className="fusion-side-panel__title">在当前侧面板内浏览、打开并编辑工作区文件</div>
        </div>
      </div>

      <div className="fusion-side-panel__action-row">
        <button type="button" className="fusion-side-panel__ghost-button" onClick={onShowEditor}>
          打开编辑器
        </button>
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

      <div className="fusion-side-panel__meta-card">
        <span>当前文件</span>
        <strong title={activeEditorTitle}>{activeEditorLabel}</strong>
        <small>{editorStatusHint}</small>
        {editorOpenFilePaths.length > 0 ? (
          <div className="fusion-side-panel__pill-row" aria-label="已打开文件">
            {editorOpenFilePaths.slice(0, 4).map((path) => {
              const label = basename(path);
              return (
                <button
                  key={path}
                  type="button"
                  className="fusion-side-panel__file-pill"
                  onClick={() => onOpenFileInEditor(path)}
                  aria-label={`切换到 ${label}`}
                  title={toWorkspaceRelativePath(path, effectiveWorkingDirectory)}
                >
                  {label}
                </button>
              );
            })}
            {editorOpenFilePaths.length > 4 ? (
              <span className="fusion-side-panel__file-pill" data-passive="true">
                +{editorOpenFilePaths.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="fusion-side-panel__section" aria-labelledby="fusion-files-editor-heading">
        {effectiveWorkingDirectory ? (
          <>
            <div className="fusion-side-panel__subsection-head">
              <div className="fusion-side-panel__eyebrow">工作区浏览</div>
              <div className="fusion-side-panel__title" id="fusion-files-tree-heading">
                当前工作区文件树
              </div>
            </div>
            <div className="fusion-side-panel__workspace-tree-shell">
              <WorkspaceFileTreePanel
                workspacePath={effectiveWorkingDirectory}
                sessionId={currentSessionId}
                onOpenFile={onOpenFileInEditor}
                fetchTree={fetchTree}
                active={true}
                allowMutations={false}
                variant="embedded"
                style={{
                  flex: 1,
                  minHeight: 0,
                  background: 'var(--bg-surface)',
                  overflow: 'hidden',
                }}
              />
            </div>

            <div className="fusion-side-panel__subsection-head">
              <div className="fusion-side-panel__eyebrow">文件编辑器</div>
              <div className="fusion-side-panel__title" id="fusion-files-editor-heading">
                当前工作区代码视图
              </div>
            </div>
            <div className="fusion-side-panel__editor-shell">
              <EditorBrowserWorkspace
                fileEditor={editorWorkspaceState}
                saving={saving}
                handleSaveFile={handleSaveFile}
                workspacePath={effectiveWorkingDirectory}
              />
            </div>
          </>
        ) : (
          <div className="fusion-side-panel__empty">
            <strong>还没有绑定工作区</strong>
            <span>先选择一个工作区，文件树和编辑器联动能力才会生效。</span>
          </div>
        )}
      </section>

      <section
        className="fusion-side-panel__section"
        aria-labelledby="fusion-files-context-heading"
      >
        <div className="fusion-side-panel__subsection-head">
          <div className="fusion-side-panel__eyebrow">上下文索引</div>
          <div className="fusion-side-panel__title" id="fusion-files-context-heading">
            {workspaceFileItems.length > 0
              ? `${workspaceFileItems.length} 个已注入文件`
              : '暂无已注入文件'}
          </div>
        </div>

        {workspaceFileItems.length > 0 ? (
          <ul className="fusion-side-panel__file-list" aria-label="文件上下文列表">
            {workspaceFileItems.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  className="fusion-side-panel__file-row"
                  title={
                    item.relativePath ??
                    toWorkspaceRelativePath(item.path, effectiveWorkingDirectory)
                  }
                  onClick={() => onOpenFileInEditor(item.path)}
                  aria-label={`在编辑器中打开 ${item.label}`}
                >
                  <span className="fusion-side-panel__file-icon" aria-hidden="true">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </span>
                  <span className="fusion-side-panel__file-main">
                    <span>{item.label}</span>
                    <small>{item.relativePath || dirname(item.path)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="fusion-side-panel__empty">
            <strong>还没有注入文件上下文</strong>
            <span>在输入框使用 @ 文件后，这里会保留上下文文件，同时支持一键在编辑器中打开。</span>
          </div>
        )}
      </section>
    </div>
  );
}
