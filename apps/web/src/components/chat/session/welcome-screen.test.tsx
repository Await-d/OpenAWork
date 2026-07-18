// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openAwork/shared-ui', () => {
  return {
    BrandLogo: ({ size = 22 }: { readonly size?: number }) => (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32">
        <path d="M 16,3 C 26,3 29,12 16,16" />
        <path d="M 16,3 C 26,3 29,12 16,16" transform="rotate(120 16 16)" />
        <path d="M 16,3 C 26,3 29,12 16,16" transform="rotate(240 16 16)" />
        <circle cx="16" cy="16" r="2.8" />
      </svg>
    ),
  };
});

import { TeamWelcomeScreen } from '../../../pages/team/runtime/shell/controls/TeamWelcomeScreen.js';
import { WelcomeScreen } from './welcome-screen.js';

const BRAND_LOGO_PETAL_PATH = 'M 16,3 C 26,3 29,12 16,16';
const LEGACY_CHAT_LAYER_PATH = 'M12 2L2 7l10 5 10-5-10-5z';

afterEach(() => {
  cleanup();
});

describe('WelcomeScreen', () => {
  it('chat 欢迎页复用与 team 欢迎页相同的品牌图标', () => {
    const chat = render(
      <WelcomeScreen
        hasWorkspace
        dialogueMode="coding"
        onNewSession={() => {}}
        onOpenWorkspace={() => {}}
        onSelectMode={() => {}}
      />,
    );
    const team = render(
      <TeamWelcomeScreen
        canCreateSession
        canCreateWorkspace
        workspaceLabel="OpenAWork"
        onCreateWorkspace={() => {}}
        onNewSession={() => {}}
        onSelectSuggestion={() => {}}
      />,
    );

    expect(chat.container.querySelectorAll(`path[d="${BRAND_LOGO_PETAL_PATH}"]`)).toHaveLength(3);
    expect(team.container.querySelectorAll(`path[d="${BRAND_LOGO_PETAL_PATH}"]`)).toHaveLength(3);
    expect(chat.container.querySelector(`path[d="${LEGACY_CHAT_LAYER_PATH}"]`)).toBeNull();
  });
});
