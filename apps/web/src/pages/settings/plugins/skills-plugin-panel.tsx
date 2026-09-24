/**
 * 技能管理面（设置 → 插件 → 技能）。
 *
 * 该视图只负责「管理已安装」：数据流复用共享 hook `useInstalledSkills`，
 * 列表渲染复用 shared-ui `InstalledSkillsManager`——与 `/skills` 页的
 * 「已安装」视图同源，避免两套逻辑漂移。市场发现在独立 `/skills` 页。
 */

import React from 'react';
import { Link } from 'react-router';
import { InstalledSkillsManager } from '@openAwork/shared-ui';
import { useInstalledSkills } from '../../../hooks/skills/use-installed-skills.js';

export function SkillsPluginPanel(): React.ReactElement {
  const installed = useInstalledSkills();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
        <Link
          to="/skills"
          style={{
            color: 'var(--accent)',
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          前往技能市场 →
        </Link>
      </div>

      {!installed.loaded ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 12, padding: 20 }}>加载中…</div>
      ) : (
        <InstalledSkillsManager
          skills={installed.skills}
          onUninstall={(id) => void installed.uninstall(id)}
          onUpdate={() => {
            // 单行更新入口在 /skills 页；这里只提供整体「检查更新」。
          }}
          onCheckUpdates={() => void installed.checkUpdates()}
          onToggle={(id, next) => void installed.toggle(id, next)}
          toggleDisabledReason={(skill) => (skill.preinstalled ? '系统预装技能，不允许禁用' : null)}
        />
      )}

      {installed.busy || installed.statusMessage || installed.error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
          {installed.busy ? <span style={{ color: 'var(--fg-default)' }}>处理中…</span> : null}
          {installed.statusMessage ? (
            <span style={{ color: 'var(--accent)' }}>{installed.statusMessage}</span>
          ) : null}
          {installed.error ? (
            <span role="alert" style={{ color: 'var(--danger)' }}>
              {installed.error}
            </span>
          ) : null}
        </div>
      ) : null}

      <div style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.55 }}>
        点击「检查更新」会触发一次系统目录扫描（如{' '}
        <code style={{ fontSize: 11 }}>~/.claude/skills</code>
        ），自动同步本机外部安装的技能。GitHub 来源的远端版本会在后台周期性检查（默认 12
        小时），有更新时此处会显示「→ vX.Y.Z」标签。
      </div>
    </div>
  );
}
