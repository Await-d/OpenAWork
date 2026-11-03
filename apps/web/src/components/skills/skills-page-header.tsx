export interface SkillsPageHeaderProps {
  marketTotal: number;
  installedCount: number;
  sourceCount: number;
  updateCount: number;
  busy: boolean;
  onRefresh: () => void;
}

/**
 * `/skills` 页头：标题 + 说明 + 内联统计 + 刷新。
 *
 * 与 Agent 管理页共用 `console-head` / `console-statline` / `console-btn`
 * （`src/styles/console-surfaces.css`），不再各自维护一套按钮与统计样式。
 */
export function SkillsPageHeader({
  marketTotal,
  installedCount,
  sourceCount,
  updateCount,
  busy,
  onRefresh,
}: SkillsPageHeaderProps) {
  return (
    <header className="console-head">
      <div className="console-title-group">
        <h1 className="console-title">技能</h1>
        <p className="console-subtitle">浏览技能市场、管理已安装技能与注册源。</p>
      </div>

      <span className="console-spacer" />

      <div className="console-statline">
        <span>
          市场 <b>{marketTotal}</b>
        </span>
        <span className="console-statline__sep" aria-hidden="true" />
        <span>
          已安装 <b>{installedCount}</b>
        </span>
        <span className="console-statline__sep" aria-hidden="true" />
        <span>
          注册源 <b>{sourceCount}</b>
        </span>
        <span className="console-statline__sep" aria-hidden="true" />
        <span className={updateCount > 0 ? 'console-statline--warn' : undefined}>
          可更新 <b>{updateCount}</b>
        </span>
      </div>

      <button
        type="button"
        className="console-btn console-btn--ghost"
        disabled={busy}
        onClick={onRefresh}
      >
        {busy ? '刷新中…' : '刷新'}
      </button>
    </header>
  );
}
