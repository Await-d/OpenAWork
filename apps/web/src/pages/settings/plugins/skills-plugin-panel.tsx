/**
 * Skill management surface embedded inside the Settings → 插件 tab.
 *
 * Mirrors a subset of `SkillsPage`'s installed-skill management (list +
 * toggle + uninstall + check-updates) but skips the marketplace browse
 * UI: this view is for *managing what's already installed*, while
 * discovery still happens on the standalone `/skills` page. Keeping the
 * two surfaces deliberately distinct avoids the settings tab ballooning
 * into a full second copy of the marketplace.
 *
 * Implementation notes:
 *   - Reuses `@openAwork/shared-ui` `InstalledSkillsManager`. The
 *     toggle UI is opt-in via the `onToggle` prop added in the same
 *     change set.
 *   - Toggle calls go through the existing
 *     `PATCH /skills/installed/:id/enable` endpoint.
 *   - `local-system:` rows are rendered with a tooltip explaining that
 *     they're auto-sourced from system directories — toggling is still
 *     allowed (operator might want to silence a globally-installed
 *     skill for this user) and the next system rescan preserves their
 *     choice (system-skills.ts honours user disables).
 *   - We intentionally don't run the marketplace prewarm here; the
 *     background scheduler already handles it every 2h.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { createSkillsClient } from '@openAwork/web-client';
import {
  InstalledSkillsManager,
  type MarketInstalledSkill as InstalledSkill,
} from '@openAwork/shared-ui';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { logger } from '../../../utils/log/logger.js';
import { DEFAULT_PREINSTALLED_SKILL_IDS } from '../../skills/shared/skills-shared-constants.js';
import { sharedUiThemeVars } from '../../../components/skills/SkillsPageSections.js';

interface InstalledSkillDto {
  skillId: string;
  manifest: { name: string; version: string };
  sourceId: string;
  enabled: boolean;
  latestVersion?: string | null;
}

interface ResyncResponse {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

const PANEL_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
};

const NOTICE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.55,
};

const LINK_STYLE: CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

export function SkillsPluginPanel(): React.ReactElement {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const skillsClient = useMemo(() => createSkillsClient(gatewayUrl), [gatewayUrl]);

  const loadInstalled = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = (await skillsClient.listInstalled(accessToken)) as {
        skills: InstalledSkillDto[];
      };
      const mapped = data.skills.map<InstalledSkill>((s) => ({
        id: s.skillId,
        name: s.manifest.name,
        version: s.manifest.version,
        latestVersion: s.latestVersion ?? s.manifest.version,
        source: s.sourceId,
        enabled: s.enabled,
        preinstalled: DEFAULT_PREINSTALLED_SKILL_IDS.has(s.skillId),
      }));
      setSkills(mapped);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skills-plugin-panel.load-failed', { error: message });
      setError(`加载失败：${message}`);
    } finally {
      setLoaded(true);
    }
  }, [accessToken, skillsClient]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  const handleToggle = useCallback(
    async (skillId: string, nextEnabled: boolean) => {
      // Optimistic update: flip immediately, roll back on failure. The
      // PATCH request is fast (single-row write on local SQLite) so
      // this just smooths over the network round-trip.
      setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, enabled: nextEnabled } : s)));
      setBusy(true);
      try {
        await skillsClient.setEnabled(accessToken ?? '', skillId, nextEnabled);
        setStatusMessage(`已${nextEnabled ? '启用' : '禁用'}：${skillId}`);
        // Eventually-consistent refetch in case the row mutated for
        // any other reason (e.g. concurrent system rescan).
        void loadInstalled();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('skills-plugin-panel.toggle-failed', { skillId, error: message });
        setError(`切换失败：${message}`);
        // Roll back optimistic update.
        setSkills((prev) =>
          prev.map((s) => (s.id === skillId ? { ...s, enabled: !nextEnabled } : s)),
        );
      } finally {
        setBusy(false);
      }
    },
    [skillsClient, accessToken, loadInstalled],
  );

  const handleUninstall = useCallback(
    async (skillId: string) => {
      setBusy(true);
      try {
        await skillsClient.uninstall(accessToken ?? '', skillId);
        setStatusMessage(`已移除：${skillId}`);
        await loadInstalled();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('skills-plugin-panel.uninstall-failed', { skillId, error: message });
        setError(`移除失败：${message}`);
      } finally {
        setBusy(false);
      }
    },
    [skillsClient, accessToken, loadInstalled],
  );

  const handleCheckUpdates = useCallback(async () => {
    setBusy(true);
    setStatusMessage(null);
    setError(null);
    try {
      // Trigger a system-skills rescan so any newly added system-level
      // skills (e.g. user just dropped a folder under ~/.claude/skills)
      // surface here without waiting for the periodic 10min tick.
      try {
        const data = (await skillsClient.resyncSystem(accessToken ?? '')) as ResyncResponse;
        setStatusMessage(
          `系统目录扫描完成：新增 ${data.added}，更新 ${data.updated}，移除 ${data.removed}（共 ${data.total}）`,
        );
      } catch {
        // Skip status update if resync failed — loadInstalled below still runs.
      }
      await loadInstalled();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skills-plugin-panel.check-updates-failed', { error: message });
      setError(`检查失败：${message}`);
    } finally {
      setBusy(false);
    }
  }, [skillsClient, accessToken, loadInstalled]);

  const toggleDisabledReason = useCallback((skill: InstalledSkill): string | null => {
    if (skill.preinstalled) return '系统预装技能，不允许禁用';
    return null;
  }, []);

  if (!loaded) {
    return <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 12 }}>加载中…</div>;
  }

  return (
    // `minWidth: 0` is load-bearing: the parent PluginsTabContent grid
    // uses `gridTemplateColumns: '240px 1fr'`, and without an explicit
    // min-width of 0 the 5-column InstalledSkillsManager table pushes
    // the `1fr` column wider than the viewport, triggering a
    // horizontal scrollbar on the whole settings page. Classic CSS
    // grid gotcha — min-content defaults to `auto`, which is the
    // intrinsic width of the child, not 0.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={PANEL_HEADER}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
          管理已安装的 Agent 技能，控制每条技能是否对当前账号启用。
        </div>
        <Link to="/skills" style={LINK_STYLE}>
          前往技能市场 →
        </Link>
      </div>

      {/*
        Two wrappers around InstalledSkillsManager:
          1. `sharedUiThemeVars` bridges @openAwork/shared-ui's
             `--color-surface` / `--color-text` / `--color-muted`
             vars to Settings' `--surface` / `--text` / `--text-3`.
             Without this the table renders dark even in light mode.
          2. `overflowX: auto` + `minWidth: 0` lets the table scroll
             horizontally on narrow viewports instead of bleeding out
             of the grid cell.
       */}
      <div style={{ ...sharedUiThemeVars, minWidth: 0, overflowX: 'auto' }}>
        <InstalledSkillsManager
          skills={skills}
          onUninstall={(id) => void handleUninstall(id)}
          onUpdate={() => {
            // Per-row update is handled on the standalone /skills
            // page — here we expose only the global "检查更新" action.
          }}
          onCheckUpdates={() => void handleCheckUpdates()}
          onToggle={(id, next) => void handleToggle(id, next)}
          toggleDisabledReason={toggleDisabledReason}
        />
      </div>

      {(busy || statusMessage || error) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...NOTICE }}>
          {busy && <span style={{ color: 'var(--fg-default)' }}>处理中…</span>}
          {statusMessage && <span style={{ color: 'var(--accent)' }}>{statusMessage}</span>}
          {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      )}

      <div style={NOTICE}>
        点击「检查更新」会触发一次系统目录扫描（如{' '}
        <code style={{ fontSize: 11 }}>~/.claude/skills</code>
        ），自动同步本机外部安装的技能。GitHub 来源的远端版本会在后台周期性检查（默认 12
        小时），有更新时此处会显示「→ vX.Y.Z」标签。
      </div>
    </div>
  );
}
