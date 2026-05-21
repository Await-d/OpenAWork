import { color } from '../tokens.js';
import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  latestVersion?: string;
  source: string;
  enabled: boolean;
  preinstalled?: boolean;
}

export interface InstalledSkillsManagerProps {
  skills: InstalledSkill[];
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onCheckUpdates: () => void;
  /**
   * Optional handler for toggling a skill's enabled flag. When provided,
   * the status cell renders an interactive switch; otherwise the cell
   * stays a read-only badge (preserves the legacy call-sites' rendering).
   *
   * The handler receives the *next* boolean state, not a delta — so
   * implementations can simply forward to a PATCH endpoint that takes
   * `{enabled}`.
   */
  onToggle?: (id: string, nextEnabled: boolean) => void;
  /**
   * Optional predicate that, when it returns a non-empty string for a
   * given skill, hides that row's toggle and shows the returned string
   * as the disabled-reason tooltip. Use for skills that the user must
   * not be able to disable (e.g. system-mandated preinstalled ones).
   * No-op when `onToggle` itself is not supplied.
   */
  toggleDisabledReason?: (skill: InstalledSkill) => string | null;
}

const cell: CSSProperties = {
  padding: '0.65rem 1rem',
  fontSize: 12,
  color: 'var(--fg-default)',
  verticalAlign: 'middle',
};
const muted: CSSProperties = { ...cell, color: 'var(--fg-muted)' };

const preinstalledBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 8,
  padding: '2px 6px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--accent)',
  background: 'rgba(56,189,248,0.14)',
  border: '1px solid rgba(56,189,248,0.22)',
};

const systemBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 8,
  padding: '2px 6px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--aux)',
  background: 'rgba(167,139,250,0.14)',
  border: '1px solid rgba(167,139,250,0.22)',
};

function isSystemSourced(source: string): boolean {
  return source.startsWith('local-system:');
}

/**
 * Render a human-readable source label. For local-system entries the
 * full path (e.g. `local-system:/home/alice/.claude/skills`) gets
 * shortened to the trailing two path segments so the column stays
 * readable on narrow viewports.
 */
function formatSourceLabel(source: string): string {
  if (!isSystemSourced(source)) return source;
  const path = source.slice('local-system:'.length);
  // Split on both POSIX `/` and Windows `\` so a path like
  // `C:\Users\alice\AppData\Roaming\OpenAWork\skills` still gets
  // shortened to `…/OpenAWork/skills` on Windows installs.
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

function btn(color: string): CSSProperties {
  return {
    background: `${color}22`,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '0.25rem 0.65rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  };
}

export function InstalledSkillsManager({
  skills,
  onUninstall,
  onUpdate,
  onCheckUpdates,
  onToggle,
  toggleDisabledReason,
}: InstalledSkillsManagerProps) {
  const updateCount = skills.filter((s) => s.latestVersion && s.latestVersion !== s.version).length;
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null);

  return (
    <div
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--fg-default)',
            }}
          >
            已安装技能
          </h2>
          {updateCount > 0 && (
            <span style={{ fontSize: 12, color: color.contrast, marginTop: 2, display: 'block' }}>
              {updateCount} 个更新可用
            </span>
          )}
        </div>
        <button type="button" style={btn('var(--accent)')} onClick={onCheckUpdates}>
          检查更新
        </button>
      </div>

      {skills.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          暂无已安装技能。
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{ borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' }}
            >
              {['名称', '版本', '来源', '状态', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    ...muted,
                    fontWeight: 500,
                    textAlign: 'left',
                    fontSize: 12,
                    whiteSpace: 'nowrap' as const,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skills.map((skill, idx) => {
              const hasUpdate = skill.latestVersion && skill.latestVersion !== skill.version;
              const isLast = idx === skills.length - 1;
              const needsRemovalConfirm = skill.preinstalled === true;
              const isConfirmingRemoval = confirmingRemovalId === skill.id;
              return (
                <tr
                  key={skill.id}
                  style={{
                    borderBottom: isLast
                      ? 'none'
                      : '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    opacity: skill.enabled ? 1 : 0.55,
                  }}
                >
                  <td style={cell}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}
                    >
                      <div style={{ fontWeight: 600 }}>{skill.name}</div>
                      {skill.preinstalled && <span style={preinstalledBadge}>系统预装</span>}
                      {isSystemSourced(skill.source) && (
                        <span
                          style={systemBadge}
                          title="自动从系统目录（如 ~/.claude/skills）发现并启用，重启时同步更新"
                        >
                          系统目录
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 1 }}>
                      {skill.id}
                    </div>
                  </td>
                  <td style={muted}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 12,
                        background: 'rgba(99,102,241,0.1)',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      v{skill.version}
                    </span>
                    {hasUpdate && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: color.contrast }}>
                        → v{skill.latestVersion}
                      </span>
                    )}
                  </td>
                  <td style={muted}>
                    <span style={{ fontSize: 12 }} title={skill.source}>
                      {formatSourceLabel(skill.source)}
                    </span>
                  </td>
                  <td style={cell}>
                    {(() => {
                      const disabledReason = onToggle
                        ? (toggleDisabledReason?.(skill) ?? null)
                        : null;
                      const showSwitch = !!onToggle && !disabledReason;
                      const badgeStyle: CSSProperties = {
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: skill.enabled
                          ? 'rgba(52,211,153,0.15)'
                          : 'rgba(100,116,139,0.15)',
                        color: skill.enabled ? color.success : 'var(--fg-muted)',
                        textTransform: 'uppercase' as const,
                        letterSpacing: 0.3,
                      };
                      if (!showSwitch) {
                        return (
                          <span style={badgeStyle} title={disabledReason ?? undefined}>
                            {skill.enabled ? '已启用' : '已禁用'}
                          </span>
                        );
                      }
                      return (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={skill.enabled}
                          aria-label={`${skill.enabled ? '禁用' : '启用'} ${skill.name}`}
                          onClick={() => onToggle?.(skill.id, !skill.enabled)}
                          title={skill.enabled ? '点击禁用' : '点击启用'}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              position: 'relative',
                              width: 28,
                              height: 16,
                              borderRadius: 999,
                              background: skill.enabled
                                ? 'rgba(52,211,153,0.55)'
                                : 'rgba(100,116,139,0.45)',
                              transition: 'background 160ms ease',
                              flexShrink: 0,
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                top: 2,
                                left: skill.enabled ? 14 : 2,
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                background: color.fgOnAccent,
                                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                                transition: 'left 160ms ease',
                              }}
                            />
                          </span>
                          <span style={badgeStyle}>{skill.enabled ? '已启用' : '已禁用'}</span>
                        </button>
                      );
                    })()}
                  </td>
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {hasUpdate && (
                        <button
                          type="button"
                          style={btn(color.success)}
                          onClick={() => onUpdate(skill.id)}
                        >
                          更新
                        </button>
                      )}
                      {isConfirmingRemoval ? (
                        <>
                          <button
                            type="button"
                            style={btn('var(--warning)')}
                            onClick={() => setConfirmingRemovalId(null)}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            style={btn(color.danger)}
                            onClick={() => {
                              setConfirmingRemovalId(null);
                              onUninstall(skill.id);
                            }}
                          >
                            确认移除
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          style={btn(color.danger)}
                          onClick={() => {
                            if (needsRemovalConfirm) {
                              setConfirmingRemovalId(skill.id);
                              return;
                            }
                            onUninstall(skill.id);
                          }}
                        >
                          {needsRemovalConfirm ? '移除（需确认）' : '移除'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
