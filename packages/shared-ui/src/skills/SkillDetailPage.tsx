import { color, font, radius, spacing } from '../tokens.js';
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

const styles = `
[data-openawork-skill-detail] .skd-btn {
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
[data-openawork-skill-detail] .skd-btn--ghost:hover {
  background: var(--bg-hover);
  border-color: var(--border-emphasis);
  color: ${color.fgStrong};
}
[data-openawork-skill-detail] .skd-btn--primary:hover:not(:disabled) {
  background: ${color.accentHover};
}
[data-openawork-skill-detail] :where(button):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
`;

const s: Record<string, CSSProperties> = {
  root: {
    color: color.fgDefault,
    display: 'grid',
    fontFamily: font.sans,
    gap: spacing[3],
    maxWidth: 860,
    minHeight: '100%',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
  },
  backBtn: {
    alignItems: 'center',
    background: 'transparent',
    border: `1px solid ${color.borderDefault}`,
    borderRadius: radius.sm,
    color: color.fgMuted,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 12,
    gap: 5,
    padding: '4px 10px',
  },
  hero: {
    borderBottom: `1px solid ${color.borderSubtle}`,
    paddingBottom: spacing[4],
  },
  heroInner: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: spacing[4],
    justifyContent: 'space-between',
  },
  iconWrap: {
    alignItems: 'center',
    background: `linear-gradient(135deg, ${color.accentMuted} 0%, ${color.auxMuted} 100%)`,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.lg,
    display: 'flex',
    flexShrink: 0,
    fontSize: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  titleGroup: { flex: 1, minWidth: 0 },
  title: {
    alignItems: 'center',
    color: color.fgStrong,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 18,
    fontWeight: 700,
    gap: spacing[2],
    lineHeight: 1.25,
    margin: 0,
  },
  verifiedBadge: {
    background: color.successMuted,
    border: `1px solid ${color.successBorder}`,
    borderRadius: radius.xs,
    color: color.success,
    fontSize: 11,
    fontWeight: 600,
    padding: '1px 6px',
  },
  desc: {
    color: color.fgMuted,
    fontSize: 13,
    lineHeight: 1.6,
    margin: '6px 0 0',
  },
  metaRow: {
    color: color.fgMuted,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 12,
    gap: spacing[4],
    marginTop: spacing[2],
  },
  metaItem: {
    alignItems: 'center',
    display: 'flex',
    gap: 4,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: spacing[2],
  },
  tag: {
    background: color.auxSubtle,
    border: `1px solid ${color.auxBorder}`,
    borderRadius: radius.xs,
    color: color.aux,
    fontSize: 10,
    fontWeight: 500,
    padding: '1px 6px',
  },
  installBtn: {
    background: color.accent,
    border: 'none',
    borderRadius: radius.md,
    color: color.fgOnAccent,
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 18px',
    whiteSpace: 'nowrap',
  },
  installedBadge: {
    alignItems: 'center',
    background: color.successMuted,
    border: `1px solid ${color.successBorder}`,
    borderRadius: radius.md,
    color: color.success,
    display: 'flex',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    gap: 5,
    padding: '6px 14px',
    whiteSpace: 'nowrap',
  },
  body: {
    display: 'grid',
    gap: spacing[5],
  },
  section: { display: 'grid', gap: spacing[2] },
  sectionTitle: {
    color: color.fgMuted,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.8,
  },
  card: {
    background: color.bgOverlay,
    border: `1px solid ${color.borderSubtle}`,
    borderRadius: radius.lg,
    padding: spacing[4],
  },
  readme: {
    color: color.fgDefault,
    fontSize: 13,
    lineHeight: 1.75,
    whiteSpace: 'pre-wrap',
  },
  permRow: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 12,
    gap: spacing[2],
    padding: '6px 0',
  },
  permBadge: {
    background: color.contrastMuted,
    border: `1px solid ${color.contrastBorder}`,
    borderRadius: radius.xs,
    color: color.contrast,
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 5px',
  },
  infoGrid: {
    display: 'grid',
    gap: spacing[3],
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  },
  infoCell: {
    background: color.bgOverlay,
    border: `1px solid ${color.borderSubtle}`,
    borderRadius: radius.md,
    padding: '8px 12px',
  },
  infoCellLabel: {
    color: color.fgMuted,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  infoCellValue: {
    color: color.fgDefault,
    fontSize: 13,
    fontWeight: 600,
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
  const permissions = skill.permissions ?? [];
  const hasPermissions = permissions.length > 0;

  return (
    <div data-openawork-skill-detail="true" style={s.root}>
      <style>{styles}</style>

      <div style={s.topBar}>
        <button type="button" className="skd-btn skd-btn--ghost" style={s.backBtn} onClick={onBack}>
          ← 技能市场
        </button>
      </div>

      <div style={s.hero}>
        <div style={s.heroInner}>
          <div style={{ display: 'flex', gap: spacing[3], flex: 1, minWidth: 0 }}>
            <div aria-hidden style={s.iconWrap}>
              {emoji}
            </div>
            <div style={s.titleGroup}>
              <h1 style={s.title}>
                {skill.name}
                {skill.verified ? <span style={s.verifiedBadge}>✓ 已验证</span> : null}
              </h1>
              {skill.description ? <p style={s.desc}>{skill.description}</p> : null}
              <div style={s.metaRow}>
                <span style={s.metaItem}>v{skill.version}</span>
                {skill.author ? <span style={s.metaItem}>👤 {skill.author}</span> : null}
                {skill.license ? <span style={s.metaItem}>⚖️ {skill.license}</span> : null}
                {skill.downloads > 0 ? (
                  <span style={s.metaItem}>⬇️ {skill.downloads.toLocaleString()} 次</span>
                ) : null}
              </div>
              {(skill.tags ?? []).length > 0 ? (
                <div style={s.tagRow}>
                  {(skill.tags ?? []).map((tag) => (
                    <span key={tag} style={s.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {isInstalled ? (
            <div style={s.installedBadge}>
              <span aria-hidden>✓</span>
              <span>已安装</span>
            </div>
          ) : (
            <button
              type="button"
              className="skd-btn skd-btn--primary"
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
        <div style={s.infoGrid}>
          <div style={s.infoCell}>
            <div style={s.infoCellLabel}>版本</div>
            <div style={s.infoCellValue}>v{skill.version}</div>
          </div>
          <div style={s.infoCell}>
            <div style={s.infoCellLabel}>分类</div>
            <div style={s.infoCellValue}>{skill.category}</div>
          </div>
          {skill.license ? (
            <div style={s.infoCell}>
              <div style={s.infoCellLabel}>许可</div>
              <div style={s.infoCellValue}>{skill.license}</div>
            </div>
          ) : null}
          {skill.author ? (
            <div style={s.infoCell}>
              <div style={s.infoCellLabel}>作者</div>
              <div style={s.infoCellValue}>{skill.author}</div>
            </div>
          ) : null}
        </div>

        {hasPermissions ? (
          <div style={s.section}>
            <div style={s.sectionTitle}>所需权限</div>
            <div style={s.card}>
              {permissions.map((perm, index) => (
                <div
                  key={perm}
                  style={{
                    ...s.permRow,
                    borderBottom:
                      index < permissions.length - 1 ? `1px solid ${color.borderSubtle}` : 'none',
                  }}
                >
                  <span style={s.permBadge}>PERM</span>
                  <span style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: 12 }}>
                    {perm}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {skill.readme ? (
          <div style={s.section}>
            <div style={s.sectionTitle}>说明文档</div>
            <div style={s.card}>
              <div style={s.readme}>{skill.readme}</div>
            </div>
          </div>
        ) : null}

        {skill.changelog ? (
          <div style={s.section}>
            <div style={s.sectionTitle}>更新日志</div>
            <div style={s.card}>
              <div style={{ ...s.readme, fontSize: 12 }}>{skill.changelog}</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
