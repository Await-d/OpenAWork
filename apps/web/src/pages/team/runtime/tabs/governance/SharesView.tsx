/**
 * 260516-team-page-v2 · T-13 · SharesView
 *
 * 「共享 / 协作」tab：列出当前工作区的共享情况。
 *   - 我共享出去的会话（含成员、权限）
 *   - 别人共享给我的会话（含权限、状态）
 *
 * 数据来源：useTeamRuntimeReferenceViewData().sessionShares + sharedSessions
 */

import { useMemo, useState, type CSSProperties } from 'react';
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
  comment: 'var(--aux))',
  operate: 'var(--success))',
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
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--fg-strong)',
};

type ShareTab = 'outgoing' | 'incoming';

export function SharesView() {
  const { sessionShares, sharedSessions } = useTeamRuntimeReferenceViewData();
  const [tab, setTab] = useState<ShareTab>('outgoing');

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

  if (totalOutgoing === 0 && totalIncoming === 0) {
    return (
      <TabContainer title="共享 / 协作" subtitle="管理我对外共享的会话以及别人共享给我的会话。">
        <div style={CONTAINER_STYLE}>
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              padding: 32,
              borderRadius: 12,
              border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
              color: 'var(--fg-muted)',
              fontSize: 13,
              gap: 6,
            }}
          >
            <span style={{ fontSize: 26 }} aria-hidden>
              🤝
            </span>
            <strong style={{ color: 'var(--fg-default)' }}>暂无共享记录</strong>
            <span>当你或别人共享会话时，会出现在这里。</span>
          </div>
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer title="共享 / 协作" subtitle="管理我对外共享的会话以及别人共享给我的会话。">
      <div style={CONTAINER_STYLE}>
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
                        <span
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
                          <span
                            style={{
                              color: PERMISSION_COLORS[share.permission],
                              fontWeight: 700,
                            }}
                          >
                            {PERMISSION_LABELS[share.permission]}
                          </span>
                        </span>
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
              sharedSessions.map((session) => (
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
                  {session.workspacePath ? (
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      {session.workspacePath}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </TabContainer>
  );
}
