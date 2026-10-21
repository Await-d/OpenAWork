/**
 * 预览宿主「还没有预览地址」时的开始页。
 *
 * 与 `BuiltInBrowser` 内部的开始页共用同一份视觉与交互，区别只在于当前没有浏览器
 * 实例：输入框与快捷入口的出口是宿主的 `onSubmit`（写回当前 workspace 的预览地址），
 * 而不是某个标签的 `navigateActiveTab`。
 *
 * 快捷入口来自宿主没有浏览器实例时也能读到的两份本地数据：
 * - 书签（全应用共享）；
 * - 该 workspace 上一次持久化的标签历史（`loadPersistedState`）。
 * 都只是读，写仍然由宿主与 `BuiltInBrowser` 负责。
 */

import { useMemo } from 'react';
import { BrowserStartPage } from './BrowserStartPage.js';
import { collectRecentLinks } from './browser-start-page.js';
import { loadBookmarks, loadPersistedState } from './browser-storage.js';
import { normalizeBrowserPreviewInput } from './browser-url.js';

export interface BrowserPreviewStartPageProps {
  /** 与 `BuiltInBrowser` 的存储作用域同源，用来读该工作区的历史标签。 */
  readonly workspacePath: string | null | undefined;
  /** 打开预览：接收已补全 scheme 的地址。返回 `null`（空输入）时不会被调用。 */
  readonly onSubmit: (url: string) => void;
}

export function BrowserPreviewStartPage({ workspacePath, onSubmit }: BrowserPreviewStartPageProps) {
  const quickLinks = useMemo(() => {
    const persisted = loadPersistedState(workspacePath);
    return {
      bookmarks: loadBookmarks(),
      recentLinks: persisted !== null ? collectRecentLinks(persisted.tabs) : [],
    };
  }, [workspacePath]);

  const handleNavigate = (value: string) => {
    const nextUrl = normalizeBrowserPreviewInput(value);
    if (nextUrl === null) return;
    onSubmit(nextUrl);
  };

  return (
    <BrowserStartPage
      mode="preview"
      onNavigate={handleNavigate}
      bookmarks={quickLinks.bookmarks}
      recentLinks={quickLinks.recentLinks}
    />
  );
}
