import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@openAwork/shared';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { createSessionHistoryPager, prependHistoricalMessages } from './session-history-pager.js';
const raw = (id: string, createdAt: number): Message => ({
  id,
  createdAt,
  role: 'user',
  content: [{ type: 'text', text: id }],
});
const chat = (id: string, createdAt: number): ChatMessage => ({
  id,
  createdAt,
  role: 'user',
  content: id,
});
describe('session history pager', () => {
  it('preserves current references and only prepends older messages', () => {
    const current = [chat('same', 20), chat('live', 30)];
    const merged = prependHistoricalMessages(current, [
      chat('old', 10),
      chat('same', 20),
      chat('future', 40),
    ]);
    expect(merged.map((message) => message.id)).toEqual(['old', 'same', 'live']);
    expect(merged[1]).toBe(current[0]);
    expect(merged[2]).toBe(current[1]);
  });
  it('shares a request and stops after finding older history', async () => {
    let messages = [chat('new', 100)];
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ messages: [raw('new', 100)], more: true, nextCursor: 'c1' })
      .mockResolvedValueOnce({ messages: [raw('old', 50)], more: true, nextCursor: 'c2' });
    const pager = createSessionHistoryPager({
      readPage,
      readMessages: () => messages,
      isCurrent: () => true,
      publish: (older) => {
        messages = prependHistoricalMessages(messages, older);
      },
    });
    const results = await Promise.all([pager.load(), pager.load()]);
    expect(readPage.mock.calls).toEqual([[undefined], ['c1']]);
    expect(results[0]?.messages.map((message) => message.id)).toEqual(['old', 'new']);
    expect(results[1]).toEqual(results[0]);
  });
  it('does not publish a stale view response', async () => {
    let current = true;
    const publish = vi.fn();
    const pager = createSessionHistoryPager({
      readPage: async () => {
        current = false;
        return { messages: [raw('old', 10)], more: false };
      },
      readMessages: () => [],
      isCurrent: () => current,
      publish,
    });
    expect(await pager.load()).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });
  it('keeps legacy tool results with their assistant across page boundaries', async () => {
    const assistant: Message = {
      id: 'assistant',
      role: 'assistant',
      createdAt: 20,
      content: [{ type: 'tool_call', toolCallId: 'call', toolName: 'read', input: {} }],
    };
    const result: Message = {
      id: 'result',
      role: 'tool',
      createdAt: 30,
      content: [
        { type: 'tool_result', toolCallId: 'call', output: { value: 'complete' }, isError: false },
      ],
    };
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ messages: [result], more: true, nextCursor: 'c1' })
      .mockResolvedValueOnce({ messages: [raw('user', 10), assistant], more: false });
    const pager = createSessionHistoryPager({
      readPage,
      readMessages: () => [chat('new', 100)],
      isCurrent: () => true,
      publish: vi.fn(),
    });
    const page = await pager.load();
    expect(
      page?.messages
        .find((message) => message.id === 'assistant')
        ?.parts?.find((part) => part.type === 'tool'),
    ).toMatchObject({ toolCallId: 'call', output: { value: 'complete' }, status: 'completed' });
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('loads only until a target is reached and stops a repeated cursor', async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ messages: [raw('old', 50)], more: true, nextCursor: 'c1' })
      .mockResolvedValueOnce({ messages: [raw('target', 20)], more: true, nextCursor: 'c2' })
      .mockResolvedValueOnce({ messages: [], more: true, nextCursor: 'c2' });
    const pager = createSessionHistoryPager({
      readPage,
      readMessages: () => [chat('new', 100)],
      isCurrent: () => true,
      publish: vi.fn(),
    });
    expect((await pager.load('target'))?.messages.map((message) => message.id)).toEqual([
      'target',
      'old',
      'new',
    ]);
    expect(readPage).toHaveBeenCalledTimes(2);
    expect((await pager.load())?.more).toBe(false);
    expect(readPage).toHaveBeenCalledTimes(3);
  });

  it('retries a failed page without advancing its cursor', async () => {
    const readPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ messages: [raw('old', 10)], more: false });
    const pager = createSessionHistoryPager({
      readPage,
      readMessages: () => [],
      isCurrent: () => true,
      publish: vi.fn(),
    });
    await expect(pager.load()).rejects.toThrow('network');
    expect((await pager.load())?.more).toBe(false);
    expect(readPage.mock.calls).toEqual([[undefined], [undefined]]);
  });
});
