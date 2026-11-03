/**
 * 技能页中列：内联详情（概览 / README / 权限 / 更新日志）+ 与当前视图匹配的动作。
 *
 * 取代旧版的「整页替换详情」：选择技能不再离开列表，返回成本为零；三类视图
 * （市场 / 本地 / 已安装）的动作在这里分派，列表行只负责选中。
 */

import { useState } from 'react';
import type { MarketSkillDetail } from '@openAwork/shared-ui';
import { formatSourceLabel } from './skills-page-model.js';
import type { SkillRow } from './skills-page-model.js';
import type { SkillsTab } from './skills-tab-bar.js';

type DocTab = 'overview' | 'readme' | 'permissions' | 'changelog';

const DOC_TABS: Array<{ id: DocTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'readme', label: 'README' },
  { id: 'permissions', label: '权限' },
  { id: 'changelog', label: '更新日志' },
];

function OverviewDoc({
  row,
  detail,
  detailLoading,
  tab,
}: {
  row: SkillRow;
  detail: MarketSkillDetail | null;
  detailLoading: boolean;
  tab: SkillsTab;
}) {
  return (
    <div className="skills-doc">
      <h3>简介</h3>
      <p>{detail?.description || row.description || '该技能未提供说明。'}</p>

      {detailLoading ? <p className="console-statline">正在读取技能详情…</p> : null}

      <h3>基本信息</h3>
      <ul>
        <li>版本：v{detail?.version ?? row.version}</li>
        {/* 展示详情里「版本」已按条目自身取值（已安装条目即已装版本），相同则不再重复一行。 */}
        {row.installedVersion && row.installedVersion !== (detail?.version ?? row.version) ? (
          <li>已安装版本：v{row.installedVersion}</li>
        ) : null}
        {row.hasUpdate && row.latestVersion ? <li>可更新到：v{row.latestVersion}</li> : null}
        <li>分类：{detail?.category || row.category || '未分类'}</li>
        <li>来源：{formatSourceLabel(row.source)}</li>
        {row.downloads > 0 ? <li>安装量：{row.downloads.toLocaleString()} 次</li> : null}
        {tab === 'installed' && row.enabled !== null ? (
          <li>启用状态：{row.enabled ? '已启用' : '已禁用'}</li>
        ) : null}
        {row.workspaceRelativePath ? (
          <li>
            路径：{row.workspaceRelativePath === '.' ? '工作区根目录' : row.workspaceRelativePath}
          </li>
        ) : null}
      </ul>

      {row.tags.length > 0 ? (
        <>
          <h3>标签</h3>
          <ul>
            {row.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </>
      ) : null}

      {row.systemSourced ? (
        <p className="console-statline">
          该技能从系统目录（如 ~/.claude/skills）自动发现，重启时会同步更新。
        </p>
      ) : null}
      {row.preinstalled ? (
        <p className="console-statline">系统预装技能：不允许禁用，移除前需要二次确认。</p>
      ) : null}
    </div>
  );
}

export function SkillsDetailPanel({
  tab,
  row,
  detail,
  detailLoading,
  busy,
  onInstall,
  onToggle,
  onUpdate,
  onUninstall,
}: {
  tab: SkillsTab;
  row: SkillRow | null;
  detail: MarketSkillDetail | null;
  detailLoading: boolean;
  busy: boolean;
  onInstall: () => void;
  onToggle: (nextEnabled: boolean) => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const [docTab, setDocTab] = useState<DocTab>('overview');
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  if (!row) {
    return (
      <section className="console-col" aria-label="技能详情">
        <div className="console-empty">从左侧选择技能即可在此查看详情并安装。</div>
      </section>
    );
  }

  const permissions = detail?.permissions ?? [];
  const readme = detail?.readme ?? '';
  const changelog = detail?.changelog ?? '';

  return (
    <section className="console-col" aria-label="技能详情">
      <div className="skills-detail__head">
        <div className="skills-detail__title-group">
          <h2 className="skills-detail__title">{detail?.name ?? row.name}</h2>
          <p className="skills-detail__subtitle">
            {detail?.description || row.description || '该技能未提供说明。'}
          </p>
          <div className="skills-detail__badges">
            <span className="console-badge console-badge--mono">
              v{detail?.version ?? row.version}
            </span>
            {(detail?.verified ?? row.verified) ? (
              <span className="console-badge console-badge--success">✓ 已验证</span>
            ) : null}
            {detail?.category || row.category ? (
              <span className="console-badge console-badge--aux">
                {detail?.category || row.category}
              </span>
            ) : null}
            {/* 「已安装」视图下上面的版本徽章本身就是已装版本，不再重复标注。 */}
            {tab !== 'installed' && row.installedVersion ? (
              <span className="console-badge">已安装 v{row.installedVersion}</span>
            ) : null}
            {row.hasUpdate ? (
              <span className="console-badge console-badge--contrast">可更新</span>
            ) : null}
            {detail?.author ? <span className="console-badge">{detail.author}</span> : null}
            {detail?.license ? <span className="console-badge">{detail.license}</span> : null}
          </div>
        </div>

        <div className="skills-detail__actions">
          {tab === 'installed' ? (
            <>
              {row.preinstalled ? (
                <span className="console-badge" title="系统预装技能，不允许禁用">
                  系统预装
                </span>
              ) : (
                <label className="console-check-row">
                  {row.enabled ? '已启用' : '已禁用'}
                  <button
                    type="button"
                    role="switch"
                    className="console-switch"
                    aria-checked={row.enabled === true}
                    aria-label={row.enabled ? `禁用 ${row.name}` : `启用 ${row.name}`}
                    disabled={busy}
                    onClick={() => onToggle(row.enabled !== true)}
                  />
                </label>
              )}

              {row.hasUpdate ? (
                <button
                  type="button"
                  className="console-btn console-btn--primary"
                  disabled={busy}
                  onClick={onUpdate}
                >
                  更新到 v{row.latestVersion}
                </button>
              ) : null}

              {confirmingRemoval ? (
                <>
                  <button
                    type="button"
                    className="console-btn"
                    onClick={() => setConfirmingRemoval(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="console-btn console-btn--danger"
                    onClick={() => {
                      setConfirmingRemoval(false);
                      onUninstall();
                    }}
                  >
                    确认移除
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="console-btn console-btn--danger"
                  disabled={busy}
                  onClick={() => {
                    if (row.preinstalled) {
                      setConfirmingRemoval(true);
                      return;
                    }
                    onUninstall();
                  }}
                >
                  移除
                </button>
              )}
            </>
          ) : (
            <>
              {row.installedVersion ? (
                <span className="console-badge console-badge--success">
                  已安装 v{row.installedVersion}
                </span>
              ) : null}
              <button
                type="button"
                className="console-btn console-btn--primary"
                disabled={!row.installable || busy}
                title={row.installable ? undefined : '该来源暂不支持在产品内安装'}
                onClick={onInstall}
              >
                {row.installable ? row.actionLabel : '仅浏览'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="skills-tabs" role="tablist" aria-label="技能详情分区">
        {DOC_TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            role="tab"
            aria-selected={docTab === tabItem.id}
            className={`skills-tab${docTab === tabItem.id ? ' is-active' : ''}`}
            onClick={() => setDocTab(tabItem.id)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      <div className="console-col__scroll">
        {docTab === 'overview' ? (
          <OverviewDoc row={row} detail={detail} detailLoading={detailLoading} tab={tab} />
        ) : null}

        {docTab === 'readme' ? (
          readme ? (
            <div className="skills-doc">
              <pre>{readme}</pre>
            </div>
          ) : (
            <div className="console-empty">
              {detailLoading ? '正在读取 README…' : '该技能未提供 README。'}
            </div>
          )
        ) : null}

        {docTab === 'permissions' ? (
          permissions.length > 0 ? (
            <div className="skills-doc">
              <h3>该技能会请求的权限</h3>
              {permissions.map((permission) => (
                <div key={permission} className="skills-perm-row">
                  <span className="console-badge console-badge--contrast">PERM</span>
                  <code>{permission}</code>
                </div>
              ))}
              <p className="console-statline">
                安装即表示授予上述权限；可在「设置 → 插件 → 技能」中随时撤销。
              </p>
            </div>
          ) : (
            <div className="console-empty">
              {detailLoading ? '正在读取权限清单…' : '该技能未声明额外权限。'}
            </div>
          )
        ) : null}

        {docTab === 'changelog' ? (
          changelog ? (
            <div className="skills-doc">
              <pre>{changelog}</pre>
            </div>
          ) : (
            <div className="console-empty">
              {detailLoading ? '正在读取更新日志…' : '该技能未提供更新日志。'}
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
