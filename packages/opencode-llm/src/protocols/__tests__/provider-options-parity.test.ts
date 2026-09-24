import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import { ToolDefinition } from '../../schema/index.js';
import * as AnthropicMessages from '../anthropic-messages.js';
import * as Gemini from '../gemini.js';
import * as OpenAIResponses from '../openai-responses.js';

/**
 * 逐项审计补齐（对齐 opencode 参考库）：
 * - `ToolChoice.disableParallelToolUse` → Anthropic `disable_parallel_tool_use` /
 *   Responses `parallel_tool_calls`；
 * - Gemini `safetySettings` provider option 透传。
 */

const testTool = ToolDefinition.make({
  name: 'read_file',
  description: '读取文件',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
});

describe('并行工具调用开关对齐', () => {
  it('Anthropic：disableParallelToolUse 下发 disable_parallel_tool_use', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const request = LLM.request({
      model,
      prompt: 'hi',
      tools: [testTool],
      toolChoice: { type: 'auto', disableParallelToolUse: true },
    });

    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
    expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  it('Responses：disableParallelToolUse 推导 parallel_tool_calls:false，显式配置优先', async () => {
    const model = OpenAIResponses.route.model({ id: 'gpt-5' });
    const derived = LLM.request({
      model,
      prompt: 'hi',
      tools: [testTool],
      toolChoice: { type: 'auto', disableParallelToolUse: true },
    });
    const derivedBody = await Effect.runPromise(OpenAIResponses.protocol.body.from(derived));
    expect(derivedBody.parallel_tool_calls).toBe(false);

    const configured = LLM.request({
      model,
      prompt: 'hi',
      tools: [testTool],
      providerOptions: { openai: { parallelToolCalls: true } },
    });
    const configuredBody = await Effect.runPromise(OpenAIResponses.protocol.body.from(configured));
    expect(configuredBody.parallel_tool_calls).toBe(true);

    const absent = LLM.request({ model, prompt: 'hi', tools: [testTool] });
    const absentBody = await Effect.runPromise(OpenAIResponses.protocol.body.from(absent));
    expect(absentBody.parallel_tool_calls).toBeUndefined();
  });

  it('Gemini：safetySettings / serviceTier / thinkingLevel 透传', async () => {
    const model = Gemini.route.model({ id: 'gemini-2.5-pro' });
    const request = LLM.request({
      model,
      prompt: 'hi',
      providerOptions: {
        gemini: {
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
          ],
          serviceTier: 'flex',
          thinkingConfig: { thinkingLevel: 'low', includeThoughts: false },
        },
      },
    });
    const body = await Effect.runPromise(Gemini.protocol.body.from(request));
    expect(body.safetySettings).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
    ]);
    expect(body.serviceTier).toBe('flex');
    expect(body.generationConfig?.thinkingConfig).toMatchObject({ thinkingLevel: 'low' });

    const invalid = LLM.request({
      model,
      prompt: 'hi',
      providerOptions: { gemini: { safetySettings: [{ category: 'X' }] } },
    });
    await expect(Effect.runPromise(Gemini.protocol.body.from(invalid))).rejects.toThrow(
      /threshold/,
    );
  });

  it('Responses：maxToolCalls 透传', async () => {
    const model = OpenAIResponses.route.model({ id: 'gpt-5' });
    const request = LLM.request({
      model,
      prompt: 'hi',
      tools: [testTool],
      providerOptions: { openai: { maxToolCalls: 3 } },
    });
    const body = await Effect.runPromise(OpenAIResponses.protocol.body.from(request));

    expect(body.max_tool_calls).toBe(3);
  });
});
