export type {
  FileIconThemeId,
  FileIconThemeOption,
  FileIconThemeContextValue,
  MaterialIconManifest,
  MaterialIconManifestLight,
  ResolvedFileIcon,
  ResolvedFolderIcon,
} from './types.js';

export {
  FILE_ICON_BASE_PATH,
  loadMaterialIconManifest,
  useMaterialIconManifest,
} from './material-icon-manifest.js';

export {
  FILE_ICON_THEMES,
  DEFAULT_FILE_ICON_THEME,
  isFileIconThemeId,
  canonicalizeFolderName,
  resolveFileIcon,
  resolveFolderIcon,
} from './resolve-file-icon.js';

export {
  FileIconThemeContext,
  FileIconThemeProvider,
  useFileIconTheme,
} from './file-icon-theme-context.js';
export type { FileIconThemeProviderProps } from './file-icon-theme-context.js';

export { FileTypeIcon, FolderTypeIcon } from './file-type-icon.js';
export type { FileTypeIconProps, FolderTypeIconProps } from './file-type-icon.js';
