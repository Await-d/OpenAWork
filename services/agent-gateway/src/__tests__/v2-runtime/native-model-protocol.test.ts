import type { AIProvider } from '@openAwork/agent-core';
import { afterEach, describe, expect, it } from 'vitest';
import '../../provider/plugins/openai.js';
import {
  resolveCompactionRoute,
  resolveModelRouteFromProvider,
} from '../../provider/model-router.js';
import { buildNativeModel } from '../../v2-runtime/upstream/native-model.js';

const makeProvider = (overrides: Partial<AIProvider> = {}): AIProvider => ({
  id: 'test-provider',
  type: 'openai',
  name: 'Test Provider',
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  defaultModels: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  delete process.env['AI_API_BASE_URL'];
  delete process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'];
});

describe('native model protocol selection', () => {
  it.each([
    'http://127.0.0.1:8080/v1',
    'http://192.168.1.10/v1',
    'http://169.254.169.254/latest',
    'http://metadata.google.internal/v1',
  ])('rejects an unsafe native provider base URL: %s', (baseURL) => {
    expect(() =>
      buildNativeModel({
        providerType: 'openai',
        baseURL,
        apiKey: 'fixture-key',
        model: 'fixture-model',
      }),
    ).toThrow(/受限制的本地或内网地址/);
  });

  it('permits an explicitly opted-in loopback fixture without rewriting its /v1 path', () => {
    const baseURL = 'http://127.0.0.1:8080/v1';
    const model = buildNativeModel({
      providerType: 'openai',
      baseURL,
      allowInsecureLocalhost: true,
      apiKey: 'fixture-key',
      model: 'fixture-model',
    });

    expect(model.route.endpoint.baseURL).toBe(baseURL);
  });

  it('forwards the explicit loopback environment opt-in to provider configuration', () => {
    process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = '1';
    const baseURL = 'http://127.0.0.1:8080/v1';
    const model = buildNativeModel({
      providerType: 'openai',
      baseURL,
      apiKey: 'fixture-key',
      model: 'fixture-model',
    });

    expect(model.route.endpoint.baseURL).toBe(baseURL);
  });

  it('uses the production OpenAI plugin default for a real resolved route', () => {
    const route = resolveModelRouteFromProvider(makeProvider(), 'gpt-4o', {
      maxTokens: 256,
      temperature: 0,
    });
    const model = buildNativeModel({
      providerType: route.providerType,
      upstreamProtocol: route.upstreamProtocol,
      baseURL: route.apiBaseUrl,
      apiKey: route.apiKey,
      model: route.model,
    });

    expect(route.upstreamProtocol).toBe('chat_completions');
    expect(model.route.protocol).toBe('openai-chat');
  });

  it('defaults an unresolved OpenAI workflow provider to Chat Completions', () => {
    const model = buildNativeModel({
      providerType: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    expect(model.route.protocol).toBe('openai-chat');
  });

  it('preserves an explicit Responses protocol for the same provider', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({ upstreamProtocol: 'responses' }),
      'gpt-4o',
      { maxTokens: 256, temperature: 0 },
    );
    const model = buildNativeModel({
      providerType: route.providerType,
      upstreamProtocol: route.upstreamProtocol,
      baseURL: route.apiBaseUrl,
      apiKey: route.apiKey,
      model: route.model,
    });

    expect(route.upstreamProtocol).toBe('responses');
    expect(model.route.protocol).toBe('openai-responses');
  });

  it('preserves the OpenAI Fast mode setting on either configured native protocol', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({ openaiFastMode: true, upstreamProtocol: 'responses' }),
      'gpt-5.4',
      { maxTokens: 256, temperature: 0 },
    );

    expect(route.upstreamProtocol).toBe('responses');
    expect(route.openaiFastMode).toBe(true);
  });

  it('preserves Fast mode for a custom provider through model and compaction routes', () => {
    const provider = makeProvider({
      id: 'custom-openai-relay',
      type: 'custom',
      name: 'Custom OpenAI relay',
      baseUrl: 'https://relay.example.com/v1',
      openaiFastMode: true,
      upstreamProtocol: 'responses',
    });

    const route = resolveModelRouteFromProvider(provider, 'relay-model', {
      maxTokens: 256,
      temperature: 0,
    });
    const compactionRoute = resolveCompactionRoute(provider, 'relay-model');

    expect(route.openaiFastMode).toBe(true);
    expect(compactionRoute.openaiFastMode).toBe(true);
  });

  it('uses Responses for a custom provider that explicitly configures that protocol', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({
        id: 'responses-relay',
        type: 'custom',
        name: 'Responses relay',
        baseUrl: 'https://relay.example.com/v1',
        upstreamProtocol: 'responses',
      }),
      'relay-model',
      { maxTokens: 256, temperature: 0 },
    );
    const model = buildNativeModel({
      providerType: route.providerType,
      upstreamProtocol: route.upstreamProtocol,
      baseURL: route.apiBaseUrl,
      apiKey: route.apiKey,
      model: route.model,
    });

    expect(route.upstreamProtocol).toBe('responses');
    expect(model.route.protocol).toBe('openai-responses');
  });

  it('does not override an explicit Chat Completions protocol with the provider default', () => {
    const model = buildNativeModel({
      providerType: 'anthropic',
      upstreamProtocol: 'chat_completions',
      baseURL: 'https://relay.example.com/v1',
      apiKey: 'test-key',
      model: 'relay-model',
    });

    expect(model.route.id).toBe('openai-compatible-chat');
    expect(model.route.protocol).toBe('openai-chat');
  });

  it('keeps non-OpenAI providers on their OpenAI-compatible chat route', () => {
    const provider = makeProvider({
      id: 'deepseek-provider',
      type: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    const route = resolveModelRouteFromProvider(provider, 'deepseek-chat', {
      maxTokens: 256,
      temperature: 0,
    });
    const model = buildNativeModel({
      providerType: route.providerType,
      upstreamProtocol: route.upstreamProtocol,
      baseURL: route.apiBaseUrl,
      apiKey: route.apiKey,
      model: route.model,
    });

    expect(route.upstreamProtocol).toBe('chat_completions');
    expect(model.route.id).toBe('openai-compatible-chat');
    expect(model.route.protocol).toBe('openai-chat');
  });

  it('keeps Anthropic providers on native Messages', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({
        id: 'anthropic-provider',
        type: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
      }),
      'claude-sonnet-4-0',
      { maxTokens: 256, temperature: 0 },
    );
    const model = buildNativeModel({
      providerType: route.providerType,
      upstreamProtocol: route.upstreamProtocol,
      baseURL: route.apiBaseUrl,
      apiKey: route.apiKey,
      model: route.model,
    });

    expect(route.upstreamProtocol).toBe('anthropic_messages');
    expect(model.route.protocol).toBe('anthropic-messages');
  });
});
