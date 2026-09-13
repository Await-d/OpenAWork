import { useEffect, useMemo, useState } from 'react';
import { ImagePreview } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';

interface ComposerImagePreviewItemProps {
  readonly item: AttachmentItem;
  readonly file: File;
  readonly onRemove: (id: string) => void;
}

/**
 * 单个图片预览。
 *
 * objectURL 的创建与回收都在 effect 内完成：既避免了在 render 期产生副作用，
 * 也让每个条目独占自己的 URL 生命周期（父级列表增删不会误伤其他条目的 URL）。
 */
function ComposerImagePreviewItem({ item, file, onRemove }: ComposerImagePreviewItemProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  if (objectUrl === null) return null;

  return (
    <ImagePreview
      src={objectUrl}
      alt={item.name}
      onRemove={() => onRemove(item.id)}
      style={{ marginBottom: 0 }}
    />
  );
}

export interface ComposerImagePreviewsProps {
  readonly attachmentItems: readonly AttachmentItem[];
  /** 附件条目 id 到源文件的映射，由上层统一构建。 */
  readonly attachmentFilesById?: ReadonlyMap<string, File>;
  readonly onRemoveAttachment: (id: string) => void;
}

/** 输入框内的图片附件预览条。非图片附件由 AttachmentBar 呈现。 */
export function ComposerImagePreviews({
  attachmentItems,
  attachmentFilesById,
  onRemoveAttachment,
}: ComposerImagePreviewsProps) {
  const imageAttachments = useMemo(
    () =>
      attachmentItems.flatMap((item) => {
        const file = attachmentFilesById?.get(item.id);
        return item.type === 'image' && file ? [{ item, file }] : [];
      }),
    [attachmentItems, attachmentFilesById],
  );

  if (imageAttachments.length === 0) return null;

  return (
    <div className="composer-image-previews">
      {imageAttachments.map(({ item, file }) => (
        <ComposerImagePreviewItem
          key={item.id}
          item={item}
          file={file}
          onRemove={onRemoveAttachment}
        />
      ))}
    </div>
  );
}
