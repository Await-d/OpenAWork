import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendSessionEvent: vi.fn(),
  appendSessionMessage: vi.fn(),
  getSessionMessageByRequestId: vi.fn(),
  maybeAutoTitle: vi.fn(),
  sqliteGet: vi.fn(() => ({ metadata_json: '{}' })),
}));

vi.mock('../message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessage,
  getSessionMessageByRequestId: mocks.getSessionMessageByRequestId,
}));

vi.mock('../session-entry-store.js', () => ({
  appendSessionEvent: mocks.appendSessionEvent,
}));

vi.mock('../session-title.js', () => ({
  maybeAutoTitle: mocks.maybeAutoTitle,
}));

vi.mock('../session-title-llm.js', () => ({
  generateSessionTitleLlm: vi.fn(),
  isFirstUserMessage: vi.fn(() => false),
}));

vi.mock('../storage-paths.js', () => ({
  resolveGatewayArtifactsIndexPath: vi.fn(() => '/tmp/openawork-artifacts.json'),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: [],
  sqliteGet: mocks.sqliteGet,
}));

import { persistStreamUserMessage } from '../stream-session-title.js';

describe('persistStreamUserMessage', () => {
  beforeEach(() => {
    mocks.appendSessionEvent.mockClear();
    mocks.appendSessionMessage.mockClear();
    mocks.getSessionMessageByRequestId.mockReset();
    mocks.maybeAutoTitle.mockClear();
    mocks.sqliteGet.mockClear();
  });

  it('writes a prompt session event for entry replay when persisting a new user message', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-1',
      displayMessage: 'visible prompt',
      message: 'raw prompt',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(mocks.appendSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'request-1',
        role: 'user',
        sessionId: 'session-1',
        userId: 'user-1',
      }),
    );
    expect(mocks.appendSessionEvent).toHaveBeenCalledWith({
      clientRequestId: 'request-1',
      sessionId: 'session-1',
      userId: 'user-1',
      event: expect.objectContaining({
        text: 'visible prompt',
        type: 'prompt',
      }),
    });
  });
});
