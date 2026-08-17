import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_CATALOG } from '../../../../../packages/agent-core/src/provider/catalog.js';
import type {
  ProviderCatalogEntry,
  ProviderUpstreamVariant,
} from '../../../../../packages/agent-core/src/provider/catalog.js';
import { resolveUpstreamProtocol, type UpstreamProtocol } from '../../routes/upstream-protocol.js';
import {
  mergeCompactionMetadata,
  readPersistedCompactionMemory,
} from '../../compaction/compaction-metadata.js';
import {
  buildCompactionMarkerContent,
  parseCompactionMarkerText,
} from '../../compaction/compaction-marker.js';
import {
  buildDurableCompactionSummary,
  buildPreparedUpstreamConversation,
} from '../../session/session-message-store.js';
import type { Message } from '@openAwork/shared';
import * as LLM from '../../../../../packages/opencode-llm/src/llm.js';
import * as AnthropicMessages from '../../../../../packages/opencode-llm/src/protocols/anthropic-messages.js';

const FIXED_NOW = 1_754_000_000_000;
const SOURCE = 'openawork_internal';
const MARKER_TYPE = 'compaction_marker';
const CONTEXT_MANAGEMENT = {
  edits: [{ type: 'clear_thinking_20251015', keep: { type: 'thinking_turns', value: 2 } }],
} as const;

type EntryPoint = 'main stream' | 'recovery stream' | 'overflow recovery';

type MatrixCase = {
  readonly entryPoint: string;
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly protocol: UpstreamProtocol;
  readonly contextWindow?: number;
};

type Scenario = {
  readonly entryPoint: EntryPoint;
  readonly trigger: 'automatic' | 'manual';
};

const SCENARIOS: readonly Scenario[] = [
  { entryPoint: 'main stream', trigger: 'manual' },
  { entryPoint: 'recovery stream', trigger: 'automatic' },
  { entryPoint: 'overflow recovery', trigger: 'automatic' },
];

function firstModel(entry: ProviderCatalogEntry): string {
  return entry.defaultModels[0]?.id ?? `${entry.type}-fixture-model`;
}

function resolveCatalogProtocol(
  entry: ProviderCatalogEntry,
  upstream: ProviderUpstreamVariant,
  model: string,
): UpstreamProtocol {
  return resolveUpstreamProtocol({
    model,
    providerType: entry.type,
    baseUrl: upstream.baseUrl,
    ...(upstream.protocol ? { explicitOverride: upstream.protocol } : {}),
  });
}

function buildMatrixCases(): readonly MatrixCase[] {
  const catalogCases = PROVIDER_CATALOG.flatMap((entry) => {
    const model = firstModel(entry);
    return entry.upstreams.map((upstream) => ({
      entryPoint: upstream.label,
      provider: entry.type,
      model,
      baseUrl: upstream.baseUrl,
      protocol: resolveCatalogProtocol(entry, upstream, model),
      ...(entry.defaultModels[0]?.contextWindow !== undefined
        ? { contextWindow: entry.defaultModels[0].contextWindow }
        : {}),
    }));
  });

  return [
    ...catalogCases,
    {
      entryPoint: 'custom Anthropic relay',
      provider: 'custom',
      model: 'claude-relay-fixture',
      baseUrl: 'https://relay.example/v1',
      protocol: 'anthropic_messages',
    },
    {
      entryPoint: 'unknown provider fallback',
      provider: 'unknown-provider',
      model: 'unknown-fixture',
      baseUrl: 'https://unknown.example/v1',
      protocol: 'chat_completions',
    },
    {
      entryPoint: 'missing contextWindow fallback',
      provider: 'custom',
      model: 'contextless-fixture',
      baseUrl: 'https://relay.example/v1',
      protocol: 'chat_completions',
    },
  ];
}

const MATRIX_CASES = buildMatrixCases();

function textMessage(id: string, role: 'user' | 'assistant', text: string): Message {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    createdAt: FIXED_NOW,
  };
}

function hasOwn(value: unknown, key: string): boolean {
  return (
    typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
  );
}

function markerMessage(input: {
  readonly omittedMessages: number;
  readonly persistedMemory: unknown;
  readonly signature: string;
  readonly summary: string;
  readonly tailStartMessageId: string;
  readonly trigger: string;
}): Message {
  const marker = buildCompactionMarkerContent({
    ...input,
    source: SOURCE,
    markerType: MARKER_TYPE,
  });
  return {
    id: `marker-${input.signature}`,
    role: 'assistant',
    clientRequestId: marker.clientRequestId,
    content: marker.content,
    createdAt: FIXED_NOW,
  };
}

function baseHistory(): Message[] {
  return [
    textMessage('user-1', 'user', 'retain the migration goal'),
    textMessage('assistant-1', 'assistant', 'implemented the first deterministic step'),
    textMessage('user-2', 'user', 'continue with the provider matrix'),
    textMessage('assistant-2', 'assistant', 'recorded the protocol-specific outcome'),
  ];
}

function isOfficialAnthropicRoute(testCase: MatrixCase): boolean {
  try {
    return (
      testCase.provider === 'anthropic' &&
      new URL(testCase.baseUrl).hostname === 'api.anthropic.com'
    );
  } catch (error: unknown) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

async function projectAnthropicCapability(testCase: MatrixCase): Promise<unknown> {
  const route = AnthropicMessages.route.with({
    provider: testCase.provider,
    endpoint: { baseURL: testCase.baseUrl },
  });
  const model = route.model({ id: testCase.model });
  const request = LLM.request({
    model,
    prompt: 'compaction fixture',
    providerOptions: { anthropic: { contextManagement: CONTEXT_MANAGEMENT } },
  });
  const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
  return body;
}

describe('compaction provider parity matrix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(
    MATRIX_CASES.flatMap((testCase) => SCENARIOS.map((scenario) => ({ testCase, scenario }))),
  )(
    '$testCase.provider / $testCase.protocol / $testCase.entryPoint / $scenario.entryPoint',
    async ({ testCase, scenario }) => {
      const history = baseHistory();
      const durable = buildDurableCompactionSummary({
        messages: history.slice(0, 2),
        recentMessagesKept: 2,
        trigger: scenario.trigger,
      });
      expect(durable).not.toBeNull();
      if (!durable) return;

      const metadata: Record<string, unknown> = {
        ...mergeCompactionMetadata('{}', {
          summary: durable.structuredSummary,
          trigger: scenario.trigger,
          omittedMessages: durable.totalRepresentedMessages,
          recentMessagesKept: 2,
          signature: durable.signature,
          persistedMemory: durable.persistedMemory,
        }),
        lastCompactionLlmSummary: durable.structuredSummary,
      };
      const metadataJson = JSON.stringify(metadata);
      const marker = markerMessage({
        omittedMessages: durable.totalRepresentedMessages,
        persistedMemory: durable.persistedMemory,
        signature: durable.signature,
        summary: durable.structuredSummary,
        tailStartMessageId: 'user-2',
        trigger: scenario.trigger,
      });
      const reloadedHistory = [marker, ...history.slice(2)];
      const prepared = buildPreparedUpstreamConversation(reloadedHistory, {
        contextWindow: testCase.contextWindow ?? 128_000,
        metadataJson,
      });
      const markerRecord = parseCompactionMarkerText(
        marker.content[0]?.type === 'text' ? marker.content[0].text : '',
        { source: SOURCE, markerType: MARKER_TYPE },
      );
      const persisted = readPersistedCompactionMemory(metadataJson);

      expect(markerRecord?.signature).toBe(durable.signature);
      expect(persisted?.coveredUntilMessageId).toBe('assistant-1');
      expect(metadata['lastCompactionTrigger']).toBe(scenario.trigger);
      expect(metadata['lastCompactionSignature']).toBe(durable.signature);
      expect(prepared.normalizedMessages).toEqual(
        expect.arrayContaining([
          { role: 'user', content: 'What did we do so far?' },
          { role: 'assistant', content: durable.structuredSummary },
          { role: 'user', content: 'continue with the provider matrix' },
        ]),
      );
      expect(prepared.report?.compactSummaryInjected).toBe(false);

      if (testCase.protocol === 'anthropic_messages') {
        const body = await projectAnthropicCapability(testCase);
        if (isOfficialAnthropicRoute(testCase)) {
          expect(hasOwn(body, 'context_management')).toBe(true);
        } else {
          expect(hasOwn(body, 'context_management')).toBe(false);
        }
      }
    },
  );

  it('uses an explicit local fallback for overflow with no history', () => {
    const metadata = mergeCompactionMetadata('{"stale":"preserve"}', {
      summary: '',
      trigger: 'automatic',
      omittedMessages: 0,
      recentMessagesKept: 0,
    });
    const prepared = buildPreparedUpstreamConversation([], {
      contextWindow: 128_000,
      metadataJson: JSON.stringify(metadata),
    });

    expect(metadata['stale']).toBe('preserve');
    expect(prepared.normalizedMessages).toEqual([]);
    expect(prepared.report?.compactSummaryInjected).toBe(false);
  });

  it('does not leak repeated cache usage fields into the reloaded model input', () => {
    const history = baseHistory().map((message) => ({
      ...message,
      providerUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
      },
    }));
    const prepared = buildPreparedUpstreamConversation(history, { contextWindow: 128_000 });
    const serialized = JSON.stringify(prepared.normalizedMessages);

    expect(serialized).not.toContain('cacheReadTokens');
    expect(serialized).not.toContain('cacheWriteTokens');
    expect(serialized).not.toContain('providerUsage');
  });
});
