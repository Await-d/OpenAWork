import { Effect, Schema, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import * as OpenAIResponses from '../openai-responses.js';
import { sseFraming } from '../shared.js';
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
  it('keeps a summary delta on the active summary part when the relay omits its index', async () => {
    const request = makeRequest();
    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);
    let state = OpenAIResponses.protocol.stream.initial(request);
    const emitted: LLMEvent[] = [];
    for (const rawEvent of [
      { type: 'response.output_item.added', item: { type: 'reasoning', id: 'rs-order' } },
      { type: 'response.reasoning_summary_part.added', item_id: 'rs-order', summary_index: 1 },
      { type: 'response.reasoning_summary_text.delta', item_id: 'rs-order', delta: '第二段' },
    ]) {
      const [nextState, events] = await Effect.runPromise(
        OpenAIResponses.protocol.stream.step(state, decode(JSON.stringify(rawEvent))),
      );
      state = nextState;
      emitted.push(...events);
    }

    expect(emitted.filter(LLMEvent.is.reasoningDelta).map((event) => event.id)).toEqual([
      'rs-order:1',
    ]);
  });

  it('accepts protocol extension fields emitted by Responses streams', () => {
    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);

    expect(
      decode(
        JSON.stringify({
          type: 'response.output_text.delta',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
          sequence_number: 3,
          delta: '你好',
        }),
      ),
    ).toMatchObject({ type: 'response.output_text.delta', delta: '你好' });
  });

  it('accepts extension fields on output items and error payloads', () => {
    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);

    expect(
      decode(
        JSON.stringify({
          type: 'response.output_item.added',
          sequence_number: 4,
          output_index: 0,
          item: {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            content: [],
            status: 'in_progress',
          },
        }),
      ),
    ).toMatchObject({ item: { type: 'message', id: 'msg_1' } });

    expect(
      decode(
        JSON.stringify({
          type: 'error',
          code: 'provider_error',
          message: 'temporary failure',
          request_id: 'req_1',
          retry_after: 1,
        }),
      ),
    ).toMatchObject({ type: 'error', code: 'provider_error' });
  });

  it('accepts null-valued optional fields from compatible Responses relays', () => {
    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);

    expect(
      decode(
        JSON.stringify({
          type: 'response.output_text.delta',
          delta: null,
          item_id: null,
          summary_index: null,
          item: null,
          response: null,
          code: null,
          message: null,
          param: null,
        }),
      ),
    ).toMatchObject({ type: 'response.output_text.delta' });
  });

  it('accepts null-valued nested usage, incomplete details, and output item fields', () => {
    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);

    expect(
      decode(
        JSON.stringify({
          type: 'response.incomplete',
          response: {
            id: null,
            service_tier: null,
            incomplete_details: { reason: null },
            usage: {
              input_tokens: null,
              input_tokens_details: { cached_tokens: null },
              output_tokens: null,
              output_tokens_details: { reasoning_tokens: null },
              total_tokens: null,
            },
            error: null,
          },
        }),
      ),
    ).toMatchObject({ type: 'response.incomplete' });

    expect(
      decode(
        JSON.stringify({
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            id: null,
            call_id: null,
            name: null,
            arguments: null,
            status: null,
            action: null,
            output: null,
            encrypted_content: null,
          },
        }),
      ),
    ).toMatchObject({ item: { type: 'function_call', arguments: null } });
  });

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

  it('decodes an event when an SSE relay provides the type only in the event name', async () => {
    const frames = await Effect.runPromise(
      sseFraming(
        Stream.fromIterable([
          new TextEncoder().encode(
            'event: response.output_text.delta\ndata: {"item_id":"msg_1","delta":"你好"}\n\n',
          ),
        ]),
      ).pipe(
        Stream.runFold(
          () => [],
          (items, frame) => [...items, frame],
        ),
      ),
    );

    const decode = Schema.decodeUnknownSync(OpenAIResponses.protocol.stream.event);

    expect(decode(frames[0])).toMatchObject({
      type: 'response.output_text.delta',
      item_id: 'msg_1',
      delta: '你好',
    });
  });

  it('preserves an event type already present in the SSE data payload', async () => {
    const frames = await Effect.runPromise(
      sseFraming(
        Stream.fromIterable([
          new TextEncoder().encode(
            'event: response.output_text.delta\ndata: {"type":"response.completed"}\n\n',
          ),
        ]),
      ).pipe(
        Stream.runFold(
          () => [],
          (items, frame) => [...items, frame],
        ),
      ),
    );

    expect(frames).toEqual(['{"type":"response.completed"}']);
  });
});
