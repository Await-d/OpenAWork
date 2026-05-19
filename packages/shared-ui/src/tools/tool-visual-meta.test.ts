import { describe, expect, it } from 'vitest';
import {
  resolveToolIconKey,
  resolveToolKind,
  resolveToolStatusMeta,
  resolveToolVisualStatus,
} from './tool-visual-meta.js';

describe('tool visual meta', () => {
  it('prefers explicit capability kind over tool name heuristics', () => {
    expect(resolveToolKind('custom_runner', 'skill')).toBe('skill');
    expect(resolveToolIconKey('custom_runner', 'skill')).toBe('kind-skill');
    expect(resolveToolKind('external_lookup', 'mcp')).toBe('mcp');
    expect(resolveToolIconKey('external_lookup', 'mcp')).toBe('kind-mcp');
  });

  it('normalizes extended status values into the shared tool visual states', () => {
    expect(resolveToolVisualStatus({ status: 'done' })).toBe('completed');
    expect(resolveToolVisualStatus({ status: 'in_progress' })).toBe('running');
    expect(resolveToolVisualStatus({ status: 'pending' })).toBe('pending');
    expect(resolveToolVisualStatus({ status: 'cancelled' })).toBe('cancelled');
  });

  it('preserves paused question cards special labels in shared status metadata', () => {
    expect(resolveToolStatusMeta('paused', 'AskUserQuestion').label).toBe('等待回答');
    expect(resolveToolStatusMeta('paused', 'ExitPlanMode').label).toBe('等待确认');
    expect(resolveToolStatusMeta('paused', 'bash').label).toBe('等待权限');
  });
});
