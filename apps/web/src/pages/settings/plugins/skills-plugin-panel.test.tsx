// @vitest-environment jsdom
/**
 * Smoke coverage for the Settings → 插件 → 技能 panel.
 *
 * The panel is the "manage-only" surface described in the skill
 * management docs: no marketplace, just GET /skills/installed plus
 * per-row enable/disable toggles wired to
 * PATCH /skills/installed/:id/enable.
 *
 * We verify:
 *   1. On mount it calls GET /skills/installed with the auth header
 *      from `useAuthStore` and renders one row per installed skill.
 *   2. Clicking the row's switch sends PATCH with the INVERTED
 *      `enabled` value (not a delta). Regression guard so nobody
 *      accidentally ships a "toggle that always sends the current
 *      state" bug.
 *   3. Rows flagged as `preinstalled` render a static badge and do
 *      NOT surface a clickable switch — prevents end users from
 *      disabling skills the platform ships as core.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SkillsPluginPanel } from './skills-plugin-panel.js';
import { useAuthStore } from '../../../stores/auth.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <SkillsPluginPanel />
    </MemoryRouter>,
  );
}

describe('SkillsPluginPanel', () => {
  beforeEach(() => {
    // Seed the real zustand store so the component can read accessToken
    // + gatewayUrl off `useAuthStore()` without an IRL login flow.
    useAuthStore.setState({
      accessToken: 'test-token',
      gatewayUrl: 'https://gateway.test',
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ accessToken: null, gatewayUrl: 'http://localhost:3000' });
  });

  it('fetches installed skills on mount and renders a row per skill', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/skills/installed') && !url.includes('/enable')) {
        return jsonResponse({
          skills: [
            {
              skillId: 'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
              manifest: { name: 'AgentDocs Orchestrator', version: '1.0.0' },
              sourceId: 'github:Await-d/agentdocs-orchestrator',
              enabled: true,
            },
            {
              skillId: 'github:acme/foo-skill/foo',
              manifest: { name: 'Foo Skill', version: '0.2.0' },
              sourceId: 'github:acme/foo-skill',
              enabled: true,
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    await screen.findByText('AgentDocs Orchestrator');
    expect(screen.getByText('Foo Skill')).toBeTruthy();

    // The GET should have carried the Bearer token from the store.
    const getCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/skills/installed') && !String(url).includes('/enable'),
    );
    expect(getCall).toBeTruthy();
    const init = getCall?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Authorization']).toBe('Bearer test-token');
  });

  it("clicking an enabled row's switch issues PATCH {enabled:false}", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/skills/installed')) {
        return jsonResponse({
          skills: [
            {
              skillId: 'github:acme/foo-skill/foo',
              manifest: { name: 'Foo Skill', version: '0.2.0' },
              sourceId: 'github:acme/foo-skill',
              enabled: true,
            },
          ],
        });
      }
      if (url.includes('/enable') && init?.method === 'PATCH') {
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await screen.findByText('Foo Skill');

    // The toggle button carries role="switch" per InstalledSkillsManager's
    // contract. Enabled rows start with aria-checked=true.
    const switchButtons = screen.getAllByRole('switch');
    expect(switchButtons.length).toBeGreaterThan(0);
    const fooSwitch = switchButtons.find(
      (btn) => btn.getAttribute('aria-label')?.includes('Foo Skill') ?? false,
    );
    expect(fooSwitch).toBeTruthy();
    expect(fooSwitch?.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(fooSwitch!);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/enable') && (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(String((patchCall?.[1] as RequestInit).body));
      // Must send the INVERTED state — regression guard against
      // "always sends current state" bugs.
      expect(body.enabled).toBe(false);
    });
  });

  it('preinstalled skills render a static badge instead of a switch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/skills/installed')) {
        return jsonResponse({
          skills: [
            {
              skillId: 'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
              manifest: { name: 'AgentDocs Orchestrator', version: '1.0.0' },
              sourceId: 'github:Await-d/agentdocs-orchestrator',
              enabled: true,
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await screen.findByText('AgentDocs Orchestrator');

    // Preinstalled → the toggleDisabledReason predicate returns a
    // non-null string, so the manager falls back to the read-only
    // badge (no role=switch).
    const switchButtons = screen.queryAllByRole('switch');
    expect(
      switchButtons.some((btn) =>
        btn.getAttribute('aria-label')?.includes('AgentDocs Orchestrator'),
      ),
    ).toBe(false);

    // The "已启用" badge still renders (as read-only text, not button).
    expect(screen.getByText('已启用')).toBeTruthy();
  });
});
