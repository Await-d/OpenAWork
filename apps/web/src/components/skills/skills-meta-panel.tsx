/**
 * 技能页右列：随视图切换的上下文侧栏。
 *
 *   - 市场 / 本地：安装目标 + 技能元信息 + 权限清单（安装前要能看清的东西）；
 *   - 已安装：注册源管理（复用 shared-ui `RegistrySourceManager`，行为与设置页一致）。
 *
 * 这样「注册源」不再需要在列表下方折叠一个独立区块，而是落在它真正影响的那个视图里。
 */

import { RegistrySourceManager } from '@openAwork/shared-ui';
import type { MarketSkillDetail, RegistrySource } from '@openAwork/shared-ui';
import { formatSourceLabel } from './skills-page-model.js';
import type { SkillRow } from './skills-page-model.js';
import type { SkillsTab } from './skills-tab-bar.js';

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="console-meta__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SkillsMetaPanel({
  tab,
  row,
  detail,
  registrySources,
  installSourceId,
  onInstallSourceChange,
  onAddSource,
  onRemoveSource,
  onToggleSource,
}: {
  tab: SkillsTab;
  row: SkillRow | null;
  detail: MarketSkillDetail | null;
  registrySources: RegistrySource[];
  installSourceId: string;
  onInstallSourceChange: (sourceId: string) => void;
  onAddSource: (url: string) => void;
  onRemoveSource: (id: string) => void;
  onToggleSource: (id: string, enabled: boolean) => void;
}) {
  if (tab === 'installed') {
    return (
      <aside className="console-col console-col--aside" aria-label="注册源">
        <div className="console-col__scroll">
          <div className="skills-registry-slot">
            <RegistrySourceManager
              sources={registrySources}
              onAdd={onAddSource}
              onRemove={onRemoveSource}
              onToggle={onToggleSource}
            />
          </div>
        </div>
      </aside>
    );
  }

  const enabledSources = registrySources.filter((source) => source.enabled);

  return (
    <aside className="console-col console-col--aside" aria-label="技能元信息">
      <div className="console-col__head">
        <h2 className="console-col__title">元信息</h2>
        <span className="console-spacer" />
        <span className="console-statline">{row ? '只读' : '未选择'}</span>
      </div>

      <div className="console-col__scroll">
        {!row ? (
          <div className="console-empty">从左侧选择技能查看元信息与权限清单。</div>
        ) : (
          <div className="skills-meta">
            {tab === 'market' ? (
              <div className="console-group">
                <span className="console-group__label">安装目标</span>
                {enabledSources.length > 0 ? (
                  <select
                    className="console-select"
                    value={installSourceId}
                    aria-label="安装来源"
                    onChange={(event) => onInstallSourceChange(event.target.value)}
                  >
                    <option value="">默认来源</option>
                    {enabledSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="console-check-row">
                    当前没有启用的注册源，将使用默认来源安装。
                  </span>
                )}
              </div>
            ) : null}

            <dl className="console-meta">
              <KvRow label="版本" value={`v${detail?.version ?? row.version}`} />
              {row.installedVersion && row.installedVersion !== (detail?.version ?? row.version) ? (
                <KvRow label="已装版本" value={`v${row.installedVersion}`} />
              ) : null}
              {row.hasUpdate && row.latestVersion ? (
                <KvRow label="可更新" value={`v${row.latestVersion}`} />
              ) : null}
              <KvRow label="分类" value={detail?.category || row.category || '未分类'} />
              <KvRow label="作者" value={detail?.author || '未提供'} />
              <KvRow label="许可" value={detail?.license || '未提供'} />
              <KvRow
                label="安装量"
                value={row.downloads > 0 ? row.downloads.toLocaleString() : '—'}
              />
              <KvRow label="来源" value={formatSourceLabel(row.source)} />
              {row.dirPath ? <KvRow label="目录" value={row.dirPath} /> : null}
            </dl>

            <div className="console-group">
              <span className="console-group__label">权限清单</span>
              {(detail?.permissions ?? []).length > 0 ? (
                (detail?.permissions ?? []).map((permission) => (
                  <div key={permission} className="console-check-row">
                    <span className="console-badge console-badge--contrast">PERM</span>
                    {permission}
                  </div>
                ))
              ) : (
                <span className="console-check-row">未声明额外权限。</span>
              )}
            </div>

            {row.tags.length > 0 ? (
              <div className="console-group">
                <span className="console-group__label">标签</span>
                <div className="console-tag-row">
                  {row.tags.map((tag) => (
                    <span key={tag} className="console-badge console-badge--aux">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
