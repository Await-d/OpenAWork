import { beforeAll, describe, expect, it } from 'vitest';
import type {
  MessageID,
  MessageWithParts,
} from '../../message/message-v2-schema.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let filterMessagesByTeamTaskThread: (
  messages: Iterable<MessageWithParts>,
  teamTaskThreadId?: string,
) => Iterable<MessageWithParts>;

function buildMessage(id: string, clientRequestId?: string): MessageWithParts {
  return {
    info: {
      id: id as MessageID,
      sessionID: 'session-thread-filter',
      role: 'user',
      time: { created: 1000 },
      ...(clientRequestId ? { clientRequestId } : {}),
    },
    parts: [],
  };
}

beforeAll(async () => {
  const module = await import('../../routes/stream-model-round.js');
  filterMessagesByTeamTaskThread = module.filterMessagesByTeamTaskThread;
});

describe('filterMessagesByTeamTaskThread', () => {
  it('未指定 thread 时保留全部消息', () => {
    const messages = [
      buildMessage('m-1', 'handoff:h-1'),
      buildMessage('m-2', 'handoff:h-2'),
      buildMessage('m-3'),
    ];

    expect([...filterMessagesByTeamTaskThread(messages)]).toEqual(messages);
  });

  it('只保留同一 handoff request scope 的消息', () => {
    const messages = [
      buildMessage('m-root', 'handoff:h-1'),
      buildMessage('m-assistant', 'handoff:h-1:assistant:2'),
      buildMessage('m-tool', 'handoff:h-1:tool:call-1'),
      buildMessage('m-other', 'handoff:h-2'),
      buildMessage('m-empty'),
    ];

    expect([...filterMessagesByTeamTaskThread(messages, 'handoff:h-1')].map((item) => item.info.id))
      .toEqual(['m-root', 'm-assistant', 'm-tool']);
  });
});
