import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createArtifactMock: vi.fn(),
  listArtifactsBySessionMock: vi.fn(),
  updateArtifactMock: vi.fn(),
}));

vi.mock('../artifact-content-store.js', () => ({
  createArtifact: mocks.createArtifactMock,
  listArtifactsBySession: mocks.listArtifactsBySessionMock,
  updateArtifact: mocks.updateArtifactMock,
}));

import {
  extractAssistantArtifactDrafts,
  upsertArtifactsFromAssistantMessage,
} from '../assistant-content-artifacts.js';

describe('assistant content artifacts', () => {
  beforeEach(() => {
    mocks.createArtifactMock.mockReset();
    mocks.listArtifactsBySessionMock.mockReset();
    mocks.updateArtifactMock.mockReset();
  });

  it('extracts artifact drafts from assistant fences while ignoring thinking blocks', () => {
    const drafts = extractAssistantArtifactDrafts({
      clientRequestId: 'req-12345678',
      text: [
        '```thinking',
        'internal reasoning',
        '```',
        '',
        '```html',
        '<div class="card">Hello artifact</div>',
        '```',
      ].join('\n'),
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      blockIndex: 1,
      type: 'html',
      content: '<div class="card">Hello artifact</div>',
      metadata: {
        sourceClientRequestId: 'req-12345678',
        sourceBlockIndex: 1,
        sourceKind: 'assistant_message_block',
        sourceLanguage: 'html',
      },
    });
    expect(drafts[0]?.title).toBe('assistant-req-1234-02.html');
  });

  it('updates existing artifacts for the same request/block instead of duplicating them', () => {
    mocks.listArtifactsBySessionMock.mockReturnValue([
      {
        id: 'artifact-1',
        sessionId: 'session-1',
        userId: 'user-1',
        type: 'html',
        title: 'assistant-req-1-01.html',
        content: '<div>old</div>',
        version: 1,
        parentVersionId: null,
        metadata: {
          sourceBlockIndex: 0,
          sourceClientRequestId: 'req-1',
          sourceKind: 'assistant_message_block',
        },
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
    ]);
    mocks.updateArtifactMock.mockReturnValue({ id: 'artifact-1', version: 2 });

    const updatedArtifacts = upsertArtifactsFromAssistantMessage({
      clientRequestId: 'req-1',
      content: [
        {
          type: 'text',
          text: '```html\n<div class="card">Updated artifact payload</div>\n```',
        },
      ],
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(mocks.createArtifactMock).not.toHaveBeenCalled();
    expect(mocks.updateArtifactMock).toHaveBeenCalledWith(
      'user-1',
      'artifact-1',
      expect.objectContaining({
        content: '<div class="card">Updated artifact payload</div>',
        createdBy: 'agent',
        metadata: expect.objectContaining({
          sourceBlockIndex: 0,
          sourceClientRequestId: 'req-1',
          sourceKind: 'assistant_message_block',
          sourceLanguage: 'html',
        }),
        type: 'html',
      }),
    );
    expect(updatedArtifacts).toEqual([{ id: 'artifact-1', version: 2 }]);
  });
});
