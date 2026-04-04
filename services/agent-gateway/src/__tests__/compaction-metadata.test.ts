import { describe, expect, it } from 'vitest';
import {
  mergePersistedCompactionMemory,
  readPersistedCompactionMemory,
  renderPersistedCompactionMemory,
} from '../compaction-metadata.js';

describe('compaction metadata', () => {
  it('safely ignores malformed metadata json and invalid compaction memory shapes', () => {
    expect(readPersistedCompactionMemory('{invalid-json')).toBeNull();
    expect(
      readPersistedCompactionMemory(
        JSON.stringify({
          compactionMemory: {
            schemaVersion: 1,
            summarizedMessages: 'bad-type',
          },
        }),
      ),
    ).toBeNull();

    expect(
      readPersistedCompactionMemory(
        JSON.stringify({
          compactionMemory: {
            coveredUntilMessageId: 'assistant-2',
            summarizedMessages: 'bad-type',
            userGoals: ['目标 1', '目标 1', '目标 2', '目标 3', '目标 4', '目标 5'],
            assistantProgress: [
              '进展 1',
              '进展 2',
              '进展 3',
              '进展 4',
              '进展 5',
              '进展 6',
              '进展 7',
            ],
          },
        }),
      ),
    ).toMatchObject({
      coveredUntilMessageId: 'assistant-2',
      summarizedMessages: 0,
      userGoals: ['目标 2', '目标 3', '目标 4', '目标 5'],
      assistantProgress: ['进展 2', '进展 3', '进展 4', '进展 5', '进展 6', '进展 7'],
    });
  });

  it('deduplicates and caps merged compaction memory fields', () => {
    const merged = mergePersistedCompactionMemory(
      {
        schemaVersion: 1,
        coveredUntilMessageId: 'assistant-2',
        updatedAt: 1,
        compactionCount: 2,
        summarizedMessages: 6,
        lastTrigger: 'automatic',
        userGoals: ['目标 1', '目标 2'],
        assistantProgress: ['进展 1', '进展 2'],
        toolActivity: ['tool-a'],
        filesReferenced: ['a.ts'],
        latestUserRequest: '旧请求',
        lastCompactionSignature: 'sig-1',
      },
      {
        coveredUntilMessageId: 'assistant-4',
        fields: {
          userGoals: ['目标 2', '目标 3', '目标 4', '目标 5', '目标 6'],
          assistantProgress: ['进展 2', '进展 3', '进展 4', '进展 5', '进展 6', '进展 7'],
          toolActivity: ['tool-a', 'tool-b', 'tool-c', 'tool-d', 'tool-e', 'tool-f', 'tool-g'],
          filesReferenced: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts', 'i.ts'],
          latestUserRequest: '新请求',
        },
        newlySummarizedMessages: 4,
        signature: 'sig-2',
        trigger: 'manual',
      },
    );

    expect(merged).toMatchObject({
      coveredUntilMessageId: 'assistant-4',
      compactionCount: 3,
      summarizedMessages: 10,
      lastTrigger: 'manual',
      latestUserRequest: '新请求',
      lastCompactionSignature: 'sig-2',
      userGoals: ['目标 3', '目标 4', '目标 5', '目标 6'],
      assistantProgress: ['进展 2', '进展 3', '进展 4', '进展 5', '进展 6', '进展 7'],
      toolActivity: ['tool-b', 'tool-c', 'tool-d', 'tool-e', 'tool-f', 'tool-g'],
      filesReferenced: ['b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts', 'i.ts'],
    });
  });

  it('renders durable compaction memory with the persisted boundary details', () => {
    const summary = renderPersistedCompactionMemory({
      memory: {
        schemaVersion: 1,
        coveredUntilMessageId: 'assistant-4',
        updatedAt: 1,
        compactionCount: 3,
        summarizedMessages: 10,
        lastTrigger: 'manual',
        userGoals: ['目标 3'],
        assistantProgress: ['进展 7'],
        toolActivity: ['tool-g'],
        filesReferenced: ['i.ts'],
        latestUserRequest: '新请求',
        lastCompactionSignature: 'sig-2',
      },
      omittedMessages: 10,
      recentMessagesKept: 2,
      trigger: 'manual',
    });

    expect(summary).toContain('Durable session compaction memory (manual compaction).');
    expect(summary).toContain('Covered until message id: assistant-4');
    expect(summary).toContain('Cumulative summarized messages: 10');
    expect(summary).toContain('- 目标 3');
  });
});
