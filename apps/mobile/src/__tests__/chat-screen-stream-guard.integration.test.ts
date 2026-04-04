import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const chatScreenPath = resolve(currentDir, '../screens/ChatScreen.tsx');

describe('ChatScreen stream guard wiring', () => {
  it('keeps the real mobile chat path wired to the stale-callback guard', () => {
    const source = readFileSync(chatScreenPath, 'utf8');

    expect(source).toContain('buildChatStreamToken');
    expect(source).toContain('shouldApplyChatSessionMutation');
    expect(source).toContain('shouldApplyChatStreamMutation');
    expect(source).toContain('createChatScreenGuardedStreamHandlers');
    expect(source).toContain('const canApplySessionMutation =');
    expect(source).toContain('const canApplyMutation = () =>');
    expect(source).toContain('if (!canApplySessionMutation(requestSessionId)) {');
    expect(source).toContain('activeStreamTokenRef.current = requestToken');
    expect(source).toContain('const handlers = createChatScreenGuardedStreamHandlers<Message>({');
    expect(source).toContain('canApplyMutation,');
    expect(source).toContain('clearActiveStreamToken: () => {');
    expect(source).toContain('syncTaskActivities,');
    expect(source).toContain('stream(requestSessionId, requestMessage, handlers, streamOptions);');
    expect(source).toContain('activeStreamTokenRef.current = null;');
  });
});
