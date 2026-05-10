// @vitest-environment jsdom
/**
 * Smoke coverage for the right-panel-embedded `SkillSettingsPanel`. Verifies:
 *
 *  - On mount the panel issues `GET /skills/selection?…` and `GET
 *    /skills/installed` and renders a row for every effective skill.
 *  - The default scope tab is "本会话" when a session id is present, with
 *    no "保存" button (workspace-only). Switching to "Workspace 默认" reveals
 *    the AI 推荐 / 导入 / 导出 / 保存 toolbar.
 *  - Toggling the `Enabled` checkbox in the session tab while a row's
 *    existing override carries `pinned: null` ("inherit workspace pinned")
 *    issues a `PATCH` that **omits** the `pinned` field, preserving the
 *    inherit semantic. Regression for the bug fixed during the deep review.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SkillSettingsPanel from './SkillSettingsPanel.js';

interface SelectionMock {
  workspacePath: string;
  workspaceSelections: Array<Record<string, unknown>>;
  sessionOverrides: Array<{
    skillId: string;
    enabled: boolean;
    pinned: boolean | null;
    updatedAt: number;
  }>;
  effective: Array<{
    skillId: string;
    enabled: boolean;
    pinned: boolean;
    origin: 'workspace' | 'workspace-fallback' | 'session-override' | 'builtin';
    displayName?: string;
    description?: string;
    capabilities?: string[];
  }>;
}

interface InstalledMock {
  skills: Array<{
    skillId: string;
    enabled: boolean;
    manifest: {
      id: string;
      displayName?: string;
      version?: string;
    };
  }>;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

interface RenderOptions {
  sessionId: string | null;
  workspacePath: string | null;
}

function renderPanel(options: RenderOptions) {
  return render(
    <MemoryRouter>
      <SkillSettingsPanel
        sessionId={options.sessionId}
        workspacePath={options.workspacePath}
        accessToken="test-token"
        gatewayUrl="https://gateway.test"
      />
    </MemoryRouter>,
  );
}

describe('SkillSettingsPanel', () => {
  beforeEach(() => {
    /* nothing — accessToken is passed in directly */
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders an auth notice when no access token is supplied and does not fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <SkillSettingsPanel
          sessionId="s-1"
          workspacePath="/home/alice/projects/alpha"
          accessToken={null}
          gatewayUrl="https://gateway.test"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/请先登录/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches selection + installed and exposes Workspace tab tools after switching', async () => {
    const selection: SelectionMock = {
      workspacePath: '/home/alice/projects/alpha',
      workspaceSelections: [],
      sessionOverrides: [],
      effective: [
        {
          skillId: 'skill-a',
          enabled: true,
          pinned: true,
          origin: 'workspace',
          displayName: 'Skill A',
        },
        {
          skillId: 'skill-b',
          enabled: false,
          pinned: false,
          origin: 'workspace',
          displayName: 'Skill B',
        },
      ],
    };
    const installed: InstalledMock = {
      skills: [
        { skillId: 'skill-a', enabled: true, manifest: { id: 'skill-a', displayName: 'Skill A' } },
        { skillId: 'skill-b', enabled: true, manifest: { id: 'skill-b', displayName: 'Skill B' } },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/skills/installed')) return jsonResponse(installed);
      if (url.includes('/skills/selection?')) return jsonResponse(selection);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel({
      sessionId: 's-1',
      workspacePath: '/home/alice/projects/alpha',
    });

    await screen.findByText('Skill A');
    expect(screen.getByText('Skill B')).toBeTruthy();

    // Default tab "本会话" — no save button surfaced.
    expect(screen.queryByText('保存')).toBeNull();

    // Switch to Workspace tab.
    await act(async () => {
      fireEvent.click(screen.getByText('Workspace 默认'));
    });
    expect(screen.getByText('保存')).toBeTruthy();
    expect(screen.getByText('AI 推荐')).toBeTruthy();
    expect(screen.getByText('导出')).toBeTruthy();
    expect(screen.getByText('导入')).toBeTruthy();
  });

  it('session tab: re-enabling a row with existing pinned=null override preserves the null', async () => {
    const selection: SelectionMock = {
      workspacePath: '/home/alice/projects/alpha',
      workspaceSelections: [],
      sessionOverrides: [
        {
          skillId: 'inherit-pin',
          enabled: false,
          pinned: null,
          updatedAt: Date.now(),
        },
      ],
      effective: [
        {
          skillId: 'inherit-pin',
          enabled: false,
          pinned: false,
          origin: 'session-override',
          displayName: 'Inherit Pin',
        },
      ],
    };
    const installed: InstalledMock = {
      skills: [
        {
          skillId: 'inherit-pin',
          enabled: true,
          manifest: { id: 'inherit-pin', displayName: 'Inherit Pin' },
        },
      ],
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/skills/installed')) return jsonResponse(installed);
      if (url.includes('/skills/selection/session/')) {
        return jsonResponse({ sessionId: 's-1', effective: [] });
      }
      if (url.includes('/skills/selection?')) return jsonResponse(selection);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel({
      sessionId: 's-1',
      workspacePath: '/home/alice/projects/alpha',
    });

    await screen.findByText('Inherit Pin');

    const enabledCheckbox = screen.getAllByLabelText('启用', { selector: 'input' })[0];
    expect(enabledCheckbox).toBeDefined();
    await act(async () => {
      fireEvent.click(enabledCheckbox!);
    });

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url.includes('/skills/selection/session/s-1') && c.init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
    });
    const patch = calls.find(
      (c) => c.url.includes('/skills/selection/session/s-1') && c.init?.method === 'PATCH',
    )!;
    const body = JSON.parse(String(patch.init!.body)) as {
      items: Array<{ skillId: string; enabled: boolean; pinned?: boolean }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.skillId).toBe('inherit-pin');
    expect(body.items[0]?.enabled).toBe(true);
    // pinned must be omitted so the route stores NULL = "inherit workspace pinned".
    expect(body.items[0]).not.toHaveProperty('pinned');
  });
});
