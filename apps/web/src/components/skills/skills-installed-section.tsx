import { useState } from 'react';
import { InstalledSkillsManager, RegistrySourceManager } from '@openAwork/shared-ui';
import type { MarketInstalledSkill, RegistrySource } from '@openAwork/shared-ui';

export interface SkillsInstalledSectionProps {
  loading: boolean;
  skills: MarketInstalledSkill[];
  registrySources: RegistrySource[];
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onCheckUpdates: () => void;
  onToggle?: (id: string, nextEnabled: boolean) => void;
  onAddSource: (url: string) => void;
  onRemoveSource: (id: string) => void;
  onToggleSource: (id: string, enabled: boolean) => void;
  statusMessage?: string | null;
  error?: string | null;
}

/**
 * 已安装视图：技能列表为主，注册源管理折叠在下方（不再常驻半屏）。
 */
export function SkillsInstalledSection({
  loading,
  skills,
  registrySources,
  onUninstall,
  onUpdate,
  onCheckUpdates,
  onToggle,
  onAddSource,
  onRemoveSource,
  onToggleSource,
  statusMessage,
  error,
}: SkillsInstalledSectionProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  if (loading && skills.length === 0) {
    return (
      <div
        style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          color: 'var(--fg-muted)',
          fontSize: 12,
          padding: '24px 16px',
          textAlign: 'center',
        }}
      >
        加载中…
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <InstalledSkillsManager
        skills={skills}
        onUninstall={onUninstall}
        onUpdate={onUpdate}
        onCheckUpdates={onCheckUpdates}
        {...(onToggle ? { onToggle } : {})}
        toggleDisabledReason={(skill) => (skill.preinstalled ? '系统预装技能，不允许禁用' : null)}
      />

      {(statusMessage || error) && (
        <div style={{ display: 'grid', fontSize: 11, gap: 4, lineHeight: 1.55 }}>
          {statusMessage ? <span style={{ color: 'var(--accent)' }}>{statusMessage}</span> : null}
          {error ? (
            <span role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </span>
          ) : null}
        </div>
      )}

      <button
        type="button"
        aria-expanded={sourcesOpen}
        onClick={() => setSourcesOpen((open) => !open)}
        style={{
          alignItems: 'center',
          alignSelf: 'flex-start',
          background: 'transparent',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          display: 'inline-flex',
          fontSize: 12,
          fontWeight: 600,
          gap: 6,
          padding: '5px 12px',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            transform: sourcesOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        >
          ›
        </span>
        注册源管理 · {registrySources.length}
      </button>

      {sourcesOpen ? (
        <RegistrySourceManager
          sources={registrySources}
          onAdd={onAddSource}
          onRemove={onRemoveSource}
          onToggle={onToggleSource}
        />
      ) : null}
    </div>
  );
}
