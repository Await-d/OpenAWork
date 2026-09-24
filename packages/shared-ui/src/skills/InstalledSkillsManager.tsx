import { color, font, radius, spacing } from '../tokens.js';
import type { CSSProperties, ReactNode } from 'react';
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

/**
 * 已安装技能管理面——紧凑列表行，替代历史上的 5 列表格。
 *
 * 设计约束（E · Nebula）：
 *   - 单层面板，行分隔用 `--border-subtle`，hover 用 `--bg-raised`；
 *   - 状态/来源徽章一律走 token，禁止硬编码色值；
 *   - 所有交互元素（开关 / 更新 / 移除 / 检查更新）都必须有 focus ring；
 *   - 375px 窄屏下列内容允许换行，不产生横向滚动。
 */
const styles = `
[data-openawork-installed-skills] .isk-row:hover {
  background: var(--bg-raised);
}
[data-openawork-installed-skills] .isk-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: ${radius.sm}px;
  background: transparent;
  color: ${color.fgMuted};
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  transition: color 100ms ease, background 100ms ease, border-color 100ms ease;
}
[data-openawork-installed-skills] .isk-action:hover {
  background: var(--bg-hover);
  color: var(--fg-default);
}
[data-openawork-installed-skills] .isk-action[data-tone='accent'] {
  color: ${color.accent};
}
[data-openawork-installed-skills] .isk-action[data-tone='accent']:hover {
  background: ${color.accentMuted};
}
[data-openawork-installed-skills] .isk-action[data-tone='danger']:hover {
  background: ${color.complementMuted};
  color: ${color.complement};
}
[data-openawork-installed-skills] :where(button, [role='switch']):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
[data-openawork-installed-skills] .isk-action[data-tone='danger']:focus-visible {
  outline-color: ${color.complement};
  box-shadow: 0 0 0 4px ${color.complementSubtle};
}
`;

const panelStyle: CSSProperties = {
  background: color.bgOverlay,
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.lg,
  fontFamily: font.sans,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  alignItems: 'center',
  borderBottom: `1px solid ${color.borderSubtle}`,
  display: 'flex',
  gap: spacing[3],
  justifyContent: 'space-between',
  padding: `${spacing[3]}px ${spacing[4]}px`,
};

const rowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${spacing[2]}px ${spacing[3]}px`,
  padding: `${spacing[2] + 2}px ${spacing[4]}px`,
  transition: 'background 100ms ease',
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

function Badge({
  children,
  title,
  tone = 'accent',
}: {
  children: ReactNode;
  title?: string;
  tone?: 'accent' | 'aux';
}) {
  return (
    <span
      title={title}
      style={{
        background: tone === 'accent' ? color.accentMuted : color.auxMuted,
        border: `1px solid ${tone === 'accent' ? color.accentBorder : color.auxBorder}`,
        borderRadius: radius.pill,
        color: tone === 'accent' ? color.accent : color.aux,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.4,
        padding: '1px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function SkillSwitch({
  skill,
  onToggle,
}: {
  skill: InstalledSkill;
  onToggle: (id: string, nextEnabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={skill.enabled}
      aria-label={`${skill.enabled ? '禁用' : '启用'} ${skill.name}`}
      title={skill.enabled ? '点击禁用' : '点击启用'}
      onClick={() => onToggle(skill.id, !skill.enabled)}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          background: skill.enabled ? color.accent : 'var(--switch-track-off)',
          borderRadius: radius.pill,
          display: 'block',
          height: 20,
          position: 'relative',
          transition: 'background 160ms ease',
          width: 36,
        }}
      >
        <span
          style={{
            background: color.bgOverlay,
            borderRadius: '50%',
            boxShadow: 'var(--shadow-sm)',
            height: 16,
            left: skill.enabled ? 18 : 2,
            position: 'absolute',
            top: 2,
            transition: 'left 160ms ease',
            width: 16,
          }}
        />
      </span>
    </button>
  );
}

function SkillRow({
  skill,
  onUninstall,
  onUpdate,
  onToggle,
  toggleDisabledReason,
}: {
  skill: InstalledSkill;
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onToggle?: (id: string, nextEnabled: boolean) => void;
  toggleDisabledReason?: (skill: InstalledSkill) => string | null;
}) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const hasUpdate = Boolean(skill.latestVersion && skill.latestVersion !== skill.version);
  const disabledReason = onToggle ? (toggleDisabledReason?.(skill) ?? null) : null;

  return (
    <li
      className="isk-row"
      data-isk-row={skill.id}
      style={{
        ...rowStyle,
        borderTop: `1px solid ${color.borderSubtle}`,
        opacity: skill.enabled ? 1 : 0.6,
      }}
    >
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div
          style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}
        >
          <span
            data-isk-name
            style={{
              color: color.fgStrong,
              fontSize: 12,
              fontWeight: 600,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {skill.name}
          </span>
          {skill.preinstalled ? <Badge>系统预装</Badge> : null}
          {isSystemSourced(skill.source) ? (
            <Badge
              tone="aux"
              title="自动从系统目录（如 ~/.claude/skills）发现并启用，重启时同步更新"
            >
              系统目录
            </Badge>
          ) : null}
        </div>
        <div
          style={{
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 11,
            marginTop: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={skill.id}
        >
          {skill.id}
        </div>
      </div>

      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: 11,
          minWidth: 0,
        }}
      >
        <span style={{ color: color.fgMuted, fontFamily: font.mono }}>v{skill.version}</span>
        {hasUpdate ? (
          <span style={{ color: color.contrast, fontFamily: font.mono, fontWeight: 600 }}>
            → v{skill.latestVersion}
          </span>
        ) : null}
        <span
          style={{
            color: color.fgSubtle,
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={skill.source}
        >
          {formatSourceLabel(skill.source)}
        </span>
      </div>

      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: spacing[2],
          marginLeft: 'auto',
        }}
      >
        {onToggle && !disabledReason ? (
          <SkillSwitch skill={skill} onToggle={onToggle} />
        ) : (
          <span
            title={disabledReason ?? undefined}
            style={{
              background: skill.enabled ? color.successMuted : 'var(--bg-surface)',
              border: `1px solid ${skill.enabled ? color.successBorder : color.borderDefault}`,
              borderRadius: radius.xs,
              color: skill.enabled ? color.success : color.fgMuted,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.3,
              padding: '2px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            {skill.enabled ? '已启用' : '已禁用'}
          </span>
        )}

        {hasUpdate ? (
          <button
            type="button"
            className="isk-action"
            data-tone="accent"
            onClick={() => onUpdate(skill.id)}
          >
            更新
          </button>
        ) : null}

        {confirmingRemoval ? (
          <>
            <button
              type="button"
              className="isk-action"
              onClick={() => setConfirmingRemoval(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="isk-action"
              data-tone="danger"
              onClick={() => {
                setConfirmingRemoval(false);
                onUninstall(skill.id);
              }}
            >
              确认移除
            </button>
          </>
        ) : (
          <button
            type="button"
            className="isk-action"
            data-tone="danger"
            onClick={() => {
              if (skill.preinstalled) {
                setConfirmingRemoval(true);
                return;
              }
              onUninstall(skill.id);
            }}
          >
            {skill.preinstalled ? '移除（需确认）' : '移除'}
          </button>
        )}
      </div>
    </li>
  );
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

  return (
    <div data-openawork-installed-skills="true" style={panelStyle}>
      <style>{styles}</style>
      <div style={headerStyle}>
        <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ color: color.fgDefault, fontSize: 12, fontWeight: 600, margin: 0 }}>
            已安装技能
          </h2>
          <span style={{ color: color.fgMuted, fontSize: 11 }}>
            {skills.length} 个
            {updateCount > 0 ? (
              <span style={{ color: color.contrast }}> · {updateCount} 个可更新</span>
            ) : null}
          </span>
        </div>
        <button type="button" className="isk-action" data-tone="accent" onClick={onCheckUpdates}>
          检查更新
        </button>
      </div>

      {skills.length === 0 ? (
        <div
          style={{
            color: color.fgMuted,
            fontSize: 12,
            padding: `${spacing[6]}px ${spacing[4]}px`,
            textAlign: 'center',
          }}
        >
          暂无已安装技能。
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
              {...(onToggle ? { onToggle } : {})}
              {...(toggleDisabledReason ? { toggleDisabledReason } : {})}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
