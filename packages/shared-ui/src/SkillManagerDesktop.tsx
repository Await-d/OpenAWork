import type { CSSProperties } from 'react';
import type { InstalledSkill } from './SkillManagerMobile.js';

export type { InstalledSkill };

export interface SkillManagerDesktopProps {
  skills: InstalledSkill[];
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  style?: CSSProperties;
}

const AUTH_COLOR: Record<string, string> = {
  ok: '#34d399',
  missing: '#facc15',
  error: '#f87171',
};

const cell: CSSProperties = {
  padding: '0.65rem 1rem',
  fontSize: 12,
  color: 'var(--color-text, #e2e8f0)',
  verticalAlign: 'middle',
};

const muted: CSSProperties = {
  ...cell,
  color: 'var(--color-muted, #94a3b8)',
};

export function SkillManagerDesktop({
  skills,
  onInstall,
  onUninstall,
  style,
}: SkillManagerDesktopProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}
        >
          技能 — 已安装
        </h2>
      </div>

      {skills.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--color-muted, #94a3b8)',
            fontSize: 12,
          }}
        >
          暂无已安装技能。
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border, #334155)' }}>
              {['名称', '版本', '认证', '描述', '来源', '最后更新', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    ...muted,
                    fontWeight: 500,
                    textAlign: 'left',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skills.map((skill, idx) => {
              const color = AUTH_COLOR[skill.authStatus] ?? '#94a3b8';
              const isLast = idx === skills.length - 1;
              return (
                <tr
                  key={skill.id}
                  style={{
                    borderBottom: isLast ? 'none' : '1px solid var(--color-border, #334155)',
                    opacity: skill.enabled ? 1 : 0.55,
                  }}
                >
                  <td style={cell}>
                    <div style={{ fontWeight: 600 }}>{skill.name}</div>
                    <div
                      style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', marginTop: 1 }}
                    >
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
                  </td>
                  <td style={cell}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: `${color}22`,
                        color,
                        letterSpacing: 0.3,
                        textTransform: 'uppercase',
                      }}
                    >
                      {skill.authStatus}
                    </span>
                  </td>
                  <td style={{ ...muted, maxWidth: 220 }}>
                    <span style={{ fontSize: 12 }}>—</span>
                  </td>
                  <td style={muted}>
                    <span style={{ fontSize: 12 }}>—</span>
                  </td>
                  <td style={muted}>
                    <span style={{ fontSize: 12 }}>—</span>
                  </td>
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => onInstall(skill.id)}
                        style={actionBtn('var(--color-accent, #6366f1)')}
                      >
                        安装
                      </button>
                      <button
                        type="button"
                        onClick={() => onUninstall(skill.id)}
                        style={actionBtn('#475569', '#f87171')}
                      >
                        移除
                      </button>
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

function actionBtn(bg: string, color = '#fff'): CSSProperties {
  return {
    background: `${bg}22`,
    color,
    border: `1px solid ${bg}55`,
    borderRadius: 6,
    padding: '0.25rem 0.6rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  };
}
