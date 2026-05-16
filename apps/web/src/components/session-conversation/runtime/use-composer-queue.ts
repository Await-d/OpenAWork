import { useCallback } from 'react';
import { sanitizeComposerPlainText } from './support.js';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { QueuedComposerMessage } from './queued-composer-state.js';
import type { ComposerMenuState } from './support.js';
import {
  persistQueuedComposerFiles,
  deleteQueuedComposerFiles,
} from './queued-composer-file-store.js';

export interface ComposerQueueOptions {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  attachedFiles: File[];
  setAttachedFiles: (value: File[] | ((prev: File[]) => File[])) => void;
  attachmentItems: AttachmentItem[];
  setAttachmentItems: (
    value: AttachmentItem[] | ((prev: AttachmentItem[]) => AttachmentItem[]),
  ) => void;
  queuedComposerMessages: QueuedComposerMessage[];
  setQueuedComposerMessages: (
    value: QueuedComposerMessage[] | ((prev: QueuedComposerMessage[]) => QueuedComposerMessage[]),
  ) => void;
  queuedComposerScope: string | null;
  setComposerMenu: (
    value:
      | ComposerMenuState
      | null
      | ((prev: ComposerMenuState | null) => ComposerMenuState | null),
  ) => void;
  setStreamError: (value: string | null) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export interface ComposerQueueReturn {
  appendFiles: (files: File[]) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeFile: (index: number) => void;
  removeAttachment: (id: string) => void;
  clearComposerDraft: () => void;
  enqueueComposerMessage: () => Promise<boolean>;
  removeQueuedComposerMessage: (messageId: string) => void;
  restoreQueuedComposerMessage: (messageId: string) => void;
}

export function useComposerQueue(opts: ComposerQueueOptions): ComposerQueueReturn {
  const {
    input,
    setInput,
    attachedFiles,
    setAttachedFiles,
    attachmentItems,
    setAttachmentItems,
    queuedComposerMessages,
    setQueuedComposerMessages,
    queuedComposerScope,
    setComposerMenu,
    setStreamError,
    textareaRef,
    fileInputRef,
  } = opts;

  const appendFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setAttachedFiles((prev) => [...prev, ...files]);
      const newItems: AttachmentItem[] = files.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        name: file.name,
        type: file.type.startsWith('image/')
          ? 'image'
          : file.type.startsWith('audio/')
            ? 'audio'
            : 'file',
        sizeBytes: file.size,
      }));
      setAttachmentItems((prev) => [...prev, ...newItems]);
    },
    [setAttachedFiles, setAttachmentItems],
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    appendFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeAttachment(id: string) {
    const idx = attachmentItems.findIndex((a) => a.id === id);
    if (idx !== -1) removeFile(idx);
    setAttachmentItems((prev) => prev.filter((a) => a.id !== id));
  }

  const clearComposerDraft = useCallback(() => {
    setInput('');
    setAttachedFiles([]);
    setAttachmentItems([]);
    setComposerMenu(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [setInput, setAttachedFiles, setAttachmentItems, setComposerMenu, textareaRef]);

  const enqueueComposerMessage = useCallback(async () => {
    const nextText = sanitizeComposerPlainText(input).trim();
    if (nextText.length === 0 && attachedFiles.length === 0) return false;

    const queueItem: QueuedComposerMessage = {
      attachmentItems: attachmentItems.map((item) => ({ ...item })),
      files: [...attachedFiles],
      id: crypto.randomUUID(),
      requiresAttachmentRebind: attachedFiles.length > 0 && !queuedComposerScope,
      text: nextText,
    };
    setQueuedComposerMessages((previous) => [...previous, queueItem]);
    clearComposerDraft();

    if (attachedFiles.length > 0 && queuedComposerScope) {
      const persisted = await persistQueuedComposerFiles({
        attachmentItems: queueItem.attachmentItems,
        files: queueItem.files,
        queueId: queueItem.id,
        scope: queuedComposerScope,
      });
      if (!persisted) {
        setQueuedComposerMessages((previous) =>
          previous.map((item) =>
            item.id === queueItem.id ? { ...item, requiresAttachmentRebind: true } : item,
          ),
        );
      }
    }
    return true;
  }, [
    attachedFiles,
    attachmentItems,
    clearComposerDraft,
    input,
    queuedComposerScope,
    setQueuedComposerMessages,
  ]);

  const removeQueuedComposerMessage = useCallback(
    (messageId: string) => {
      if (queuedComposerScope) {
        void deleteQueuedComposerFiles({ queueId: messageId, scope: queuedComposerScope });
      }
      setQueuedComposerMessages((previous) => previous.filter((item) => item.id !== messageId));
    },
    [queuedComposerScope, setQueuedComposerMessages],
  );

  const restoreQueuedComposerMessage = useCallback(
    (messageId: string) => {
      const queueItem = queuedComposerMessages.find((item) => item.id === messageId);
      if (!queueItem) return;

      if (queuedComposerScope) {
        void deleteQueuedComposerFiles({ queueId: messageId, scope: queuedComposerScope });
      }
      setQueuedComposerMessages((previous) => previous.filter((item) => item.id !== messageId));
      setInput((previous) =>
        previous.trim().length > 0 ? `${queueItem.text}\n\n${previous}` : queueItem.text,
      );
      setAttachedFiles(queueItem.files);
      setAttachmentItems(queueItem.files.length > 0 ? queueItem.attachmentItems : []);
      setComposerMenu(null);
      setStreamError(
        queueItem.requiresAttachmentRebind && queueItem.attachmentItems.length > 0
          ? `已恢复待发文本，原有 ${queueItem.attachmentItems.length} 个附件需要重新选择后再发送。`
          : null,
      );
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [
      queuedComposerMessages,
      queuedComposerScope,
      setInput,
      setAttachedFiles,
      setAttachmentItems,
      setComposerMenu,
      setQueuedComposerMessages,
      setStreamError,
      textareaRef,
    ],
  );

  return {
    appendFiles,
    handleFileChange,
    removeFile,
    removeAttachment,
    clearComposerDraft,
    enqueueComposerMessage,
    removeQueuedComposerMessage,
    restoreQueuedComposerMessage,
  };
}
