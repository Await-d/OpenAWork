import { describe, expect, it, vi } from 'vitest';
import type { ChannelEvent, ChannelInstance, ChannelMessage } from '../../channels/types.js';
import { WhatsAppChannelService } from '../../channels/whatsapp.js';

/**
 * Regression (§0.108, channel inbound batch isolation): WhatsApp's
 * handleWebhookEvent walks a nested entry → changes → messages batch and
 * dispatches each message via the notify callback. Before the fix it called
 * `this.notify` raw, so one throwing dispatch (e.g. a downstream auto-reply
 * filter that throws synchronously) skipped every LATER message in the same
 * webhook payload. The handler now routes through `safeNotify`, mirroring the
 * Telegram channel's established invariant.
 */
function buildInstance(): ChannelInstance {
  return {
    id: 'wa-1',
    type: 'whatsapp',
    name: 'wa',
    enabled: true,
    config: { phoneNumberId: 'pn-1', accessToken: 'tok', verifyToken: 'vt' },
    createdAt: 0,
    updatedAt: 0,
  };
}

function twoMessageWebhook(): unknown {
  const message = (id: string, body: string) => ({
    id,
    from: `user-${id}`,
    text: { body },
    timestamp: '1700000000',
  });
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [message('m1', 'first'), message('m2', 'second')],
              contacts: [],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsAppChannelService webhook notify resilience', () => {
  it('单条消息回调抛错不会中断同批后续消息的派发', () => {
    const received: string[] = [];
    // The first dispatch throws; the second must still be delivered.
    const notify = vi.fn((event: ChannelEvent) => {
      if (event.type !== 'message') return;
      const msg = event.message as ChannelMessage;
      if (msg.id === 'm1') {
        throw new Error('simulated downstream notify failure');
      }
      received.push(msg.id);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const service = new WhatsAppChannelService(buildInstance(), notify);
    try {
      // Must not throw despite the first message's dispatch throwing.
      expect(() => service.handleWebhookEvent(twoMessageWebhook())).not.toThrow();
      // The second message was still delivered — the batch survived.
      expect(received).toEqual(['m2']);
      expect(notify).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
