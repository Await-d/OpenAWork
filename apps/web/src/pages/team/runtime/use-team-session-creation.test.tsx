// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowTemplateRecord } from '@openAwork/web-client';
import { useTeamSessionCreation } from './use-team-session-creation.js';

type HookState = ReturnType<typeof useTeamSessionCreation>;

function HookHarness({
  onState,
  teamWorkspaceId,
}: {
  onState: (state: HookState) => void;
  teamWorkspaceId: string;
}) {
  const state = useTeamSessionCreation({ teamWorkspaceId });
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    onStateRef.current({ ...state });
  });

  return null;
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

async function mountHarness(teamWorkspaceId = 'workspace-1') {
  let captured: HookState | null = null;

  await act(async () => {
    root!.render(
      <HookHarness
        teamWorkspaceId={teamWorkspaceId}
        onState={(state) => {
          captured = state;
        }}
      />,
    );
    await Promise.resolve();
  });

  if (!captured) {
    throw new Error('Hook state not captured');
  }

  return {
    getState() {
      if (!captured) {
        throw new Error('Hook state not captured');
      }
      return captured;
    },
  };
}

describe('useTeamSessionCreation', () => {
  const savedTemplate: WorkflowTemplateRecord = {
    id: 'workflow-1',
    name: '研究团队模板',
    description: 'team-playbook',
    category: 'team-playbook',
    metadata: {
      teamTemplate: {
        defaultBindings: {
          executor: 'hephaestus',
          planner: 'oracle',
          researcher: 'librarian',
          reviewer: 'momus',
        },
        defaultProvider: 'claude-code',
        optionalAgentIds: ['atlas'],
        requiredRoles: ['planner', 'researcher', 'executor', 'reviewer'],
      },
    },
    nodes: [],
    edges: [],
  };

  it('starts with a blank draft and source step', async () => {
    const harness = await mountHarness();

    expect(harness.getState().step).toBe('source');
    expect(harness.getState().draft.teamWorkspaceId).toBe('workspace-1');
    expect(harness.getState().draft.source.kind).toBe('blank');
    expect(harness.getState().draft.optionalAgentIds).toEqual([]);
    expect(harness.getState().draft.requiredRoleBindings).toEqual({
      planner: 'oracle',
      researcher: 'librarian',
      executor: 'hephaestus',
      reviewer: 'momus',
    });
  });

  it('blocks advancing from required-roles when title or required roles are incomplete', async () => {
    const harness = await mountHarness();

    await act(async () => {
      harness.getState().nextStep();
      await Promise.resolve();
    });
    expect(harness.getState().step).toBe('required-roles');

    await act(async () => {
      const advanced = harness.getState().nextStep();
      expect(advanced).toBe(false);
      await Promise.resolve();
    });

    expect(harness.getState().step).toBe('required-roles');
    expect(harness.getState().fieldErrors.title).toBe('请输入会话标题');
  });

  it('advances to review only after title and all required role bindings are set', async () => {
    const harness = await mountHarness();

    await act(async () => {
      harness.getState().nextStep();
      harness.getState().setTitle('研究团队 2026-04-16');
      await Promise.resolve();
    });

    await act(async () => {
      const advanced = harness.getState().nextStep();
      expect(advanced).toBe(true);
      await Promise.resolve();
    });
    expect(harness.getState().step).toBe('optional-members');

    await act(async () => {
      const advanced = harness.getState().nextStep();
      expect(advanced).toBe(true);
      await Promise.resolve();
    });
    expect(harness.getState().step).toBe('review');
    expect(harness.getState().canSubmit).toBe(true);
  });

  it('toggles optional members without duplicates and resets back to blank draft', async () => {
    const harness = await mountHarness();

    await act(async () => {
      harness.getState().toggleOptionalAgent('atlas');
      harness.getState().toggleOptionalAgent('atlas');
      harness.getState().toggleOptionalAgent('momus');
      await Promise.resolve();
    });

    expect(harness.getState().draft.optionalAgentIds).toEqual(['momus']);

    await act(async () => {
      harness.getState().setTitle('临时标题');
      harness.getState().reset();
      await Promise.resolve();
    });

    expect(harness.getState().step).toBe('source');
    expect(harness.getState().draft.title).toBe('');
    expect(harness.getState().draft.optionalAgentIds).toEqual([]);
  });

  it('applies saved template metadata into the draft', async () => {
    const harness = await mountHarness();

    await act(async () => {
      harness.getState().applyTemplate(savedTemplate);
      await Promise.resolve();
    });

    expect(harness.getState().draft.source).toEqual({
      kind: 'saved-template',
      templateId: 'workflow-1',
    });
    expect(harness.getState().draft.defaultProvider).toBe('claude-code');
    expect(harness.getState().draft.optionalAgentIds).toEqual(['atlas']);
    expect(harness.getState().draft.requiredRoleBindings.executor).toBe('hephaestus');
    expect(harness.getState().draft.requiredRoleBindings.planner).toBe('oracle');
    expect(harness.getState().draft.requiredRoleBindings.researcher).toBe('librarian');
    expect(harness.getState().draft.requiredRoleBindings.reviewer).toBe('momus');
  });
});
