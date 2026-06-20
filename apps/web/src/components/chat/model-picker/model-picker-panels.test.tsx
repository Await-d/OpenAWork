// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ModelSettingsPopover } from './model-picker-panels.js';

vi.mock('@openAwork/shared-ui', () => ({
  describeReasoningEffort: (level: string) => level,
  getSupportedReasoningEffortsForModel: () => ['low', 'medium', 'high'],
  resolveProviderVisual: () => ({ accentKey: 'accent', displayName: 'OpenAI' }),
}));

describe('ModelSettingsPopover', () => {
  it('renders the global Fast settings entry', () => {
    const anchorRef = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchorRef} type="button">
          anchor
        </button>
        <ModelSettingsPopover
          anchorRef={anchorRef}
          open
          onClose={() => undefined}
          modelLabel="GPT-5.4"
          providerType="openai"
          modelId="gpt-5.4"
          supportsThinking
          canConfigureThinking
          supportsTools
          supportsVision
          thinkingEnabled={false}
          reasoningEffort="medium"
          onChangeThinkingEnabled={() => undefined}
          onChangeReasoningEffort={() => undefined}
        />
      </>,
    );

    expect(screen.getByText('Fast 快速模型')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开 Fast 设置' })).toBeTruthy();
  });
});
