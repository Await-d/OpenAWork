import { describe, expect, it } from 'vitest';
import { toModelMessages } from '../../message/message-to-model-messages.js';
import type { MessageID, MessageWithParts, PartID } from '../../message/message-v2-schema.js';

function asMessageId(value: string): MessageID {
  return value as MessageID;
}

function asPartId(value: string): PartID {
  return value as PartID;
}

function userMessage(input: {
  readonly id: string;
  readonly syntheticContext: string;
  readonly text: string;
}): MessageWithParts {
  const messageID = asMessageId(input.id);
  return {
    info: {
      id: messageID,
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
    },
    parts: [
      {
        id: asPartId(`${input.id}-synthetic`),
        sessionID: 'session-1',
        messageID,
        type: 'text',
        text: input.syntheticContext,
        synthetic: true,
      },
      {
        id: asPartId(`${input.id}-text`),
        sessionID: 'session-1',
        messageID,
        type: 'text',
        text: input.text,
      },
    ],
  };
}

describe('toModelMessages synthetic context projection', () => {
  it('removes historical synthetic context while preserving each user request', () => {
    const modelMessages = toModelMessages([
      userMessage({
        id: 'older-user',
        syntheticContext: '<system-reminder>old dynamic context</system-reminder>',
        text: '保留这条历史用户请求',
      }),
      userMessage({
        id: 'latest-user',
        syntheticContext: '<system-reminder>current dynamic context</system-reminder>',
        text: '处理当前用户请求',
      }),
    ]);

    expect(modelMessages).toEqual([
      { role: 'user', content: '保留这条历史用户请求' },
      {
        role: 'user',
        content: '<system-reminder>current dynamic context</system-reminder>\n处理当前用户请求',
      },
    ]);
  });

  it.each([
    '请用中文进行思考。你必须全程使用中文思考，绝对不要切换到英文。',
    '日本語で思考してください。必ず日本語のみで思考してください。',
    '한국어로 생각하세요. 한국어로만 사고하세요.',
  ])('drops an old gateway language directive without altering user text', (hint) => {
    const directive = `[${hint}]`;
    expect(
      toModelMessages([
        userMessage({ id: 'latest-user', syntheticContext: `\n${directive}`, text: directive }),
      ]),
    ).toEqual([{ role: 'user', content: directive }]);
  });

  it('keeps the current response-language hint', () => {
    const hint = '[如无其他语言要求，请用中文回复。]';
    expect(
      toModelMessages([userMessage({ id: 'latest-user', syntheticContext: hint, text: '继续' })]),
    ).toEqual([{ role: 'user', content: `${hint}\n继续` }]);
  });
});
