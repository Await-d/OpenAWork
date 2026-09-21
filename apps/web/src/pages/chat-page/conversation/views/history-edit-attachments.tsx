import { useState } from 'react';
import type { ReactElement } from 'react';
import type { InputImageContent } from '@openAwork/shared';
import { ImageZoomTrigger } from '../../../../components/common/display/ImageZoomTrigger.js';
import { ImageLightbox } from '../../../../components/chat/image/image-lightbox.js';
import type { ImageLightboxItem } from '../../../../components/chat/image/image-lightbox.js';

interface HistoryEditAttachmentsProps {
  readonly inputParts: readonly InputImageContent[];
  readonly onRemove: (index: number) => void;
}

interface ViewableAttachment {
  readonly partIndex: number;
  readonly src: string;
  readonly label: string;
  readonly fileName?: string;
}

export function HistoryEditAttachments({
  inputParts,
  onRemove,
}: HistoryEditAttachmentsProps): ReactElement | null {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const viewable = inputParts.flatMap<ViewableAttachment>((part, index) => {
    const src = part.imageUrl;
    if (!src) return [];
    return [
      {
        partIndex: index,
        src,
        label: part.fileName ?? `图片 ${index + 1}`,
        fileName: part.fileName,
      },
    ];
  });
  const gallery: readonly ImageLightboxItem[] = viewable.map((entry) => ({
    src: entry.src,
    alt: entry.label,
    fileName: entry.fileName,
  }));

  const openAt = (partIndex: number) => {
    const galleryIndex = viewable.findIndex((entry) => entry.partIndex === partIndex);
    if (galleryIndex >= 0) setLightboxIndex(galleryIndex);
  };

  if (inputParts.length === 0) return null;

  return (
    <div className="history-edit-inline-editor__attachments">
      {inputParts.map((part, index) => {
        const label = part.fileName ?? `图片 ${index + 1}`;
        const key = `${part.imageUrl ?? part.artifactId ?? label}-${index}`;

        return (
          <div key={key} className="history-edit-inline-editor__attachment">
            {part.imageUrl ? (
              <ImageZoomTrigger
                src={part.imageUrl}
                alt={label}
                label={`放大查看图片：${label}`}
                imageClassName="history-edit-inline-editor__attachment-preview"
                onOpen={() => openAt(index)}
              />
            ) : (
              <div className="history-edit-inline-editor__attachment-placeholder">图片已附加</div>
            )}
            <button
              type="button"
              aria-label={`移除 ${label}`}
              className="history-edit-inline-editor__attachment-remove"
              onClick={() => onRemove(index)}
            >
              <CloseIcon />
            </button>
            <span className="history-edit-inline-editor__attachment-label">{label}</span>
          </div>
        );
      })}
      <ImageLightbox
        open={lightboxIndex !== null}
        items={gallery}
        index={lightboxIndex ?? 0}
        onIndexChange={(next) => setLightboxIndex(next)}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
