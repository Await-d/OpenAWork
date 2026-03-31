import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'restricted',
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root', '/tmp/openawork-second-root'],
}));

import {
  extractSessionWorkingDirectory,
  extractToolSurfaceProfile,
  isSessionWorkspaceRebindingAttempt,
  mergeSessionMetadataForUpdate,
  normalizeIncomingSessionMetadata,
  parseSessionMetadataJson,
  normalizePersistedSessionMetadata,
  sanitizeSessionMetadataJson,
  validateSessionMetadataPatch,
} from '../session-workspace-metadata.js';

describe('session workspace metadata helpers', () => {
  it('rejects incoming workspace metadata outside the configured root', () => {
    expect(
      normalizeIncomingSessionMetadata({
        workingDirectory: '/tmp/openawork-workspace-root-sibling/project',
      }),
    ).toEqual({
      metadata: { workingDirectory: '/tmp/openawork-workspace-root-sibling/project' },
      workingDirectory: null,
    });
  });

  it('preserves valid incoming workspace metadata inside the configured root', () => {
    expect(
      normalizeIncomingSessionMetadata({
        workingDirectory: '/tmp/openawork-workspace-root/apps/web',
        tag: 'kept',
      }),
    ).toEqual({
      metadata: {
        workingDirectory: '/tmp/openawork-workspace-root/apps/web',
        tag: 'kept',
      },
      workingDirectory: '/tmp/openawork-workspace-root/apps/web',
    });
  });

  it('strips persisted invalid workspace paths while keeping other metadata', () => {
    expect(
      normalizePersistedSessionMetadata({
        workingDirectory: '/tmp/openawork-workspace-root-sibling/project',
        tag: 'kept',
      }),
    ).toEqual({ tag: 'kept' });
  });

  it('sanitizes persisted metadata json with invalid workspace paths', () => {
    expect(
      sanitizeSessionMetadataJson(
        JSON.stringify({
          workingDirectory: '/tmp/openawork-workspace-root-sibling/project',
          tag: 'kept',
        }),
      ),
    ).toBe(JSON.stringify({ tag: 'kept' }));
  });

  it('leaves unrelated metadata json untouched when no workspace path is present', () => {
    expect(sanitizeSessionMetadataJson(JSON.stringify({ tag: 'kept' }))).toBe(
      JSON.stringify({ tag: 'kept' }),
    );
  });

  it('allows unrelated metadata updates after sanitizing a persisted invalid workspace path', () => {
    expect(
      mergeSessionMetadataForUpdate(
        {
          workingDirectory: '/tmp/openawork-workspace-root-sibling/project',
          staleTag: 'drop-path-only',
        },
        { titleTag: 'new-value' },
      ),
    ).toEqual({
      metadata: {
        staleTag: 'drop-path-only',
        titleTag: 'new-value',
      },
    });
  });

  it('accepts supported user-facing session metadata patch keys', () => {
    const result = validateSessionMetadataPatch({
      dialogueMode: 'coding',
      yoloMode: true,
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'high',
      providerId: 'provider-1',
      modelId: 'model-1',
      parentSessionId: 'session-1',
      editSourceMessageId: 'message-1',
      workingDirectory: '/tmp/openawork-workspace-root/apps/web',
    });

    expect(result.success).toBe(true);
  });

  it('accepts extended reasoning effort values in session metadata patches', () => {
    const result = validateSessionMetadataPatch({
      thinkingEnabled: true,
      reasoningEffort: 'xhigh',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown session metadata patch keys', () => {
    const result = validateSessionMetadataPatch({
      activeLoopKind: 'ralph',
      unexpected: 'value',
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid toolSurfaceProfile values in session metadata patches', () => {
    for (const profile of ['openawork', 'claude_code_simple', 'claude_code_default'] as const) {
      const result = validateSessionMetadataPatch({ toolSurfaceProfile: profile });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.toolSurfaceProfile).toBe(profile);
    }
  });

  it('rejects invalid toolSurfaceProfile values', () => {
    const result = validateSessionMetadataPatch({ toolSurfaceProfile: 'unknown_profile' });
    expect(result.success).toBe(false);
  });

  it('defaults missing toolSurfaceProfile to openawork', () => {
    expect(extractToolSurfaceProfile({})).toBe('openawork');
    expect(extractToolSurfaceProfile({ toolSurfaceProfile: 'not_valid' })).toBe('openawork');
  });

  it('extracts known toolSurfaceProfile from metadata', () => {
    expect(extractToolSurfaceProfile({ toolSurfaceProfile: 'claude_code_simple' })).toBe(
      'claude_code_simple',
    );
    expect(extractToolSurfaceProfile({ toolSurfaceProfile: 'claude_code_default' })).toBe(
      'claude_code_default',
    );
    expect(extractToolSurfaceProfile({ toolSurfaceProfile: 'openawork' })).toBe('openawork');
  });

  it('preserves toolSurfaceProfile through metadata merge', () => {
    const result = mergeSessionMetadataForUpdate(
      { toolSurfaceProfile: 'claude_code_simple', tag: 'old' },
      { tag: 'new' },
    );
    expect(result.metadata['toolSurfaceProfile']).toBe('claude_code_simple');
  });

  it('falls back to an empty metadata object when persisted metadata is corrupted', () => {
    expect(parseSessionMetadataJson('{not valid json')).toEqual({});
  });

  it('extracts the persisted working directory from metadata', () => {
    expect(
      extractSessionWorkingDirectory({
        workingDirectory: '/tmp/openawork-workspace-root/apps/web',
        tag: 'kept',
      }),
    ).toBe('/tmp/openawork-workspace-root/apps/web');
  });

  it('detects attempts to rebind a session workspace after it has been set', () => {
    expect(
      isSessionWorkspaceRebindingAttempt(
        { workingDirectory: '/tmp/openawork-workspace-root/apps/web' },
        '/tmp/openawork-workspace-root/packages/shared-ui',
      ),
    ).toBe(true);
    expect(
      isSessionWorkspaceRebindingAttempt(
        { workingDirectory: '/tmp/openawork-workspace-root/apps/web' },
        '/tmp/openawork-workspace-root/apps/web',
      ),
    ).toBe(false);
    expect(isSessionWorkspaceRebindingAttempt({}, '/tmp/openawork-workspace-root/apps/web')).toBe(
      false,
    );
  });
});
