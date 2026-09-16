/**
 * 文件图标主题模块的类型契约。
 *
 * 清单形状与静态资产端点（`/file-icons/manifest.json`）冻结契约一一对应，
 * 全部字段只读——清单由资产端点提供，前端不得就地改写。
 *
 * 所有关联表的值都是「图标文件名（不含 `.svg`）」，拼 `${basePath}/<值>.svg` 即可取到图标；
 * 该不变量由资产端点的构建管线保证（值从上游 iconDefinitions 反推，而非假定 id 即文件名）。
 */

export type FileIconThemeId = 'material' | 'minimal';

export interface FileIconThemeOption {
  readonly id: FileIconThemeId;
  readonly label: string;
  readonly description: string;
}

/** 亮色模式下的图标覆盖表；各子键均可选，缺省时回退到暗色主表。 */
export interface MaterialIconManifestLight {
  readonly fileExtensions?: Readonly<Record<string, string>>;
  readonly fileNames?: Readonly<Record<string, string>>;
  readonly folderNames?: Readonly<Record<string, string>>;
  readonly folderNamesExpanded?: Readonly<Record<string, string>>;
}

export interface MaterialIconManifest {
  readonly file: string;
  readonly folder: string;
  readonly folderExpanded: string;
  readonly rootFolder: string;
  readonly rootFolderExpanded: string;
  /** key = 小写扩展名（可能是复合扩展名，如 "html_vm"）。 */
  readonly fileExtensions: Readonly<Record<string, string>>;
  /** key = 原始文件名（如 "package.json"、".pug-lintrc.js"）。 */
  readonly fileNames: Readonly<Record<string, string>>;
  /** key = 规范化目录名（小写且已去除非字母数字）。 */
  readonly folderNames: Readonly<Record<string, string>>;
  readonly folderNamesExpanded: Readonly<Record<string, string>>;
  readonly light?: MaterialIconManifestLight;
}

export interface FileIconThemeContextValue {
  readonly theme: FileIconThemeId;
  readonly mode: 'dark' | 'light';
  readonly basePath: string;
}

export interface ResolvedFileIcon {
  readonly kind: 'material';
  readonly iconId: string;
}

export interface ResolvedFolderIcon {
  readonly kind: 'material';
  readonly iconId: string;
  readonly openIconId: string;
}
