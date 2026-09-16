import { FileTypeIcon, FolderTypeIcon } from '@openAwork/shared-ui';

// 兼容层：文件树/编辑器标签/选择器仍从本模块导入。真实图标解析与降级
// 全部交给 shared-ui 的文件图标主题层（含 material 清单与 minimal 轮廓）。
export function FileIcon({ path, size = 14 }: { path: string; size?: number }) {
  return <FileTypeIcon path={path} size={size} />;
}

export function FolderIcon({
  open = false,
  size = 14,
  name,
}: {
  open?: boolean;
  size?: number;
  name?: string;
}) {
  return <FolderTypeIcon name={name ?? ''} open={open} size={size} />;
}
