/**
 * 文件/目录图标解析——纯函数，不依赖 React 或 DOM，便于独立测试与复用。
 *
 * 匹配语义对齐 VS Code：文件名精确命中优先于扩展名，复合扩展名按最长优先，
 * 亮色清单覆盖优先于主表，未知项回退到清单内的通用图标。
 */

import type {
  FileIconThemeId,
  FileIconThemeOption,
  MaterialIconManifest,
  MaterialIconManifestLight,
  ResolvedFileIcon,
  ResolvedFolderIcon,
} from './types.js';

export const FILE_ICON_THEMES: readonly FileIconThemeOption[] = [
  {
    id: 'material',
    label: 'Material 图标',
    description: '按扩展名/文件名/目录名匹配真实图标',
  },
  {
    id: 'minimal',
    label: '极简线条',
    description: '仅用主题色绘制统一的文件/目录轮廓',
  },
];

export const DEFAULT_FILE_ICON_THEME: FileIconThemeId = 'material';

export function isFileIconThemeId(value: unknown): value is FileIconThemeId {
  return value === 'material' || value === 'minimal';
}

export function canonicalizeFolderName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 由完整文件名构造扩展名候选，最长优先：
 * `foo.bar.ts` → `['bar.ts', 'ts']`。
 */
function extensionCandidates(lowerName: string): string[] {
  const parts = lowerName.split('.');
  const candidates: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('.');
    if (candidate.length > 0) candidates.push(candidate);
  }
  return candidates;
}

function lookupFileName(
  name: string,
  manifest: MaterialIconManifest,
  light: MaterialIconManifestLight | undefined,
): string | undefined {
  const exact = light?.fileNames?.[name] ?? manifest.fileNames[name];
  if (exact) return exact;
  const lowerName = name.toLowerCase();
  if (lowerName === name) return undefined;
  return light?.fileNames?.[lowerName] ?? manifest.fileNames[lowerName];
}

export function resolveFileIcon(input: {
  name: string;
  path?: string;
  manifest: MaterialIconManifest;
  mode?: 'dark' | 'light';
}): ResolvedFileIcon {
  const { name, manifest, mode = 'dark' } = input;
  const light = mode === 'light' ? manifest.light : undefined;

  const byFileName = lookupFileName(name, manifest, light);
  if (byFileName) return { kind: 'material', iconId: byFileName };

  for (const candidate of extensionCandidates(name.toLowerCase())) {
    const byExtension = light?.fileExtensions?.[candidate] ?? manifest.fileExtensions[candidate];
    if (byExtension) return { kind: 'material', iconId: byExtension };
  }

  return { kind: 'material', iconId: manifest.file };
}

export function resolveFolderIcon(input: {
  name: string;
  open?: boolean;
  isRoot?: boolean;
  manifest: MaterialIconManifest;
  mode?: 'dark' | 'light';
}): ResolvedFolderIcon {
  const { name, isRoot = false, manifest, mode = 'dark' } = input;
  const key = canonicalizeFolderName(name);
  const light = mode === 'light' ? manifest.light : undefined;

  const matchedIcon = light?.folderNames?.[key] ?? manifest.folderNames[key];
  const matchedOpenIcon = light?.folderNamesExpanded?.[key] ?? manifest.folderNamesExpanded[key];

  const defaultIcon = isRoot ? manifest.rootFolder : manifest.folder;
  const defaultOpenIcon = isRoot ? manifest.rootFolderExpanded : manifest.folderExpanded;

  return {
    kind: 'material',
    iconId: matchedIcon ?? defaultIcon,
    openIconId: matchedOpenIcon ?? defaultOpenIcon,
  };
}
