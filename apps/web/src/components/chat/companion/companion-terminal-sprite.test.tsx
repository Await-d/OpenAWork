// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionProfile, CompanionUtteranceSeed } from './companion-display-model.js';
import { CompanionTerminalSprite } from './companion-terminal-sprite.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const liveOutput: CompanionUtteranceSeed = {
  badge: '跟随生成',
  text: '主助手正在生成，我贴着边观察这轮输出。',
  tone: 'active',
};

function createProfile(): CompanionProfile {
  return {
    accentColor: 'var(--accent)',
    accentTint: 'var(--accent-muted)',
    archetype: '工作台回声体',
    glyph: '✦',
    name: '稜镜',
    note: '贴着输入框旁边陪跑。',
    rarityStars: '★★★',
    species: '软团',
    sprite: {
      eye: '◉',
      hat: 'none',
      rarity: 'rare',
      shiny: false,
      species: 'blob',
    },
    traits: ['低打扰'],
  };
}

describe('CompanionTerminalSprite', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    vi.useRealTimers();
    container?.remove();
    root = null;
    container = null;
  });

  it('renders the ASCII sprite and speech bubble output', async () => {
    await act(async () => {
      root?.render(
        <CompanionTerminalSprite
          fading={false}
          liveOutput={liveOutput}
          petNonce={0}
          prefersReducedMotion={false}
          profile={createProfile()}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="companion-terminal-sprite"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="companion-reaction"]')).not.toBeNull();
    expect(container?.textContent).toContain('跟随生成');
  });

  it('does not show pet hearts when reduced motion is enabled', async () => {
    await act(async () => {
      root?.render(
        <CompanionTerminalSprite
          fading={false}
          liveOutput={null}
          petNonce={1}
          prefersReducedMotion={true}
          profile={createProfile()}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="companion-pet-hearts"]')).toBeNull();
  });

  it('shows a blink frame during the idle sequence', async () => {
    await act(async () => {
      root?.render(
        <CompanionTerminalSprite
          fading={false}
          liveOutput={null}
          petNonce={0}
          prefersReducedMotion={false}
          profile={createProfile()}
        />,
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(container?.textContent).toContain('-  -');
  });

  it('shows hearts only within the pet burst window', async () => {
    await act(async () => {
      root?.render(
        <CompanionTerminalSprite
          fading={false}
          liveOutput={null}
          petNonce={1}
          prefersReducedMotion={false}
          profile={createProfile()}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="companion-pet-hearts"]')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    expect(container?.querySelector('[data-testid="companion-pet-hearts"]')).toBeNull();
  });
});
