import { describe, expect, it } from 'vitest';
import { resolveUpstreamProtocol } from '../routes/upstream-protocol.js';

describe('resolveUpstreamProtocol', () => {
  it('returns responses for openai provider type with official base URL', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toBe('responses');
  });

  it('returns chat_completions for openai provider type with proxy base URL', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        providerType: 'openai',
        baseUrl: 'https://my-proxy.example.com/v1',
      }),
    ).toBe('chat_completions');
  });

  it('returns chat_completions for openai provider type with one-api proxy', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        providerType: 'openai',
        baseUrl: 'https://one-api.example.com/v1',
      }),
    ).toBe('chat_completions');
  });

  it('returns responses for openai model ID without provider type when base URL is official', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toBe('responses');
  });

  it('returns chat_completions for openai model ID without provider type when base URL is a proxy', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        baseUrl: 'https://proxy.internal/v1',
      }),
    ).toBe('chat_completions');
  });

  it('returns responses for openai provider type when baseUrl is undefined', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        providerType: 'openai',
      }),
    ).toBe('responses');
  });

  it('returns responses for openai model ID without provider type when baseUrl is undefined', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
      }),
    ).toBe('responses');
  });

  it('returns chat_completions for non-openai provider types', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'claude-sonnet-4-0',
        providerType: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
      }),
    ).toBe('chat_completions');
  });

  it('returns chat_completions for gemini provider type', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gemini-2.5-pro',
        providerType: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      }),
    ).toBe('chat_completions');
  });

  it('returns chat_completions for deepseek provider type', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'deepseek-chat',
        providerType: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
      }),
    ).toBe('chat_completions');
  });

  it('returns chat_completions for unknown model without provider type', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'some-custom-model',
        baseUrl: 'https://custom.api/v1',
      }),
    ).toBe('chat_completions');
  });

  it('handles base URLs with paths correctly', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1/proxy/path',
      }),
    ).toBe('responses');
  });

  it('handles base URLs with ports correctly', () => {
    expect(
      resolveUpstreamProtocol({
        model: 'gpt-4o',
        providerType: 'openai',
        baseUrl: 'http://localhost:8080/v1',
      }),
    ).toBe('chat_completions');
  });
});
