import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { InputImageContent } from '@openAwork/shared';

interface HistoryEditDialogProps {
  initialText: string;
  inputParts?: InputImageContent[];
  onClose: () => void;
  onContinueCurrent: (text: string, inputParts?: InputImageContent[]) => void;
  onCreateBranch: (text: string, inputParts?: InputImageContent[]) => void;
  onResendCurrent?: (text: string, inputParts?: InputImageContent[]) => void;
  open: boolean;
}

function containsCodeMarkers(text: string): boolean {
  return /```|<file\s+name=|diff --git|^\s*(import|export|function|const|let|class)\s+/m.test(text);
}

export default function HistoryEditDialog({
  initialText,
  inputParts,
  onClose,
  onContinueCurrent,
  onCreateBranch,
  onResendCurrent,
  open,
}: HistoryEditDialogProps) {
  const [draft, setDraft] = useState(initialText);
  const [draftInputParts, setDraftInputParts] = useState<InputImageContent[]>(
    inputParts ?? [],
  );

  useEffect(() => {
    if (!open) return;
    setDraft(initialText);
    setDraftInputParts(inputParts ?? []);
  }, [initialText, inputParts, open]);

  const [dragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const addImageFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    void Promise.all(imageFiles.map(fileToInputImagePart)).then(
      (parts: InputImageContent[]) => {
        setDraftInputParts((prev) => [...prev, ...parts]);
      },
    );
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      addImageFiles(files);
    },
    [addImageFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item?.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const hasCodeMarkers = containsCodeMarkers(draft);

  const effectiveInputParts =
    draftInputParts.length > 0 ? draftInputParts : undefined;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="历史消息编辑方式"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.58)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          width: 'min(560px, 100%)',
          borderRadius: 18,
          border: dragging
            ? '2px dashed var(--accent)'
            : '1px solid var(--border)',
          background: dragging
            ? 'color-mix(in oklch, var(--accent) 6%, var(--surface))'
            : 'var(--surface)',
          boxShadow: 'var(--shadow-xl)',
          padding: '20px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          transition: 'border 0.15s, background 0.15s',
          position: 'relative',
        }}
      >
        {dragging && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--accent)',
              }}
            >
              释放以添加图片
            </span>
          </div>
        )}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>编辑历史消息</div>
          <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'var(--text-2)' }}>
            这是历史消息。你可以编辑后重新发送（截断后续消息），在末尾追加，或从这里新建子会话。
          </div>
        </div>

        {hasCodeMarkers && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid color-mix(in oklch, var(--warning, #f59e0b) 35%, var(--border))',
              background: 'color-mix(in oklch, var(--warning, #f59e0b) 12%, transparent)',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--text)',
            }}
          >
            检测到这条历史消息带有代码标识。为了避免后续上下文污染，建议从这里新建会话继续。
          </div>
        )}

        {draftInputParts.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              padding: '8px 0 0',
            }}
          >
            {draftInputParts.map((part, index) => {
              const label = part.fileName ?? `图片 ${index + 1}`;
              const src = part.imageUrl;
              return (
                <div
                  key={`${src ?? part.artifactId ?? 'img'}-${index}`}
                  style={{ display: 'grid', gap: 4, width: 100, position: 'relative' }}
                >
                  {src ? (
                    <img
                      src={src}
                      alt={label}
                      style={{
                        width: '100%',
                        maxHeight: 80,
                        objectFit: 'cover',
                        borderRadius: 8,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--surface)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        minHeight: 60,
                        borderRadius: 8,
                        border: '1px dashed var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-3)',
                        fontSize: 10,
                        background: 'var(--surface)',
                      }}
                    >
                      图片已附加
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`移除 ${label}`}
                    onClick={() =>
                      setDraftInputParts((prev) => prev.filter((_, i) => i !== index))
                    }
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text-2)',
                      cursor: 'pointer',
                      fontSize: 12,
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
          data-testid="history-edit-dialog-textarea"
          style={{
            width: '100%',
            minHeight: 180,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-2)',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text)',
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            style={secondaryButtonStyle}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onContinueCurrent(draft, effectiveInputParts)}
            style={secondaryButtonStyle}
          >
            追加到末尾
          </button>
          <button
            type="button"
            onClick={() => onCreateBranch(draft, effectiveInputParts)}
            style={secondaryButtonStyle}
          >
            从这里新建会话
          </button>
          {onResendCurrent && (
            <button
              type="button"
              onClick={() => onResendCurrent(draft, effectiveInputParts)}
              style={primaryButtonStyle}
            >
              编辑并重新发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-2)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const primaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: '0 14px',
  borderRadius: 10,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

function fileToInputImagePart(file: File): Promise<InputImageContent> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        type: 'input_image',
        imageUrl: reader.result as string,
        fileName: file.name,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  });
}
