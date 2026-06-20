import type { CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { formatRoleLayerTag, getRoleLayerIdentity } from '../../data/role-layer-identity.js';

const ROLE_LAYER_ORDER = new Map<string, number>([
  ['reception', 0],
  ['pm1', 1],
  ['pm2', 2],
  ['executor', 3],
  ['reviewer', 4],
]);

export interface DeleteSessionConfirmTarget {
  id: string;
  title: string;
}

interface DeleteSessionImpactNode {
  depth: number;
  id: string;
  parentSessionId: string | null;
  roleLayer: string | null;
  title: string;
}

export interface DeleteSessionImpactTree {
  items: DeleteSessionImpactNode[];
  root: DeleteSessionImpactNode;
}

function compareDeleteImpactSession(
  left: AgentTeamsSidebarTeam,
  right: AgentTeamsSidebarTeam,
): number {
  const leftRank = left.roleLayer ? (ROLE_LAYER_ORDER.get(left.roleLayer) ?? 99) : 99;
  const rightRank = right.roleLayer ? (ROLE_LAYER_ORDER.get(right.roleLayer) ?? 99) : 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.title.localeCompare(right.title, 'zh-CN');
}

export function buildDeleteSessionImpactTree(
  target: DeleteSessionConfirmTarget,
  sessions: AgentTeamsSidebarTeam[],
): DeleteSessionImpactTree {
  const sessionById = new Map<string, AgentTeamsSidebarTeam>();
  const childrenByParent = new Map<string, AgentTeamsSidebarTeam[]>();

  for (const session of sessions) {
    if (!sessionById.has(session.id)) {
      sessionById.set(session.id, session);
    }

    const parentSessionId = session.parentSessionId;
    if (!parentSessionId || parentSessionId === session.id) {
      continue;
    }

    const children = childrenByParent.get(parentSessionId) ?? [];
    children.push(session);
    childrenByParent.set(parentSessionId, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareDeleteImpactSession);
  }

  const fallbackRoot: AgentTeamsSidebarTeam = {
    id: target.id,
    isSharedSession: false,
    parentSessionId: null,
    roleLayer: null,
    status: 'completed',
    subtitle: '',
    title: target.title,
  };
  const rootSession = sessionById.get(target.id) ?? fallbackRoot;
  const items: DeleteSessionImpactNode[] = [];
  const visited = new Set<string>();

  const visit = (session: AgentTeamsSidebarTeam, depth: number) => {
    if (visited.has(session.id)) {
      return;
    }
    visited.add(session.id);
    items.push({
      depth,
      id: session.id,
      parentSessionId: session.parentSessionId ?? null,
      roleLayer: session.roleLayer ?? null,
      title: session.title,
    });

    for (const child of childrenByParent.get(session.id) ?? []) {
      visit(child, depth + 1);
    }
  };

  visit(rootSession, 0);

  return {
    items,
    root: items[0] ?? {
      depth: 0,
      id: target.id,
      parentSessionId: null,
      roleLayer: null,
      title: target.title,
    },
  };
}

const CONFIRM_OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9995,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--bg-base) 70%, transparent)',
  backdropFilter: 'blur(2px)',
};

const CONFIRM_DIALOG_STYLE: CSSProperties = {
  position: 'relative',
  width: 'min(520px, calc(100vw - 32px))',
  maxHeight: 'min(720px, calc(100vh - 48px))',
  padding: 20,
  borderRadius: 14,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const DELETE_IMPACT_SUMMARY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--danger-border)',
  background: 'var(--danger-muted)',
};

const DELETE_IMPACT_LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  maxHeight: 260,
  overflowY: 'auto',
  padding: 8,
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-base) 68%, var(--bg-overlay))',
  listStyle: 'none',
  margin: 0,
};

const DELETE_IMPACT_ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: 8,
  alignItems: 'flex-start',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-overlay) 84%, var(--bg-base))',
};

const DELETE_IMPACT_CONNECTOR_STYLE: CSSProperties = {
  width: 16,
  minHeight: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--fg-muted)',
  fontSize: 12,
  lineHeight: 1,
};

const DELETE_IMPACT_META_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  fontSize: 10,
  color: 'var(--fg-muted)',
};

const DELETE_IMPACT_LAYER_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 18,
  padding: '0 6px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-base) 70%, transparent)',
  color: 'var(--fg-default)',
  fontWeight: 700,
};

const CONFIRM_ACTION_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
};

const CONFIRM_CANCEL_BUTTON_STYLE: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  fontSize: 12,
  cursor: 'pointer',
};

const CONFIRM_DELETE_BUTTON_STYLE: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--danger)',
  color: 'var(--fg-on-complement)',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

export function DeleteSessionImpactDialog({
  impact,
  onCancel,
  onConfirm,
}: {
  impact: DeleteSessionImpactTree;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const rootIdentity = getRoleLayerIdentity(impact.root.roleLayer);
  const descendantCount = Math.max(0, impact.items.length - 1);

  return (
    <div style={CONFIRM_OVERLAY_STYLE}>
      <div role="alertdialog" aria-label="确认删除会话" style={CONFIRM_DIALOG_STYLE}>
        <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>删除会话</strong>
        <span style={{ fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.6 }}>
          确定要删除「{impact.root.title}」吗？删除后不可恢复。
        </span>

        <div aria-label="删除影响范围" style={DELETE_IMPACT_SUMMARY_STYLE}>
          <span style={{ fontSize: 12, color: 'var(--fg-strong)', fontWeight: 700 }}>
            删除影响层级
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}>
            当前层级：{rootIdentity.label}。
            {descendantCount > 0
              ? `将同时移除 ${descendantCount} 个下游层级会话，共 ${impact.items.length} 个会话节点。`
              : '未检测到下游层级，只移除当前会话。'}
          </span>
        </div>

        <ul aria-label="将被删除的会话层级" style={DELETE_IMPACT_LIST_STYLE}>
          {impact.items.map((item, index) => {
            const identity = getRoleLayerIdentity(item.roleLayer);
            const tag = formatRoleLayerTag(item.roleLayer);
            return (
              <li
                key={item.id}
                style={{
                  ...DELETE_IMPACT_ITEM_STYLE,
                  marginLeft: Math.min(item.depth, 6) * 14,
                }}
              >
                <span aria-hidden="true" style={DELETE_IMPACT_CONNECTOR_STYLE}>
                  {item.depth === 0 ? '•' : '↳'}
                </span>
                <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                  <span style={DELETE_IMPACT_META_STYLE}>
                    <span style={DELETE_IMPACT_LAYER_BADGE_STYLE}>{identity.label}</span>
                    <span>{tag}</span>
                    {index === 0 ? <span>当前</span> : null}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--fg-strong)',
                      lineHeight: 1.45,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {item.title}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {item.id}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <div style={CONFIRM_ACTION_ROW_STYLE}>
          <button type="button" onClick={onCancel} style={CONFIRM_CANCEL_BUTTON_STYLE}>
            取消
          </button>
          <button type="button" onClick={onConfirm} style={CONFIRM_DELETE_BUTTON_STYLE}>
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
