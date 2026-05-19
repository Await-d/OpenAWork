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
    const timeDiff = (left.createdAt ?? 0) - (right.createdAt ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return left.id.localeCompare(right.id);
  });
}
