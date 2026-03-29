import type { CSSProperties } from 'react';
import type { MarketSkill } from './SkillMarketHome.js';

export interface MarketSkillDetail extends MarketSkill {
  author: string;
  license: string;
  readme: string;
  permissions: string[];
  changelog?: string;
}

export interface SkillDetailPageProps {
  skill: MarketSkillDetail;
  onInstall: () => void;
  onBack: () => void;
  isInstalled?: boolean;
}

const s: Record<string, CSSProperties> = {
  root: {
    background: 'var(--color-bg, #0f172a)',
    minHeight: '100%',
    fontFamily: 'system-ui, sans-serif',
    color: 'var(--color-text, #e2e8f0)',
    maxWidth: 860,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '1rem 1.5rem 0',
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid var(--color-border, #334155)',
    color: 'var(--color-muted, #94a3b8)',
    fontSize: 12,
    cursor: 'pointer',
    padding: '0.35rem 0.75rem',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    transition: 'border-color 0.15s, color 0.15s',
  },
  hero: {
    padding: '1.5rem 1.5rem 1.25rem',
    borderBottom: '1px solid var(--color-border, #334155)',
  },
  heroInner: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '1rem',
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: 'linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(139,92,246,0.15) 100%)',
    border: '1px solid rgba(99,102,241,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    flexShrink: 0,
  },
  titleGroup: { flex: 1 },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--color-text, #e2e8f0)',
    lineHeight: 1.2,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  verifiedBadge: {
    fontSize: 11,
    color: '#34d399',
    fontWeight: 600,
    background: 'rgba(52,211,153,0.12)',
    border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 4,
    padding: '1px 6px',
  },
  desc: {
    margin: '0.35rem 0 0',
    fontSize: 13,
    color: 'var(--color-muted, #94a3b8)',
    lineHeight: 1.6,
  },
  metaRow: {
    display: 'flex',
    gap: '1.25rem',
    flexWrap: 'wrap' as const,
    marginTop: '0.75rem',
    fontSize: 12,
    color: 'var(--color-muted, #94a3b8)',
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  tagRow: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap' as const,
    marginTop: '0.65rem',
  },
  tag: {
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    background: 'rgba(99,102,241,0.12)',
    color: 'var(--color-accent, #6366f1)',
    fontWeight: 500,
    border: '1px solid rgba(99,102,241,0.2)',
  },
  installBtn: {
    background: 'var(--color-accent, #6366f1)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '0.6rem 1.4rem',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
  installedBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'rgba(52,211,153,0.1)',
    border: '1px solid rgba(52,211,153,0.3)',
    color: '#34d399',
    borderRadius: 8,
    padding: '0.5rem 1rem',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  body: {
    padding: '1.25rem 1.5rem',
  },
  section: { marginBottom: '1.5rem' },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--color-muted, #94a3b8)',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: '0.6rem',
  },
  card: {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 10,
    padding: '1rem',
  },
  readme: {
    fontSize: 13,
    color: 'var(--color-text, #e2e8f0)',
    lineHeight: 1.75,
    whiteSpace: 'pre-wrap' as const,
  },
  permRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0.45rem 0',
    fontSize: 12,
  },
  permBadge: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 700,
    background: 'rgba(250,204,21,0.12)',
    color: '#facc21',
    border: '1px solid rgba(250,204,21,0.2)',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '0.75rem',
  },
  infoCell: {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 8,
    padding: '0.65rem 0.85rem',
  },
  infoCellLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--color-muted, #94a3b8)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  infoCellValue: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-text, #e2e8f0)',
  },
};

const CATEGORY_EMOJI: Record<string, string> = {
  automation: '⚙️',
  productivity: '⚡',
  development: '💻',
  communication: '💬',
  data: '📊',
  system: '🔧',
  creative: '🎨',
  other: '✦',
};

export function SkillDetailPage({
  skill,
  onInstall,
  onBack,
  isInstalled = false,
}: SkillDetailPageProps) {
  const emoji = CATEGORY_EMOJI[skill.category] ?? '✦';
  const hasPermissions = (skill.permissions?.length ?? 0) > 0;

  return (
    <div style={s.root}>
      <div style={s.topBar}>
        <button type="button" style={s.backBtn} onClick={onBack}>
          ← 技能市场
        </button>
      </div>

      <div style={s.hero}>
        <div style={s.heroInner}>
          <div style={{ display: 'flex', gap: '0.85rem', flex: 1, minWidth: 0 }}>
            <div style={s.iconWrap}>{emoji}</div>
            <div style={s.titleGroup}>
              <h1 style={s.title}>
                {skill.name}
                {skill.verified && <span style={s.verifiedBadge}>✓ 已验证</span>}
              </h1>
              {skill.description && <p style={s.desc}>{skill.description}</p>}
              <div style={s.metaRow}>
                <span style={s.metaItem}>v{skill.version}</span>
                {skill.author && <span style={s.metaItem}>👤 {skill.author}</span>}
                {skill.license && <span style={s.metaItem}>⚖️ {skill.license}</span>}
                {skill.downloads > 0 && (
                  <span style={s.metaItem}>⬇️ {skill.downloads.toLocaleString()} 次</span>
                )}
              </div>
              {(skill.tags ?? []).length > 0 && (
                <div style={s.tagRow}>
                  {(skill.tags ?? []).map((t) => (
                    <span key={t} style={s.tag}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isInstalled ? (
            <div style={s.installedBadge}>
              <span>✓</span>
              <span>已安装</span>
            </div>
          ) : (
            <button
              type="button"
              style={
                skill.installable === false
                  ? { ...s.installBtn, opacity: 0.5, cursor: 'not-allowed' }
                  : s.installBtn
              }
              disabled={skill.installable === false}
              onClick={onInstall}
            >
              {skill.installable === false ? '仅浏览' : '安装'}
            </button>
          )}
        </div>
      </div>

      <div style={s.body}>
        <div style={{ ...s.section, ...s.infoGrid }}>
          <div style={s.infoCell}>
            <div style={s.infoCellLabel}>版本</div>
            <div style={s.infoCellValue}>v{skill.version}</div>
          </div>
          <div style={s.infoCell}>
            <div style={s.infoCellLabel}>分类</div>
            <div style={s.infoCellValue}>{skill.category}</div>
          </div>
          {skill.license && (
            <div style={s.infoCell}>
              <div style={s.infoCellLabel}>许可</div>
              <div style={s.infoCellValue}>{skill.license}</div>
            </div>
          )}
          {skill.author && (
            <div style={s.infoCell}>
              <div style={s.infoCellLabel}>作者</div>
              <div style={s.infoCellValue}>{skill.author}</div>
            </div>
          )}
        </div>

        {hasPermissions && (
          <div style={s.section}>
            <div style={s.sectionTitle}>所需权限</div>
            <div style={s.card}>
              {skill.permissions?.map((perm, i) => (
                <div
                  key={perm}
                  style={{
                    ...s.permRow,
                    borderBottom:
                      i < (skill.permissions?.length ?? 0) - 1
                        ? '1px solid var(--color-border, #334155)'
                        : 'none',
                  }}
                >
                  <span style={s.permBadge}>PERM</span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: 'var(--color-muted, #94a3b8)',
                    }}
                  >
                    {perm}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {skill.readme && (
          <div style={s.section}>
            <div style={s.sectionTitle}>说明文档</div>
            <div style={s.card}>
              <div style={s.readme}>{skill.readme}</div>
            </div>
          </div>
        )}

        {skill.changelog && (
          <div style={s.section}>
            <div style={s.sectionTitle}>更新日志</div>
            <div style={s.card}>
              <div style={{ ...s.readme, fontSize: 12 }}>{skill.changelog}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
