// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryTabContent } from './memory-tab-content.js';
import type { UseMemoryManagementResult } from './memory-types.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
});

function getRenderedText(): string {
  return container?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function buildDefaultState(
  overrides: Partial<UseMemoryManagementResult> = {},
): UseMemoryManagementResult {
  return {
    memories: [],
    loadStatus: 'idle',
    loadError: null,
    stats: null,
    statsStatus: 'idle',
    settings: {
      enabled: true,
      autoExtract: false,
      maxTokenBudget: 2000,
      minConfidence: 0.3,
    },
    settingsStatus: 'idle',
    actionFeedback: { status: 'idle', message: null },
    clearActionFeedback: vi.fn(),
    refreshMemories: vi.fn().mockResolvedValue(undefined),
    refreshStats: vi.fn().mockResolvedValue(undefined),
    createMemory: vi.fn().mockResolvedValue(undefined),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    updateMemory: vi.fn().mockResolvedValue(undefined),
    extractMemories: vi.fn().mockResolvedValue(undefined),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    filteredMemories: [],
    ...overrides,
  };
}

describe('MemoryTabContent', () => {
  it('renders loading state with shimmer placeholders', () => {
    const state = buildDefaultState({ loadStatus: 'loading' });
    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const shimmers = container?.querySelectorAll('[style*="animation"]');
    expect(shimmers?.length).toBeGreaterThan(0);
  });

  it('renders error state with retry button', () => {
    const state = buildDefaultState({
      loadStatus: 'error',
      loadError: '网络连接失败',
    });
    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const text = getRenderedText();
    expect(text).toContain('记忆加载失败');
    expect(text).toContain('网络连接失败');
    expect(text).toContain('重试');
  });

  it('renders empty state with extract prompt when loaded with no memories', () => {
    const state = buildDefaultState({ loadStatus: 'loaded' });
    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const text = getRenderedText();
    expect(text).toContain('还没有记忆');
    expect(text).toContain('立即提取');
  });

  it('renders memory cards using current memory contract', () => {
    const mockMemories = [
      {
        id: 'mem-1',
        type: 'preference' as const,
        key: 'preferred_language',
        value: 'TypeScript 严格模式',
        source: 'manual' as const,
        confidence: 0.92,
        priority: 80,
        workspaceRoot: '/workspace/openawork',
        enabled: true,
        createdAt: '2026-03-20T10:00:00Z',
        updatedAt: '2026-03-21T08:30:00Z',
      },
    ];
    const state = buildDefaultState({
      loadStatus: 'loaded',
      memories: mockMemories,
      filteredMemories: mockMemories,
    });

    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const text = getRenderedText();
    expect(text).toContain('preferred_language');
    expect(text).toContain('TypeScript 严格模式');
    expect(text).toContain('偏好');
    expect(text).toContain('手动');
    expect(text).toContain('已启用');
    expect(text).toContain('置信度 92%');
  });

  it('renders search-empty state when filter yields no results', () => {
    const state = buildDefaultState({
      loadStatus: 'loaded',
      memories: [
        {
          id: 'mem-1',
          type: 'fact',
          key: 'project_name',
          value: 'OpenAWork',
          source: 'api',
          confidence: 0.6,
          priority: 30,
          workspaceRoot: null,
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      filteredMemories: [],
      searchQuery: '不存在的关键词',
    });

    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const text = getRenderedText();
    expect(text).toContain('未找到匹配的记忆');
  });

  it('renders action feedback banner', () => {
    const state = buildDefaultState({
      loadStatus: 'loaded',
      actionFeedback: { status: 'success', message: '已删除' },
    });

    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const text = getRenderedText();
    expect(text).toContain('已删除');
  });

  it('renders stats bar with current stats shape', () => {
    const state = buildDefaultState({
      loadStatus: 'loaded',
      statsStatus: 'loaded',
      stats: {
        total: 42,
        enabled: 30,
        disabled: 12,
        bySource: { manual: 20, auto_extracted: 15, api: 7 },
        byType: {
          preference: 10,
          fact: 12,
          instruction: 8,
          project_context: 6,
          learned_pattern: 6,
        },
      },
    });

    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const text = getRenderedText();
    expect(text).toContain('42');
    expect(text).toContain('30');
    expect(text).toContain('20');
    expect(text).toContain('15');
  });

  it('calls extractMemories when extract button is clicked', () => {
    const extractFn = vi.fn().mockResolvedValue(undefined);
    const state = buildDefaultState({
      loadStatus: 'loaded',
      extractMemories: extractFn,
    });

    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const extractBtn = container?.querySelector('[aria-label="提取记忆"]') as HTMLButtonElement;
    expect(extractBtn).toBeTruthy();
    act(() => {
      extractBtn.click();
    });

    expect(extractFn).toHaveBeenCalled();
  });

  it('renders settings panel with current settings fields', () => {
    const state = buildDefaultState({
      loadStatus: 'loaded',
      settingsStatus: 'loaded',
      settings: { enabled: true, autoExtract: true, maxTokenBudget: 2500, minConfidence: 0.45 },
    });

    act(() => {
      root?.render(<MemoryTabContent memoryState={state} />);
    });

    const memoryToggle = container?.querySelector(
      '[aria-label="切换记忆系统"]',
    ) as HTMLButtonElement;
    const extractToggle = container?.querySelector(
      '[aria-label="切换自动提取"]',
    ) as HTMLButtonElement;

    expect(memoryToggle).toBeTruthy();
    expect(extractToggle).toBeTruthy();
    expect(memoryToggle.getAttribute('aria-checked')).toBe('true');
    expect(extractToggle.getAttribute('aria-checked')).toBe('true');

    const text = getRenderedText();
    expect(text).toContain('最大注入预算');
    expect(text).toContain('最低置信度');
  });
});
