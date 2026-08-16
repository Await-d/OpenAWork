import type { ReactElement } from 'react';
import type { InputImageContent } from '@openAwork/shared';

interface HistoryEditAttachmentsProps {
  readonly inputParts: readonly InputImageContent[];
  readonly onRemove: (index: number) => void;
}

export function HistoryEditAttachments({
  inputParts,
  onRemove,
}: HistoryEditAttachmentsProps): ReactElement | null {
  if (inputParts.length === 0) return null;

  return (
    <div className="history-edit-inline-editor__attachments">
      {inputParts.map((part, index) => {
        const label = part.fileName ?? `图片 ${index + 1}`;
        const key = `${part.imageUrl ?? part.artifactId ?? label}-${index}`;

        return (
          <div key={key} className="history-edit-inline-editor__attachment">
            {part.imageUrl ? (
              <img
                src={part.imageUrl}
                alt={label}
                className="history-edit-inline-editor__attachment-preview"
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
