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

  // Regression: persist-time synthetic injection (websearch low-cache-hit fix).
  // The per-request synthetic block (capability context, keyword reminder,
  // companion prompt) must be persisted as a `synthetic: true` text part
  // *before* the user's real text part. That keeps Anthropic / OpenAI
  // prompt-cache prefixes byte-stable across turns instead of mutating the
  // bytes of whichever message currently happens to be the latest user turn.
  it('prepends a synthetic:true text part when syntheticContext has content', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-2',
      message: 'search for React 19',
      sessionId: 'session-1',
      userId: 'user-1',
      syntheticContext: {
        capabilityContext: '<capabilities>web_search</capabilities>',
        injectedPrompt: null,
        companionPrompt: null,
      },
    });

    const call = mocks.appendSessionMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string; synthetic?: boolean }>;
    };
    expect(call).toBeDefined();
    expect(call.content).toHaveLength(2);
    expect(call.content[0]).toEqual({
      type: 'text',
      text: '<system-reminder>\n<capabilities>web_search</capabilities>\n</system-reminder>',
      synthetic: true,
    });
    expect(call.content[1]).toEqual({ type: 'text', text: 'search for React 19' });
  });

  it('does not add a synthetic part when syntheticContext block is empty', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-3',
      message: 'hi',
      sessionId: 'session-1',
      userId: 'user-1',
      syntheticContext: {
        capabilityContext: null,
        injectedPrompt: null,
        companionPrompt: null,
      },
    });

    const call = mocks.appendSessionMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string; synthetic?: boolean }>;
    };
    expect(call.content).toHaveLength(1);
    expect(call.content[0]).toEqual({ type: 'text', text: 'hi' });
  });

  it('joins all three synthetic context fields with the legacy "---" separator', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-4',
      message: 'go',
      sessionId: 'session-1',
      userId: 'user-1',
      syntheticContext: {
        injectedPrompt: 'INJECTED',
        capabilityContext: 'CAPS',
        companionPrompt: 'COMPANION',
      },
    });

    const call = mocks.appendSessionMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string; synthetic?: boolean }>;
    };
    expect(call.content[0]).toEqual({
      type: 'text',
      text: '<system-reminder>\nINJECTED\n\n---\n\nCAPS\n\n---\n\nCOMPANION\n</system-reminder>',
      synthetic: true,
    });
  });

  // Regression: persist-time thinking-language hint (websearch low-cache-hit
  // fix, second root cause). The legacy `applyThinkingLanguageHintToConversation`
  // mutated whichever user message currently happened to be the latest by
  // appending `[hint]` at end-of-content, which moved the hint between
  // earlier and later user turns across rounds and broke prompt-cache prefix
  // byte stability. Persisting the hint as a `synthetic: true` *trailing*
  // text part freezes it onto the user message that triggered it.
  it('appends a synthetic:true trailing text part for thinkingLanguageHint', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-5',
      message: '搜索一下 React 19',
      sessionId: 'session-1',
      userId: 'user-1',
      syntheticContext: {
        injectedPrompt: null,
        capabilityContext: null,
        companionPrompt: null,
        thinkingLanguageHint: '请用中文进行思考。你必须全程使用中文思考，绝对不要切换到英文。',
      },
    });

    const call = mocks.appendSessionMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string; synthetic?: boolean }>;
    };
    expect(call.content).toHaveLength(2);
    expect(call.content[0]).toEqual({ type: 'text', text: '搜索一下 React 19' });
    expect(call.content[1]).toEqual({
      type: 'text',
      text: '\n[请用中文进行思考。你必须全程使用中文思考，绝对不要切换到英文。]',
      synthetic: true,
    });
  });

  it('emits both leading and trailing synthetic parts when both are present', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-6',
      message: '查一下天气',
      sessionId: 'session-1',
      userId: 'user-1',
      syntheticContext: {
        injectedPrompt: null,
        capabilityContext: 'CAPS',
        companionPrompt: null,
        thinkingLanguageHint: '请用中文进行思考。',
      },
    });

    const call = mocks.appendSessionMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string; synthetic?: boolean }>;
    };
    expect(call.content).toHaveLength(3);
    expect(call.content[0]).toEqual({
      type: 'text',
      text: '<system-reminder>\nCAPS\n</system-reminder>',
      synthetic: true,
    });
    expect(call.content[1]).toEqual({ type: 'text', text: '查一下天气' });
    expect(call.content[2]).toEqual({
      type: 'text',
      text: '\n[请用中文进行思考。]',
      synthetic: true,
    });
  });

  it('omits the trailing thinking part when thinkingLanguageHint is empty', () => {
    mocks.getSessionMessageByRequestId.mockReturnValue(null);

    persistStreamUserMessage({
      clientRequestId: 'request-7',
      message: 'hello',
      sessionId: 'session-1',
      userId: 'user-1',
      syntheticContext: {
        injectedPrompt: null,
        capabilityContext: null,
        companionPrompt: null,
        thinkingLanguageHint: null,
      },
    });

    const call = mocks.appendSessionMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string; synthetic?: boolean }>;
    };
    expect(call.content).toHaveLength(1);
    expect(call.content[0]).toEqual({ type: 'text', text: 'hello' });
  });
});
