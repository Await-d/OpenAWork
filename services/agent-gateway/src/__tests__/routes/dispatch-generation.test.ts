import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { planDispatch } from '../../dispatch/dispatch-generation.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('../../provider/provider-catalog.js', () => ({
  getChatProvider: () => ({ provider: { id: 'test-provider' }, modelId: 'test-model' }),
  getProviderForSelection: mocks.select,
}));

vi.mock('../../provider/model-router.js', () => ({
  resolveModelRouteFromProvider: () => ({
    providerType: 'openai',
    model: 'test-model',
    requestOverrides: {
      headers: { 'x-test-provider': 'test' },
      body: { metadata: { source: 'account-setting' } },
    },
  }),
}));

vi.mock('../../v2-runtime/upstream/run-upstream-generate.js', () => ({
  runUpstreamGenerate: mocks.generate,
}));

it('sends only the goal when planning and does not forward provider body overrides', async () => {
  const selection = { providerId: 'test-provider', modelId: 'test-model' };
  const plan = {
    title: 'Meeting notes',
    items: [
      {
        title: 'Actions',
        objective: 'Extract decisions',
        acceptance: 'List them',
        role: 'extract',
      },
    ],
  };
  mocks.select.mockResolvedValue({
    provider: { id: selection.providerId },
    modelId: selection.modelId,
  });
  mocks.generate.mockReturnValue(Effect.succeed({ text: JSON.stringify(plan) }));
  const signal = new AbortController().signal;

  await expect(
    planDispatch(
      'owner',
      { request: 'Extract the decisions', excerpt: 'Private meeting notes' },
      signal,
    ),
  ).resolves.toEqual({ selection, plan });
  expect(mocks.select).toHaveBeenCalledExactlyOnceWith('owner', selection, {
    fallbackToChat: false,
  });
  expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      messages: [{ role: 'user', content: JSON.stringify({ request: 'Extract the decisions' }) }],
      requestOverrides: { headers: { 'x-test-provider': 'test' } },
      signal,
    }),
  );
});
