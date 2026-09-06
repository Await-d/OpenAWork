import type { Message } from '@openAwork/opencode-llm';

export interface NativeToolContextGuardOptions {
  readonly maxTotalToolCostChars?: number;
}

export function guardNativeToolContext(
  messages: readonly Message[],
  _options: NativeToolContextGuardOptions = {},
): Message[] {
  return messages.map((message) => ({
    ...message,
    content: [...message.content],
  }));
}
