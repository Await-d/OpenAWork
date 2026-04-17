// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposerMenuState, SlashCommandItem } from '../../pages/chat-page/support.js';
import { ChatComposer } from './ChatComposer.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function createSlashItems(count: number): SlashCommandItem[] {
  return Array.from({ length: count }, (_, index) => ({
    badgeLabel: '命令',
    description: `第 ${index + 1} 个快捷命令说明`,
    id: `slash-item-${index + 1}`,
    kind: 'slash',
    label: `命令 ${index + 1}`,
    onSelect: async () => undefined,
    source: 'command',
    type: 'insert',
    insertText: `/cmd-${index + 1}`,
  }));
}

const noop = () => undefined;
const noopAsync = async () => undefined;

function ComposerHarness() {
  const [composerMenu, setComposerMenu] = React.useState<ComposerMenuState>({
    end: 1,
    query: '',
    selectedIndex: 0,
    start: 0,
    type: 'slash',
  });
  const slashItems = React.useMemo(() => createSlashItems(8), []);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <ChatComposer
      activeModelSupportsThinking={true}
      activeProviderId="provider-test"
      attachedFiles={[]}
      attachmentItems={[]}
      composerMenu={composerMenu}
      editorMode={false}
      fileInputRef={fileInputRef}
      input="/"
      mentionItems={[]}
      modelPickerRef={React.createRef<HTMLButtonElement>()}
      modelSettingsRef={React.createRef<HTMLButtonElement>()}
      onApplyComposerSelection={noopAsync}
      onComposerHover={(index) => {
        setComposerMenu((previous) =>
          previous ? { ...previous, selectedIndex: index } : previous,
        );
      }}
      onFileChange={noop}
      onInputChange={noop}
      onInputPaste={noop}
      onInputSelect={noop}
      onKeyDown={(event) => {
        if (!composerMenu || slashItems.length === 0) {
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setComposerMenu((previous) =>
            previous
              ? {
                  ...previous,
                  selectedIndex: (previous.selectedIndex + 1) % slashItems.length,
                }
              : previous,
          );
        }
      }}
      onQueueMessage={undefined}
      onRemoveAttachment={noop}
      onRemoveQueuedMessage={noop}
      onRequestFiles={noop}
      onRestoreQueuedMessage={undefined}
      onSend={noopAsync}
      onStop={noopAsync}
      onToggleModelPicker={noop}
      onToggleModelSettings={noop}
      onToggleVoice={noop}
      onToggleWebSearch={noop}
      onVoiceTranscript={noop}
      agentOptions={[]}
      manualAgentId=""
      defaultAgentLabel="默认"
      onChangeManualAgentId={noop}
      onClearManualAgentId={noop}
      queuedMessages={[]}
      sessionBusyState={null}
      showModelPicker={false}
      showModelSettings={false}
      showVoice={false}
      slashCommandItems={slashItems}
      stopCapability="none"
      stoppingStream={false}
      streaming={false}
      textareaRef={textareaRef}
      thinkingEnabled={false}
      variant="home"
      webSearchEnabled={false}
    />
  );
}

describe('ChatComposer', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it('scrolls the selected composer suggestion into view during keyboard navigation', async () => {
    await act(async () => {
      root?.render(<ComposerHarness />);
    });

    const textarea = container?.querySelector('textarea');
    expect(textarea).not.toBeNull();

    const targetButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('命令 6'),
    );
    expect(targetButton).toBeInstanceOf(HTMLButtonElement);

    const scrollIntoViewMock = vi.fn();
    Object.defineProperty(targetButton as HTMLButtonElement, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });

    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        textarea?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
      }
    });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
