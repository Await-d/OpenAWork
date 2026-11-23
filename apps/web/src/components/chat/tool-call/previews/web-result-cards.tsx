import { formatResultCount, resultToneIndex } from '../shared/result-view.js';
import type { WebResultItem, WebStructuredResults } from '../shared/web-structured-results.js';

/**
 * 把 `extractWebStructuredResults` 的识别结果渲染成结果卡片。
 *
 * 视觉语言对齐现有 tool-call 体系：无重边框、hover 才浮出表面色，字号
 * 11–12px，技术字段（star / fork / 语言）压到一行次要色。
 */
export function WebResultCards({ results }: { results: WebStructuredResults }) {
  const shown = results.items.length;
  const total = results.totalCount;
  const remaining = total !== undefined && total > shown ? total - shown : 0;

  return (
    <div className="tool-call-block-web-results">
      {results.items.map((item, index) => (
        <WebResultCard
          item={item}
          key={`${item.kind}:${item.owner ?? ''}:${item.title}:${index}`}
        />
      ))}
      {remaining > 0 && (
        <div className="tool-call-block-web-results-more">
          接口共命中 {total} 条，此处展示前 {shown} 条
        </div>
      )}
    </div>
  );
}

function WebResultCard({ item }: { item: WebResultItem }) {
  const seed = item.owner ?? item.title;
  const avatarInitial = seed.slice(0, 1).toUpperCase();

  const body = (
    <>
      <span
        className="tool-call-block-web-result-avatar"
        data-tone={resultToneIndex(seed)}
        aria-hidden="true"
      >
        {avatarInitial}
      </span>
      <span className="tool-call-block-web-result-main">
        <span className="tool-call-block-web-result-line">
          {item.owner && (
            <>
              <span className="tool-call-block-web-result-owner">{item.owner}</span>
              <span className="tool-call-block-web-result-slash">/</span>
            </>
          )}
          <span className="tool-call-block-web-result-name">{item.title}</span>
          {item.language && (
            <span className="tool-call-block-web-result-chip">
              <i style={{ background: languageColor(item.language) }} aria-hidden="true" />
              {item.language}
            </span>
          )}
        </span>
        {item.description && (
          <span className="tool-call-block-web-result-desc">{item.description}</span>
        )}
        <ResultStats item={item} />
      </span>
    </>
  );

  // 只有 http/https 链接会被 `asUrl` 放行，这里直接渲染成可点击卡片。
  return item.url ? (
    <a
      className="tool-call-block-web-result"
      href={item.url}
      target="_blank"
      rel="noreferrer noopener"
      title={item.url}
    >
      {body}
    </a>
  ) : (
    <div className="tool-call-block-web-result">{body}</div>
  );
}

/** 统计项图标：每个指标各自对应语义正确的图形，不复用彼此的图标。 */
type StatIconKind = 'star' | 'fork' | 'issue' | 'repo' | 'users';

function ResultStats({ item }: { item: WebResultItem }) {
  const stats: Array<{ key: string; icon: StatIconKind; label?: string; value: string }> = [];

  if (item.stars !== undefined) {
    stats.push({ key: 'stars', icon: 'star', value: formatResultCount(item.stars) });
  }
  if (item.forks !== undefined) {
    stats.push({ key: 'forks', icon: 'fork', value: formatResultCount(item.forks) });
  }
  if (item.issues !== undefined && item.issues > 0) {
    stats.push({ key: 'issues', icon: 'issue', value: String(item.issues) });
  }
  if (item.repositoryCount !== undefined) {
    stats.push({
      key: 'repos',
      icon: 'repo',
      label: '仓库',
      value: formatResultCount(item.repositoryCount),
    });
  }
  if (item.followers !== undefined) {
    stats.push({
      key: 'followers',
      icon: 'users',
      label: '关注者',
      value: formatResultCount(item.followers),
    });
  }

  if (stats.length === 0) return null;

  return (
    <span className="tool-call-block-web-result-stats">
      {stats.map((stat) => (
        <span className="tool-call-block-web-result-stat" key={stat.key}>
          <StatIcon icon={stat.icon} />
          {stat.label && (
            <span className="tool-call-block-web-result-stat-label">{stat.label}</span>
          )}
          {stat.value}
        </span>
      ))}
    </span>
  );
}

function StatIcon({ icon }: { icon: StatIconKind }) {
  if (icon === 'star') {
    return (
      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
        <path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z" />
      </svg>
    );
  }
  if (icon === 'fork') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="18" cy="5" r="2.5" />
        <circle cx="12" cy="19" r="2.5" />
        <path d="M6 7.5v2a4 4 0 004 4h4a4 4 0 004-4v-2" />
      </svg>
    );
  }
  if (icon === 'repo') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 4.5A1.5 1.5 0 016 3h12.5v16H6a1.5 1.5 0 00-1.5 1.5z" />
        <path d="M4.5 4.5v16" />
      </svg>
    );
  }
  if (icon === 'users') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="8" r="3.4" />
        <path d="M2.8 19.4a6.4 6.4 0 0112.4 0" />
        <path d="M16.6 4.9a3.4 3.4 0 010 6.2M17.8 19.4a6.4 6.4 0 00-1.5-4.1" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

/**
 * 语言色点。只维护常见语言，未命中退回中性色——完整色表会变成一份长期负债，
 * 而色点本身只是识别性装饰，不影响信息传达。
 */
const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  python: '#3572a5',
  go: '#00add8',
  rust: '#dea584',
  java: '#b07219',
  'c++': '#f34b7d',
  c: '#8899a6',
  'c#': '#178600',
  ruby: '#701516',
  php: '#4f5d95',
  swift: '#f05138',
  kotlin: '#a97bff',
  shell: '#89e051',
  html: '#e34c26',
  css: '#563d7c',
  vue: '#41b883',
  svelte: '#ff3e00',
  dart: '#00b4ab',
  lua: '#000080',
  zig: '#ec915c',
};

function languageColor(language: string): string {
  return LANGUAGE_COLORS[language.trim().toLowerCase()] ?? 'var(--fg-subtle)';
}
