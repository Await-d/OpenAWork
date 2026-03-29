import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import {
  toPublicSessionResponse,
  validateImportedMessagesPayload,
} from '../routes/session-route-helpers.js';

describe('session route helpers', () => {
  it('omits internal session storage fields from the public session response', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        createdAt: 1,
      },
    ];

    const response = toPublicSessionResponse(
      {
        id: 'session-1',
        state_status: 'idle',
        metadata_json: JSON.stringify({ parentSessionId: 'parent-1' }),
        title: '测试会话',
        created_at: '2026-03-25T00:00:00Z',
        updated_at: '2026-03-25T00:00:01Z',
      },
      messages,
      [{ content: '补充待办', status: 'pending', priority: 'medium' }],
    );

    expect(response.id).toBe('session-1');
    expect(response.messages).toEqual(messages);
    expect(response.todos).toEqual([
      { content: '补充待办', status: 'pending', priority: 'medium' },
    ]);
    expect(response.metadata_json).toBe(JSON.stringify({ parentSessionId: 'parent-1' }));
    expect('messages_json' in response).toBe(false);
    expect('user_id' in response).toBe(false);
  });

  it('rejects imports that exceed the message count limit', () => {
    const validation = validateImportedMessagesPayload(
      Array.from({ length: 501 }, (_, index) => ({ role: 'user', content: `m-${index}` })),
    );

    expect(validation).toEqual({ ok: false, error: 'Import exceeds 500 messages' });
  });

  it('rejects imports that exceed the byte limit', () => {
    const validation = validateImportedMessagesPayload([
      { role: 'user', content: 'x'.repeat(600 * 1024) },
    ]);

    expect(validation).toEqual({ ok: false, error: 'Import exceeds 524288 bytes' });
  });
});
