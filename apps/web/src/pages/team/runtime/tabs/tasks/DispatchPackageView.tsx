/**
 * 260516-team-phase-d · T-09
 *
 * dispatch_package 可视化：右侧面板任务详情中展示派发包内容。
 */

import { type CSSProperties } from 'react';

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
};

const ROLE_COLORS: Record<string, string> = {
  executor: 'var(--success)',
  tester: 'var(--aux)',
  reviewer: 'var(--warning)',
};

export interface DispatchPackageViewProps {
  packages: Array<{
    goal: string;
    role: string;
    toolsets: string[];
    taskMarkers: { taskId: string; parallel: boolean; story?: string; priority: string };
    dependsOn: string[];
  }>;
}

export function DispatchPackageView({ packages }: DispatchPackageViewProps) {
  if (packages.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 12 }}>
        暂无派发包。PM2 完成任务拆分后这里会展示每个 dispatch_package 的内容。
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Dispatch Packages（{packages.length}）
      </span>
      {packages.map((pkg) => {
        const color = ROLE_COLORS[pkg.role] ?? 'var(--fg-muted)';
        return (
          <div key={pkg.taskMarkers.taskId} style={CARD_STYLE}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                style={{
                  ...BADGE_STYLE,
                  color,
                  border: `1px solid ${color}40`,
                  background: `${color}10`,
                }}
              >
                {pkg.role}
              </span>
              <span
                style={{
                  ...BADGE_STYLE,
                  color: 'var(--fg-muted)',
                  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
                }}
              >
                {pkg.taskMarkers.taskId}
              </span>
              {pkg.taskMarkers.parallel ? (
                <span
                  style={{
                    ...BADGE_STYLE,
                    color: 'var(--aux)',
                    border: '1px solid var(--aux-muted)',
                    background: 'var(--aux-subtle)',
                  }}
                >
                  [P]
                </span>
              ) : null}
              {pkg.taskMarkers.story ? (
                <span
                  style={{
                    ...BADGE_STYLE,
                    color: 'var(--success)',
                    border: '1px solid var(--success-muted)',
                    background: 'var(--success-muted)',
                  }}
                >
                  [{pkg.taskMarkers.story}]
                </span>
              ) : null}
            </div>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{pkg.goal}</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {pkg.toolsets.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    padding: '1px 4px',
                    borderRadius: 3,
                    background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
            {pkg.dependsOn.length > 0 ? (
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                依赖：{pkg.dependsOn.join(', ')}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
