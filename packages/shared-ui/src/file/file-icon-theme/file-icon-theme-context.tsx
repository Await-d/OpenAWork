import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { FILE_ICON_BASE_PATH } from './material-icon-manifest.js';
import { DEFAULT_FILE_ICON_THEME } from './resolve-file-icon.js';
import type { FileIconThemeContextValue, FileIconThemeId } from './types.js';

const DEFAULT_CONTEXT_VALUE: FileIconThemeContextValue = {
  theme: DEFAULT_FILE_ICON_THEME,
  mode: 'dark',
  basePath: FILE_ICON_BASE_PATH,
};

export const FileIconThemeContext = createContext<FileIconThemeContextValue>(DEFAULT_CONTEXT_VALUE);

export interface FileIconThemeProviderProps {
  theme?: FileIconThemeId;
  mode?: 'dark' | 'light';
  basePath?: string;
  children: ReactNode;
}

export function FileIconThemeProvider({
  theme = DEFAULT_FILE_ICON_THEME,
  mode = 'dark',
  basePath = FILE_ICON_BASE_PATH,
  children,
}: FileIconThemeProviderProps) {
  return <FileIconThemeContext value={{ theme, mode, basePath }}>{children}</FileIconThemeContext>;
}

/** 无 Provider 时返回默认主题，使图标组件可安全独立渲染。 */
export function useFileIconTheme(): FileIconThemeContextValue {
  return useContext(FileIconThemeContext);
}
