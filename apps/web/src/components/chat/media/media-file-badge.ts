/**
 * 文件类型徽章解算（纯函数，无 React 依赖，便于单测）。
 *
 * 背景：消息里的文件引用只有 `fileName` 与 `artifactId` —— 上游把非图片附件压平成
 * `- <name> (artifact:<id>)` 一行文本（见 `attachment-upload.ts:130-136`），
 * **既没有 MIME 也没有大小**。因此类型只能按扩展名推断，这与仓库既有口径一致：
 * `packages/shared-ui/src/file/file-icon-theme/resolve-file-icon.ts` 同样按扩展名匹配
 * （其注释明确写了「按扩展名，不基于 MIME」）。
 *
 * 徽章只管「显示成什么」，不参与交互与取数。
 */

export type FileBadgeTone =
  'pdf' | 'sheet' | 'doc' | 'archive' | 'code' | 'image' | 'audio' | 'video' | 'text' | 'other';

export interface FileBadge {
  /** 徽章上的短标签，1–4 个字符。 */
  readonly label: string;
  readonly tone: FileBadgeTone;
  /** 无障碍用的类型描述，例如「PDF 文档」。 */
  readonly description: string;
}

const TONE_BY_EXTENSION: Readonly<Record<string, FileBadgeTone>> = {
  pdf: 'pdf',
  xls: 'sheet',
  xlsx: 'sheet',
  xlsm: 'sheet',
  csv: 'sheet',
  ods: 'sheet',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  json: 'code',
  py: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  rb: 'code',
  php: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  cs: 'code',
  swift: 'code',
  sh: 'code',
  sql: 'code',
  yml: 'code',
  yaml: 'code',
  toml: 'code',
  xml: 'code',
  html: 'code',
  css: 'code',
  vue: 'code',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  flac: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  txt: 'text',
  log: 'text',
  md: 'text',
};

const DESCRIPTION_BY_TONE: Readonly<Record<FileBadgeTone, string>> = {
  pdf: 'PDF 文档',
  sheet: '表格',
  doc: '文档',
  archive: '压缩包',
  code: '代码文件',
  image: '图片',
  audio: '音频',
  video: '视频',
  text: '文本文件',
  other: '文件',
};

/**
 * 按文件名解算徽章。
 *
 * 防御约定：`fileName` 可以是空串、只有扩展名（`.gitignore`）、或多段扩展名
 * （`archive.tar.gz` → 取最后一段 `gz`）—— 后者与「按最后一段扩展名匹配」的既有口径一致，
 * 不做双扩展名特判。
 */
export function resolveFileBadge(fileName: string): FileBadge {
  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  // `lastDot <= 0` 同时覆盖「无扩展名」与「以点开头的隐藏文件」（如 `.gitignore`）。
  const extension =
    lastDot > 0 && lastDot < normalized.length - 1 ? normalized.slice(lastDot + 1) : '';
  const tone = TONE_BY_EXTENSION[extension] ?? 'other';

  return {
    label: extension ? extension.slice(0, 4).toUpperCase() : 'FILE',
    tone,
    description: DESCRIPTION_BY_TONE[tone],
  };
}
