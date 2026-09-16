import { createContext, useContext } from 'react';
import type { ReactElement } from 'react';

import type { FileIconThemeProviderProps } from '../../../../../packages/shared-ui/src/file/file-icon-theme/file-icon-theme-context.js';
import type {
  FileTypeIconProps,
  FolderTypeIconProps,
} from '../../../../../packages/shared-ui/src/file/file-icon-theme/file-type-icon.js';
import { FILE_ICON_BASE_PATH } from '../../../../../packages/shared-ui/src/file/file-icon-theme/material-icon-manifest.js';
import {
  DEFAULT_FILE_ICON_THEME,
  FILE_ICON_THEMES,
  canonicalizeFolderName,
  isFileIconThemeId,
  resolveFileIcon,
  resolveFolderIcon,
} from '../../../../../packages/shared-ui/src/file/file-icon-theme/resolve-file-icon.js';
import type {
  FileIconThemeContextValue,
  FileIconThemeId,
  FileIconThemeOption,
  MaterialIconManifest,
  MaterialIconManifestLight,
  ResolvedFileIcon,
  ResolvedFolderIcon,
} from '../../../../../packages/shared-ui/src/file/file-icon-theme/types.js';

// 文件图标主题的解析函数与类型是一组纯函数/纯常量（无副作用、不依赖 React 或 DOM），
// 没有值得替身的行为，直接转发真实实现，避免 mock 与
// packages/shared-ui/src/file/file-icon-theme 逐渐漂移。
export {
  DEFAULT_FILE_ICON_THEME,
  FILE_ICON_BASE_PATH,
  FILE_ICON_THEMES,
  canonicalizeFolderName,
  isFileIconThemeId,
  resolveFileIcon,
  resolveFolderIcon,
};
export type {
  FileIconThemeContextValue,
  FileIconThemeId,
  FileIconThemeOption,
  FileIconThemeProviderProps,
  FileTypeIconProps,
  FolderTypeIconProps,
  MaterialIconManifest,
  MaterialIconManifestLight,
  ResolvedFileIcon,
  ResolvedFolderIcon,
};

/**
 * 组件与清单加载器保留替身：真实实现依赖 React context 与 fetch 清单网络请求，
 * 测试环境既慢又无法稳定命中。替身只固定一份最小清单来驱动上面转发的真实解析
 * 函数，不复刻匹配逻辑，并保持「按 theme 决定渲染 img 还是内联 svg」的语义。
 */
const MOCK_MATERIAL_ICON_MANIFEST: MaterialIconManifest = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  rootFolder: 'folder',
  rootFolderExpanded: 'folder-open',
  fileExtensions: {},
  fileNames: {},
  folderNames: {},
  folderNamesExpanded: {},
};

const DEFAULT_CONTEXT_VALUE: FileIconThemeContextValue = {
  theme: DEFAULT_FILE_ICON_THEME,
  mode: 'dark',
  basePath: FILE_ICON_BASE_PATH,
};

export const FileIconThemeContext = createContext<FileIconThemeContextValue>(DEFAULT_CONTEXT_VALUE);

export function FileIconThemeProvider({
  theme = DEFAULT_FILE_ICON_THEME,
  mode = 'dark',
  basePath = FILE_ICON_BASE_PATH,
  children,
}: FileIconThemeProviderProps): ReactElement {
  return <FileIconThemeContext value={{ theme, mode, basePath }}>{children}</FileIconThemeContext>;
}

export function useFileIconTheme(): FileIconThemeContextValue {
  return useContext(FileIconThemeContext);
}

export function loadMaterialIconManifest(_basePath?: string): Promise<MaterialIconManifest> {
  return Promise.resolve(MOCK_MATERIAL_ICON_MANIFEST);
}

function GenericFileGlyph({
  path,
  size,
  className,
}: {
  path: string;
  size: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
      data-file-icon-path={path}
    />
  );
}

function GenericFolderGlyph({
  name,
  open,
  size,
  className,
}: {
  name: string;
  open: boolean;
  size: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
      data-folder-icon-name={name}
      data-folder-icon-open={open ? 'true' : 'false'}
    />
  );
}

export function FileTypeIcon({
  path,
  name,
  size = 16,
  className,
}: FileTypeIconProps): ReactElement {
  const { theme, mode, basePath } = useFileIconTheme();

  if (theme === 'minimal') {
    return <GenericFileGlyph path={path} size={size} className={className} />;
  }

  const resolvedName = name ?? path.split('/').pop() ?? path;
  const { iconId } = resolveFileIcon({
    name: resolvedName,
    manifest: MOCK_MATERIAL_ICON_MANIFEST,
    mode,
  });
  return (
    <img
      src={`${basePath}/${iconId}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
      data-file-icon-path={path}
    />
  );
}

export function FolderTypeIcon({
  name = '',
  open = false,
  size = 16,
  isRoot = false,
  className,
}: FolderTypeIconProps): ReactElement {
  const { theme, mode, basePath } = useFileIconTheme();

  if (theme === 'minimal') {
    return <GenericFolderGlyph name={name} open={open} size={size} className={className} />;
  }

  const resolved = resolveFolderIcon({
    name,
    isRoot,
    manifest: MOCK_MATERIAL_ICON_MANIFEST,
    mode,
  });
  const iconId = open ? resolved.openIconId : resolved.iconId;
  return (
    <img
      src={`${basePath}/${iconId}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
      data-folder-icon-name={name}
    />
  );
}
