/**
 * 文件树图标：按扩展名/文件名/目录名解析真实图标。
 *
 * 图标颜色全部由资产自带或 CSS 变量提供，组件本身不写死任何色值。
 * 清单未就绪、加载失败或图片 404 时统一降级为通用轮廓，避免抛出错误
 * 或出现裂图。
 */

import { useEffect, useState } from 'react';
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
  const [failed, setFailed] = useState(false);

  const iconId = manifest ? resolveFileIcon({ name, manifest, mode }).iconId : null;
  const iconKey = iconId === null ? null : `${basePath}:${iconId}`;

  // 解析结果或 basePath 变化意味着换了一张图：清掉上一次的 404 记忆。
  // 否则组件实例被复用（同一行换了文件名）时会永久停在通用轮廓，直到 remount。
  useEffect(() => {
    setFailed(false);
  }, [iconKey]);

  if (failed || iconId === null) {
    return <GenericFileGlyph size={size} className={className} />;
  }

  return (
    <img
      src={`${basePath}/${iconId}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setFailed(true)}
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
  const [failed, setFailed] = useState(false);

  const resolved = manifest ? resolveFolderIcon({ name, isRoot, manifest, mode }) : null;
  const iconId = resolved ? (open ? resolved.openIconId : resolved.iconId) : null;
  const iconKey = iconId === null ? null : `${basePath}:${iconId}`;

  // 同 MaterialFileIcon：展开态切换或解析结果变化时允许重新尝试加载。
  useEffect(() => {
    setFailed(false);
  }, [iconKey]);

  if (failed || iconId === null) {
    return <GenericFolderGlyph size={size} open={open} className={className} />;
  }

  return (
    <img
      src={`${basePath}/${iconId}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setFailed(true)}
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
