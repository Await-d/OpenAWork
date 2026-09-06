import { type CSSProperties } from 'react';
import type { SharedSessionDetailRecord, TeamWorkspaceSummary } from '@openAwork/web-client';
import type { Message } from '@openAwork/shared';
import type { HandoffEntry, TeamRoleLayer } from '../../../stores/team/team-events.js';
import type { MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import { TabContainer, TabSection } from '../runtime/tabs/TabContainer.js';
import type {
  AgentTeamsFooterStat,
  AgentTeamsSidebarTeam,
} from '../runtime/data/team-runtime-types.js';
import {
  formatSidebarTeamStatus,
  resolveSidebarTeamSubtitle,
} from '../runtime/data/team-runtime-status.js';
import { tryFormatJson, looksLikeJson } from '../../../utils/format-json.js';

const FOCUS_BANNER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
};

const FOCUS_BANNER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const FOCUS_BANNER_ACTION_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const FOCUS_BANNER_PRIMARY_ACTION_STYLE: CSSProperties = {
  ...FOCUS_BANNER_ACTION_STYLE,
  border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  color: 'var(--accent)',
};

const FOCUS_LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const FOCUS_STATE_LABELS: Record<HandoffEntry['state'], string> = {
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const SHARED_PERMISSION_LABELS: Record<SharedSessionDetailRecord['share']['permission'], string> = {
  view: '只读',
  comment: '评论',
  operate: '可操作',
};

const SUMMARY_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
};

const SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const SHARED_ACTION_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const SHARED_ACTION_STYLE: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 9,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const SHARED_PRIMARY_ACTION_STYLE: CSSProperties = {
  ...SHARED_ACTION_STYLE,
  border: '1px solid color-mix(in srgb, var(--accent) 46%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
};

const IDLE_FLOW_STEPS = ['接待', '规划', '管控', '执行', '评审'] as const;

const CURRENT_SESSION_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxWidth: 280,
  padding: '4px 11px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
  color: 'var(--fg-default)',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

const CURRENT_SESSION_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontWeight: 600,
  flexShrink: 0,
};

const CURRENT_SESSION_TITLE_STYLE: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--fg-strong)',
  fontWeight: 700,
};

const CURRENT_SESSION_META_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 74%, var(--bg-base))',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const SUPERBAR_LEADING_CLUSTER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'nowrap',
  minWidth: 0,
};

const SUPERBAR_WORKSPACE_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: 0,
  borderRadius: 0,
  background: 'transparent',
  border: 'none',
};

const SUPERBAR_SESSION_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  minWidth: 0,
};

const SUPERBAR_SUMMARY_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  flexShrink: 0,
};

const SUPERBAR_STAT_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 9px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 72%, var(--bg-base))',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const SUPERBAR_STAT_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const SUPERBAR_CONTEXT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  maxWidth: 360,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export interface TeamPageSuperbarLeadingProps {
  activeWorkspaceId: string | null;
  activeWorkspaceName?: string;
  compact?: boolean;
  memberCount: string;
  onlineCount: string;
  selectedTeam: AgentTeamsSidebarTeam | null;
  summaryDescription: string;
  workspaces: TeamWorkspaceSummary[];
}

export function TeamPageSuperbarLeading({
  activeWorkspaceId,
  activeWorkspaceName,
  compact = false,
  memberCount,
  onlineCount,
  selectedTeam,
  summaryDescription,
  workspaces,
}: TeamPageSuperbarLeadingProps) {
  const activeWorkspace = workspaces.find((ws) => ws.id === activeWorkspaceId) ?? null;
  const activeWorkspaceDisplayName =
    activeWorkspaceName ?? activeWorkspace?.name ?? activeWorkspaceId ?? '未选择工作区';
  const sessionStatus = selectedTeam ? formatSidebarTeamStatus(selectedTeam.status) : null;
  const sessionSubtitle = selectedTeam
    ? resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle)
    : null;
  return (
    <span style={SUPERBAR_LEADING_CLUSTER_STYLE}>
      <span style={SUPERBAR_WORKSPACE_GROUP_STYLE}>
        <strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>团队</strong>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>·</span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--fg-default)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 200,
          }}
          title={activeWorkspaceDisplayName}
        >
          {activeWorkspaceDisplayName}
        </span>
      </span>
      {selectedTeam ? (
        <span style={SUPERBAR_SESSION_GROUP_STYLE}>
          <span
            data-testid="team-current-session-pill"
            style={
              compact
                ? {
                    ...CURRENT_SESSION_PILL_STYLE,
                    padding: '0 2px',
                    border: 'none',
                    background: 'transparent',
                    gap: 4,
                  }
                : CURRENT_SESSION_PILL_STYLE
            }
            title={[selectedTeam.title, sessionStatus, sessionSubtitle, summaryDescription]
              .filter(Boolean)
              .join(' · ')}
          >
            {!compact ? <span style={CURRENT_SESSION_LABEL_STYLE}>当前会话</span> : null}
            <span
              style={{
                ...CURRENT_SESSION_TITLE_STYLE,
                maxWidth: compact ? 220 : CURRENT_SESSION_TITLE_STYLE.maxWidth,
              }}
            >
              {selectedTeam.title}
            </span>
          </span>
          {/* compact/classic：状态改由最顶 TeamStatusBar 统一展示，避免重复 pill */}
          {!compact ? (
            <span data-testid="team-current-session-status" style={CURRENT_SESSION_META_PILL_STYLE}>
              {sessionStatus}
            </span>
          ) : (
            <span data-testid="team-current-session-status" style={{ display: 'none' }}>
              {sessionStatus}
            </span>
          )}
          {!compact && sessionSubtitle ? (
            <span style={CURRENT_SESSION_META_PILL_STYLE}>{sessionSubtitle}</span>
          ) : null}
          {!compact ? (
            <span
              data-testid="team-current-session-members"
              style={CURRENT_SESSION_META_PILL_STYLE}
              title={`${memberCount} · ${onlineCount}`}
            >
              {memberCount} · {onlineCount}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export interface TeamPageSuperbarSummaryProps {
  description: string;
  footerLead: string;
  footerStats: AgentTeamsFooterStat[];
}

export function TeamPageSuperbarSummary({
  description,
  footerLead,
  footerStats,
}: TeamPageSuperbarSummaryProps) {
  if (!footerLead) {
    return null;
  }

  return (
    <span data-testid="team-superbar-summary" style={SUPERBAR_SUMMARY_GROUP_STYLE}>
      <span
        data-testid="team-superbar-footer-lead"
        style={CURRENT_SESSION_META_PILL_STYLE}
        title={footerLead}
      >
        {footerLead}
      </span>
      {footerStats.map((stat) => (
        <span
          key={stat.label}
          data-testid={`team-superbar-stat-${stat.label}`}
          style={SUPERBAR_STAT_PILL_STYLE}
          title={`${stat.label} ${stat.value}`}
        >
          <span>{stat.label}</span>
          <span style={SUPERBAR_STAT_VALUE_STYLE}>{stat.value}</span>
        </span>
      ))}
      <span
        data-testid="team-superbar-description"
        style={SUPERBAR_CONTEXT_STYLE}
        title={description}
      >
        {description}
      </span>
    </span>
  );
}

export interface TeamFocusHandoffBannerProps {
  entry: HandoffEntry | null;
  focusHandoffId: string;
  suggestedTab: MiddleTabKey | null;
  onClear: () => void;
  onSelectTab: (tab: MiddleTabKey) => void;
}

export function TeamFocusHandoffBanner({
  entry,
  focusHandoffId,
  suggestedTab,
  onClear,
  onSelectTab,
}: TeamFocusHandoffBannerProps) {
  return (
    <div style={FOCUS_BANNER_STYLE} aria-live="polite">
      <div style={FOCUS_BANNER_ROW_STYLE}>
        <strong style={{ color: 'var(--accent)', fontSize: 12 }}>
          当前聚焦 Handoff #{focusHandoffId.slice(0, 8)}
        </strong>
        {entry ? (
          <span style={{ color: 'var(--fg-default)', fontSize: 12, fontWeight: 600 }}>
            {FOCUS_LAYER_LABELS[entry.fromRoleLayer]} → {FOCUS_LAYER_LABELS[entry.toRoleLayer]} ·{' '}
            {FOCUS_STATE_LABELS[entry.state]}
          </span>
        ) : (
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
            当前视图正在定位相关上下文。
          </span>
        )}
      </div>
      <div style={FOCUS_BANNER_ROW_STYLE}>
        {suggestedTab ? (
          <button
            type="button"
            onClick={() => onSelectTab(suggestedTab)}
            style={FOCUS_BANNER_PRIMARY_ACTION_STYLE}
          >
            {suggestedTab === 'review'
              ? '回到评审上下文'
              : suggestedTab === 'artifacts'
                ? '回到任务与产物'
                : '查看健康度'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onSelectTab('health')}
          style={FOCUS_BANNER_ACTION_STYLE}
        >
          查看健康度
        </button>
        <button type="button" onClick={onClear} style={FOCUS_BANNER_ACTION_STYLE}>
          清除定位
        </button>
      </div>
    </div>
  );
}

export interface TeamSharedConversationPanelProps {
  selectedTeamStatus?: string | null;
  selectedTeamSubtitle?: string | null;
  selectedTeamTitle?: string | null;
  sharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  onOpenReview: () => void;
  onOpenShares: () => void;
}

export function TeamSharedConversationPanel({
  selectedTeamStatus,
  selectedTeamSubtitle,
  selectedTeamTitle,
  sharedSession,
  sharedSessionLoading,
  onOpenReview,
  onOpenShares,
}: TeamSharedConversationPanelProps) {
  const title =
    selectedTeamTitle?.trim() ||
    sharedSession?.share.title?.trim() ||
    sharedSession?.share.sessionId ||
    '共享会话';
  const statusLabel =
    selectedTeamStatus?.trim() ||
    selectedTeamSubtitle?.trim() ||
    sharedSession?.share.stateStatus ||
    '共享中';
  const latestAssistantOutput = summarizeLatestAssistantOutput(sharedSession?.session.messages);
  const workspaceLabel = sharedSession?.share.workspacePath ?? '未绑定工作区';
  const messageCount = sharedSession?.session.messages?.length ?? 0;
  const commentCount = sharedSession?.comments.length ?? 0;
  const presenceCount = sharedSession?.presence.length ?? 0;
  const pendingPermissionCount = sharedSession?.pendingPermissions.length ?? 0;
  const pendingQuestionCount = sharedSession?.pendingQuestions.length ?? 0;

  return (
    <div data-testid="team-shared-conversation-panel" style={{ flex: 1, minHeight: 0 }}>
      <TabContainer
        title={title}
        subtitle="当前选中的是共享会话。对话主 tab 会展示共享详情、最新输出摘要和待处理协作项。"
        actions={
          <div style={SHARED_ACTION_ROW_STYLE}>
            <button
              type="button"
              data-testid="team-shared-conversation-open-review"
              onClick={onOpenReview}
              style={SHARED_PRIMARY_ACTION_STYLE}
            >
              查看评审队列
            </button>
            <button
              type="button"
              data-testid="team-shared-conversation-open-shares"
              onClick={onOpenShares}
              style={SHARED_ACTION_STYLE}
            >
              打开共享详情
            </button>
          </div>
        }
      >
        <TabSection card title="共享上下文" hint="共享会话不会直接挂载本地 TeamConversationView。">
          <div style={SUMMARY_GRID_STYLE}>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>状态</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{statusLabel}</strong>
            </div>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>权限</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                {sharedSession
                  ? SHARED_PERMISSION_LABELS[sharedSession.share.permission]
                  : '待加载'}
              </strong>
            </div>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>共享者</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                {sharedSession?.share.sharedByEmail ?? '待加载'}
              </strong>
            </div>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>工作区</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{workspaceLabel}</strong>
            </div>
          </div>
        </TabSection>

        <TabSection card title="最新助手输出" hint={`消息 ${messageCount} 条`}>
          {sharedSessionLoading ? (
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>正在加载共享会话详情…</span>
          ) : sharedSession ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div
                data-testid="team-shared-conversation-latest-output"
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-overlay) 72%, var(--bg-base))',
                  fontSize: 12,
                  lineHeight: 1.65,
                  color: latestAssistantOutput ? 'var(--fg-default)' : 'var(--fg-muted)',
                  whiteSpace: looksLikeJson(latestAssistantOutput ?? '') ? 'pre' : 'pre-wrap',
                  fontFamily: looksLikeJson(latestAssistantOutput ?? '')
                    ? 'ui-monospace, SFMono-Regular, monospace'
                    : undefined,
                }}
              >
                {latestAssistantOutput
                  ? tryFormatJson(latestAssistantOutput)
                  : '当前共享会话还没有可展示的助手文本输出。'}
              </div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                最近同步：{formatSharedDate(sharedSession.share.shareUpdatedAt)}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              共享会话详情暂时不可用。请稍后在「共享 / 协作」里重试。
            </span>
          )}
        </TabSection>

        <TabSection card title="协作状态" hint="这些待处理项会同步进入评审与共享治理视图。">
          <div style={SUMMARY_GRID_STYLE}>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>在线查看</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{presenceCount}</strong>
            </div>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>评论</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{commentCount}</strong>
            </div>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>待审批</span>
              <strong style={{ fontSize: 14, color: 'var(--warning)' }}>
                {pendingPermissionCount}
              </strong>
            </div>
            <div style={SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>待回答</span>
              <strong style={{ fontSize: 14, color: 'var(--aux)' }}>{pendingQuestionCount}</strong>
            </div>
          </div>
        </TabSection>
      </TabContainer>
    </div>
  );
}

export function IdleHint() {
  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        padding: '24px 20px',
        margin: '16px 0',
        borderRadius: 14,
        border: '1px dashed color-mix(in srgb, var(--accent) 40%, transparent)',
        background: 'color-mix(in srgb, var(--accent) 4%, var(--bg-overlay))',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 16, color: 'var(--fg-strong)', letterSpacing: '0.01em' }}>
          👋 团队待命中
        </strong>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          在下方对话框输入需求，团队会按选定 workflow 自动流转
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
        aria-label="团队工作流"
      >
        {IDLE_FLOW_STEPS.map((step, idx) => (
          <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
              }}
            >
              {step}
            </span>
            {idx < IDLE_FLOW_STEPS.length - 1 ? (
              <span aria-hidden style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingTop: 6,
          borderTop: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
          fontSize: 11,
          color: 'var(--fg-muted)',
        }}
      >
        <span aria-hidden>↓</span>
        <span>在下方输入框开始你的第一个需求</span>
      </div>
    </div>
  );
}

function summarizeLatestAssistantOutput(messages: Message[] | undefined): string | null {
  const latestAssistantMessage = [...(messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant');
  if (!latestAssistantMessage) {
    return null;
  }

  const text = latestAssistantMessage.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .filter((part) => part.length > 0)
    .join('\n')
    .trim();
  if (!text) {
    return null;
  }
  return text.length > 360 ? `${text.slice(0, 357)}…` : text;
}

function formatSharedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
