import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePreview } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import { ImageLightbox } from '../image/image-lightbox.js';
import type { ImageLightboxItem } from '../image/image-lightbox.js';

interface ComposerImagePreviewItemProps {
  readonly item: AttachmentItem;
  readonly file: File;
  readonly onRemove: (id: string) => void;
  /** 把本条目当前可用的 objectURL 登记到上层，供图集查看器复用。 */
  readonly onObjectUrlChange: (id: string, url: string | null) => void;
  readonly onOpen: () => void;
}

/**
 * 单个图片预览。
 *
 * objectURL 的创建与回收都在 effect 内完成：既避免了在 render 期产生副作用，
 * 也让每个条目独占自己的 URL 生命周期（父级列表增删不会误伤其他条目的 URL）；
 * 同时把 URL 登记到上层，使图集查看器与缩略图共用同一份地址。
 */
function ComposerImagePreviewItem({
  item,
  file,
  onRemove,
  onObjectUrlChange,
  onOpen,
}: ComposerImagePreviewItemProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setObjectUrl(nextUrl);
    onObjectUrlChange(item.id, nextUrl);
    return () => {
      onObjectUrlChange(item.id, null);
      URL.revokeObjectURL(nextUrl);
    };
  }, [file, item.id, onObjectUrlChange]);

  if (objectUrl === null) return null;

  return (
    <ImagePreview
      src={objectUrl}
      alt={item.name}
      onOpen={onOpen}
      openLabel={`放大查看图片：${item.name}`}
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
  const [objectUrlById, setObjectUrlById] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const handleObjectUrlChange = useCallback((id: string, url: string | null) => {
    setObjectUrlById((current) => {
      const next = new Map(current);
      if (url === null) next.delete(id);
      else next.set(id, url);
      return next;
    });
  }, []);

  const gallery = useMemo(() => {
    const indexByAttachmentId = new Map<string, number>();
    const items: ImageLightboxItem[] = [];
    for (const { item } of imageAttachments) {
      const src = objectUrlById.get(item.id);
      if (!src) continue;
      indexByAttachmentId.set(item.id, items.length);
      items.push({ src, alt: item.name, fileName: item.name });
    }
    return { items, indexByAttachmentId };
  }, [imageAttachments, objectUrlById]);

  useEffect(() => {
    if (imageAttachments.length === 0) setLightboxIndex(null);
  }, [imageAttachments.length]);

  if (imageAttachments.length === 0) return null;

  return (
    <div className="composer-image-previews">
      {imageAttachments.map(({ item, file }) => (
        <ComposerImagePreviewItem
          key={item.id}
          item={item}
          file={file}
          onRemove={onRemoveAttachment}
          onObjectUrlChange={handleObjectUrlChange}
          onOpen={() => {
            const galleryIndex = gallery.indexByAttachmentId.get(item.id);
            if (galleryIndex !== undefined) setLightboxIndex(galleryIndex);
          }}
        />
      ))}
      <ImageLightbox
        open={lightboxIndex !== null}
        items={gallery.items}
        index={lightboxIndex ?? 0}
        onIndexChange={(next) => setLightboxIndex(next)}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
