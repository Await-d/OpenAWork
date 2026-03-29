import type { CSSProperties } from 'react';

export type AuthStatus = 'ok' | 'missing' | 'error';

export interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  authStatus: AuthStatus;
}

export interface SkillManagerMobileProps {
  skills: InstalledSkill[];
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  style?: CSSProperties;
}

const AUTH_COLOR: Record<AuthStatus, string> = {
  ok: '#34d399',
  missing: '#facc15',
  error: '#f87171',
};

const AUTH_LABEL: Record<AuthStatus, string> = {
  ok: '认证正常',
  missing: '认证缺失',
  error: '认证错误',
};

export function SkillManagerMobile({
  skills,
  onInstall,
  onUninstall,
  style,
}: SkillManagerMobileProps) {
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
          padding: '1rem',
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}
        >
          Installed Skills
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
          No skills installed.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {skills.map((skill, idx) => {
            const color = AUTH_COLOR[skill.authStatus];
            const isLast = idx === skills.length - 1;
            return (
              <div
                key={skill.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  borderBottom: isLast ? 'none' : '1px solid var(--color-border, #334155)',
                  opacity: skill.enabled ? 1 : 0.55,
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-text, #e2e8f0)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {skill.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--color-muted, #94a3b8)',
                      marginTop: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>v{skill.version}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: `${color}22`,
                        color,
                        letterSpacing: 0.3,
                      }}
                    >
                      {AUTH_LABEL[skill.authStatus]}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => onInstall(skill.id)}
                    style={actionBtn('var(--color-accent, #6366f1)')}
                  >
                    Install
                  </button>
                  <button
                    type="button"
                    onClick={() => onUninstall(skill.id)}
                    style={actionBtn('#475569', '#f87171')}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
  };
}
