/**
 * Coverage for the V1 → v2 hook shim (`src/plugin/v1-shim.ts`):
 * legacy two-argument callbacks keyed by the original hook names are
 * re-shaped onto the v2 domain registry while preserving the original
 * calling convention for the plugin author.
 *
 *   `chat.message` → `session.prompt`
 *   `chat.params`  → `session.context`
 *   `tool.execute.after` keeps its `(input, output)` shape including
 *   the optional `title` field.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _registerPluginForTest,
  _resetPluginsForTest,
  dispatchChatMessage,
  dispatchChatParams,
  dispatchToolExecuteAfter,
  type ChatParamsOutput,
  type ToolExecuteAfterOutput,
} from '../../runtime/plugin-host.js';

describe('v1 hook shim', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
  });

  it('maps chat.message onto session.prompt with the legacy two-argument shape', async () => {
    const seen: { sessionID: string; modelId?: string; messageID?: string }[] = [];

    _registerPluginForTest('legacy-message', {
      'chat.message': (input, output) => {
        seen.push({
          sessionID: input.sessionID,
          modelId: input.modelId,
          messageID: input.messageID,
        });
        output.message = { role: 'user', content: `${String(output.message.content)} [tagged]` };
        output.parts.push('injected-part');
      },
    });

    const output = {
      message: { role: 'user', content: 'hello' },
      parts: [] as unknown[],
    };
    await dispatchChatMessage({ sessionID: 's1', modelId: 'm1', messageID: 'msg-1' }, output);

    expect(seen).toEqual([{ sessionID: 's1', modelId: 'm1', messageID: 'msg-1' }]);
    expect(output.message.content).toBe('hello [tagged]');
    expect(output.parts).toEqual(['injected-part']);
  });

  it('maps chat.params onto session.context and folds mutations back', async () => {
    const seen: { sessionID: string; modelId: string }[] = [];

    _registerPluginForTest('legacy-params', {
      'chat.params': (input, output) => {
        seen.push({ sessionID: input.sessionID, modelId: input.modelId });
        output.temperature = 0;
        output.maxOutputTokens = 4096;
        output.options['plugin-tag'] = 'deterministic';
      },
    });

    const output: ChatParamsOutput = { temperature: 0.9, options: {} };
    await dispatchChatParams({ sessionID: 's1', modelId: 'gpt-5' }, output);

    expect(seen).toEqual([{ sessionID: 's1', modelId: 'gpt-5' }]);
    expect(output.temperature).toBe(0);
    expect(output.maxOutputTokens).toBe(4096);
    expect(output.options['plugin-tag']).toBe('deterministic');
  });

  it('preserves the tool.execute.after title field through the shim', async () => {
    _registerPluginForTest('legacy-after', {
      'tool.execute.after': (_input, output) => {
        output.title = 'renamed by plugin';
      },
    });

    const output: ToolExecuteAfterOutput = {
      output: 'done' as unknown,
      metadata: {} as Record<string, unknown>,
    };
    await dispatchToolExecuteAfter(
      { tool: 'bash', sessionID: 's1', callID: 'c1', args: {} },
      output,
    );

    expect(output.title).toBe('renamed by plugin');
    expect(output.output).toBe('done');
  });
});
