import { describe, it, expect } from 'vitest';
import {
  buildMemoryInjectionBlock,
  createMemorySchema,
  deduplicateMemories,
  DEFAULT_MEMORY_SETTINGS,
  estimateTokenCount,
  extractMemoriesFromText,
  memorySettingsSchema,
  normalizeMemoryKey,
  parseMemorySettings,
  updateMemorySchema,
} from '../memory/index.js';
import type {
  ExtractedMemoryCandidate,
  MemoryEntry,
  MemoryInjectionConfig,
} from '../memory/index.js';

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem-1',
    userId: 'user-1',
    type: 'preference',
    key: 'lang',
    value: 'TypeScript',
    source: 'manual',
    confidence: 1.0,
    priority: 50,
    workspaceRoot: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('memory schema validation', () => {
  it('validates createMemorySchema with defaults', () => {
    const result = createMemorySchema.safeParse({
      type: 'preference',
      key: 'language',
      value: 'TypeScript',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('manual');
      expect(result.data.confidence).toBe(1.0);
      expect(result.data.priority).toBe(50);
      expect(result.data.workspaceRoot).toBe(null);
    }
  });

  it('rejects empty key', () => {
    const result = createMemorySchema.safeParse({
      type: 'fact',
      key: '',
      value: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = createMemorySchema.safeParse({
      type: 'invalid_type',
      key: 'test',
      value: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const result = createMemorySchema.safeParse({
      type: 'fact',
      key: 'test',
      value: 'val',
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('validates updateMemorySchema with partial fields', () => {
    const result = updateMemorySchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it('validates memorySettingsSchema', () => {
    const result = memorySettingsSchema.safeParse(DEFAULT_MEMORY_SETTINGS);
    expect(result.success).toBe(true);
  });
});

describe('helpers', () => {
  it('estimateTokenCount returns positive for non-empty text', () => {
    expect(estimateTokenCount('hello world')).toBeGreaterThan(0);
  });

  it('normalizeMemoryKey lowercases and replaces spaces', () => {
    expect(normalizeMemoryKey('My Favorite Language')).toBe('my_favorite_language');
  });

  it('normalizeMemoryKey trims whitespace', () => {
    expect(normalizeMemoryKey('  foo  ')).toBe('foo');
  });

  it('parseMemorySettings returns defaults for null', () => {
    const settings = parseMemorySettings(null);
    expect(settings.enabled).toBe(DEFAULT_MEMORY_SETTINGS.enabled);
    expect(settings.autoExtract).toBe(DEFAULT_MEMORY_SETTINGS.autoExtract);
  });

  it('parseMemorySettings merges partial input', () => {
    const settings = parseMemorySettings({ enabled: false });
    expect(settings.enabled).toBe(false);
    expect(settings.autoExtract).toBe(DEFAULT_MEMORY_SETTINGS.autoExtract);
  });
});

describe('injector', () => {
  const defaultConfig: MemoryInjectionConfig = {
    enabled: true,
    maxTokenBudget: 2000,
    minConfidence: 0.3,
    workspaceRoot: null,
  };

  it('returns null when disabled', () => {
    const result = buildMemoryInjectionBlock([makeMemory()], { ...defaultConfig, enabled: false });
    expect(result).toBeNull();
  });

  it('returns null when no memories', () => {
    const result = buildMemoryInjectionBlock([], defaultConfig);
    expect(result).toBeNull();
  });

  it('builds user-memory block with correct format', () => {
    const result = buildMemoryInjectionBlock([makeMemory()], defaultConfig);
    expect(result).not.toBeNull();
    expect(result).toContain('<user-memory>');
    expect(result).toContain('</user-memory>');
    expect(result).toContain('[preference] lang: TypeScript');
  });

  it('filters by minimum confidence', () => {
    const lowConf = makeMemory({ id: 'low', confidence: 0.1, key: 'low_conf' });
    const highConf = makeMemory({ id: 'high', confidence: 0.8, key: 'high_conf' });
    const result = buildMemoryInjectionBlock([lowConf, highConf], {
      ...defaultConfig,
      minConfidence: 0.5,
    });
    expect(result).toContain('high_conf');
    expect(result).not.toContain('low_conf');
  });

  it('filters disabled memories', () => {
    const disabled = makeMemory({ id: 'dis', enabled: false, key: 'disabled_key' });
    const enabled = makeMemory({ id: 'en', enabled: true, key: 'enabled_key' });
    const result = buildMemoryInjectionBlock([disabled, enabled], defaultConfig);
    expect(result).toContain('enabled_key');
    expect(result).not.toContain('disabled_key');
  });

  it('sorts by priority then confidence', () => {
    const low = makeMemory({ id: '1', priority: 10, confidence: 0.9, key: 'low_prio' });
    const high = makeMemory({ id: '2', priority: 90, confidence: 0.5, key: 'high_prio' });
    const result = buildMemoryInjectionBlock([low, high], defaultConfig);
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const highIdx = lines.findIndex((l) => l.includes('high_prio'));
    const lowIdx = lines.findIndex((l) => l.includes('low_prio'));
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('respects token budget by truncating', () => {
    const memories = Array.from({ length: 100 }, (_, i) =>
      makeMemory({
        id: `mem-${i}`,
        key: `key_${i}`,
        value: 'x'.repeat(200),
        priority: 100 - i,
      }),
    );
    const result = buildMemoryInjectionBlock(memories, { ...defaultConfig, maxTokenBudget: 100 });
    expect(result).not.toBeNull();
    const lineCount = result!.split('\n').filter((l) => l.startsWith('- [')).length;
    expect(lineCount).toBeLessThan(100);
  });

  it('filters by workspace root', () => {
    const global = makeMemory({ id: 'g', workspaceRoot: null, key: 'global_key' });
    const ws = makeMemory({ id: 'w', workspaceRoot: '/project/a', key: 'ws_key' });
    const otherWs = makeMemory({ id: 'o', workspaceRoot: '/project/b', key: 'other_ws_key' });

    const result = buildMemoryInjectionBlock([global, ws, otherWs], {
      ...defaultConfig,
      workspaceRoot: '/project/a',
    });
    expect(result).toContain('global_key');
    expect(result).toContain('ws_key');
    expect(result).not.toContain('other_ws_key');
  });
});

describe('deduplicator', () => {
  it('identifies new candidates', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'name', value: 'Alice', confidence: 0.8 },
    ];
    const result = deduplicateMemories(candidates, []);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
  });

  it('detects exact duplicates', () => {
    const existing = [makeMemory({ type: 'fact', key: 'name', value: 'Alice' })];
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'name', value: 'Alice', confidence: 0.8 },
    ];
    const result = deduplicateMemories(candidates, existing);
    expect(result.duplicates).toHaveLength(1);
    expect(result.toCreate).toHaveLength(0);
  });

  it('updates when new confidence >= existing', () => {
    const existing = [makeMemory({ type: 'fact', key: 'name', value: 'Alice', confidence: 0.5 })];
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'name', value: 'Bob', confidence: 0.8 },
    ];
    const result = deduplicateMemories(candidates, existing);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0]!.candidate.value).toBe('Bob');
  });

  it('treats as duplicate when new confidence < existing', () => {
    const existing = [makeMemory({ type: 'fact', key: 'name', value: 'Alice', confidence: 0.9 })];
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'name', value: 'Bob', confidence: 0.3 },
    ];
    const result = deduplicateMemories(candidates, existing);
    expect(result.duplicates).toHaveLength(1);
    expect(result.toCreate).toHaveLength(0);
  });

  it('normalizes key for matching (case-insensitive)', () => {
    const existing = [makeMemory({ type: 'fact', key: 'User Name', value: 'Alice' })];
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'user_name', value: 'Alice', confidence: 0.8 },
    ];
    const result = deduplicateMemories(candidates, existing);
    expect(result.duplicates).toHaveLength(1);
  });
});

describe('extractor', () => {
  it('returns empty for empty text', () => {
    expect(extractMemoriesFromText('')).toHaveLength(0);
  });

  it('returns empty for text without extraction patterns', () => {
    const result = extractMemoriesFromText('The weather is nice today.');
    expect(result).toHaveLength(0);
  });

  it('extracts Chinese preference pattern', () => {
    const result = extractMemoriesFromText('我偏好使用 TypeScript');
    expect(result.length).toBeGreaterThanOrEqual(1);
    const pref = result.find((c) => c.type === 'preference');
    expect(pref).toBeDefined();
  });

  it('extracts Chinese instruction pattern', () => {
    const result = extractMemoriesFromText('请记住不要用分号');
    expect(result.length).toBeGreaterThanOrEqual(1);
    const instr = result.find((c) => c.type === 'instruction');
    expect(instr).toBeDefined();
  });

  it('extracts Chinese name fact', () => {
    const result = extractMemoriesFromText('我的名字是张三');
    expect(result.length).toBeGreaterThanOrEqual(1);
    const fact = result.find((c) => c.key === 'user_name');
    expect(fact).toBeDefined();
    expect(fact?.value).toContain('张三');
  });

  it('extracts English preference', () => {
    const result = extractMemoriesFromText('I prefer using Rust for backend');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts English instruction', () => {
    const result = extractMemoriesFromText('always use single quotes in JavaScript');
    expect(result.length).toBeGreaterThanOrEqual(1);
    const instr = result.find((c) => c.type === 'instruction');
    expect(instr).toBeDefined();
  });

  it('deduplicates identical values from same text', () => {
    const text = 'I prefer TypeScript. I prefer TypeScript again.';
    const result = extractMemoriesFromText(text);
    const tsResults = result.filter((c) => c.value.toLowerCase().includes('typescript'));
    expect(tsResults.length).toBeLessThanOrEqual(1);
  });

  it('all candidates have confidence > 0', () => {
    const result = extractMemoriesFromText('我偏好 Python, my name is Alice, 请记住用 tabs');
    for (const candidate of result) {
      expect(candidate.confidence).toBeGreaterThan(0);
    }
  });
});
