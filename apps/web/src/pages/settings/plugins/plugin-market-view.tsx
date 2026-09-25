/**
 * 插件市场展示层：搜索 + 来源管理（GitHub 仓库）+ 条目列表/详情 +
 * 一键安装（带信任确认）。
 *
 * 纯 props + 本地 UI 状态；容器 `PluginMarketPanel` 负责数据接线。
 * 插件以网关权限运行（无沙箱），安装前必须显式确认来源。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import type {
  PluginMarketDetail,
  PluginMarketEntry,
  PluginMarketSource,
} from '@openAwork/web-client';

export interface PluginMarketViewProps {
  sources: PluginMarketSource[];
  entries: PluginMarketEntry[];
  failedSources: Array<{ readonly sourceId: string; readonly error: string }>;
  loading: boolean;
  error: string | null;
  busy: boolean;
  statusMessage: string | null;
  detail: PluginMarketDetail | null;
  detailLoading: boolean;
  onRefresh: (query?: string) => void;
  onOpenEntry: (entry: PluginMarketEntry) => void;
  onCloseDetail: () => void;
  onInstall: (entry: PluginMarketEntry) => void;
  onAddSource: (repo: string, ref?: string) => Promise<boolean>;
  onRemoveSource: (sourceId: string) => void;
}

const styles = `
[data-plugin-market] .pkm-btn {
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
[data-plugin-market] .pkm-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-emphasis);
  color: var(--fg-strong);
}
[data-plugin-market] .pkm-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
[data-plugin-market] .pkm-btn-primary {
  background: var(--accent);
  border-color: var(--accent-border);
  color: var(--fg-on-accent);
}
[data-plugin-market] .pkm-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-border);
  color: var(--fg-on-accent);
}
[data-plugin-market] .pkm-btn-danger {
  color: var(--danger);
}
[data-plugin-market] .pkm-btn-danger:hover:not(:disabled) {
  background: var(--danger-muted);
  border-color: var(--danger-border);
  color: var(--danger);
}
[data-plugin-market] .pkm-input:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-subtle);
  outline: none;
}
[data-plugin-market] :where(button, input):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
`;

const buttonStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
  height: 28,
  padding: '0 10px',
} as const;

const inputStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  color: 'var(--fg-strong)',
  fontSize: 12,
  height: 36,
  minWidth: 0,
  padding: '0 12px',
} as const;

function badgeStyle(tone: 'neutral' | 'accent' | 'warning'): {
  background: string;
  border: string;
  color: string;
} {
  if (tone === 'accent') {
    return {
      background: 'var(--accent-muted)',
      border: 'var(--accent-border)',
      color: 'var(--accent)',
    };
  }
  if (tone === 'warning') {
    return {
      background: 'var(--contrast-muted)',
      border: 'var(--contrast-border)',
      color: 'var(--contrast)',
    };
  }
  return {
    background: 'var(--bg-elevated)',
    border: 'var(--border-default)',
    color: 'var(--fg-muted)',
  };
}

function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'accent' | 'warning';
  children: React.ReactNode;
}): ReactElement {
  const palette = badgeStyle(tone);
  return (
    <span
      style={{
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: 9999,
        color: palette.color,
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 8px',
      }}
    >
      {children}
    </span>
  );
}

function SourcesPanel({
  sources,
  busy,
  onAddSource,
  onRemoveSource,
}: {
  sources: PluginMarketSource[];
  busy: boolean;
  onAddSource: (repo: string, ref?: string) => Promise<boolean>;
  onRemoveSource: (sourceId: string) => void;
}): ReactElement {
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');

  return (
    <div
      data-pkm-sources="true"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        display: 'grid',
        gap: 10,
        padding: 12,
      }}
    >
      <div style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 600 }}>
        市场来源（GitHub 仓库）
      </div>

      {sources.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
          还没有来源。添加一个包含 <code>openawork-plugins.json</code> 的 GitHub 仓库
          （或直接是一个插件仓库），即可在此浏览与安装。
        </div>
      ) : (
        <ul style={{ display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
          {sources.map((source) => (
            <li
              key={source.id}
              data-pkm-source={source.id}
              style={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: 'var(--fg-strong)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {source.repo}
              </span>
              {source.ref ? <Badge tone="neutral">{source.ref}</Badge> : null}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="pkm-btn pkm-btn-danger"
                disabled={busy}
                onClick={() => onRemoveSource(source.id)}
                style={buttonStyle}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        action={(formData) => {
          const target = String(formData.get('repo') ?? '').trim();
          const targetRef = String(formData.get('ref') ?? '').trim();
          if (target.length === 0) return;
          void onAddSource(target, targetRef.length === 0 ? undefined : targetRef).then((ok) => {
            if (ok) {
              setRepo('');
              setRef('');
            }
          });
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
      >
        <input
          className="pkm-input"
          name="repo"
          type="text"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          placeholder="owner/repo 或 owner/repo@ref"
          aria-label="插件源仓库"
          style={{ ...inputStyle, flex: '1 1 220px' }}
        />
        <input
          className="pkm-input"
          name="ref"
          type="text"
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder="分支 / tag（可选）"
          aria-label="插件源分支"
          style={{ ...inputStyle, flex: '0 1 140px' }}
        />
        <button
          type="submit"
          className="pkm-btn pkm-btn-primary"
          disabled={busy || repo.trim().length === 0}
          style={{ ...buttonStyle, fontSize: 12, height: 36, padding: '0 16px' }}
        >
          添加来源
        </button>
      </form>
    </div>
  );
}

function MarketEntryRow({
  entry,
  busy,
  confirming,
  onOpen,
  onStartConfirm,
  onCancelConfirm,
  onConfirmInstall,
}: {
  entry: PluginMarketEntry;
  busy: boolean;
  confirming: boolean;
  onOpen: () => void;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmInstall: () => void;
}): ReactElement {
  return (
    <li
      data-pkm-entry={entry.id}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        display: 'grid',
        gap: 6,
        padding: '10px 12px',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
        <span style={{ color: 'var(--fg-strong)', fontSize: 13, fontWeight: 600 }}>
          {entry.name}
        </span>
        {entry.version ? <Badge tone="accent">v{entry.version}</Badge> : null}
        <Badge tone="neutral">{entry.sourceName}</Badge>
        {entry.fallback ? <Badge tone="warning">根目录单插件</Badge> : null}
        <span style={{ flex: 1 }} />
        {confirming ? (
          <>
            <button
              type="button"
              className="pkm-btn pkm-btn-primary"
              disabled={busy}
              onClick={onConfirmInstall}
              style={{ ...buttonStyle, fontSize: 12, height: 30 }}
            >
              确认安装
            </button>
            <button
              type="button"
              className="pkm-btn"
              disabled={busy}
              onClick={onCancelConfirm}
              style={buttonStyle}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button type="button" className="pkm-btn" onClick={onOpen} style={buttonStyle}>
              详情
            </button>
            <button
              type="button"
              className="pkm-btn pkm-btn-primary"
              disabled={busy}
              onClick={onStartConfirm}
              style={{ ...buttonStyle, fontSize: 12, height: 30 }}
            >
              安装
            </button>
          </>
        )}
      </div>

      {entry.description ? (
        <div
          style={{
            color: 'var(--fg-muted)',
            fontSize: 12,
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
          }}
        >
          {entry.description}
        </div>
      ) : null}

      {confirming ? (
        <div
          data-pkm-confirm="true"
          role="alert"
          style={{
            color: 'var(--contrast)',
            fontSize: 11,
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
          }}
        >
          插件将以网关权限执行任意代码（无沙箱）。来源：{entry.repo}
          {entry.ref ? `@${entry.ref}` : ''}
          {entry.path ? ` · 路径 ${entry.path}` : ''}。确认安装？
        </div>
      ) : (
        <div
          data-pkm-repo="true"
          style={{
            color: 'var(--fg-subtle)',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.repo}
          {entry.path ? ` · ${entry.path}` : ''}
        </div>
      )}
    </li>
  );
}

function DetailCard({
  detail,
  busy,
  onClose,
  onInstall,
}: {
  detail: PluginMarketDetail;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
}): ReactElement {
  return (
    <div
      data-pkm-detail="true"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        display: 'grid',
        gap: 10,
        padding: 12,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ color: 'var(--fg-strong)', fontSize: 14, fontWeight: 700 }}>
          {detail.entry.name}
        </span>
        {detail.entry.version ? <Badge tone="accent">v{detail.entry.version}</Badge> : null}
        {detail.entry.author ? <Badge tone="neutral">{detail.entry.author}</Badge> : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="pkm-btn pkm-btn-primary"
          disabled={busy}
          onClick={onInstall}
          style={{ ...buttonStyle, fontSize: 12, height: 30 }}
        >
          安装
        </button>
        <button type="button" className="pkm-btn" onClick={onClose} style={buttonStyle}>
          关闭
        </button>
      </div>

      {detail.entry.description ? (
        <div
          style={{
            color: 'var(--fg-muted)',
            fontSize: 12,
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
          }}
        >
          {detail.entry.description}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, minWidth: 0 }}>
        <a
          href={detail.repoUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--aux)', fontSize: 11, overflowWrap: 'anywhere' }}
        >
          {detail.repoUrl}
        </a>
        {detail.entry.path ? (
          <span style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>路径：{detail.entry.path}</span>
        ) : null}
      </div>

      {detail.readme ? (
        <pre
          data-pkm-readme="true"
          style={{
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            color: 'var(--fg-default)',
            fontSize: 11,
            lineHeight: 1.6,
            margin: 0,
            maxHeight: 260,
            overflow: 'auto',
            padding: 10,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {detail.readme}
        </pre>
      ) : (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 11 }}>（仓库未提供 README）</div>
      )}
    </div>
  );
}

export function PluginMarketView({
  sources,
  entries,
  failedSources,
  loading,
  error,
  busy,
  statusMessage,
  detail,
  detailLoading,
  onRefresh,
  onOpenEntry,
  onCloseDetail,
  onInstall,
  onAddSource,
  onRemoveSource,
}: PluginMarketViewProps): ReactElement {
  const [query, setQuery] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [confirmingEntryId, setConfirmingEntryId] = useState<string | null>(null);

  return (
    <div
      data-plugin-market="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}
    >
      <style>{styles}</style>

      <p style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        从 GitHub 源浏览并一键安装插件（zipball 下载 → 校验落位 → 热重载激活）。
        插件与网关同进程运行、没有沙箱——安装前请确认来源可信。
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          className="pkm-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索插件名称 / 描述 / 仓库"
          aria-label="搜索插件市场"
          style={{ ...inputStyle, flex: '1 1 220px' }}
        />
        <button
          type="button"
          className="pkm-btn"
          onClick={() => onRefresh(query)}
          style={{ ...buttonStyle, height: 36, padding: '0 14px' }}
        >
          搜索
        </button>
        <button
          type="button"
          className="pkm-btn"
          onClick={() => setSourcesOpen((open) => !open)}
          style={{ ...buttonStyle, height: 36, padding: '0 14px' }}
        >
          来源（{sources.length}）
        </button>
      </div>

      {statusMessage ? (
        <div role="status" style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
          {statusMessage}
        </div>
      ) : null}

      {failedSources.length > 0 ? (
        <div
          role="alert"
          style={{
            background: 'var(--contrast-muted)',
            border: '1px solid var(--contrast-border)',
            borderRadius: 8,
            color: 'var(--contrast)',
            fontSize: 11,
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
            padding: '8px 10px',
          }}
        >
          {failedSources.map((failure) => (
            <div key={failure.sourceId}>
              来源 {failure.sourceId} 读取失败：{failure.error}
            </div>
          ))}
        </div>
      ) : null}

      {sourcesOpen ? (
        <SourcesPanel
          sources={sources}
          busy={busy}
          onAddSource={onAddSource}
          onRemoveSource={onRemoveSource}
        />
      ) : null}

      {detailLoading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>读取详情…</div>
      ) : detail ? (
        <DetailCard
          detail={detail}
          busy={busy}
          onClose={onCloseDetail}
          onInstall={() => onInstall(detail.entry)}
        />
      ) : null}

      {loading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>加载中…</div>
      ) : error ? (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.5 }}>
            {error}
          </div>
          <button
            type="button"
            className="pkm-btn"
            onClick={() => onRefresh(query)}
            style={buttonStyle}
          >
            重试
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div
          data-pkm-empty="true"
          style={{
            background: 'var(--bg-overlay)',
            border: '1px dashed var(--border-emphasis)',
            borderRadius: 12,
            padding: '32px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ color: 'var(--fg-strong)', fontSize: 14, fontWeight: 600 }}>
            市场里还没有可安装的插件
          </div>
          <p style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.5, margin: '6px 0 0' }}>
            打开「来源」添加一个 GitHub 仓库（含 openawork-plugins.json 清单或本身就是插件），
            或调整搜索关键字。
          </p>
        </div>
      ) : (
        <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
          {entries.map((entry) => (
            <MarketEntryRow
              key={entry.id}
              entry={entry}
              busy={busy}
              confirming={confirmingEntryId === entry.id}
              onOpen={() => onOpenEntry(entry)}
              onStartConfirm={() => setConfirmingEntryId(entry.id)}
              onCancelConfirm={() => setConfirmingEntryId(null)}
              onConfirmInstall={() => {
                setConfirmingEntryId(null);
                onInstall(entry);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
