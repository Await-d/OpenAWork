import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Message } from '@openAwork/shared';
import type { SharedSessionDetailRecord, TeamAuditLogRecord } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { formatTimelineDetail } from '../../data/team-runtime-reference-formatters.js';
import {
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
} from '../../data/team-runtime-shared-context.js';
import { tryFormatJson, looksLikeJson } from '../../../../../utils/format-json.js';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';
import { EmptyState, SegmentedToggle } from '../../shared/content-kit/index.js';
import { TabContainer } from '../TabContainer.js';
import { useNarrowConversationLayout } from './use-narrow-conversation-layout.js';

type SharedLayeredMode = 'assistant' | 'comments' | 'todo';

interface LayeredItem {
  detail?: string;
  id: string;
  summary: string;
  timestampMs: number;
  title: string;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  flexShrink: 0,
};

const HEADER_TOP_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  flexWrap: 'wrap',
};

const HEADER_ACTION_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const SPLIT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
  gap: 12,
};

const TIMELINE_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 0,
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  paddingRight: 12,
};

const TIMELINE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 4px 4px',
};

const TIMELINE_HEADER_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  letterSpacing: '0.08em',
};

const DETAIL_PANE_STYLE: CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  overflow: 'hidden',
};

function summarizeAssistantMessage(message: Message): string {
  const text = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .find((part) => part.length > 0);
  return text ?? '共享输出已更新';
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimeMs(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildAssistantItems(messages: Message[]): LayeredItem[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message, index) => ({
      detail: summarizeAssistantMessage(message),
      id: `assistant-${message.id}`,
      summary: `共享输出 #${index + 1}`,
      timestampMs: message.createdAt,
      title: 'Assistant 输出',
    }))
    .sort((left, right) => right.timestampMs - left.timestampMs);
}

function buildCommentItems(comments: SharedSessionDetailRecord['comments']): LayeredItem[] {
  return comments
    .map((comment) => ({
      detail: comment.content,
      id: `comment-${comment.id}`,
      summary: comment.authorEmail,
      timestampMs: parseIsoMs(comment.createdAt) ?? 0,
      title: '共享评论',
    }))
    .filter((item) => item.timestampMs > 0)
    .sort((left, right) => right.timestampMs - left.timestampMs);
}

function buildTodoItems(input: {
  auditLogs: TeamAuditLogRecord[];
  selectedTeamId: string;
  sharedSession: SharedSessionDetailRecord;
}): LayeredItem[] {
  const permissionItems = input.sharedSession.pendingPermissions.map((request) => ({
    detail: request.reason,
    id: `permission-${request.requestId}`,
    summary: request.previewAction ?? request.toolName,
    timestampMs: parseIsoMs(request.createdAt) ?? 0,
    title: `权限请求 · ${request.scope}`,
  }));
  const questionItems = input.sharedSession.pendingQuestions.map((request) => ({
    detail: request.questions
      .map((question) => `${question.header}：${question.question}`)
      .join('\n'),
    id: `question-${request.requestId}`,
    summary: request.title,
    timestampMs: parseIsoMs(request.createdAt) ?? 0,
    title: `问题请求 · ${request.toolName}`,
  }));
  const auditItems = input.auditLogs
    .filter((log) => log.sessionId === input.selectedTeamId)
    .map((log) => ({
      detail: formatTimelineDetail(log.detail ?? log.summary, 200),
      id: `audit-${log.id}`,
      summary: log.actorEmail ?? log.actorUserId ?? '系统',
      timestampMs: parseIsoMs(log.createdAt) ?? 0,
      title: formatTimelineDetail(log.summary, 80),
    }));

  return [...permissionItems, ...questionItems, ...auditItems]
    .filter((item) => item.timestampMs > 0)
    .sort((left, right) => right.timestampMs - left.timestampMs);
}

export function SharedSessionLayeredView({
  selectedTeam,
}: {
  selectedTeam: AgentTeamsSidebarTeam;
}) {
  const {
    activeSharedSession,
    auditLogs,
    selectedSharedSession,
    sharedSessionLoading,
    sharedSessions,
  } = useTeamRuntimeReferenceViewData();
  const sharedSession = resolveMatchedSharedSessionDetail({
    selectedTeamId: selectedTeam.id,
    activeSharedSession,
    selectedSharedSession,
  });
  const sharedSummary = resolveMatchedSharedSummary({
    selectedTeamId: selectedTeam.id,
    activeSharedSession,
    selectedSharedSession,
    sharedSessions,
  });
  const isNarrowLayout = useNarrowConversationLayout();
  const [mode, setMode] = useState<SharedLayeredMode>('assistant');
  const items = useMemo(() => {
    if (!sharedSession) return [];
    if (mode === 'assistant') {
      return buildAssistantItems(sharedSession.session.messages ?? []);
    }
    if (mode === 'comments') {
      return buildCommentItems(sharedSession.comments);
    }
    return buildTodoItems({
      auditLogs,
      selectedTeamId: selectedTeam.id,
      sharedSession,
    });
  }, [auditLogs, mode, selectedTeam.id, sharedSession]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedItemId((previous) => {
      if (items.length === 0) {
        return null;
      }
      if (previous && items.some((item) => item.id === previous)) {
        return previous;
      }
      return items[0]?.id ?? null;
    });
  }, [items]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const splitStyle: CSSProperties = isNarrowLayout
    ? {
        ...SPLIT_STYLE,
        display: 'flex',
        flexDirection: 'column',
      }
    : SPLIT_STYLE;
  const timelinePanelStyle: CSSProperties = isNarrowLayout
    ? {
        ...TIMELINE_PANEL_STYLE,
        borderRight: 'none',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
        paddingBottom: 12,
        paddingRight: 0,
        maxHeight: 260,
      }
    : TIMELINE_PANEL_STYLE;

  if (sharedSessionLoading && !sharedSession) {
    return (
      <TabContainer
        title="层级对话"
        subtitle="共享会话展示共享输出、评论和待办详情，而不是本地 handoff 线程。"
      >
        <EmptyState
          emoji="🪜"
          title="正在同步共享线程"
          description="共享会话详情加载完成后，这里会展示共享输出、评论和协作待办的分层详情。"
        />
      </TabContainer>
    );
  }

  if (!sharedSummary || !sharedSession) {
    return (
      <TabContainer
        title="层级对话"
        subtitle="共享会话展示共享输出、评论和待办详情，而不是本地 handoff 线程。"
      >
        <EmptyState
          emoji="🪜"
          title="共享线程暂不可用"
          description="当前只拿到了共享会话选择状态，详细共享快照还未同步。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级对话"
      subtitle="共享会话按输出 / 评论 / 协作待办三类内容组织详情，方便逐条查看。"
    >
      <div data-testid="shared-layered-view" style={CONTAINER_STYLE}>
        <div style={HEADER_STYLE}>
          <div style={HEADER_TOP_ROW_STYLE}>
            <span style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 260px' }}>
              <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>共享线程</strong>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                输出{' '}
                {sharedSession.session.messages?.filter((message) => message.role === 'assistant')
                  .length ?? 0}{' '}
                · 评论 {sharedSession.comments.length} · 待办{' '}
                {sharedSession.pendingPermissions.length + sharedSession.pendingQuestions.length}
              </span>
            </span>
          </div>
          <div style={HEADER_ACTION_ROW_STYLE}>
            <SegmentedToggle<SharedLayeredMode>
              ariaLabel="共享线程模式"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'assistant', label: '输出', icon: '✨' },
                { value: 'comments', label: '评论', icon: '💬' },
                { value: 'todo', label: '待办', icon: '🧾' },
              ]}
            />
          </div>
        </div>

        <div style={splitStyle}>
          <div style={timelinePanelStyle}>
            <div style={TIMELINE_HEADER_STYLE}>
              <span style={TIMELINE_HEADER_LABEL_STYLE}>共享条目</span>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                当前显示 {items.length}
              </span>
            </div>
            {items.length === 0 ? (
              <EmptyState emoji="📭" title="当前分类暂无内容" compact style={{ flex: 1 }} />
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId((prev) => (prev === item.id ? null : item.id))}
                  aria-pressed={selectedItemId === item.id}
                  style={{
                    textAlign: 'left',
                    display: 'grid',
                    gap: 4,
                    padding: '8px 10px',
                    borderRadius: 10,
                    border:
                      selectedItemId === item.id
                        ? '1px solid color-mix(in srgb, var(--accent) 60%, transparent)'
                        : '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
                    background:
                      selectedItemId === item.id
                        ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-overlay))'
                        : 'color-mix(in srgb, var(--bg-overlay) 68%, var(--bg-base))',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <strong
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: 'var(--fg-strong)',
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </strong>
                    <span
                      style={{
                        marginLeft: 'auto',
                        flexShrink: 0,
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatTimeMs(item.timestampMs)}
                    </span>
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      minWidth: 0,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                        color: 'var(--accent)',
                        fontSize: 9.5,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {mode === 'assistant'
                        ? '共享输出'
                        : mode === 'comments'
                          ? '共享评论'
                          : '协作待办'}
                    </span>
                    <span
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                      }}
                      title={tryFormatJson(item.summary)}
                    >
                      {tryFormatJson(item.summary)}
                    </span>
                  </span>
                  {item.detail && selectedItemId !== item.id ? (
                    <span
                      style={{
                        color: 'var(--fg-muted)',
                        fontSize: 10.5,
                        lineHeight: 1.45,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                      title={item.detail}
                    >
                      {item.detail}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div style={DETAIL_PANE_STYLE}>
            {selectedItem ? (
              <div style={{ display: 'grid', gap: 10, padding: '12px 14px' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ color: 'var(--fg-strong)', fontSize: 14 }}>
                    {selectedItem.title}
                  </strong>
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                    {tryFormatJson(selectedItem.summary)}
                  </span>
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                    {formatTimeMs(selectedItem.timestampMs)}
                  </span>
                </div>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
                    background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                    minHeight: 120,
                  }}
                >
                  {looksLikeJson(selectedItem.detail ?? '') ? (
                    <pre
                      style={{
                        margin: 0,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border-subtle)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                        fontSize: 11,
                        lineHeight: 1.6,
                        whiteSpace: 'pre',
                        overflowX: 'auto',
                      }}
                    >
                      {tryFormatJson(selectedItem.detail ?? '暂无更多细节。')}
                    </pre>
                  ) : (
                    <MarkdownMessageContent content={selectedItem.detail ?? '暂无更多细节。'} />
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                emoji="💬"
                title="选择左侧条目查看详情"
                description="右侧会展示共享输出、评论或协作待办的完整上下文。"
                style={{ flex: 1 }}
              />
            )}
          </div>
        </div>
      </div>
    </TabContainer>
  );
}
