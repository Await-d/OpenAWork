/**
 * pin 快照 v2（版本化）回归（T-07）。
 *
 * 锁定三条语义：
 *   1. 老快照（无 `entries`）行为不变 —— 只固定成员；
 *   2. v2 会话级条目固定**内容**：摘要变了就不再注入，而不是把新内容当旧内容；
 *   3. 撤权（`enabled = false`）优先于 pin，历史快照不复活已撤销项。
 */
import { describe, expect, it } from 'vitest';
import type { SkillManifest } from '@openAwork/skill-types';
import type { EffectiveSkill } from '../../skill/skill-selection.js';
import {
  PINNED_SKILLS_SNAPSHOT_SCHEMA_VERSION,
  applyPinnedSnapshot,
  shouldRecapturePinnedSnapshot,
  snapshotFromEffective,
  type PinnedSkillsSnapshot,
} from '../../skill/pinned-skills-prompt.js';

function manifest(id: string): SkillManifest {
  return {
    apiVersion: 'agent-skill/v1',
    id,
    name: id,
    displayName: id,
    version: '1.0.0',
    description: `${id} desc`,
    capabilities: [],
    permissions: [],
  };
}

function sessionSkill(params: {
  skillId: string;
  enabled?: boolean;
  pinned?: boolean;
  contentDigest?: string;
}): EffectiveSkill {
  return {
    skillId: params.skillId,
    enabled: params.enabled ?? true,
    pinned: params.pinned ?? true,
    origin: 'session-extension',
    reason: 'session-extension',
    manifest: manifest(params.skillId),
    resourceRef: `skill:session:${params.skillId}`,
    contentDigest: params.contentDigest ?? 'digest-1',
  };
}

describe('snapshotFromEffective（v2）', () => {
  it('为会话级条目记录 resourceRef 与 contentDigest', () => {
    const snapshot = snapshotFromEffective([sessionSkill({ skillId: 'a', contentDigest: 'd1' })]);
    expect(snapshot.schemaVersion).toBe(PINNED_SKILLS_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.entries).toEqual([
      { skillId: 'a', resourceRef: 'skill:session:a', contentDigest: 'd1' },
    ]);
  });

  it('用户级条目只固定成员（摘要为 null）', () => {
    const userSkill: EffectiveSkill = {
      skillId: 'user-skill',
      enabled: true,
      pinned: true,
      origin: 'workspace',
      manifest: manifest('user-skill'),
    };
    const snapshot = snapshotFromEffective([userSkill]);
    expect(snapshot.entries).toEqual([
      { skillId: 'user-skill', resourceRef: null, contentDigest: null },
    ]);
  });

  it('未固定的条目不入快照', () => {
    const snapshot = snapshotFromEffective([
      sessionSkill({ skillId: 'a', pinned: false }),
      sessionSkill({ skillId: 'b', enabled: false }),
    ]);
    expect(snapshot.skillIds).toEqual([]);
  });
});

describe('shouldRecapturePinnedSnapshot（会话扩展下一轮刷新）', () => {
  const snapshot = (extensionRevision?: number): PinnedSkillsSnapshot => ({
    skillIds: ['a'],
    capturedAt: 1,
    entries: [{ skillId: 'a', resourceRef: 'skill:session:a', contentDigest: 'd1' }],
    schemaVersion: 2,
    ...(extensionRevision === undefined ? {} : { extensionRevision }),
  });

  it('未捕获过快照时必须捕获', () => {
    expect(shouldRecapturePinnedSnapshot(null, 0)).toBe(true);
    expect(shouldRecapturePinnedSnapshot(undefined, 3)).toBe(true);
  });

  it('无会话扩展的会话保持首轮冻结契约', () => {
    expect(shouldRecapturePinnedSnapshot(snapshot(), 0)).toBe(false);
  });

  it('会话扩展 revision 变化时下一轮重建', () => {
    expect(shouldRecapturePinnedSnapshot(snapshot(3), 4)).toBe(true);
    expect(shouldRecapturePinnedSnapshot(snapshot(4), 4)).toBe(false);
  });

  it('老快照缺 extensionRevision 时，有会话扩展即重建', () => {
    expect(shouldRecapturePinnedSnapshot(snapshot(), 2)).toBe(true);
  });
});

describe('applyPinnedSnapshot（v2 内容对齐）', () => {
  it('同名用户技能缺少摘要或资源身份变化时旧 pin 失效', () => {
    const original = sessionSkill({ skillId: 'a', contentDigest: 'd1' });
    const snapshot = snapshotFromEffective([original]);
    const userFallback: EffectiveSkill = {
      skillId: 'a',
      enabled: true,
      pinned: true,
      origin: 'workspace',
      manifest: manifest('a'),
    };
    expect(applyPinnedSnapshot([userFallback], snapshot).some((entry) => entry.pinned)).toBe(false);
    expect(
      applyPinnedSnapshot([{ ...original, resourceRef: 'another-resource' }], snapshot).some(
        (entry) => entry.pinned,
      ),
    ).toBe(false);
  });
  it('摘要一致时照常固定', () => {
    const snapshot: PinnedSkillsSnapshot = {
      skillIds: ['a'],
      capturedAt: 1,
      entries: [{ skillId: 'a', resourceRef: 'skill:session:a', contentDigest: 'd1' }],
      schemaVersion: 2,
    };
    const applied = applyPinnedSnapshot(
      [sessionSkill({ skillId: 'a', contentDigest: 'd1' })],
      snapshot,
    );
    expect(applied.filter((entry) => entry.pinned).map((entry) => entry.skillId)).toEqual(['a']);
  });

  it('内容被替换（摘要变化）时不再注入，避免新内容冒充已固定内容', () => {
    const snapshot: PinnedSkillsSnapshot = {
      skillIds: ['a'],
      capturedAt: 1,
      entries: [{ skillId: 'a', resourceRef: 'skill:session:a', contentDigest: 'd1' }],
      schemaVersion: 2,
    };
    const applied = applyPinnedSnapshot(
      [sessionSkill({ skillId: 'a', contentDigest: 'd2' })],
      snapshot,
    );
    expect(applied.some((entry) => entry.pinned)).toBe(false);
  });

  it('用户级条目（摘要为 null）不做内容校验，内容漂移照常固定', () => {
    const snapshot: PinnedSkillsSnapshot = {
      skillIds: ['u'],
      capturedAt: 1,
      entries: [{ skillId: 'u', resourceRef: null, contentDigest: null }],
      schemaVersion: 2,
    };
    const userSkill: EffectiveSkill = {
      skillId: 'u',
      enabled: true,
      pinned: true,
      origin: 'workspace',
      manifest: manifest('u'),
    };
    const applied = applyPinnedSnapshot([userSkill], snapshot);
    expect(applied.filter((entry) => entry.pinned).map((entry) => entry.skillId)).toEqual(['u']);
  });

  it('撤权优先于 pin：禁用条目即便在快照里也不复活', () => {
    const snapshot: PinnedSkillsSnapshot = {
      skillIds: ['a'],
      capturedAt: 1,
      entries: [{ skillId: 'a', resourceRef: 'skill:session:a', contentDigest: 'd1' }],
      schemaVersion: 2,
    };
    const applied = applyPinnedSnapshot(
      [sessionSkill({ skillId: 'a', enabled: false, contentDigest: 'd1' })],
      snapshot,
    );
    expect(applied.some((entry) => entry.pinned)).toBe(false);
  });
});

describe('老快照（v1）兼容', () => {
  it('无 entries 时只固定成员，不因内容漂移丢弃', () => {
    const legacy: PinnedSkillsSnapshot = { skillIds: ['a'], capturedAt: 1 };
    const applied = applyPinnedSnapshot(
      [sessionSkill({ skillId: 'a', contentDigest: 'whatever-new' })],
      legacy,
    );
    expect(applied.filter((entry) => entry.pinned).map((entry) => entry.skillId)).toEqual(['a']);
  });

  it('显式空快照仍抑制会话内新增 pin', () => {
    const empty: PinnedSkillsSnapshot = { skillIds: [], capturedAt: 1 };
    const applied = applyPinnedSnapshot([sessionSkill({ skillId: 'a', pinned: true })], empty);
    expect(applied.some((entry) => entry.pinned)).toBe(false);
  });

  it('null 快照放行实时集合（PR3 之前的老会话）', () => {
    const applied = applyPinnedSnapshot([sessionSkill({ skillId: 'a' })], null);
    expect(applied.filter((entry) => entry.pinned).map((entry) => entry.skillId)).toEqual(['a']);
  });
});
