// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth.js';
import { CompanionTabContent } from './companion-tab-content.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

describe('CompanionTabContent', () => {
  const fetchMock = vi.fn<typeof fetch>();

  function installSettingsFetchMock() {
    fetchMock.mockImplementation(async (input, init) => {
      const resolvedUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(resolvedUrl);

      if (url.pathname === '/agents') {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: 'hephaestus',
                label: 'Hephaestus',
                description: '程序员代理',
                aliases: [],
                origin: 'builtin',
                source: 'system',
                enabled: true,
                removable: false,
                resettable: true,
                hasOverrides: false,
                createdAt: '2026-04-05T00:00:00.000Z',
                updatedAt: '2026-04-05T00:00:00.000Z',
              },
              {
                id: 'apollo',
                label: 'Apollo',
                description: '策略代理',
                aliases: [],
                origin: 'builtin',
                source: 'system',
                enabled: true,
                removable: false,
                resettable: true,
                hasOverrides: false,
                createdAt: '2026-04-05T00:00:00.000Z',
                updatedAt: '2026-04-05T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.pathname === '/settings/companion' && init?.method === 'PUT') {
        return new Response(
          JSON.stringify({
            bindings: {
              hephaestus: {
                behaviorTone: 'focused',
                displayName: 'Heph 小锤',
                injectionMode: 'always',
                species: 'robot',
                themeVariant: 'playful',
                verbosity: 'minimal',
                voiceOutputMode: 'important_only',
                voiceRate: 1.15,
                voiceVariant: 'bright',
              },
            },
            activeBinding: {
              behaviorTone: 'focused',
              displayName: 'Heph 小锤',
              injectionMode: 'always',
              species: 'robot',
              themeVariant: 'playful',
              verbosity: 'minimal',
              voiceOutputMode: 'important_only',
              voiceRate: 1.15,
              voiceVariant: 'bright',
            },
            feature: { enabled: true, mode: 'beta' },
            preferences: {
              enabled: false,
              injectionMode: 'mention_only',
              muted: false,
              reducedMotion: false,
              verbosity: 'normal',
              voiceOutputEnabled: false,
              voiceOutputMode: 'buddy_only',
              voiceRate: 1.02,
              voiceVariant: 'system',
            },
            profile: {
              accentColor: 'var(--accent)',
              accentTint: 'color-mix(in oklch, var(--accent) 14%, transparent)',
              archetype: '工作台回声体',
              glyph: '✦',
              name: 'Heph 小锤',
              note: '只在你需要时露面，不抢主助手的话筒。',
              rarityStars: '★★★',
              species: '机械体',
              sprite: {
                eye: '✦',
                hat: 'none',
                rarity: 'rare',
                shiny: false,
                species: 'robot',
              },
              traits: ['低打扰', '看输入', '贴着节奏'],
            },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          bindings: {},
          activeBinding: undefined,
          feature: { enabled: true, mode: 'beta' },
          preferences: {
            enabled: true,
            injectionMode: 'mention_only',
            muted: false,
            reducedMotion: false,
            verbosity: 'normal',
            voiceOutputEnabled: false,
            voiceOutputMode: 'buddy_only',
            voiceRate: 1.02,
            voiceVariant: 'system',
          },
          profile: {
            accentColor: 'var(--accent)',
            accentTint: 'color-mix(in oklch, var(--accent) 14%, transparent)',
            archetype: '低打扰观察员',
            glyph: '✦',
            name: '雾灯',
            note: '只在你需要时露面，不抢主助手的话筒。',
            rarityStars: '★★',
            species: '企鹅',
            sprite: {
              eye: '✦',
              hat: 'none',
              rarity: 'uncommon',
              shiny: false,
              species: 'penguin',
            },
            traits: ['低打扰', '看输入', '贴着节奏'],
          },
        }),
        { status: 200 },
      );
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(globalThis.window, 'innerWidth', {
      configurable: true,
      value: 1280,
      writable: true,
    });
    globalThis.window.localStorage.clear();
    useAuthStore.setState({
      accessToken: 'token-a',
      email: 'buddy@example.com',
      gatewayUrl: 'http://localhost:3000',
    });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    globalThis.window.localStorage.clear();
    useAuthStore.setState({
      accessToken: null,
      email: null,
      gatewayUrl: 'http://localhost:3000',
    });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders companion settings and persists toggle changes', async () => {
    installSettingsFetchMock();

    await act(async () => {
      root?.render(<CompanionTabContent />);
    });

    expect(container?.textContent).toContain('Buddy 伴侣');
    expect(container?.textContent).toContain('当前 Buddy');
    expect(container?.textContent).toContain('伴侣图鉴');
    expect(container?.textContent).toContain('18 种 companion');
    expect(container?.textContent).toContain('Uncommon');
    expect(container?.textContent).toContain('调试');
    expect(container?.textContent).toContain('Agent 绑定');
    expect(container?.textContent).toContain('Hephaestus');
    expect(container?.textContent).toContain('行为语气');
    expect(container?.textContent).toContain('播报模式覆盖');
    expect(container?.textContent).toContain('主控制会在你切换开关后的约 0.5 秒内自动同步');
    expect(container?.textContent).toContain('恢复已保存');
    expect(container?.querySelectorAll('[data-testid="companion-gallery-card"]')).toHaveLength(19);

    const buttons = Array.from(container?.querySelectorAll('button') ?? []);
    const masterToggle = buttons.find((button) =>
      button.textContent?.includes('保持这个 Persona 在线'),
    );
    expect(masterToggle).not.toBeUndefined();

    const enableToggle = container?.querySelector('button[aria-label="启用 Buddy 伴侣"]');
    await act(async () => {
      enableToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      vi.advanceTimersByTime(501);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/settings/companion?agentId=hephaestus',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: {
            enabled: false,
            injectionMode: 'mention_only',
            muted: false,
            reducedMotion: false,
            verbosity: 'normal',
            voiceOutputEnabled: false,
            voiceOutputMode: 'buddy_only',
            voiceRate: 1.02,
            voiceVariant: 'system',
          },
        }),
      },
    );
  });

  it('shows dirty binding state, can reset the draft, and collapses the gallery', async () => {
    installSettingsFetchMock();

    await act(async () => {
      root?.render(<CompanionTabContent />);
    });

    const nameInput = container?.querySelector(
      'input[name="buddy-binding-name"]',
    ) as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();

    await act(async () => {
      if (nameInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(nameInput, 'Forge Duck');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(container?.textContent).toContain('有未保存的绑定更改');
    expect(container?.textContent).toContain('创建绑定');

    const resetButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('恢复已保存'),
    );
    expect(resetButton?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(nameInput?.value).toBe('');
    expect(container?.textContent).toContain('当前 Agent 还没有专属绑定');

    const galleryToggle = container?.querySelector(
      '[data-testid="companion-gallery-toggle"]',
    ) as HTMLButtonElement | null;
    expect(galleryToggle?.textContent).toContain('收起图鉴');

    await act(async () => {
      galleryToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="companion-gallery-grid"]')).toBeNull();
    expect(container?.textContent).toContain('图鉴已收起');
  });

  it('saves manual agent bindings through the explicit binding action', async () => {
    installSettingsFetchMock();

    await act(async () => {
      root?.render(<CompanionTabContent />);
    });

    const nameInput = container?.querySelector(
      'input[name="buddy-binding-name"]',
    ) as HTMLInputElement | null;

    await act(async () => {
      if (nameInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(nameInput, 'Forge Duck');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const saveButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('创建绑定'),
    );

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === 'http://localhost:3000/settings/companion?agentId=hephaestus' &&
          init?.method === 'PUT' &&
          JSON.stringify(init?.headers) ===
            JSON.stringify({
              Authorization: 'Bearer token-a',
              'Content-Type': 'application/json',
            }) &&
          init?.body ===
            JSON.stringify({
              bindings: {
                hephaestus: {
                  behaviorTone: 'focused',
                  displayName: 'Forge Duck',
                  species: 'duck',
                  themeVariant: 'default',
                },
              },
            }),
      ),
    ).toBe(true);
  });

  it('confirms before discarding dirty binding edits when switching agents', async () => {
    installSettingsFetchMock();
    const confirmMock = vi.fn(() => false);
    Object.defineProperty(globalThis.window, 'confirm', {
      configurable: true,
      value: confirmMock,
    });

    await act(async () => {
      root?.render(<CompanionTabContent />);
    });

    const nameInput = container?.querySelector(
      'input[name="buddy-binding-name"]',
    ) as HTMLInputElement | null;
    const agentSelect = container?.querySelector(
      'select[aria-label="Buddy 绑定 Agent"]',
    ) as HTMLSelectElement | null;

    await act(async () => {
      if (nameInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(nameInput, 'Needs Confirm');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await act(async () => {
      if (agentSelect) {
        agentSelect.value = 'apollo';
        agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(agentSelect?.value).toBe('hephaestus');
    expect(container?.textContent).toContain('当前编辑对象：Hephaestus');

    confirmMock.mockReturnValueOnce(true);

    await act(async () => {
      if (agentSelect) {
        agentSelect.value = 'apollo';
        agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(agentSelect?.value).toBe('apollo');
    expect(container?.textContent).toContain('当前编辑对象：Apollo');
  });

  it('collapses the gallery by default on narrow viewports and exposes accessible toggle state', async () => {
    installSettingsFetchMock();
    Object.defineProperty(globalThis.window, 'innerWidth', {
      configurable: true,
      value: 820,
      writable: true,
    });

    await act(async () => {
      root?.render(<CompanionTabContent />);
    });

    const galleryToggle = container?.querySelector(
      '[data-testid="companion-gallery-toggle"]',
    ) as HTMLButtonElement | null;

    expect(galleryToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(galleryToggle?.getAttribute('aria-controls')).toBe('companion-gallery-panel');
    expect(galleryToggle?.textContent).toContain('展开图鉴');
    expect(container?.querySelector('[data-testid="companion-gallery-grid"]')).toBeNull();
    expect(container?.textContent).toContain('图鉴已收起');
  });
});
