import type { ReferenceModelEntry } from '../task-model-reference-snapshot.js';

export const FROZEN_AGENT_MODEL_ENTRIES: Record<string, ReferenceModelEntry[]> = {
  explore: [
    { modelId: 'grok-code-fast-1', providerHints: ['github-copilot', 'xai'] },
    { modelId: 'minimax-m2.7-highspeed', providerHints: ['opencode-go'] },
    { modelId: 'minimax-m2.7', providerHints: ['opencode'] },
    { modelId: 'claude-haiku-4-5', providerHints: ['anthropic', 'opencode'] },
    { modelId: 'gpt-5-nano', providerHints: ['opencode'] },
  ],
  librarian: [
    { modelId: 'minimax-m2.7', providerHints: ['opencode-go'] },
    { modelId: 'minimax-m2.7-highspeed', providerHints: ['opencode'] },
    { modelId: 'claude-haiku-4-5', providerHints: ['anthropic', 'opencode'] },
    { modelId: 'gpt-5-nano', providerHints: ['opencode'] },
  ],
  oracle: [
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    {
      modelId: 'gemini-3.1-pro',
      providerHints: ['google', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
  ],
  zeus: [
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'xhigh',
    },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
  ],
  metis: [
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
    { modelId: 'kimi-k2.5', providerHints: ['kimi-for-coding'] },
  ],
  momus: [
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'xhigh',
    },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    {
      modelId: 'gemini-3.1-pro',
      providerHints: ['google', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
  ],
  'multimodal-looker': [
    { modelId: 'gpt-5.4', providerHints: ['openai', 'opencode'], variant: 'medium' },
    { modelId: 'kimi-k2.5', providerHints: ['opencode-go'] },
    { modelId: 'glm-4.6v', providerHints: ['zai-coding-plan'] },
    { modelId: 'gpt-5-nano', providerHints: ['openai', 'github-copilot', 'opencode'] },
  ],
  'sisyphus-junior': [
    { modelId: 'claude-sonnet-4-6', providerHints: ['anthropic', 'github-copilot', 'opencode'] },
    { modelId: 'kimi-k2.5', providerHints: ['opencode-go'] },
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'medium',
    },
    { modelId: 'minimax-m2.7', providerHints: ['opencode-go'] },
    { modelId: 'big-pickle', providerHints: ['opencode'] },
  ],
  hephaestus: [
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'venice', 'opencode'],
      variant: 'medium',
    },
  ],
  prometheus: [
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
    { modelId: 'gemini-3.1-pro', providerHints: ['google', 'github-copilot', 'opencode'] },
  ],
  atlas: [
    { modelId: 'claude-sonnet-4-6', providerHints: ['anthropic', 'github-copilot', 'opencode'] },
    { modelId: 'kimi-k2.5', providerHints: ['opencode-go'] },
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'medium',
    },
    { modelId: 'minimax-m2.7', providerHints: ['opencode-go'] },
  ],
};

export const FROZEN_CATEGORY_MODEL_ENTRIES: Record<string, ReferenceModelEntry[]> = {
  'visual-engineering': [
    {
      modelId: 'gemini-3.1-pro',
      providerHints: ['google', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    { modelId: 'glm-5', providerHints: ['zai-coding-plan', 'opencode'] },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
    { modelId: 'kimi-k2.5', providerHints: ['kimi-for-coding'] },
  ],
  ultrabrain: [
    { modelId: 'gpt-5.4', providerHints: ['openai', 'opencode'], variant: 'xhigh' },
    {
      modelId: 'gemini-3.1-pro',
      providerHints: ['google', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
  ],
  deep: [
    { modelId: 'gpt-5.3-codex', providerHints: ['openai', 'opencode'], variant: 'medium' },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    {
      modelId: 'gemini-3.1-pro',
      providerHints: ['google', 'github-copilot', 'opencode'],
      variant: 'high',
    },
  ],
  artistry: [
    {
      modelId: 'gemini-3.1-pro',
      providerHints: ['google', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    { modelId: 'gpt-5.4', providerHints: ['openai', 'github-copilot', 'opencode'] },
  ],
  quick: [
    { modelId: 'gpt-5.4-mini', providerHints: ['openai', 'github-copilot', 'opencode'] },
    { modelId: 'claude-haiku-4-5', providerHints: ['anthropic', 'github-copilot', 'opencode'] },
    { modelId: 'gemini-3-flash', providerHints: ['google', 'github-copilot', 'opencode'] },
    { modelId: 'minimax-m2.7', providerHints: ['opencode-go'] },
    { modelId: 'gpt-5-nano', providerHints: ['opencode'] },
  ],
  'unspecified-low': [
    { modelId: 'claude-sonnet-4-6', providerHints: ['anthropic', 'github-copilot', 'opencode'] },
    { modelId: 'gpt-5.3-codex', providerHints: ['openai', 'opencode'], variant: 'medium' },
    { modelId: 'kimi-k2.5', providerHints: ['opencode-go'] },
    { modelId: 'gemini-3-flash', providerHints: ['google', 'github-copilot', 'opencode'] },
    { modelId: 'minimax-m2.7', providerHints: ['opencode-go'] },
  ],
  'unspecified-high': [
    {
      modelId: 'claude-opus-4-6',
      providerHints: ['anthropic', 'github-copilot', 'opencode'],
      variant: 'max',
    },
    {
      modelId: 'gpt-5.4',
      providerHints: ['openai', 'github-copilot', 'opencode'],
      variant: 'high',
    },
    { modelId: 'glm-5', providerHints: ['zai-coding-plan', 'opencode'] },
    { modelId: 'kimi-k2.5', providerHints: ['kimi-for-coding'] },
    { modelId: 'glm-5', providerHints: ['opencode-go'] },
    { modelId: 'kimi-k2.5', providerHints: ['opencode'] },
  ],
  writing: [
    { modelId: 'gemini-3-flash', providerHints: ['google', 'github-copilot', 'opencode'] },
    { modelId: 'kimi-k2.5', providerHints: ['opencode-go'] },
    { modelId: 'claude-sonnet-4-6', providerHints: ['anthropic', 'github-copilot', 'opencode'] },
    { modelId: 'minimax-m2.7', providerHints: ['opencode-go'] },
  ],
};
