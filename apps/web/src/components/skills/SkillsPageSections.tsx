import React from 'react';
import {
  InstalledSkillsManager,
  RegistrySourceManager,
  SkillMarketHome,
} from '@openAwork/shared-ui';
import type {
  InstallStep,
  MarketInstalledSkill,
  MarketSkill,
  RegistrySource,
} from '@openAwork/shared-ui';

const PANEL: React.CSSProperties = {
  borderRadius: 22,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-md)',
};

const HEADER_PANEL: React.CSSProperties = {
  ...PANEL,
  background:
    'linear-gradient(180deg, color-mix(in oklab, var(--header-bg) 84%, var(--surface) 16%), var(--surface))',
};

const HERO_PANEL: React.CSSProperties = {
  ...HEADER_PANEL,
  overflow: 'hidden',
  position: 'relative',
};

const sharedUiThemeVars = {
  '--color-surface': 'var(--surface)',
  '--color-border': 'var(--border)',
  '--color-text': 'var(--text)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
} as React.CSSProperties;

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 14,
    background: disabled
      ? 'rgba(99, 102, 241, 0.35)'
      : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
    color: '#fff',
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 10px 24px rgba(79, 70, 229, 0.22)',
  };
}

function secondaryButtonStyle(disabled = false): React.CSSProperties {
  return {
    border: '1px solid var(--border-subtle)',
    borderRadius: 14,
    background: 'color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%)',
    color: disabled ? 'var(--text-3)' : 'var(--text-2)',
    padding: '11px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.72 : 1,
  };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        ...PANEL,
        padding: '14px 16px',
        background:
          'linear-gradient(180deg, color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%), var(--surface))',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

export function SkillsHero({
  marketTotal,
  installedCount,
  sourceCount,
  updateCount,
}: {
  marketTotal: number;
  installedCount: number;
  sourceCount: number;
  updateCount: number;
}) {
  return (
    <section style={{ ...HERO_PANEL, padding: 18, display: 'grid', gap: 16 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at top right, color-mix(in oklab, var(--accent) 24%, transparent 76%), transparent 42%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', display: 'grid', gap: 8, maxWidth: 760 }}>
        <span className="page-title">技能市场</span>
        <div style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>
          统一浏览技能市场、管理已安装技能和注册源，让技能发现、安装与维护保持与当前工作台一致的节奏。
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="市场技能" value={String(marketTotal)} />
        <StatCard label="已安装" value={String(installedCount)} />
        <StatCard label="注册源" value={String(sourceCount)} />
        <StatCard label="可更新" value={String(updateCount)} />
      </div>
    </section>
  );
}

export function SkillsToolbar({
  activeTab,
  busy,
  onRefresh,
  onTabChange,
}: {
  activeTab: 'market' | 'local' | 'installed';
  busy: boolean;
  onRefresh: () => void;
  onTabChange: (tab: 'market' | 'local' | 'installed') => void;
}) {
  return (
    <section
      style={{
        ...PANEL,
        padding: 16,
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>技能工作区</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          在市场、本地与已安装视图间切换，并随时刷新当前数据。
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          style={secondaryButtonStyle(busy)}
        >
          {busy ? '刷新中…' : '刷新'}
        </button>
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'color-mix(in oklab, var(--surface) 88%, var(--bg-2) 12%)',
            borderRadius: 14,
            padding: 4,
            border: '1px solid var(--border-subtle)',
          }}
        >
          {(['market', 'local', 'installed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              style={
                activeTab === tab
                  ? primaryButtonStyle(false)
                  : {
                      ...secondaryButtonStyle(false),
                      padding: '9px 14px',
                    }
              }
            >
              {tab === 'market' ? '市场' : tab === 'local' ? '本地' : '已安装'}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SkillsMarketSection({
  skills,
  title,
  subtitle,
  loading,
  error,
  currentPage,
  pageSize,
  total,
  onSearch,
  onPageChange,
  onInstall,
  onSelect,
}: {
  skills: MarketSkill[];
  title?: string;
  subtitle?: string;
  loading: boolean;
  error: string | null;
  currentPage: number;
  pageSize: number;
  total: number;
  onSearch: (q: string, category?: string) => void;
  onPageChange: (page: number) => void;
  onInstall: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section style={{ ...HEADER_PANEL, overflow: 'hidden' }}>
      {(title || subtitle) && (
        <div style={{ padding: '18px 20px 0', display: 'grid', gap: 6 }}>
          {title ? (
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          ) : null}
          {subtitle ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>{subtitle}</div>
          ) : null}
        </div>
      )}
      <div style={sharedUiThemeVars}>
        <SkillMarketHome
          skills={skills}
          categories={[]}
          loading={loading}
          error={error}
          currentPage={currentPage}
          pageSize={pageSize}
          total={total}
          onSearch={onSearch}
          onPageChange={onPageChange}
          onInstall={onInstall}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
}

export function SkillsInstalledSection({
  loading,
  installedSkills,
  registrySources,
  onUninstall,
  onUpdate,
  onCheckUpdates,
  onAddSource,
  onRemoveSource,
  onToggleSource,
}: {
  loading: boolean;
  installedSkills: MarketInstalledSkill[];
  registrySources: RegistrySource[];
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onCheckUpdates: () => void;
  onAddSource: (url: string) => void;
  onRemoveSource: (id: string) => void;
  onToggleSource: (id: string, enabled: boolean) => void;
}) {
  return (
    <div
      style={{
        maxWidth: 1380,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
        gap: 16,
      }}
    >
      <section style={{ ...HEADER_PANEL, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
            加载中…
          </div>
        ) : (
          <div style={sharedUiThemeVars}>
            <InstalledSkillsManager
              skills={installedSkills}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
              onCheckUpdates={onCheckUpdates}
            />
          </div>
        )}
      </section>

      <section style={{ ...HEADER_PANEL, overflow: 'hidden' }}>
        <div style={sharedUiThemeVars}>
          <RegistrySourceManager
            sources={registrySources}
            onAdd={onAddSource}
            onRemove={onRemoveSource}
            onToggle={onToggleSource}
          />
        </div>
      </section>
    </div>
  );
}

export { sharedUiThemeVars };
