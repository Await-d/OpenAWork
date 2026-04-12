import type { Message } from '@openAwork/shared';

export function mergeRuntimeSafeSessionMessages(input: {
  legacyMessages: Message[];
  runtimeMessages: Message[];
}): Message[] {
  const byId = new Map<string, Message>();

  for (const message of input.legacyMessages) {
    byId.set(message.id, message);
  }

  for (const message of input.runtimeMessages) {
    if (!byId.has(message.id)) {
      byId.set(message.id, message);
    }
  }

  return [...byId.values()].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }

    return left.createdAt - right.createdAt;
  });
}
