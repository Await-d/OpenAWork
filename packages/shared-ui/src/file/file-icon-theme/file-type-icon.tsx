/**
 * 文件树图标：按扩展名/文件名/目录名解析真实图标。
 *
 * 图标颜色全部由资产自带或 CSS 变量提供，组件本身不写死任何色值。
 * 清单未就绪、加载失败或图片 404 时统一降级为通用轮廓，避免抛出错误
 * 或出现裂图。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';

import { useFileIconTheme } from './file-icon-theme-context.js';
import { useMaterialIconManifest } from './material-icon-manifest.js';
import { resolveFileIcon, resolveFolderIcon } from './resolve-file-icon.js';

const ICON_STYLE: CSSProperties = { flexShrink: 0 };

function GenericFileGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--fg-muted)"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={ICON_STYLE}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function GenericFolderGlyph({
  size,
  open,
  className,
}: {
  size: number;
  open: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={open ? 'var(--accent-muted)' : 'none'}
      stroke="var(--accent)"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={ICON_STYLE}
    >
      <path d="M4 6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l.9 1.2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function MaterialFileIcon({
  name,
  size,
  className,
  basePath,
  mode,
}: {
  name: string;
  size: number;
  className?: string;
  basePath: string;
  mode: 'dark' | 'light';
}) {
  const manifest = useMaterialIconManifest(basePath);
  // 记录「哪一张图」加载失败，而不是一个布尔量：布尔量必须靠 effect 在换图时复位，
  // 而 passive effect 在提交之后才异步落地——图片若在复位之前报错，复位会把失败状态
  // 覆盖回成功，img 便一直停在裂图态（jsdom 等无网络环境不会再来第二次 error）。
  // 按 iconSrc 记账后换图天然免复位：key 变了就不再等于上次失败的那个 key。
  const [failedIconSrc, setFailedIconSrc] = useState<string | null>(null);

  const iconId = manifest ? resolveFileIcon({ name, manifest, mode }).iconId : null;
  const iconSrc = iconId === null ? null : `${basePath}/${iconId}.svg`;
  const failed = iconSrc !== null && failedIconSrc === iconSrc;

  if (iconSrc === null || failed) {
    return <GenericFileGlyph size={size} className={className} />;
  }

  return (
    <img
      src={iconSrc}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setFailedIconSrc(iconSrc)}
      className={className}
      style={ICON_STYLE}
    />
  );
}

function MaterialFolderIcon({
  name,
  open,
  isRoot,
  size,
  className,
}: {
  name: string;
  open: boolean;
  isRoot: boolean;
  size: number;
  className?: string;
}) {
  const { mode, basePath } = useFileIconTheme();
  const manifest = useMaterialIconManifest(basePath);
  const [failedIconSrc, setFailedIconSrc] = useState<string | null>(null);

  const resolved = manifest ? resolveFolderIcon({ name, isRoot, manifest, mode }) : null;
  const iconId = resolved ? (open ? resolved.openIconId : resolved.iconId) : null;
  const iconSrc = iconId === null ? null : `${basePath}/${iconId}.svg`;
  const failed = iconSrc !== null && failedIconSrc === iconSrc;

  if (iconSrc === null || failed) {
    return <GenericFolderGlyph size={size} open={open} className={className} />;
  }

  return (
    <img
      src={iconSrc}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setFailedIconSrc(iconSrc)}
      className={className}
      style={ICON_STYLE}
    />
  );
}

export interface FileTypeIconProps {
  path: string;
  name?: string;
  size?: number;
  className?: string;
}

export function FileTypeIcon({ path, name, size = 16, className }: FileTypeIconProps) {
  const { theme, mode, basePath } = useFileIconTheme();
  const resolvedName = name ?? path.split('/').pop() ?? path;

  if (theme === 'minimal') {
    return <GenericFileGlyph size={size} className={className} />;
  }

  return (
    <MaterialFileIcon
      name={resolvedName}
      size={size}
      className={className}
      basePath={basePath}
      mode={mode}
    />
  );
}

export interface FolderTypeIconProps {
  name?: string;
  open?: boolean;
  size?: number;
  isRoot?: boolean;
  className?: string;
}

export function FolderTypeIcon({
  name = '',
  open = false,
  size = 16,
  isRoot = false,
  className,
}: FolderTypeIconProps) {
  const { theme } = useFileIconTheme();

  if (theme === 'minimal') {
    return <GenericFolderGlyph size={size} open={open} className={className} />;
  }

  return (
    <MaterialFolderIcon name={name} open={open} isRoot={isRoot} size={size} className={className} />
  );
}
