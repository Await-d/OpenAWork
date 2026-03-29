// @vitest-environment jsdom

import { useEffect, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedRouteOutlet } from './CachedRouteOutlet.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  root = null;
  container?.remove();
  container = null;
});

function dispatchClick(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
}

function RouteCacheLayout({ maxCacheEntries }: { maxCacheEntries?: number }) {
  return <CachedRouteOutlet maxCacheEntries={maxCacheEntries} />;
}

describe('CachedRouteOutlet', () => {
  it('keeps route state when switching between top-level pages', async () => {
    const chatMounted = vi.fn();
    const chatUnmounted = vi.fn();

    function ChatRoute() {
      const navigate = useNavigate();
      const [count, setCount] = useState(0);

      useEffect(() => {
        chatMounted();
        return () => {
          chatUnmounted();
        };
      }, []);

      return (
        <div data-testid="chat-page">
          <span data-testid="chat-count">{count}</span>
          <button
            type="button"
            data-testid="chat-inc"
            onClick={() => setCount((value) => value + 1)}
          >
            chat+1
          </button>
          <button type="button" data-testid="goto-settings" onClick={() => navigate('/settings')}>
            go-settings
          </button>
        </div>
      );
    }

    function SettingsRoute() {
      const navigate = useNavigate();
      return (
        <div data-testid="settings-page">
          <button type="button" data-testid="goto-chat" onClick={() => navigate('/chat')}>
            go-chat
          </button>
        </div>
      );
    }

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route element={<RouteCacheLayout />}>
              <Route path="/chat" element={<ChatRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const chatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const incrementButton = chatWrapper?.querySelector('[data-testid="chat-inc"]');
    const goSettingsButton = chatWrapper?.querySelector('[data-testid="goto-settings"]');

    expect(chatWrapper).not.toBeNull();
    expect(incrementButton).toBeInstanceOf(HTMLElement);
    expect(goSettingsButton).toBeInstanceOf(HTMLElement);

    await act(async () => {
      dispatchClick(incrementButton as HTMLElement);
    });

    expect(chatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');

    await act(async () => {
      dispatchClick(goSettingsButton as HTMLElement);
      await Promise.resolve();
    });

    const hiddenChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const settingsWrapper = container?.querySelector('[data-route-cache-key="settings"]');
    const goChatButton = settingsWrapper?.querySelector('[data-testid="goto-chat"]');

    expect(hiddenChatWrapper).not.toBeNull();
    expect(hiddenChatWrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(settingsWrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(chatMounted).toHaveBeenCalledTimes(1);
    expect(chatUnmounted).not.toHaveBeenCalled();
    expect(goChatButton).toBeInstanceOf(HTMLElement);

    await act(async () => {
      dispatchClick(goChatButton as HTMLElement);
      await Promise.resolve();
    });

    const restoredChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');

    expect(restoredChatWrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(restoredChatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');
    expect(chatMounted).toHaveBeenCalledTimes(1);
    expect(chatUnmounted).not.toHaveBeenCalled();
  });

  it('reuses the same cached page instance across optional route params in one section', async () => {
    const chatMounted = vi.fn();

    function ChatRoute() {
      const navigate = useNavigate();
      const { sessionId } = useParams<{ sessionId: string }>();
      const [count, setCount] = useState(0);

      useEffect(() => {
        chatMounted();
      }, []);

      return (
        <div data-testid="chat-page">
          <span data-testid="session-id">{sessionId ?? 'none'}</span>
          <span data-testid="chat-count">{count}</span>
          <button
            type="button"
            data-testid="chat-inc"
            onClick={() => setCount((value) => value + 1)}
          >
            chat+1
          </button>
          <button
            type="button"
            data-testid="goto-session-two"
            onClick={() => navigate('/chat/two')}
          >
            go-session-two
          </button>
        </div>
      );
    }

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route element={<RouteCacheLayout />}>
              <Route path="/chat/:sessionId?" element={<ChatRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const chatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const incrementButton = chatWrapper?.querySelector('[data-testid="chat-inc"]');
    const goSessionTwoButton = chatWrapper?.querySelector('[data-testid="goto-session-two"]');

    expect(chatWrapper?.querySelector('[data-testid="session-id"]')?.textContent).toBe('none');

    await act(async () => {
      dispatchClick(incrementButton as HTMLElement);
      dispatchClick(goSessionTwoButton as HTMLElement);
      await Promise.resolve();
    });

    const updatedChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');

    expect(updatedChatWrapper?.querySelector('[data-testid="session-id"]')?.textContent).toBe(
      'two',
    );
    expect(updatedChatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');
    expect(chatMounted).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="page-transition-loader-overlay"]')).toBeNull();
  });

  it('shows a route transition loader when switching top-level pages', async () => {
    vi.useFakeTimers();

    try {
      function ChatRoute() {
        const navigate = useNavigate();

        return (
          <div data-testid="chat-page">
            <button type="button" data-testid="goto-settings" onClick={() => navigate('/settings')}>
              go-settings
            </button>
          </div>
        );
      }

      function SettingsRoute() {
        const navigate = useNavigate();

        return (
          <div data-testid="settings-page">
            <button type="button" data-testid="goto-chat" onClick={() => navigate('/chat')}>
              go-chat
            </button>
          </div>
        );
      }

      await act(async () => {
        root?.render(
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route element={<RouteCacheLayout />}>
                <Route path="/chat" element={<ChatRoute />} />
                <Route path="/settings" element={<SettingsRoute />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        );
        await Promise.resolve();
      });

      const chatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
      const goSettingsButton = chatWrapper?.querySelector('[data-testid="goto-settings"]');

      await act(async () => {
        dispatchClick(goSettingsButton as HTMLElement);
        await Promise.resolve();
      });

      expect(
        container?.querySelector('[data-testid="page-transition-loader-overlay"]'),
      ).not.toBeNull();
      expect(
        container
          ?.querySelector('[data-route-cache-key="settings"]')
          ?.getAttribute('data-route-transition-state'),
      ).toBe('entering');
      expect(
        container
          ?.querySelector('[data-route-cache-key="chat"]')
          ?.getAttribute('data-route-transition-state'),
      ).toBe('leaving');

      await act(async () => {
        vi.advanceTimersByTime(360);
        await Promise.resolve();
      });

      expect(container?.querySelector('[data-testid="page-transition-loader-overlay"]')).toBeNull();
      expect(
        container
          ?.querySelector('[data-route-cache-key="settings"]')
          ?.getAttribute('data-route-transition-state'),
      ).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least recently used page when cache entries exceed the limit', async () => {
    const settingsMounted = vi.fn();
    const settingsUnmounted = vi.fn();

    function ChatRoute() {
      const navigate = useNavigate();
      const [count, setCount] = useState(0);

      return (
        <div data-testid="chat-page">
          <span data-testid="chat-count">{count}</span>
          <button
            type="button"
            data-testid="chat-inc"
            onClick={() => setCount((value) => value + 1)}
          >
            chat+1
          </button>
          <button
            type="button"
            data-testid="chat-goto-settings"
            onClick={() => navigate('/settings')}
          >
            chat-settings
          </button>
          <button type="button" data-testid="chat-goto-skills" onClick={() => navigate('/skills')}>
            chat-skills
          </button>
        </div>
      );
    }

    function SettingsRoute() {
      const navigate = useNavigate();

      useEffect(() => {
        settingsMounted();
        return () => {
          settingsUnmounted();
        };
      }, []);

      return (
        <div data-testid="settings-page">
          <button type="button" data-testid="settings-goto-chat" onClick={() => navigate('/chat')}>
            settings-chat
          </button>
        </div>
      );
    }

    function SkillsRoute() {
      const navigate = useNavigate();
      return (
        <div data-testid="skills-page">
          <button type="button" data-testid="skills-goto-chat" onClick={() => navigate('/chat')}>
            skills-chat
          </button>
          <button
            type="button"
            data-testid="skills-goto-settings"
            onClick={() => navigate('/settings')}
          >
            skills-settings
          </button>
        </div>
      );
    }

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route element={<RouteCacheLayout maxCacheEntries={2} />}>
              <Route path="/chat" element={<ChatRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
              <Route path="/skills" element={<SkillsRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const chatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const chatIncButton = chatWrapper?.querySelector('[data-testid="chat-inc"]');
    const chatToSettingsButton = chatWrapper?.querySelector('[data-testid="chat-goto-settings"]');

    await act(async () => {
      dispatchClick(chatIncButton as HTMLElement);
      dispatchClick(chatToSettingsButton as HTMLElement);
      await Promise.resolve();
    });

    const settingsWrapper = container?.querySelector('[data-route-cache-key="settings"]');
    const settingsToChatButton = settingsWrapper?.querySelector(
      '[data-testid="settings-goto-chat"]',
    );

    expect(settingsMounted).toHaveBeenCalledTimes(1);

    await act(async () => {
      dispatchClick(settingsToChatButton as HTMLElement);
      await Promise.resolve();
    });

    const restoredChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const chatToSkillsButton = restoredChatWrapper?.querySelector(
      '[data-testid="chat-goto-skills"]',
    );

    expect(restoredChatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');

    await act(async () => {
      dispatchClick(chatToSkillsButton as HTMLElement);
      await Promise.resolve();
    });

    const hiddenChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');

    expect(container?.querySelector('[data-route-cache-key="settings"]')).toBeNull();
    expect(settingsUnmounted).toHaveBeenCalledTimes(1);
    expect(hiddenChatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');

    const skillsWrapper = container?.querySelector('[data-route-cache-key="skills"]');
    const skillsToSettingsButton = skillsWrapper?.querySelector(
      '[data-testid="skills-goto-settings"]',
    );

    await act(async () => {
      dispatchClick(skillsToSettingsButton as HTMLElement);
      await Promise.resolve();
    });

    expect(settingsMounted).toHaveBeenCalledTimes(2);
  });

  it('keeps all visited top-level pages by default', async () => {
    const settingsUnmounted = vi.fn();

    function ChatRoute() {
      const navigate = useNavigate();
      const [count, setCount] = useState(0);

      return (
        <div data-testid="chat-page">
          <span data-testid="chat-count">{count}</span>
          <button
            type="button"
            data-testid="chat-inc"
            onClick={() => setCount((value) => value + 1)}
          >
            chat+1
          </button>
          <button
            type="button"
            data-testid="chat-goto-settings"
            onClick={() => navigate('/settings')}
          >
            chat-settings
          </button>
        </div>
      );
    }

    function SettingsRoute() {
      const navigate = useNavigate();

      useEffect(() => {
        return () => {
          settingsUnmounted();
        };
      }, []);

      return (
        <div data-testid="settings-page">
          <button
            type="button"
            data-testid="settings-goto-skills"
            onClick={() => navigate('/skills')}
          >
            settings-skills
          </button>
        </div>
      );
    }

    function SkillsRoute() {
      const navigate = useNavigate();
      return (
        <div data-testid="skills-page">
          <button type="button" data-testid="skills-goto-chat" onClick={() => navigate('/chat')}>
            skills-chat
          </button>
        </div>
      );
    }

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route element={<RouteCacheLayout />}>
              <Route path="/chat" element={<ChatRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
              <Route path="/skills" element={<SkillsRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const chatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const chatIncButton = chatWrapper?.querySelector('[data-testid="chat-inc"]');
    const chatToSettingsButton = chatWrapper?.querySelector('[data-testid="chat-goto-settings"]');

    await act(async () => {
      dispatchClick(chatIncButton as HTMLElement);
      dispatchClick(chatToSettingsButton as HTMLElement);
      await Promise.resolve();
    });

    const settingsWrapper = container?.querySelector('[data-route-cache-key="settings"]');
    const settingsToSkillsButton = settingsWrapper?.querySelector(
      '[data-testid="settings-goto-skills"]',
    );

    await act(async () => {
      dispatchClick(settingsToSkillsButton as HTMLElement);
      await Promise.resolve();
    });

    expect(container?.querySelectorAll('[data-route-cache-key]').length).toBe(3);
    expect(settingsUnmounted).not.toHaveBeenCalled();

    const skillsWrapper = container?.querySelector('[data-route-cache-key="skills"]');
    const skillsToChatButton = skillsWrapper?.querySelector('[data-testid="skills-goto-chat"]');

    await act(async () => {
      dispatchClick(skillsToChatButton as HTMLElement);
      await Promise.resolve();
    });

    const restoredChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');

    expect(restoredChatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');
    expect(container?.querySelectorAll('[data-route-cache-key]').length).toBe(3);
  });

  it('reuses the cached page instance even when route outlet identity changes on re-entry', async () => {
    function ChatContent() {
      const navigate = useNavigate();
      const [count, setCount] = useState(0);

      return (
        <div data-testid="chat-page">
          <span data-testid="chat-count">{count}</span>
          <button
            type="button"
            data-testid="chat-inc"
            onClick={() => setCount((value) => value + 1)}
          >
            chat+1
          </button>
          <button type="button" data-testid="goto-settings" onClick={() => navigate('/settings')}>
            go-settings
          </button>
        </div>
      );
    }

    function ChatRoute() {
      const location = useLocation();
      return <ChatContent key={location.key} />;
    }

    function SettingsRoute() {
      const navigate = useNavigate();
      return (
        <div data-testid="settings-page">
          <button type="button" data-testid="goto-chat" onClick={() => navigate('/chat')}>
            go-chat
          </button>
        </div>
      );
    }

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route element={<RouteCacheLayout />}>
              <Route path="/chat" element={<ChatRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const chatWrapper = container?.querySelector('[data-route-cache-key="chat"]');
    const incrementButton = chatWrapper?.querySelector('[data-testid="chat-inc"]');
    const goSettingsButton = chatWrapper?.querySelector('[data-testid="goto-settings"]');

    await act(async () => {
      dispatchClick(incrementButton as HTMLElement);
      dispatchClick(goSettingsButton as HTMLElement);
      await Promise.resolve();
    });

    const settingsWrapper = container?.querySelector('[data-route-cache-key="settings"]');
    const goChatButton = settingsWrapper?.querySelector('[data-testid="goto-chat"]');

    await act(async () => {
      dispatchClick(goChatButton as HTMLElement);
      await Promise.resolve();
    });

    const restoredChatWrapper = container?.querySelector('[data-route-cache-key="chat"]');

    expect(restoredChatWrapper?.querySelector('[data-testid="chat-count"]')?.textContent).toBe('1');
  });
});
