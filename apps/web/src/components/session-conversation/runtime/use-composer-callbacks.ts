import { useCallback } from 'react';
import type { SlashCommandItem, MentionItem, ComposerMenuState } from './support.js';
import { sanitizeComposerPlainText, detectComposerTrigger } from './support.js';

export interface ComposerCallbacksOptions {
  composerMenu: ComposerMenuState | null;
  setComposerMenu: (
    value:
      | ComposerMenuState
      | null
      | ((prev: ComposerMenuState | null) => ComposerMenuState | null),
  ) => void;
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  slashCommandItems: SlashCommandItem[];
  mentionItems: MentionItem[];
  stopCapability: string;
  streaming: boolean;
  canStopCurrentSessionStream: boolean;
  remoteSessionBusyState: unknown;
  stopActiveMessage: () => void;
  enqueueComposerMessage: () => void;
  sendMessage: () => Promise<boolean>;
  appendFiles: (files: File[]) => void;
}

export interface ComposerCallbacksReturn {
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleInputSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  replaceComposerToken: (start: number, end: number, replacement: string) => void;
  applyComposerSelection: (item: SlashCommandItem | MentionItem) => Promise<void>;
  updateComposerMenu: (value: string, caret: number) => void;
}

export function useComposerCallbacks(opts: ComposerCallbacksOptions): ComposerCallbacksReturn {
  const {
    composerMenu,
    setComposerMenu,
    input,
    setInput,
    textareaRef,
    slashCommandItems,
    mentionItems,
    stopCapability,
    streaming,
    canStopCurrentSessionStream,
    remoteSessionBusyState,
    stopActiveMessage,
    enqueueComposerMessage,
    sendMessage,
    appendFiles,
  } = opts;

  function replaceComposerToken(start: number, end: number, replacement: string) {
    const before = input.slice(0, start);
    const after = input.slice(end);
    const nextValue = `${before}${replacement}${after}`;
    setInput(nextValue);
    setComposerMenu(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const nextCaret = before.length + replacement.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function applyComposerSelection(item: SlashCommandItem | MentionItem) {
    if (!composerMenu) return;
    if (item.kind === 'slash') {
      if (item.type === 'insert') {
        replaceComposerToken(composerMenu.start, composerMenu.end, item.insertText ?? '');
        return;
      }
      setComposerMenu(null);
      await item.onSelect();
      return;
    }
    replaceComposerToken(composerMenu.start, composerMenu.end, item.insertText);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (composerMenu) {
      const currentItems = composerMenu.type === 'slash' ? slashCommandItems : mentionItems;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setComposerMenu((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex:
                  currentItems.length === 0 ? 0 : (prev.selectedIndex + 1) % currentItems.length,
              }
            : prev,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setComposerMenu((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex:
                  currentItems.length === 0
                    ? 0
                    : (prev.selectedIndex - 1 + currentItems.length) % currentItems.length,
              }
            : prev,
        );
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && currentItems.length > 0) {
        e.preventDefault();
        const selectedItem = currentItems[composerMenu.selectedIndex] ?? currentItems[0];
        if (selectedItem) void applyComposerSelection(selectedItem);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setComposerMenu(null);
        return;
      }
    }
    if ((stopCapability === 'precise' || stopCapability === 'best_effort') && e.key === 'Escape') {
      e.preventDefault();
      void stopActiveMessage();
      return;
    }
    if (
      (streaming || canStopCurrentSessionStream || remoteSessionBusyState !== null) &&
      e.key === 'Enter' &&
      !e.shiftKey
    ) {
      e.preventDefault();
      enqueueComposerMessage();
      return;
    }
    if (canStopCurrentSessionStream && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = e.target.value;
    setInput(nextValue);
    updateComposerMenu(nextValue, e.target.selectionStart ?? nextValue.length);
  }

  function handleInputSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const target = e.currentTarget;
    updateComposerMenu(target.value, target.selectionStart ?? target.value.length);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file, index) => {
        if (file.name) return file;
        const extension = file.type.split('/')[1] || 'png';
        return new File([file], `pasted-image-${Date.now()}-${index}.${extension}`, {
          type: file.type,
        });
      });

    const pastedText = e.clipboardData.getData('text/plain');
    const sanitizedPastedText = sanitizeComposerPlainText(pastedText);
    const shouldInterceptTextPaste = sanitizedPastedText !== pastedText;

    if (imageFiles.length > 0 || shouldInterceptTextPaste) {
      e.preventDefault();
      if (sanitizedPastedText.length > 0) {
        const target = e.currentTarget;
        const selectionStart = target.selectionStart ?? target.value.length;
        const selectionEnd = target.selectionEnd ?? selectionStart;
        const nextValue =
          target.value.slice(0, selectionStart) +
          sanitizedPastedText +
          target.value.slice(selectionEnd);
        const nextCaret = selectionStart + sanitizedPastedText.length;
        setInput(nextValue);
        updateComposerMenu(nextValue, nextCaret);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
        });
      }
      if (imageFiles.length > 0) appendFiles(imageFiles);
      return;
    }
  }

  function updateComposerMenu(value: string, caret: number) {
    const trigger = detectComposerTrigger(value, caret);
    if (!trigger) {
      setComposerMenu(null);
      return;
    }
    setComposerMenu((prev) => {
      if (
        !prev ||
        prev.type !== trigger.type ||
        prev.start !== trigger.start ||
        prev.end !== trigger.end
      ) {
        return { ...trigger, selectedIndex: 0 };
      }
      return { ...trigger, selectedIndex: prev.selectedIndex };
    });
  }

  return {
    handleKeyDown,
    handleInputChange,
    handleInputSelect,
    handlePaste,
    replaceComposerToken,
    applyComposerSelection,
    updateComposerMenu,
  };
}
