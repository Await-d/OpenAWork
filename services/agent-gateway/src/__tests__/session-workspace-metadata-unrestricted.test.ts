import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'unrestricted',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root'],
}));

import {
  mergeSessionMetadataForUpdate,
  normalizeIncomingSessionMetadata,
  normalizePersistedSessionMetadata,
} from '../session-workspace-metadata.js';

describe('session workspace metadata helpers in unrestricted mode', () => {
  it('preserves incoming workspace paths outside configured roots', () => {
    expect(
      normalizeIncomingSessionMetadata({
        workingDirectory: '/opt/external/project',
        tag: 'kept',
      }),
    ).toEqual({
      metadata: {
        workingDirectory: '/opt/external/project',
        tag: 'kept',
      },
      workingDirectory: '/opt/external/project',
    });
  });

  it('keeps persisted workspace paths outside configured roots', () => {
    expect(
      normalizePersistedSessionMetadata({
        workingDirectory: '/opt/external/project',
        tag: 'kept',
      }),
    ).toEqual({
      workingDirectory: '/opt/external/project',
      tag: 'kept',
    });
  });

  it('preserves existing unrestricted workspace paths during metadata updates', () => {
    expect(
      mergeSessionMetadataForUpdate(
        {
          workingDirectory: '/opt/external/project',
          oldTag: 'kept',
        },
        { newTag: 'added' },
      ),
    ).toEqual({
      metadata: {
        workingDirectory: '/opt/external/project',
        oldTag: 'kept',
        newTag: 'added',
      },
      workingDirectory: '/opt/external/project',
    });
  });
});
