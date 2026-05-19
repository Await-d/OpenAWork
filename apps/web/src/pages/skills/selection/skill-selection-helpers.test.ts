/**
 * Pure unit coverage for the shared helpers backing
 * `SkillSelectionPage.tsx`'s import/export and token estimate UX.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSelectionExport,
  estimatePinnedTokenUsage,
  parseImportedSelection,
  reorderRowsByMove,
  MAX_PINNED_SKILL_CHARS,
} from './skill-selection-helpers.js';

describe('estimatePinnedTokenUsage', () => {
  it('skips builtin / disabled / unpinned rows and accumulates a conservative char count', () => {
    const estimate = estimatePinnedTokenUsage([
      {
        skillId: 'a',
        pinned: true,
        enabled: true,
        isBuiltin: false,
        displayName: 'A',
        description: 'x'.repeat(100),
        capabilities: ['cap1', 'cap2'],
      },
      {
        skillId: 'b',
        pinned: true,
        enabled: false, // disabled — must skip
        isBuiltin: false,
        description: 'y'.repeat(2000),
      },
      {
        skillId: 'builtin',
        pinned: true,
        enabled: true,
        isBuiltin: true, // builtin — must skip
        description: 'z'.repeat(2000),
      },
      {
        skillId: 'unpinned',
        pinned: false,
        enabled: true,
        isBuiltin: false,
        description: 'q'.repeat(2000),
      },
    ]);
    expect(estimate.pinnedCount).toBe(1);
    expect(estimate.totalChars).toBeGreaterThan(100);
    expect(estimate.totalChars).toBeLessThan(200);
    expect(estimate.estimatedTokens).toBe(Math.ceil(estimate.totalChars / 4));
    expect(estimate.capChars).toBe(MAX_PINNED_SKILL_CHARS);
    expect(estimate.ratio).toBeLessThan(0.05);
  });

  it('reports ratio > 1 when pinned content would blow the cap', () => {
    const estimate = estimatePinnedTokenUsage(
      Array.from({ length: 10 }, (_, idx) => ({
        skillId: `skill-${idx}`,
        pinned: true,
        enabled: true,
        isBuiltin: false,
        description: 'x'.repeat(MAX_PINNED_SKILL_CHARS / 5),
      })),
    );
    expect(estimate.pinnedCount).toBe(10);
    expect(estimate.ratio).toBeGreaterThan(1);
  });

  it('returns zero for an empty input', () => {
    expect(estimatePinnedTokenUsage([])).toMatchObject({
      pinnedCount: 0,
      totalChars: 0,
      estimatedTokens: 0,
      ratio: 0,
    });
  });
});

describe('buildSelectionExport / parseImportedSelection', () => {
  it('round-trips installed rows through export → parse', () => {
    const exportDoc = buildSelectionExport({
      workspacePath: '/home/alice/projects/alpha',
      rows: [
        {
          skillId: 'com.example.frontend',
          enabled: true,
          pinned: true,
          isBuiltin: false,
          isInstalled: true,
          reason: 'core',
        },
        {
          skillId: 'com.example.backend',
          enabled: false,
          pinned: false,
          isBuiltin: false,
          isInstalled: true,
        },
        {
          // BUILTIN — must be excluded.
          skillId: 'builtin.always',
          enabled: true,
          pinned: false,
          isBuiltin: true,
          isInstalled: false,
        },
        {
          // Orphan (uninstalled) — must be excluded.
          skillId: 'orphan',
          enabled: true,
          pinned: false,
          isBuiltin: false,
          isInstalled: false,
        },
      ],
    });
    expect(exportDoc.version).toBe(1);
    expect(exportDoc.workspacePath).toBe('/home/alice/projects/alpha');
    expect(exportDoc.items.map((entry) => entry.skillId)).toEqual([
      'com.example.frontend',
      'com.example.backend',
    ]);

    const reparsed = parseImportedSelection(JSON.stringify(exportDoc));
    if (!reparsed.ok) throw new Error(`unexpected parse failure: ${reparsed.error}`);
    expect(reparsed.workspacePath).toBe('/home/alice/projects/alpha');
    expect(reparsed.items[0]).toMatchObject({
      skillId: 'com.example.frontend',
      enabled: true,
      pinned: true,
      reason: 'core',
    });
  });

  it('rejects malformed payloads with a precise reason', () => {
    expect(parseImportedSelection('not-json{')).toMatchObject({
      ok: false,
      error: expect.stringContaining('JSON parse'),
    });
    expect(parseImportedSelection('"a string"')).toMatchObject({
      ok: false,
      error: 'expected a JSON object at the top level',
    });
    expect(parseImportedSelection(JSON.stringify({ version: 99, items: [] }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('unsupported version'),
    });
    expect(parseImportedSelection(JSON.stringify({ version: 1 }))).toMatchObject({
      ok: false,
      error: 'missing "items" array',
    });
    expect(
      parseImportedSelection(
        JSON.stringify({ version: 1, items: [{ skillId: 'x', enabled: 'true', pinned: false }] }),
      ),
    ).toMatchObject({
      ok: false,
      error: 'items[*].enabled must be a boolean',
    });
  });
});

describe('reorderRowsByMove', () => {
  const rows = [
    { skillId: 'a', value: 1 },
    { skillId: 'b', value: 2 },
    { skillId: 'c', value: 3 },
    { skillId: 'd', value: 4 },
  ];

  it('moves a later row earlier so it lands immediately before the target', () => {
    const next = reorderRowsByMove(rows, 'd', 'b');
    expect(next.map((row) => row.skillId)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves an earlier row later by accounting for the post-splice index shift', () => {
    const next = reorderRowsByMove(rows, 'a', 'c');
    expect(next.map((row) => row.skillId)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('is a no-op when source equals target', () => {
    const next = reorderRowsByMove(rows, 'b', 'b');
    expect(next).not.toBe(rows);
    expect(next.map((row) => row.skillId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns a copy when either id is missing', () => {
    expect(reorderRowsByMove(rows, 'missing', 'b').map((row) => row.skillId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(reorderRowsByMove(rows, 'a', 'missing').map((row) => row.skillId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('does not mutate the input array', () => {
    const snapshot = rows.map((row) => row.skillId);
    void reorderRowsByMove(rows, 'd', 'a');
    expect(rows.map((row) => row.skillId)).toEqual(snapshot);
  });
});
