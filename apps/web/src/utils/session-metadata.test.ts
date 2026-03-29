import { describe, expect, it } from 'vitest';
import {
  extractParentSessionId,
  extractWorkingDirectory,
  getSessionModeLabels,
  hasParentSession,
} from './session-metadata.js';

describe('session-metadata', () => {
  it('extracts normalized working directory and parent session from metadata', () => {
    const metadataJson = JSON.stringify({
      workingDirectory: ' /repo/project ',
      parentSessionId: 'session-1',
    });

    expect(extractWorkingDirectory(metadataJson)).toBe('/repo/project');
    expect(extractParentSessionId(metadataJson)).toBe('session-1');
    expect(hasParentSession(metadataJson)).toBe(true);
  });

  it('builds visible labels from dialogue mode, yolo flag, and model id', () => {
    const metadataJson = JSON.stringify({
      dialogueMode: 'coding',
      yoloMode: true,
      modelId: 'claude-sonnet-4',
    });

    expect(getSessionModeLabels(metadataJson)).toEqual(['编程', 'YOLO', 'Claude Sonnet 4']);
  });

  it('falls back safely for invalid metadata', () => {
    expect(extractParentSessionId('not-json')).toBeNull();
    expect(extractWorkingDirectory('not-json')).toBeNull();
    expect(hasParentSession('not-json')).toBe(false);
    expect(getSessionModeLabels('not-json')).toEqual(['澄清']);
  });
});
