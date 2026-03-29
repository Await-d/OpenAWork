import type { Message } from '@openAwork/shared';

export type CompactionStrategy = 'summarize' | 'truncate' | 'sliding';

export interface ContextCompactor {
  getUsageRatio(): number;
  compact(messages: Message[], strategy: CompactionStrategy): Promise<Message[]>;
  shouldCompact(usageRatio: number): boolean;
}

const AUTO_COMPACT_THRESHOLD = 0.95;
const COMPACT_TARGET_RATIO = 0.6;
const SLIDING_KEEP_RECENT = 20;

export interface ContextCompactorOptions {
  maxTokens?: number;
  threshold?: number;
  targetRatio?: number;
  countTokens?: (messages: Message[]) => number;
  summarize?: (messages: Message[]) => Promise<string>;
}

function countWordPieces(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0;
    if (cp > 0x2e80) {
      count += 2;
      i += cp > 0xffff ? 2 : 1;
    } else if (/\S/.test(text[i] ?? '')) {
      while (i < text.length && /\S/.test(text[i] ?? '') && (text.codePointAt(i) ?? 0) <= 0x2e80)
        i++;
      count += 1;
    } else {
      i++;
    }
  }
  return Math.ceil(count * 1.3);
}

function defaultCountTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => {
    const content = m.content.map((c) => ('text' in c ? c.text : JSON.stringify(c))).join('');
    return sum + countWordPieces(content);
  }, 0);
}

export function createContextCompactor(options: ContextCompactorOptions = {}): ContextCompactor {
  const maxTokens = options.maxTokens ?? 200_000;
  const threshold = options.threshold ?? AUTO_COMPACT_THRESHOLD;
  const targetRatio = options.targetRatio ?? COMPACT_TARGET_RATIO;
  const countTokens = options.countTokens ?? defaultCountTokens;
  const summarizeFn = options.summarize;

  let currentMessages: Message[] = [];

  function getCurrentTokens(): number {
    return countTokens(currentMessages);
  }

  return {
    getUsageRatio(): number {
      return getCurrentTokens() / maxTokens;
    },

    shouldCompact(usageRatio: number): boolean {
      return usageRatio >= threshold;
    },

    async compact(messages: Message[], strategy: CompactionStrategy): Promise<Message[]> {
      currentMessages = messages;
      const targetTokens = Math.floor(maxTokens * targetRatio);

      if (strategy === 'truncate') {
        let tokens = 0;
        const kept: Message[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i]!;
          const msgTokens = countTokens([msg]);
          if (tokens + msgTokens > targetTokens) break;
          kept.unshift(msg);
          tokens += msgTokens;
        }
        currentMessages = kept;
        return kept;
      }

      if (strategy === 'sliding') {
        const systemMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
        const recent = systemMessages.slice(-SLIDING_KEEP_RECENT);
        currentMessages = recent;
        return recent;
      }

      if (strategy === 'summarize') {
        const systemMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
        const toSummarize = systemMessages.slice(0, -SLIDING_KEEP_RECENT);
        const recent = systemMessages.slice(-SLIDING_KEEP_RECENT);

        if (toSummarize.length === 0) {
          currentMessages = recent;
          return recent;
        }

        let summaryText = `[Conversation summary: ${toSummarize.length} messages omitted]`;

        if (summarizeFn) {
          try {
            summaryText = await summarizeFn(toSummarize);
          } catch {
            summaryText = toSummarize
              .map((m) => m.content.map((c) => ('text' in c ? c.text : '')).join(''))
              .join('\n');
          }
        }

        const summaryMessage: Message = {
          id: `compact-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text: summaryText }],
          createdAt: Date.now(),
        };

        const compacted = [summaryMessage, ...recent];
        currentMessages = compacted;
        return compacted;
      }

      return messages;
    },
  };
}

export { AUTO_COMPACT_THRESHOLD, COMPACT_TARGET_RATIO };
