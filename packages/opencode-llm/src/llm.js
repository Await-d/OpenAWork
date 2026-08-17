import { Effect, Schema } from 'effect';
import { LLMClient } from './route/client.js';
import {
  GenerationOptions,
  HttpOptions,
  InvalidProviderOutputReason,
  LLMError,
  LLMEvent,
  LLMRequest,
  Message,
  SystemPart,
  ToolChoice,
  ToolDefinition,
} from './schema/index.js';
import { make as makeTool, toDefinitions } from './tool.js';
export const generate = LLMClient.generate;
export const stream = LLMClient.stream;
export const requestInput = (input) => ({
  ...LLMRequest.input(input),
});
export const request = (input) => {
  const {
    system: requestSystem,
    prompt,
    messages,
    tools,
    toolChoice: requestToolChoice,
    generation: requestGeneration,
    providerOptions: requestProviderOptions,
    http: requestHttp,
    ...rest
  } = input;
  return new LLMRequest({
    ...rest,
    system: SystemPart.content(requestSystem),
    messages: [
      ...(messages?.map(Message.make) ?? []),
      ...(prompt === undefined ? [] : [Message.user(prompt)]),
    ],
    tools: tools?.map(ToolDefinition.make) ?? [],
    toolChoice: requestToolChoice ? ToolChoice.make(requestToolChoice) : undefined,
    generation:
      requestGeneration === undefined ? undefined : GenerationOptions.make(requestGeneration),
    providerOptions: requestProviderOptions,
    http: requestHttp === undefined ? undefined : HttpOptions.make(requestHttp),
  });
};
export const updateRequest = (input, patch) => request({ ...requestInput(input), ...patch });
const GENERATE_OBJECT_TOOL_NAME = 'generate_object';
const GENERATE_OBJECT_TOOL_DESCRIPTION = 'Return the structured result by calling this tool.';
export class GenerateObjectResponse {
  object;
  response;
  constructor(object, response) {
    this.object = object;
    this.response = response;
  }
  get events() {
    return this.response.events;
  }
  get usage() {
    return this.response.usage;
  }
}
const runGenerateObject = Effect.fn('LLM.generateObject')(function* (options, tool) {
  const baseRequest = request(options);
  const generateRequest = LLMRequest.update(baseRequest, {
    tools: toDefinitions({ [GENERATE_OBJECT_TOOL_NAME]: tool }),
    toolChoice: ToolChoice.named(GENERATE_OBJECT_TOOL_NAME),
  });
  const response = yield* LLMClient.generate(generateRequest);
  const call = response.toolCalls.find(
    (event) => LLMEvent.is.toolCall(event) && event.name === GENERATE_OBJECT_TOOL_NAME,
  );
  if (!call || !LLMEvent.is.toolCall(call))
    return yield* new LLMError({
      module: 'LLM',
      method: 'generateObject',
      reason: new InvalidProviderOutputReason({
        message: `generateObject: model did not call the forced \`${GENERATE_OBJECT_TOOL_NAME}\` tool`,
      }),
    });
  const object = yield* tool._decode(call.input).pipe(
    Effect.mapError(
      (error) =>
        new LLMError({
          module: 'LLM',
          method: 'generateObject',
          reason: new InvalidProviderOutputReason({
            message: `generateObject: tool input failed schema decode: ${error.message}`,
          }),
        }),
    ),
  );
  return new GenerateObjectResponse(object, response);
});
export function generateObject(options) {
  if ('schema' in options) {
    const { schema, ...rest } = options;
    return runGenerateObject(
      rest,
      makeTool({
        description: GENERATE_OBJECT_TOOL_DESCRIPTION,
        parameters: schema,
        success: Schema.Unknown,
        execute: () => Effect.void,
      }),
    );
  }
  const { jsonSchema, ...rest } = options;
  return runGenerateObject(
    rest,
    makeTool({
      description: GENERATE_OBJECT_TOOL_DESCRIPTION,
      jsonSchema,
      execute: () => Effect.void,
    }),
  );
}
//# sourceMappingURL=llm.js.map
