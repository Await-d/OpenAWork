/**
 * 260516-team-page-v2 · T-13 · SharesView
 *
 * 「共享 / 协作」tab：列出当前工作区的共享情况。
 *   - 我共享出去的会话（含成员、权限）
 *   - 别人共享给我的会话（含权限、状态）
 *
 * 数据来源：useTeamRuntimeReferenceViewData().sessionShares + sharedSessions
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { TeamSessionShareRecord } from '@openAwork/web-client';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { TabContainer } from '../TabContainer.js';

const PERMISSION_LABELS: Record<TeamSessionShareRecord['permission'], string> = {
  view: '只读',
  comment: '评论',
  operate: '可操作',
};

const PERMISSION_COLORS: Record<TeamSessionShareRecord['permission'], string> = {
  view: 'var(--fg-muted)',
  comment: 'var(--aux)',
  operate: 'var(--success)',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const TAB_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--fg-muted)',
};

const TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...TAB_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--fg-strong)',
};

type ShareTab = 'outgoing' | 'incoming';

export function SharesView() {
  const {
    canManageSessionEntries,
    createSessionShare,
    deleteSessionShare,
    members,
    selectedSharedSession,
    sharedSessionLoading,
    setSelectedSharedSessionId,
    sessionShares,
    sharedSessions,
    updateSessionShare,
    workspaceGroups,
  } = useTeamRuntimeReferenceViewData();
  const [tab, setTab] = useState<ShareTab>('outgoing');
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [newShareMemberId, setNewShareMemberId] = useState('');
  const [newSharePermission, setNewSharePermission] =
    useState<TeamSessionShareRecord['permission']>('view');
  const [newShareSessionId, setNewShareSessionId] = useState('');

  const groupedOutgoing = useMemo(() => {
    const map = new Map<string, TeamSessionShareRecord[]>();
    for (const share of sessionShares) {
      const list = map.get(share.sessionId) ?? [];
      list.push(share);
      map.set(share.sessionId, list);
    }
    return map;
  }, [sessionShares]);

  const totalOutgoing = sessionShares.length;
  const totalIncoming = sharedSessions.length;
  const shareableSessions = useMemo(() => {
    const incomingSharedSessionIds = new Set(sharedSessions.map((session) => session.sessionId));
    const map = new Map<string, { id: string; title: string }>();
    for (const group of workspaceGroups) {
      for (const session of group.sessions) {
        if (incomingSharedSessionIds.has(session.id)) {
          continue;
        }
        map.set(session.id, {
          id: session.id,
          title: session.title,
        });
      }
    }
    return Array.from(map.values());
  }, [sharedSessions, workspaceGroups]);

  const alreadySharedMemberIds = useMemo(() => {
    if (!newShareSessionId) {
      return new Set<string>();
    }
    return new Set(
      sessionShares
        .filter((share) => share.sessionId === newShareSessionId)
        .map((share) => share.memberId),
    );
  }, [newShareSessionId, sessionShares]);

  const availableMembersForNewShare = useMemo(
    () => members.filter((member) => !alreadySharedMemberIds.has(member.id)),
    [alreadySharedMemberIds, members],
  );

  useEffect(() => {
    if (!newShareMemberId) {
      return;
    }
    if (availableMembersForNewShare.some((member) => member.id === newShareMemberId)) {
      return;
    }
    setNewShareMemberId('');
  }, [availableMembersForNewShare, newShareMemberId]);

  const handlePermissionChange = async (
    shareId: string,
    permission: TeamSessionShareRecord['permission'],
  ) => {
    if (!canManageSessionEntries) {
      return;
    }
    setBusyShareId(shareId);
    try {
      await updateSessionShare(shareId, { permission });
    } finally {
      setBusyShareId(null);
    }
  };

  const handleDeleteShare = async (shareId: string) => {
    if (!canManageSessionEntries) {
      return;
    }
    setBusyShareId(shareId);
    try {
      await deleteSessionShare(shareId);
    } finally {
      setBusyShareId(null);
    }
  };

  const handleCreateShare = async () => {
    if (!canManageSessionEntries) {
      return;
    }
    if (!newShareMemberId || !newShareSessionId) {
      return;
    }
    const shareKey = `create:${newShareSessionId}:${newShareMemberId}`;
    setBusyShareId(shareKey);
    try {
      const ok = await createSessionShare({
        sessionId: newShareSessionId,
        memberId: newShareMemberId,
        permission: newSharePermission,
      });
      if (ok) {
        setNewShareMemberId('');
        setNewShareSessionId('');
        setNewSharePermission('view');
      }
    } finally {
      setBusyShareId(null);
    }
  };

  return (
    <TabContainer title="共享 / 协作" subtitle="管理我对外共享的会话以及别人共享给我的会话。">
      <div style={CONTAINER_STYLE}>
        <div
          aria-label="新建共享表单"
          data-testid="shares-create-form"
          style={{
            ...ROW_STYLE,
            gap: 8,
          }}
        >
          <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>新建共享</strong>
          {!canManageSessionEntries ? (
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              当前工作区不可写，无法新建或修改共享。
            </span>
          ) : null}
          <div
            style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
          >
            <select
              aria-label="选择共享会话"
              value={newShareSessionId}
              onChange={(event) => setNewShareSessionId(event.target.value)}
              disabled={!canManageSessionEntries}
              style={TAB_BTN_STYLE}
            >
              <option value="">选择会话</option>
              {shareableSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
            <select
              aria-label="选择共享成员"
              value={newShareMemberId}
              onChange={(event) => setNewShareMemberId(event.target.value)}
              disabled={!canManageSessionEntries}
              style={TAB_BTN_STYLE}
            >
              <option value="">选择成员</option>
              {availableMembersForNewShare.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <select
              aria-label="选择共享权限"
              value={newSharePermission}
              onChange={(event) =>
                setNewSharePermission(event.target.value as TeamSessionShareRecord['permission'])
              }
              disabled={!canManageSessionEntries}
              style={TAB_BTN_STYLE}
            >
              <option value="view">只读</option>
              <option value="comment">评论</option>
              <option value="operate">可操作</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => void handleCreateShare()}
              disabled={
                !canManageSessionEntries ||
                !newShareMemberId ||
                !newShareSessionId ||
                availableMembersForNewShare.length === 0 ||
                busyShareId?.startsWith('create:')
              }
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
                color: 'var(--accent)',
                fontSize: 11,
                fontWeight: 700,
                cursor:
                  !canManageSessionEntries ||
                  !newShareMemberId ||
                  !newShareSessionId ||
                  availableMembersForNewShare.length === 0 ||
                  busyShareId?.startsWith('create:')
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  !canManageSessionEntries ||
                  !newShareMemberId ||
                  !newShareSessionId ||
                  availableMembersForNewShare.length === 0 ||
                  busyShareId?.startsWith('create:')
                    ? 0.5
                    : 1,
              }}
            >
              创建共享
            </button>
          </div>
          {newShareSessionId && availableMembersForNewShare.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              当前会话已经共享给所有可选成员。
            </span>
          ) : null}
          {shareableSessions.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              当前工作区暂无可共享会话；先创建团队会话后即可从这里发起共享。
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => setTab('outgoing')}
            style={tab === 'outgoing' ? TAB_BTN_ACTIVE_STYLE : TAB_BTN_STYLE}
          >
            我共享的 · {totalOutgoing}
          </button>
          <button
            type="button"
            onClick={() => setTab('incoming')}
            style={tab === 'incoming' ? TAB_BTN_ACTIVE_STYLE : TAB_BTN_STYLE}
          >
            共享给我的 · {totalIncoming}
          </button>
        </div>

        {tab === 'outgoing' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <span style={SECTION_TITLE_STYLE}>我共享出去的会话</span>
            {totalOutgoing === 0 ? (
              <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>
                你还没有共享任何会话。
              </div>
            ) : (
              Array.from(groupedOutgoing.entries()).map(([sessionId, shares]) => {
                const head = shares[0]!;
                return (
                  <div key={sessionId} style={ROW_STYLE}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <strong style={{ color: 'var(--fg-strong)' }}>{head.sessionLabel}</strong>
                      {head.workspacePath ? (
                        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                          · {head.workspacePath}
                        </span>
                      ) : null}
                      <span style={{ flex: 1 }} />
                      <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
                        共 {shares.length} 个成员
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {shares.map((share) => (
                        <div
                          key={share.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '2px 10px',
                            borderRadius: 999,
                            background: 'var(--bg-overlay)',
                            border:
                              '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                            fontSize: 11,
                          }}
                        >
                          <span style={{ color: 'var(--fg-default)' }}>{share.memberName}</span>
                          <button
                            type="button"
                            aria-label={`切换 ${share.memberName} 的共享权限`}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: PERMISSION_COLORS[share.permission],
                              fontWeight: 700,
                              cursor: !canManageSessionEntries
                                ? 'not-allowed'
                                : busyShareId === share.id
                                  ? 'progress'
                                  : 'pointer',
                              padding: 0,
                              fontSize: 11,
                              opacity: !canManageSessionEntries ? 0.5 : 1,
                            }}
                            disabled={!canManageSessionEntries || busyShareId === share.id}
                            onClick={() => {
                              const next =
                                share.permission === 'view'
                                  ? 'comment'
                                  : share.permission === 'comment'
                                    ? 'operate'
                                    : 'view';
                              void handlePermissionChange(share.id, next);
                            }}
                          >
                            {PERMISSION_LABELS[share.permission]}
                          </button>
                          <button
                            type="button"
                            aria-label={`取消共享给 ${share.memberName}`}
                            onClick={() => void handleDeleteShare(share.id)}
                            disabled={!canManageSessionEntries || busyShareId === share.id}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--danger)',
                              cursor: !canManageSessionEntries
                                ? 'not-allowed'
                                : busyShareId === share.id
                                  ? 'progress'
                                  : 'pointer',
                              padding: 0,
                              fontSize: 10,
                              fontWeight: 700,
                              opacity: !canManageSessionEntries ? 0.5 : 1,
                            }}
                          >
                            取消
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <span style={SECTION_TITLE_STYLE}>别人共享给我的会话</span>
            {totalIncoming === 0 ? (
              <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>
                暂无别人共享给你的会话。
              </div>
            ) : (
              <>
                {sharedSessions.map((session) => (
                  <div key={session.sessionId} style={ROW_STYLE}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <strong style={{ color: 'var(--fg-strong)' }}>
                        {session.title ?? `会话 ${session.sessionId.slice(0, 8)}`}
                      </strong>
                      <span style={{ flex: 1 }} />
                      <span
                        style={{
                          padding: '1px 8px',
                          borderRadius: 999,
                          background: 'var(--bg-overlay)',
                          border:
                            '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                          color: 'var(--fg-default)',
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        {session.stateStatus}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      {session.workspacePath ? (
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                          {session.workspacePath}
                        </span>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedSharedSessionId(session.sessionId)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                          background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
                          color: 'var(--accent)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        查看详情
                      </button>
                    </div>
                  </div>
                ))}

                {sharedSessionLoading ? (
                  <div style={ROW_STYLE}>正在加载共享会话详情…</div>
                ) : selectedSharedSession ? (
                  <div style={{ ...ROW_STYLE, gap: 8 }}>
                    <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>
                      当前查看：
                      {selectedSharedSession.share.title ?? selectedSharedSession.share.sessionId}
                    </strong>
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      共享者：{selectedSharedSession.share.sharedByEmail} · 权限：
                      {PERMISSION_LABELS[selectedSharedSession.share.permission]}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      Presence：{selectedSharedSession.presence.length} 人 · 评论：
                      {selectedSharedSession.comments.length} 条
                    </span>
                    {selectedSharedSession.pendingPermissions.length > 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                        待处理权限请求：{selectedSharedSession.pendingPermissions.length}
                      </span>
                    ) : null}
                    {selectedSharedSession.pendingQuestions.length > 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--aux)' }}>
                        待回答问题：{selectedSharedSession.pendingQuestions.length}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </TabContainer>
  );
}
