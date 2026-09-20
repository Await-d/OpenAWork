/**
 * FusionMobileBottomPanel — 移动端（< 768px）底部 Tab 侧面板。
 *
 * 包含两部分：
 *   1. 固定底部 Tab 条（48px），显示三个 Tab 标签按钮 + 关闭按钮
 *   2. 底部抽屉（65vh），在 isOpen 时从底部滑入，展示对应 Tab 内容
 *
 * 参照 T-F4-07 移动端适配要求。
 */

import { useState } from 'react';
import type { WorkspaceFileTreePanelProps } from '../../../components/layout/sidebar/WorkspaceFileTreePanel.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';
import { FusionContextTab } from './FusionContextTab.js';
import type {
  FusionContextOverviewProps,
  FusionContextRuntimeSummary,
} from './FusionContextTab.js';
import { FusionBrowserTab } from './FusionBrowserTab.js';
import { FusionFilesTab } from './FusionFilesTab.js';
import type { FusionFilesEditorState } from './FusionFilesTab.js';
import { FusionReviewTab } from './FusionReviewTab.js';
import type { SidePanelTabId } from './SessionSidePanel.js';
import type { ChangeScope, DiffViewMode } from './review-panel-model.js';
import { useReviewPanelFileChanges } from './use-review-panel-file-changes.js';
import './FusionMobileBottomPanel.css';

export interface FusionMobileBottomPanelProps {
  readonly activeEditorFilePath: string | null;
  readonly activeTab: SidePanelTabId;
  readonly currentSessionId: string | null;
  readonly editorMode: boolean;
  readonly editorFileState: FusionFilesEditorState;
  readonly editorOpenFilePaths: readonly string[];
  readonly effectiveWorkingDirectory: string | null;
  readonly fetchTree: WorkspaceFileTreePanelProps['fetchTree'];
  readonly gatewayUrl: string;
  readonly handleSaveFile: (path: string) => Promise<void>;
  /** 面板内容是否展开（对应 reviewPanelOpened） */
  readonly isOpen: boolean;
  /** 关闭面板内容（但保留 Tab 条） */
  readonly onClose: () => void;
  /** 打开面板内容 */
  readonly onOpen: () => void;
  readonly onOpenFileInEditor: (path: string) => void;
  readonly onOpenWorkspace: () => void;
  readonly onShowEditor: () => void;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  /** 会话概览正文数据（必填）：用量、压缩入口、指标、诊断全部由它承载。 */
  readonly overview: FusionContextOverviewProps;
  readonly reviewRevision?: number;
  readonly runtimeSummary?: FusionContextRuntimeSummary;
  readonly saving: boolean;
  readonly token: string | null;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
}

function ReviewIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ContextIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function BrowserIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface TabDef {
  readonly id: SidePanelTabId;
  readonly label: string;
  readonly icon: React.ReactElement;
  readonly badge?: number;
}

const MOBILE_PANEL_TAB_IDS: readonly SidePanelTabId[] = ['files', 'browser', 'review', 'context'];

/** 共享 store 在跨断点 / 布局切换后可能残留桌面 tab；渲染前收敛到审查，避免空面板。 */
export function resolveMobilePanelTab(tab: SidePanelTabId): SidePanelTabId {
  return MOBILE_PANEL_TAB_IDS.includes(tab) ? tab : 'review';
}

export function FusionMobileBottomPanel({
  activeEditorFilePath,
  activeTab,
  currentSessionId,
  editorMode,
  editorFileState,
  editorOpenFilePaths,
  effectiveWorkingDirectory,
  fetchTree,
  gatewayUrl,
  handleSaveFile,
  isOpen,
  onClose,
  onOpen,
  onOpenFileInEditor,
  onOpenWorkspace,
  onShowEditor,
  onTabChange,
  overview,
  reviewRevision,
  runtimeSummary,
  saving,
  token,
  workspaceFileItems,
}: FusionMobileBottomPanelProps) {
  const [mutationRefetchTick, setMutationRefetchTick] = useState(0);
  const externalReviewRevision = reviewRevision ?? 0;
  const mobileTab = resolveMobilePanelTab(activeTab);
  const reviewState = useReviewPanelFileChanges({
    gatewayUrl,
    opened: isOpen,
    revision: externalReviewRevision + mutationRefetchTick,
    sessionId: currentSessionId,
    token,
  });
  const reviewCount = reviewState.kind === 'ready' ? reviewState.projection.fileDiffs.length : 0;
  const [changeScope, setChangeScope] = useState<ChangeScope>('all');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('unified');

  const tabs: readonly TabDef[] = [
    { id: 'files', label: '文件', icon: <FilesIcon /> },
    { id: 'browser', label: '浏览器', icon: <BrowserIcon /> },
    { id: 'review', label: '审查', icon: <ReviewIcon />, badge: reviewCount || undefined },
    { id: 'context', label: '会话概览', icon: <ContextIcon /> },
  ];

  const handleTabClick = (tabId: SidePanelTabId) => {
    if (isOpen && mobileTab === tabId) {
      onClose();
    } else if (isOpen) {
      onTabChange(tabId);
    } else {
      onTabChange(tabId);
      onOpen();
    }
  };

  return (
    <>
      {isOpen && (
        <>
          <button
            type="button"
            className="fusion-mobile-bottom__backdrop"
            aria-label="关闭侧面板"
            onClick={onClose}
          />
          <div
            className="fusion-mobile-bottom__sheet"
            role="dialog"
            aria-label="会话侧面板"
            aria-modal="true"
            data-testid="fusion-mobile-bottom-sheet"
          >
            <div className="fusion-mobile-bottom__sheet-drag-handle" />
            <div className="fusion-mobile-bottom__sheet-content">
              {mobileTab === 'review' ? (
                <FusionReviewTab
                  changeScope={changeScope}
                  diffViewMode={diffViewMode}
                  gatewayUrl={gatewayUrl}
                  onChangeScope={setChangeScope}
                  onChangeViewMode={setDiffViewMode}
                  onReviewMutated={() => setMutationRefetchTick((tick) => tick + 1)}
                  revision={externalReviewRevision + mutationRefetchTick}
                  sessionId={currentSessionId}
                  state={reviewState}
                  token={token}
                />
              ) : mobileTab === 'files' ? (
                <FusionFilesTab
                  activeEditorFilePath={activeEditorFilePath}
                  currentSessionId={currentSessionId}
                  editorMode={editorMode}
                  editorFileState={editorFileState}
                  editorOpenFilePaths={editorOpenFilePaths}
                  effectiveWorkingDirectory={effectiveWorkingDirectory}
                  fetchTree={fetchTree}
                  handleSaveFile={handleSaveFile}
                  onOpenFileInEditor={onOpenFileInEditor}
                  onOpenWorkspace={onOpenWorkspace}
                  onShowEditor={onShowEditor}
                  saving={saving}
                  workspaceFileItems={workspaceFileItems}
                />
              ) : mobileTab === 'browser' ? (
                <FusionBrowserTab
                  currentSessionId={currentSessionId}
                  effectiveWorkingDirectory={effectiveWorkingDirectory}
                />
              ) : (
                <FusionContextTab overview={overview} runtimeSummary={runtimeSummary} />
              )}
            </div>
          </div>
        </>
      )}

      <div
        className="fusion-mobile-bottom__strip"
        role="tablist"
        aria-label="会话侧面板标签"
        data-testid="fusion-mobile-bottom-strip"
      >
        {tabs.map((tab) => {
          const isActive = isOpen && mobileTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-active={isActive ? 'true' : 'false'}
              className="fusion-mobile-bottom__tab"
              onClick={() => {
                handleTabClick(tab.id);
              }}
            >
              {tab.icon}
              <span className="fusion-mobile-bottom__tab-label">{tab.label}</span>
              {tab.badge !== undefined && (
                <span className="fusion-mobile-bottom__tab-badge">{tab.badge}</span>
              )}
            </button>
          );
        })}

        {isOpen && (
          <button
            type="button"
            className="fusion-mobile-bottom__close"
            aria-label="关闭侧面板"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </>
  );
}
