import { useEffect, useState, type ReactNode } from 'react';
import type { ChatProviderDescriptor } from '../../../components/chat/message/chat-message-group-list.js';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';
import type {
  EditorBrowserWorkspaceProps,
  EditorPaneTab,
} from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { TaskToolRuntimeLookup } from '../conversation/render/task-tool-runtime.js';
import { resolveChatUiWorkspaceScope, resolveWorkspaceKey } from '../hooks/use-chat-ui-state.js';
import './FusionSessionSidePanel.css';
import { FusionContextTab } from './FusionContextTab.js';
import type {
  FusionContextOverviewProps,
  FusionContextRuntimeSummary,
} from './FusionContextTab.js';
import { FusionReviewTab } from './FusionReviewTab.js';
import { FusionWorkspaceTab } from './FusionWorkspaceTab.js';
import { SessionSidePanel } from './SessionSidePanel.js';
import type { SidePanelTabId } from './SessionSidePanel.js';
import type { ChangeScope, DiffViewMode } from './review-panel-model.js';
import { SubSessionDetailPanel } from './sub-session-detail-panel.js';
import { useReviewPanelFileChanges } from './use-review-panel-file-changes.js';

export type FusionDesktopPanelTab = 'review' | 'agent' | 'code' | 'preview' | 'context';

/**
 * 桌面停靠面板一级 tab（审查 / 子代理 / 代码 / 预览 / Context）；移动端专属 tab
 * 收敛到桌面近义 tab：`files` → `code`、`browser` → `preview`（移动端「浏览器」
 * 与桌面「预览」是同一浏览器工作区），其余未知脏值 → `review`，保证永远有可渲染
 * 内容。
 */
export function resolveFusionDesktopPanelTab(tab: SidePanelTabId): FusionDesktopPanelTab {
  switch (tab) {
    case 'agent':
      return 'agent';
    case 'code':
      return 'code';
    case 'preview':
    case 'browser':
      return 'preview';
    case 'context':
      return 'context';
    case 'files':
      return 'code';
    default:
      return 'review';
  }
}

export interface FusionSessionSidePanelProps {
  readonly activeTab: SidePanelTabId;
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly currentSessionId: string | null;
  readonly currentUserDisplayName?: string;
  readonly currentUserEmail: string;
  readonly effectiveWorkingDirectory: string | null;
  /** 代码 / 预览一级 tab 共享的文件编辑器状态（与主编辑器面板共用同一份）。 */
  readonly fileEditor: EditorBrowserWorkspaceProps['fileEditor'];
  /** 工作区文件树（由 ChatPage 复用与主编辑器面板相同的 WorkspaceFileTreePanel 配置）。 */
  readonly fileTree: ReactNode;
  readonly gatewayUrl: string;
  readonly handleSaveFile: (path: string) => Promise<void>;
  readonly onCompactSession: () => void;
  /** 打开子代理完整会话（从子代理 tab 的「全屏」入口跳转）。 */
  readonly onOpenFullSession: (sessionId: string) => void;
  /** 把工作区提升到主内容区（editorMode + editorFullScreen + 对应 tab）。 */
  readonly onPromoteToFullScreen: (tab: EditorPaneTab) => void;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  readonly overview?: FusionContextOverviewProps;
  readonly providerCatalog?: ReadonlyMap<string, ChatProviderDescriptor>;
  readonly reviewRevision?: number;
  readonly runtimeSummary?: FusionContextRuntimeSummary;
  readonly saving: boolean;
  /** 子代理 tab 当前选中的子会话（null 时面板自身渲染空态）。 */
  readonly selectedChildSessionId: string | null;
  /** 子代理 tab 的 tab 条数量徽章。 */
  readonly subAgentCount?: number;
  /** 子代理消息里父级 task 工具的运行态查找表。 */
  readonly taskToolRuntimeLookup?: TaskToolRuntimeLookup;
  readonly token: string | null;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
  readonly workspacePath: string | null;
  /**
   * 主内容区工作区已处于提升 / 分屏态：全屏入口由主内容区内建按钮承担，
   * 面板 tab 条不再重复渲染，保证屏幕上恰好一个全屏入口。
   */
  readonly workspacePromoted?: boolean;
}

export function FusionSessionSidePanel({
  activeTab,
  contextUsageSnapshot,
  currentSessionId,
  currentUserDisplayName,
  currentUserEmail,
  effectiveWorkingDirectory,
  fileEditor,
  fileTree,
  gatewayUrl,
  handleSaveFile,
  onCompactSession,
  onOpenFullSession,
  onPromoteToFullScreen,
  onTabChange,
  overview,
  providerCatalog,
  reviewRevision,
  runtimeSummary,
  saving,
  selectedChildSessionId,
  subAgentCount,
  taskToolRuntimeLookup,
  token,
  workspaceFileItems,
  workspacePath,
  workspacePromoted = false,
}: FusionSessionSidePanelProps) {
  const [mutationRefetchTick, setMutationRefetchTick] = useState(0);
  const externalReviewRevision = reviewRevision ?? 0;
  const reviewState = useReviewPanelFileChanges({
    gatewayUrl,
    opened: true,
    revision: externalReviewRevision + mutationRefetchTick,
    sessionId: currentSessionId,
    token,
  });
  const reviewCount = reviewState.kind === 'ready' ? reviewState.projection.fileDiffs.length : 0;
  const [changeScope, setChangeScope] = useState<ChangeScope>('all');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('unified');

  // 旧持久化状态 / 移动端 tab 落到桌面面板时先收敛，再通知父级让共享 store 同步，
  // 保证 tab 条永远有选中项、内容区永不为空。
  const desktopTab = resolveFusionDesktopPanelTab(activeTab);
  useEffect(() => {
    if (desktopTab !== activeTab) {
      onTabChange(desktopTab);
    }
  }, [activeTab, desktopTab, onTabChange]);

  const workspaceScope = resolveChatUiWorkspaceScope(effectiveWorkingDirectory, currentSessionId);
  const browserPreviewUrlByWorkspace = useUIStateStore((s) => s.browserPreviewUrlByWorkspace);
  const setBrowserPreviewUrlForWorkspace = useUIStateStore(
    (s) => s.setBrowserPreviewUrlForWorkspace,
  );
  const previewUrl = browserPreviewUrlByWorkspace[resolveWorkspaceKey(workspaceScope)] ?? null;

  // 一级 tab 扁平化：代码 / 预览共享同一个常驻工作区 pane，pane 的内部子视图由一级
  // tab 单向派生（预览 ↔ browser、代码 ↔ code），不再有第二层 tab 状态。
  const workspacePaneVisible = desktopTab === 'code' || desktopTab === 'preview';
  const workspaceTab: EditorPaneTab = desktopTab === 'preview' ? 'browser' : 'code';

  // 内建全屏的语义 = 提升到主内容区，目标 tab 跟随一级 tab（无地址时预览不可用，
  // 回落到代码，避免主区落到空白的浏览器视图）。
  const workspacePromoteTarget: EditorPaneTab =
    desktopTab === 'preview' && previewUrl !== null ? 'browser' : 'code';

  // 全屏入口停靠在面板一级 tab 条右端（与旧工作区内部工具条的可见性一致）：
  // 只在工作区 pane 可见且主内容区尚未接管时出现，屏幕上任何时刻恰好一个。
  const showWorkspaceFullScreenAction = workspacePaneVisible && !workspacePromoted;

  // 四个 pane 常驻挂载、用 hidden 切换：工作区里的浏览器实时会话（以及审查 /
  // 子代理 / Context 各自的滚动与展开状态）不会因切 tab 而重建。hidden 同时
  // 覆盖 a11y（不可聚焦、不进可访问性树），见 FusionSessionSidePanel.css。
  return (
    <SessionSidePanel
      activeTab={desktopTab}
      onTabChange={onTabChange}
      reviewCount={reviewCount}
      subAgentCount={subAgentCount}
      trailingAction={
        showWorkspaceFullScreenAction ? (
          <PanelFullScreenAction onClick={() => onPromoteToFullScreen(workspacePromoteTarget)} />
        ) : undefined
      }
    >
      <div
        className="fusion-side-panel__pane"
        data-testid="fusion-panel-pane-review"
        hidden={desktopTab !== 'review'}
      >
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
      </div>
      <div
        className="fusion-side-panel__pane"
        data-testid="fusion-panel-pane-agent"
        hidden={desktopTab !== 'agent'}
      >
        <div className="fusion-side-panel__agent-host">
          <SubSessionDetailPanel
            childSessionId={selectedChildSessionId}
            currentUserEmail={currentUserEmail}
            currentUserDisplayName={currentUserDisplayName}
            gatewayUrl={gatewayUrl}
            onOpenFullSession={onOpenFullSession}
            parentTaskRuntimeLookup={taskToolRuntimeLookup}
            providerCatalog={providerCatalog}
            token={token}
          />
        </div>
      </div>
      <div
        className="fusion-side-panel__pane"
        data-testid="fusion-panel-pane-workspace"
        hidden={!workspacePaneVisible}
      >
        <FusionWorkspaceTab
          activeTab={workspaceTab}
          browserPreviewUrl={previewUrl}
          fileEditor={fileEditor}
          fileTree={fileTree}
          handleSaveFile={handleSaveFile}
          onBrowserPreviewUrlChange={(url) => setBrowserPreviewUrlForWorkspace(workspaceScope, url)}
          onTabChange={(tab) => {
            // 子 tab 按钮已隐藏：这里只承载「新预览地址到达自动切到预览」的内建副作用。
            // pane 不可见（审查 / Context）时吞掉，避免抢走用户当前的一级 tab。
            if (tab === 'code') {
              onTabChange('code');
              return;
            }
            if (workspacePaneVisible) {
              onTabChange('preview');
            }
          }}
          saving={saving}
          workspacePath={workspacePath}
        />
      </div>
      <div
        className="fusion-side-panel__pane"
        data-testid="fusion-panel-pane-context"
        hidden={desktopTab !== 'context'}
      >
        <FusionContextTab
          contextUsageSnapshot={contextUsageSnapshot}
          currentSessionId={currentSessionId}
          effectiveWorkingDirectory={effectiveWorkingDirectory}
          onCompactSession={onCompactSession}
          overview={overview}
          runtimeSummary={runtimeSummary}
          workspaceFileItems={workspaceFileItems}
        />
      </div>
    </SessionSidePanel>
  );
}

function PanelFullScreenAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="session-side-panel__tabs-action-btn"
      onClick={onClick}
      title="全屏 · 占据整个内容区"
      aria-label="全屏"
    >
      <svg
        aria-hidden="true"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  );
}
