/**
 * Coverage for `chat.params` plugin hook integration in
 * `runUpstreamStream` (PR-D-Plugin follow-up). Validates that:
 *
 *   1. Plugin mutations to `output.temperature` / `topP` /
 *      `maxOutputTokens` reach the AI SDK's `streamText` call.
 *   2. Plugin mutations to `options.frequencyPenalty` /
 *      `options.presencePenalty` are read back and forwarded.
 *   3. Plugins can NULL out a param (set it to `undefined`) — the
 *      runner must then NOT pass it to streamText.
 *   4. A throwing plugin doesn't crash the stream.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV3 as MockLanguageModelV2 } from 'ai/test';
import type { StreamChunk } from '@openAwork/shared';
import { runUpstreamStream, type V2LanguageModel } from '../../v2-runtime/upstream/index.js';
import { _registerPluginForTest, _resetPluginsForTest } from '../../plugin-host.js';

function buildMockModel(onDoStream?: (options: unknown) => void): V2LanguageModel {
  return new MockLanguageModelV2({
    doStream: async (options: unknown) => {
      onDoStream?.(options);
      return {
        stream: new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' });
            controller.enqueue({ type: 'text-end', id: 't1' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }) as never,
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
      };
    },
  }) as unknown as V2LanguageModel;
}

async function drain(iter: AsyncIterable<StreamChunk>): Promise<void> {
  for await (const _ of iter) {
    void _;
  }
}

describe('chat.params plugin hook in runUpstreamStream', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
  });

  it('plugin can override temperature and the new value reaches streamText', async () => {
    _registerPluginForTest('test', {
      'chat.params': (_input, output) => {
        output.temperature = 0;
      },
    });

    let observedOptions: { temperature?: number } | undefined;
    const model = buildMockModel((opts) => {
      observedOptions = opts as { temperature?: number };
    });

    await drain(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'q' }],
        temperature: 0.7, // input
      }),
    );

    expect(observedOptions?.temperature).toBe(0); // overridden by plugin
  });

  it('plugin can override topP and maxOutputTokens together', async () => {
    _registerPluginForTest('test', {
      'chat.params': (_input, output) => {
        output.topP = 0.5;
        output.maxOutputTokens = 100;
      },
    });

    let observed: { topP?: number; maxOutputTokens?: number } | undefined;
    const model = buildMockModel((opts) => {
      observed = opts as { topP?: number; maxOutputTokens?: number };
    });

    await drain(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'q' }],
        topP: 0.9,
        maxOutputTokens: 4000,
      }),
    );

    expect(observed?.topP).toBe(0.5);
    expect(observed?.maxOutputTokens).toBe(100);
  });

  it('plugin can override frequencyPenalty / presencePenalty via options bag', async () => {
    _registerPluginForTest('test', {
      'chat.params': (_input, output) => {
        output.options['frequencyPenalty'] = 1.5;
        output.options['presencePenalty'] = 0.3;
      },
    });

    let observed: { frequencyPenalty?: number; presencePenalty?: number } | undefined;
    const model = buildMockModel((opts) => {
      observed = opts as { frequencyPenalty?: number; presencePenalty?: number };
    });

    await drain(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'q' }],
        frequencyPenalty: 0,
        presencePenalty: 0,
      }),
    );

    expect(observed?.frequencyPenalty).toBe(1.5);
    expect(observed?.presencePenalty).toBe(0.3);
  });

  it('plugin can NULL out a param (set undefined) and the input value is dropped', async () => {
    _registerPluginForTest('test', {
      'chat.params': (_input, output) => {
        // Plugin decides "stop sending temperature to the model".
        output.temperature = undefined;
      },
    });

    let observed: { temperature?: unknown } | undefined;
    const model = buildMockModel((opts) => {
      observed = opts as { temperature?: unknown };
    });

    await drain(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'q' }],
        temperature: 0.7,
      }),
    );

    // The plugin's `undefined` overwrites the input 0.7 — i.e. the
    // model does NOT see the original input value. (AI SDK may
    // still spread `temperature: undefined` onto its options object,
    // but the important guarantee is that 0.7 is dropped.)
    expect(observed?.temperature).toBeUndefined();
  });

  it('a throwing plugin does not crash the stream', async () => {
    _registerPluginForTest('crashy', {
      'chat.params': () => {
        throw new Error('plugin oopsie');
      },
    });

    const model = buildMockModel();
    // Should NOT throw — dispatcher isolates the plugin error.
    await drain(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'q' }],
        temperature: 0.5,
      }),
    );
  });
});
