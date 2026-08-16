/**
 * OpenCode LLM 集成示例
 *
 * 展示如何在 agent-gateway 中使用 opencode-llm 包
 */

import { Effect, Layer, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';

type ExampleStreamOutput =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'tool-call'; readonly name: string; readonly input: unknown }
  | { readonly type: 'complete'; readonly reason: OpenCodeLLM.FinishReason };

type AdapterResponse = {
  readonly text: string;
  readonly usage: OpenCodeLLM.Usage | undefined;
  readonly finishReason: OpenCodeLLM.FinishReason;
};

/**
 * 示例 1: 创建一个简单的 LLM 请求
 */
export function createSimpleRequest(apiKey?: string) {
  const message = new OpenCodeLLM.Message({
    role: 'user',
    content: [
      {
        type: 'text',
        text: '你好，请介绍一下自己。',
      },
    ],
  });

  const request = OpenCodeLLM.LLM.request({
    model: OpenCodeLLM.Providers.OpenAI.configure(apiKey ? { apiKey } : {}).chat('gpt-4'),
    messages: [message],
  });

  return request;
}

/**
 * 示例 2: 创建带工具的请求
 */
export function createRequestWithTools(apiKey?: string) {
  const weatherTool = new OpenCodeLLM.ToolDefinition({
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    inputSchema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称，如：北京、上海',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: '温度单位',
        },
      },
      required: ['city'],
    },
  });

  const message = new OpenCodeLLM.Message({
    role: 'user',
    content: [
      {
        type: 'text',
        text: '北京今天天气怎么样？',
      },
    ],
  });

  const request = OpenCodeLLM.LLM.request({
    model: OpenCodeLLM.Providers.OpenAI.configure(apiKey ? { apiKey } : {}).chat('gpt-4'),
    messages: [message],
    tools: [weatherTool],
  });

  return request;
}

/**
 * 示例 3: 使用 LLMClient 发送请求（需要配置 API 密钥）
 */
export async function sendRequestWithClient(apiKey: string) {
  const request = createSimpleRequest(apiKey);
  const layer = OpenCodeLLM.LLMClient.layer.pipe(
    Layer.provide(OpenCodeLLM.RequestExecutor.fetchLayer),
  );
  return Effect.runPromise(OpenCodeLLM.LLMClient.generate(request).pipe(Effect.provide(layer)));
}

/**
 * 示例 4: 处理流式响应事件
 */
export function handleStreamEvents(
  events: Stream.Stream<OpenCodeLLM.LLMEvent, OpenCodeLLM.LLMError>,
): Stream.Stream<ExampleStreamOutput, OpenCodeLLM.LLMError> {
  const mapEvent = (event: OpenCodeLLM.LLMEvent): Stream.Stream<ExampleStreamOutput> => {
    switch (event.type) {
      case 'text-delta':
        return Stream.succeed<ExampleStreamOutput>({ type: 'text', content: event.text });
      case 'tool-call':
        return Stream.succeed<ExampleStreamOutput>({
          type: 'tool-call',
          name: event.name,
          input: event.input,
        });
      case 'finish':
        return Stream.succeed<ExampleStreamOutput>({ type: 'complete', reason: event.reason });
      case 'step-start':
      case 'text-start':
      case 'text-end':
      case 'reasoning-start':
      case 'reasoning-delta':
      case 'reasoning-end':
      case 'tool-input-start':
      case 'tool-input-delta':
      case 'tool-input-end':
      case 'tool-result':
      case 'tool-error':
      case 'step-finish':
      case 'provider-error':
        return Stream.empty;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };
  return events.pipe(Stream.flatMap(mapEvent));
}

/**
 * 示例 5: 与现有上游调用集成
 *
 * 展示如何将 opencode-llm 与 agent-gateway 现有的上游调用集成
 */
export interface OpenCodeLLMAdapter {
  model: OpenCodeLLM.Model;
  createRequest: (messages: OpenCodeLLM.Message[]) => OpenCodeLLM.LLMRequest;
  processResponse: (response: OpenCodeLLM.LLMResponse) => AdapterResponse;
}

export function createAdapter(provider: string, modelId: string): OpenCodeLLMAdapter {
  const model = OpenCodeLLM.Providers.OpenAICompatible.configure({
    provider,
    baseURL: 'https://api.openai.com/v1',
  }).model(modelId);

  return {
    model,

    createRequest(messages: OpenCodeLLM.Message[]) {
      return OpenCodeLLM.LLM.request({
        model: this.model,
        messages,
      });
    },

    processResponse(response: OpenCodeLLM.LLMResponse) {
      // 将 OpenCode LLM 响应转换为 agent-gateway 格式
      return {
        text: response.text,
        usage: response.usage,
        finishReason: response.finishReason,
      };
    },
  };
}

/**
 * 示例 6: 错误处理
 */
export function handleLLMError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (OpenCodeLLM.isContextOverflow(message)) {
    console.error('上下文溢出错误:', error);
    return {
      type: 'context_overflow',
      message: '消息长度超出模型限制',
    };
  }

  if (OpenCodeLLM.isContextOverflowFailure(error)) {
    console.error('上下文溢出失败:', error);
    return {
      type: 'context_overflow_failure',
      message: '无法处理过长的上下文',
    };
  }

  // 其他错误
  console.error('LLM 错误:', error);
  return {
    type: 'unknown_error',
    message: String(error),
  };
}

/**
 * 使用示例
 */
export async function exampleUsage() {
  console.log('=== OpenCode LLM 集成示例 ===\n');

  // 1. 创建简单请求
  console.log('1. 创建简单请求');
  const simpleRequest = createSimpleRequest();
  console.log('  - 消息数:', simpleRequest.messages.length);
  console.log('  - 模型:', simpleRequest.model.id);

  // 2. 创建带工具的请求
  console.log('\n2. 创建带工具的请求');
  const toolRequest = createRequestWithTools();
  console.log('  - 工具数:', toolRequest.tools?.length || 0);

  // 3. 创建适配器
  console.log('\n3. 创建 OpenAI 适配器');
  const adapter = createAdapter('openai', 'gpt-4');
  console.log('  - 提供商:', adapter.model.provider);
  console.log('  - 模型:', adapter.model.id);

  console.log('\n✅ 所有示例创建成功');
  console.log('\n下一步: 配置 API 密钥并发送实际请求');
}
