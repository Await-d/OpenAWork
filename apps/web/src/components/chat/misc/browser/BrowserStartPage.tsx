/**
 * 内置浏览器开始页（新标签页）：搜索 / 地址输入 + 快速打开入口。
 *
 * 新标签的地址是占位页 `about:blank`，内容区本身没有可渲染的文档。以前直接落到
 * iframe / 原生 webview 上就是一块白板；这里用一个纯 React 的开始页顶替它，
 * 给用户一个明确的「下一步做什么」——输入网址、打开上次访问的页面或书签。
 *
 * 组件只消费 props（不碰 tabs / storage）：宿主仍持有唯一的状态，开始页的导航
 * 一律走宿主既有的 `onNavigate`，与地址栏保持同一套规范化逻辑。
 */

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Bookmark } from './browser-storage.js';
import { NAVIGABLE_URL_PATTERN } from './browser-url.js';
import {
  bookmarksToQuickLinks,
  compactLinkUrl,
  dedupeQuickLinks,
  toQuickLink,
  type BrowserQuickLink,
} from './browser-start-page.js';
import './BrowserStartPage.css';

/**
 * 两种宿主语境：
 * - `browse`：内置浏览器的新标签页，输入框同时承担搜索；
 * - `preview`：预览宿主还没有地址时的开始页，输入框只接受预览地址
 *   （宿主用 `normalizeBrowserPreviewInput` 补 scheme，搜索词会被当成主机名）。
 */
export type BrowserStartPageMode = 'browse' | 'preview';

export interface BrowserStartPageProps {
  /** 输入框 / 快捷入口的统一出口。 */
  readonly onNavigate: (value: string) => void;
  readonly bookmarks: readonly Bookmark[];
  /** 由宿主从标签历史派生的「最近访问」（已去重、已过滤占位页）。 */
  readonly recentLinks: readonly BrowserQuickLink[];
  /** 工作区已探测到的本地预览地址：作为第一个快捷入口。 */
  readonly previewUrl?: string | null;
  /** 缺省 `browse`。 */
  readonly mode?: BrowserStartPageMode;
}

interface StartPageCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly placeholder: string;
  readonly inputLabel: string;
  readonly tip: string;
  readonly empty: string;
}

const START_PAGE_COPY: Record<BrowserStartPageMode, StartPageCopy> = {
  browse: {
    eyebrow: '内置浏览器',
    title: '开始浏览',
    subtitle: '输入网址或搜索关键词，回车即可打开。本地开发服务器（localhost）可直接预览。',
    placeholder: '搜索或输入网址，回车打开',
    inputLabel: '搜索或输入网址',
    tip: '外部站点大多禁止嵌入预览；若页面空白，请用地址栏右侧的「在系统浏览器中打开」。',
    empty: '还没有书签或访问记录。打开页面后点地址栏的星标即可收藏，下次从「快速打开」直达。',
  },
  preview: {
    eyebrow: '浏览器预览',
    title: '开始预览',
    subtitle:
      '输入预览地址（本地 dev server 或线上站点），回车即可打开。也可以让 Agent 启动 dev server 后自动填入。',
    placeholder: '输入预览地址，回车打开',
    inputLabel: '预览地址',
    tip: '外部站点大多禁止嵌入预览；也可以在对话里执行 /open <url>，或让 Agent 启动 dev server 自动填入地址。',
    empty: '还没有书签或访问记录。打开预览后点地址栏的星标即可收藏，下次从「快速打开」直达。',
  },
};

/** 快捷入口卡片的展示名：标题为空时退回紧凑地址。 */
function cardTitle(link: BrowserQuickLink): string {
  const title = link.title.trim();
  return title.length > 0 ? title : compactLinkUrl(link.url, 24);
}

export function BrowserStartPage({
  onNavigate,
  bookmarks,
  recentLinks,
  previewUrl = null,
  mode = 'browse',
}: BrowserStartPageProps) {
  const copy = START_PAGE_COPY[mode];
  const [query, setQuery] = useState('');

  const groups: BrowserQuickLink[][] = [];
  if (previewUrl !== null && NAVIGABLE_URL_PATTERN.test(previewUrl)) {
    groups.push([toQuickLink(previewUrl)]);
  }
  groups.push(bookmarksToQuickLinks(bookmarks), [...recentLinks]);
  const quickLinks = dedupeQuickLinks(groups);

  const trimmedQuery = query.trim();

  const submitQuery = () => {
    if (trimmedQuery.length === 0) return;
    onNavigate(trimmedQuery);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuery();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法组合期间的 Enter 是「确认候选词」，不能当成提交。
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitQuery();
  };

  return (
    <section
      className="browser-start-page"
      data-testid="browser-start-page"
      aria-label="内置浏览器开始页"
    >
      <div className="browser-start-page__inner">
        <header className="browser-start-page__header">
          <span className="browser-start-page__eyebrow">{copy.eyebrow}</span>
          <h2 className="browser-start-page__title">{copy.title}</h2>
          <p className="browser-start-page__subtitle">{copy.subtitle}</p>
        </header>

        <form className="browser-start-page__search" role="search" onSubmit={handleSubmit}>
          <svg
            aria-hidden="true"
            className="browser-start-page__search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={copy.placeholder}
            aria-label={copy.inputLabel}
            autoFocus
            spellCheck={false}
          />
          <button type="submit" disabled={trimmedQuery.length === 0}>
            前往
          </button>
        </form>

        {quickLinks.length > 0 ? (
          <section className="browser-start-page__section" aria-label="快速打开">
            <div className="browser-start-page__section-head">
              <h3 className="browser-start-page__section-title">快速打开</h3>
              <span className="browser-start-page__section-count">{quickLinks.length} 个入口</span>
            </div>
            <div className="browser-start-page__grid">
              {quickLinks.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  className="browser-start-page__card"
                  title={link.url}
                  onClick={() => onNavigate(link.url)}
                >
                  {link.faviconUrl !== undefined ? (
                    <img
                      className="browser-start-page__card-icon"
                      src={link.faviconUrl}
                      alt=""
                      width={16}
                      height={16}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span aria-hidden="true" className="browser-start-page__card-letter">
                      {cardTitle(link).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="browser-start-page__card-body">
                    <span className="browser-start-page__card-title">{cardTitle(link)}</span>
                    <span className="browser-start-page__card-url">{compactLinkUrl(link.url)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <p className="browser-start-page__empty">{copy.empty}</p>
        )}

        <footer className="browser-start-page__tip">
          <span className="browser-start-page__tip-label">提示</span>
          <span>{copy.tip}</span>
        </footer>
      </div>
    </section>
  );
}
