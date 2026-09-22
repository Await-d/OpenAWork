import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Responses from '../openai-responses.js';
import { LLMRequest, LLMEvent } from '../../schema/index.js';

const decode = Schema.decodeUnknownSync(Responses.protocol.stream.event);

const makeRequest = () =>
  new LLMRequest({
    model: Responses.route.model({ id: 'gpt-4.1' }),
    system: [],
    messages: [],
    tools: [],
  });

const runEvent = async (raw: Record<string, unknown>) => {
  const [, events] = await Effect.runPromise(
    Responses.protocol.stream.step(
      Responses.protocol.stream.initial(makeRequest()),
      decode(JSON.stringify(raw)),
    ),
  );
  return events;
};

describe('OpenAI Responses hosted 工具', () => {
  it('识别 computer_call（真实 wire type）并暴露为 computer_use_preview', async () => {
    const events = await runEvent({
      type: 'response.output_item.done',
      item: { type: 'computer_call', id: 'cc_1', action: { type: 'click' } },
    });

    const call = events.find(LLMEvent.is.toolCall);
    expect(call?.name).toBe('computer_use_preview');
    expect(call?.providerExecuted).toBe(true);
    expect(call?.input).toEqual({ type: 'click' });
    expect(events.find(LLMEvent.is.toolResult)?.providerExecuted).toBe(true);
  });
});
