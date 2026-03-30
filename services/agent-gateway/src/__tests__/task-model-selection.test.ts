import { describe, expect, it, vi } from 'vitest';

const mockedDb = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mockedDb.sqliteGetMock,
}));

import { selectDelegatedModelForUser } from '../task-model-selection.js';

describe('selectDelegatedModelForUser', () => {
  it('prefers the first candidate available in enabled providers', () => {
    mockedDb.sqliteGetMock.mockReturnValue({
      value: JSON.stringify([
        {
          id: 'provider-openai',
          enabled: true,
          defaultModels: [{ id: 'gpt-5.4', enabled: true }],
        },
        {
          id: 'provider-anthropic',
          enabled: true,
          defaultModels: [{ id: 'claude-opus-4-6', enabled: true }],
        },
      ]),
    });

    expect(selectDelegatedModelForUser('user-1', ['claude-opus-4-6', 'gpt-5.4'])).toEqual({
      providerId: 'provider-anthropic',
      modelId: 'claude-opus-4-6',
    });
  });

  it('falls back to the first candidate when no configured provider offers it', () => {
    mockedDb.sqliteGetMock.mockReturnValue({ value: JSON.stringify([]) });

    expect(selectDelegatedModelForUser('user-1', ['gpt-5.4-mini'])).toEqual({
      modelId: 'gpt-5.4-mini',
    });
  });

  it('prefers provider-aware reference entries and carries variant through', () => {
    mockedDb.sqliteGetMock.mockReturnValue({
      value: JSON.stringify([
        {
          id: 'provider-gemini',
          type: 'gemini',
          enabled: true,
          defaultModels: [{ id: 'gemini-3.1-pro', enabled: true }],
        },
        {
          id: 'provider-openai',
          type: 'openai',
          enabled: true,
          defaultModels: [{ id: 'gpt-5.4', enabled: true }],
        },
      ]),
    });

    expect(
      selectDelegatedModelForUser('user-1', [
        { modelId: 'gemini-3.1-pro', providerHints: ['google'], variant: 'high' },
        { modelId: 'gpt-5.4', providerHints: ['openai'], variant: 'medium' },
      ]),
    ).toEqual({
      providerId: 'provider-gemini',
      modelId: 'gemini-3.1-pro',
      variant: 'high',
    });
  });
});
