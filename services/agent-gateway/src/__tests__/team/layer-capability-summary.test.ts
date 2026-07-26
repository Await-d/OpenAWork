/**
 * 260531-team-page · team-layer-capability-summary 单测
 *
 * 验证每层能力摘要：聚合 LAYER_CAPABILITIES（固定护栏）+ role-adapter（默认工具），
 * 并正确标记默认启用、终端层、可派发去向。
 */

import { describe, expect, it } from 'vitest';
import {
  buildLayerCapabilitySummaries,
  buildLayerCapabilitySummary,
} from '../../team/team-layer-capability-summary.js';

describe('buildLayerCapabilitySummaries', () => {
  it('返回 5 层（reception → reviewer）', () => {
    const all = buildLayerCapabilitySummaries();
    expect(all.map((s) => s.layer)).toEqual(['reception', 'pm1', 'pm2', 'executor', 'reviewer']);
  });

  it('executor：终端层，工具天花板含 shell/lsp/test/web/desktop', () => {
    const exec = buildLayerCapabilitySummary('executor');
    expect(exec).not.toBeNull();
    expect(exec?.terminal).toBe(true);
    expect(exec?.canHandoffTo).toEqual([]);
    const ids = exec?.toolsetCategories.map((t) => t.id) ?? [];
    expect(ids).toEqual(['read', 'write', 'shell', 'lsp', 'test', 'web', 'desktop']);
    expect(exec?.canWriteArtifactPhases).toContain('implementation');
  });

  it('reception：可派发到 pm1，默认工具 read/web 标记 defaultEnabled', () => {
    const recep = buildLayerCapabilitySummary('reception');
    expect(recep?.terminal).toBe(false);
    expect(recep?.canHandoffTo).toEqual(['pm1']);
    const read = recep?.toolsetCategories.find((t) => t.id === 'read');
    const web = recep?.toolsetCategories.find((t) => t.id === 'web');
    expect(read?.defaultEnabled).toBe(true);
    expect(web?.defaultEnabled).toBe(true);
    expect(recep?.adapterDisplayName).toBeTruthy();
    expect(recep?.agentImplKey).toBe('interaction-agent');
  });

  it('user 层无独立角色能力，返回 null', () => {
    expect(buildLayerCapabilitySummary('user')).toBeNull();
  });
});
