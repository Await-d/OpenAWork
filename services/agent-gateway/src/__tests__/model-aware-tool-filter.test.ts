/**
 * Per-turn model-aware tool filter regression suite.
 *
 * Mirrors opencode `tool/registry.ts:303-315`:
 *
 *   const usePatch = modelID.includes("gpt-")
 *     && !modelID.includes("oss")
 *     && !modelID.includes("gpt-4")
 *   if (tool.id === ApplyPatchTool.id) return usePatch
 *   if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch
 *
 * OpenAWork extension: `multi_edit` follows the same gate as `edit`,
 * since it is a multi-replace variant of the same edit op. The
 * filter also exposes an env escape hatch
 * (`OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER=1`) for sites that need
 * the legacy "expose everything" surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnabledTools, shouldUseApplyPatch } from '../routes/stream.js';

describe('shouldUseApplyPatch', () => {
  it('returns true for GPT-5-class models', () => {
    expect(shouldUseApplyPatch('gpt-5')).toBe(true);
    expect(shouldUseApplyPatch('gpt-5-codex')).toBe(true);
    expect(shouldUseApplyPatch('gpt-5.1-mini')).toBe(true);
  });

  it('returns false for GPT-4 family because they were trained on edit/write tools', () => {
    expect(shouldUseApplyPatch('gpt-4')).toBe(false);
    expect(shouldUseApplyPatch('gpt-4o')).toBe(false);
    expect(shouldUseApplyPatch('gpt-4o-mini')).toBe(false);
    expect(shouldUseApplyPatch('gpt-4-turbo-2024-04-09')).toBe(false);
  });

  it('returns false for *-oss forks regardless of GPT-5 lineage', () => {
    expect(shouldUseApplyPatch('gpt-5-oss')).toBe(false);
    expect(shouldUseApplyPatch('openai-oss-gpt-5')).toBe(false);
  });

  it('returns false for non-OpenAI providers (Anthropic, Google, ...)', () => {
    expect(shouldUseApplyPatch('claude-sonnet-4-5')).toBe(false);
    expect(shouldUseApplyPatch('gemini-2.5-flash')).toBe(false);
    expect(shouldUseApplyPatch('deepseek-v3')).toBe(false);
  });

  it('returns null when the model id is missing — caller falls back to legacy "expose everything"', () => {
    expect(shouldUseApplyPatch(undefined)).toBeNull();
    expect(shouldUseApplyPatch('')).toBeNull();
  });
});

describe('getEnabledTools (model-aware filtering)', () => {
  // The env flag is read at module load time, so each scenario that
  // toggles it must reset the module registry to pick up the new
  // value. Resetting here avoids cross-test pollution — vitest spawns
  // worker processes per file, but the modules are cached within the
  // file run.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER'];
    vi.resetModules();
  });

  it('hides edit/multi_edit/write and exposes apply_patch for GPT-5 models', () => {
    const tools = getEnabledTools(true, { modelId: 'gpt-5-codex' });
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('apply_patch');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('multi_edit');
    expect(names).not.toContain('write');
  });

  it('hides apply_patch and exposes edit/multi_edit/write for GPT-4 / Claude / others', () => {
    const claude = getEnabledTools(true, { modelId: 'claude-sonnet-4-5' });
    const claudeNames = claude.map((t) => t.function.name);
    expect(claudeNames).toContain('edit');
    expect(claudeNames).toContain('multi_edit');
    expect(claudeNames).toContain('write');
    expect(claudeNames).not.toContain('apply_patch');

    const gpt4 = getEnabledTools(true, { modelId: 'gpt-4o' });
    const gpt4Names = gpt4.map((t) => t.function.name);
    expect(gpt4Names).toContain('edit');
    expect(gpt4Names).not.toContain('apply_patch');
  });

  it('still gates websearch / webfetch behind the webSearchEnabled flag', () => {
    const off = getEnabledTools(false, { modelId: 'claude-sonnet-4-5' });
    const offNames = off.map((t) => t.function.name);
    expect(offNames).not.toContain('websearch');
    expect(offNames).not.toContain('webfetch');

    const on = getEnabledTools(true, { modelId: 'claude-sonnet-4-5' });
    const onNames = on.map((t) => t.function.name);
    expect(onNames).toContain('websearch');
    expect(onNames).toContain('webfetch');
  });

  it('falls back to the legacy "expose everything" surface when modelId is missing', () => {
    // No modelId → both apply_patch and edit/write should be present
    // so the existing pre-PR-A behaviour is preserved for callers
    // (e.g. test fixtures, dev tooling) that haven't plumbed model
    // selection into getEnabledTools yet.
    const tools = getEnabledTools(true);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('apply_patch');
    expect(names).toContain('edit');
    expect(names).toContain('multi_edit');
    expect(names).toContain('write');
  });

  it('respects OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER=1 and exposes everything regardless of model', async () => {
    // Mutate env BEFORE re-importing the module under test so the
    // module-level constant captures the new value.
    process.env['OPENAWORK_DISABLE_MODEL_AWARE_TOOL_FILTER'] = '1';
    const mod = await import('../routes/stream.js');
    const tools = mod.getEnabledTools(true, { modelId: 'gpt-5-codex' });
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('apply_patch');
    expect(names).toContain('edit');
    expect(names).toContain('multi_edit');
    expect(names).toContain('write');
  });
});
