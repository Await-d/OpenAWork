import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as OpenAIResponses from '../openai-responses.js';
import { LLMEvent, LLMRequest, Message } from '../../schema/index.js';

const reasoningEvents = [
  {
    type: 'response.output_item.added',
    item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted-1' },
  },
  { type: 'response.reasoning_summary_part.added', item_id: 'rs_1', summary_index: 0 },
  {
    type: 'response.reasoning_summary_text.delta',
    item_id: 'rs_1',
    summary_index: 0,
    delta: 'summary-1',
  },
  { type: 'response.reasoning_summary_part.done', item_id: 'rs_1', summary_index: 0 },
  {
    type: 'response.output_item.done',
    item: { type: 'reasoning', id: 'rs_1' },
  },
] as const;

const makeRequest = () =>
  new LLMRequest({
    model: OpenAIResponses.route.model({ id: 'gpt-5' }),
    system: [],
    messages: [],
    tools: [],
    providerOptions: { openai: { store: false } },
  });

describe('OpenAI Responses reasoning replay', () => {
  it('keeps encrypted content and summary when output_item.done omits encrypted_content', async () => {
    const request = makeRequest();
    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);
    let state = OpenAIResponses.protocol.stream.initial(request);
    const emitted: LLMEvent[] = [];

    for (const rawEvent of reasoningEvents) {
      const [nextState, events] = await Effect.runPromise(
        OpenAIResponses.protocol.stream.step(state, decode(JSON.stringify(rawEvent))),
      );
      state = nextState;
      emitted.push(...events);
    }

    const reasoningEnd = emitted.find(LLMEvent.is.reasoningEnd);
    expect(reasoningEnd?.providerMetadata?.openai).toMatchObject({
      itemId: 'rs_1',
      reasoningEncryptedContent: 'encrypted-1',
    });

    const assistant = Message.assistant([
      {
        type: 'reasoning',
        text: 'summary-1',
        providerMetadata: {
          openai: {
            itemId: 'rs_1',
            reasoningEncryptedContent: 'encrypted-1',
          },
        },
      },
    ]);
    const replayRequest = new LLMRequest({ ...request, messages: [assistant] });
    const body = await Effect.runPromise(OpenAIResponses.protocol.body.from(replayRequest));
    const replayItem = body.input.find((item) => 'type' in item && item.type === 'reasoning');

    expect(replayItem).toMatchObject({
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: 'summary-1' }],
      encrypted_content: 'encrypted-1',
    });
  });
});
