import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactElement } from 'react';
import type { InputImageContent } from '@openAwork/shared';
import { HistoryEditAttachments } from './history-edit-attachments.js';
import './history-edit-inline-editor.css';

interface HistoryEditInlineEditorProps {
  readonly initialText: string;
  readonly inputParts?: readonly InputImageContent[];
  readonly onClose: () => void;
  readonly onContinueCurrent: (text: string, inputParts?: InputImageContent[]) => void;
  readonly onCreateBranch?: (text: string, inputParts?: InputImageContent[]) => void;
  readonly onResendCurrent?: (text: string, inputParts?: InputImageContent[]) => void;
  readonly open?: boolean;
}

function containsCodeMarkers(text: string): boolean {
  return /```|<file\s+name=|diff --git|^\s*(import|export|function|const|let|class)\s+/m.test(text);
}

export default function HistoryEditInlineEditor({
  initialText,
  inputParts,
  onClose,
  onContinueCurrent,
  onCreateBranch,
  onResendCurrent,
  open = true,
}: HistoryEditInlineEditorProps): ReactElement | null {
  const [draft, setDraft] = useState(initialText);
  const [draftInputParts, setDraftInputParts] = useState<InputImageContent[]>(() => [
    ...(inputParts ?? []),
  ]);
  const [dragging, setDragging] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const dragCounterRef = useRef(0);
  const moreActionsId = useId();

  useEffect(() => {
    if (!open) return;
    setDraft(initialText);
    setDraftInputParts([...(inputParts ?? [])]);
    setActionsExpanded(false);
  }, [initialText, inputParts, open]);

  const addImageFiles = useCallback((files: readonly File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    void Promise.all(imageFiles.map(fileToInputImagePart)).then((parts) => {
      setDraftInputParts((currentParts) => [...currentParts, ...parts]);
    });
  }, []);

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setDragging(false);
      addImageFiles(Array.from(event.dataTransfer.files));
    },
    [addImageFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      addImageFiles(imageFiles);
    },
    [addImageFiles],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const effectiveInputParts = draftInputParts.length > 0 ? draftInputParts : undefined;
  const canCreateBranch = onCreateBranch !== undefined;

  return (
    <section
      aria-label="编辑历史消息"
      className="history-edit-inline-editor"
      data-dragging={dragging}
      data-testid="history-edit-inline-editor"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="history-edit-inline-editor__header">
        <div>
          <div className="history-edit-inline-editor__title">编辑历史消息</div>
          <p className="history-edit-inline-editor__description">
            编辑并重新发送会从这里重新生成，后续消息将在确认后截断。
          </p>
        </div>
      </header>

      {dragging && <div className="history-edit-inline-editor__drop-hint">释放以添加图片</div>}

      {containsCodeMarkers(draft) && (
        <div className="history-edit-inline-editor__warning">
          {canCreateBranch
            ? '检测到代码内容。为保留现有上下文，建议从这里新建会话继续。'
            : '检测到代码内容。请确认重试会用编辑后的内容替换后续上下文。'}
        </div>
      )}

      <HistoryEditAttachments
        inputParts={draftInputParts}
        onRemove={(index) =>
          setDraftInputParts((parts) => parts.filter((_, itemIndex) => itemIndex !== index))
        }
      />

      <textarea
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        data-testid="history-edit-dialog-textarea"
        className="history-edit-inline-editor__textarea"
      />

      <footer className="history-edit-inline-editor__actions">
        <button type="button" className="history-edit-inline-editor__button" onClick={onClose}>
          取消
        </button>
        <div className="history-edit-inline-editor__action-cluster">
          <button
            type="button"
            aria-controls={moreActionsId}
            aria-expanded={actionsExpanded}
            className="history-edit-inline-editor__button"
            onClick={() => setActionsExpanded((expanded) => !expanded)}
          >
            更多操作
            <ChevronIcon expanded={actionsExpanded} />
          </button>
          {actionsExpanded && (
            <div id={moreActionsId} className="history-edit-inline-editor__overflow">
              <button
                type="button"
                className="history-edit-inline-editor__button"
                onClick={() => onContinueCurrent(draft, effectiveInputParts)}
              >
                追加到末尾
              </button>
              {onCreateBranch && (
                <button
                  type="button"
                  className="history-edit-inline-editor__button"
                  onClick={() => onCreateBranch(draft, effectiveInputParts)}
                >
                  从这里新建会话
                </button>
              )}
            </div>
          )}
        </div>
        {onResendCurrent && (
          <button
            type="button"
            className="history-edit-inline-editor__button history-edit-inline-editor__button--primary"
            onClick={() => onResendCurrent(draft, effectiveInputParts)}
          >
            编辑并重新发送
          </button>
        )}
      </footer>
    </section>
  );
}

function ChevronIcon({ expanded }: { readonly expanded: boolean }): ReactElement {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fileToInputImagePart(file: File): Promise<InputImageContent> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = reader.result;
      resolve({
        type: 'input_image',
        fileName: file.name,
        mimeType: file.type,
        ...(typeof imageUrl === 'string' ? { imageUrl } : {}),
      });
    };
    reader.readAsDataURL(file);
  });
}
