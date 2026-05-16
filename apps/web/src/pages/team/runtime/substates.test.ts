/**
 * substates 工具函数测试（Phase 2c 前端契约）
 */

import { describe, expect, it } from 'vitest';
import {
  SUBSTATES_C,
  SUBSTATE_C_ORDER,
  SUBSTATE_D_ORDER,
  computeSubstateProgress,
  selectSubstateMeta,
} from './substates.js';

describe('selectSubstateMeta', () => {
  it('pm1 → c 层 substate 集合', () => {
    const meta = selectSubstateMeta('pm1');
    expect(meta).not.toBeNull();
    expect(meta?.order).toEqual(SUBSTATE_C_ORDER);
    expect(meta?.label['drafting_spec']).toBe('草拟规格');
  });

  it('pm2 → d 层 substate 集合', () => {
    const meta = selectSubstateMeta('pm2');
    expect(meta).not.toBeNull();
    expect(meta?.order).toEqual(SUBSTATE_D_ORDER);
    expect(meta?.label['constitution_check']).toBe('宪法检查');
  });

  it('executor / reviewer → e 层 substate 集合', () => {
    const meta1 = selectSubstateMeta('executor');
    const meta2 = selectSubstateMeta('reviewer');
    expect(meta1).not.toBeNull();
    expect(meta2).not.toBeNull();
    expect(meta1?.label['implementing']).toBe('实现中');
    expect(meta2?.label['testing']).toBe('测试中');
  });

  it('未识别的 roleLayer 返回 null', () => {
    expect(selectSubstateMeta('reception')).toBeNull();
    expect(selectSubstateMeta('user')).toBeNull();
    expect(selectSubstateMeta(null)).toBeNull();
    expect(selectSubstateMeta(undefined)).toBeNull();
    expect(selectSubstateMeta('unknown_layer')).toBeNull();
  });
});

describe('computeSubstateProgress', () => {
  it('null/undefined current → 0', () => {
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, null)).toBe(0);
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, undefined)).toBe(0);
  });

  it('idle 是顺序中的第 0 项 → 0', () => {
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, SUBSTATES_C.IDLE)).toBe(0);
  });

  it('完成态（completed/failed/cancelled）→ 100', () => {
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, 'completed')).toBe(100);
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, 'failed')).toBe(100);
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, 'cancelled')).toBe(100);
  });

  it('中间状态返回非 0 / 非 100', () => {
    const draftingSpec = computeSubstateProgress(SUBSTATE_C_ORDER, SUBSTATES_C.DRAFTING_SPEC);
    const tasksReady = computeSubstateProgress(SUBSTATE_C_ORDER, SUBSTATES_C.TASKS_READY);
    expect(draftingSpec).toBeGreaterThan(0);
    expect(draftingSpec).toBeLessThan(100);
    expect(tasksReady).toBeGreaterThan(draftingSpec);
    expect(tasksReady).toBeLessThan(100);
  });

  it('超出 order 范围的 substate → 0（非顺序状态）', () => {
    expect(computeSubstateProgress(SUBSTATE_C_ORDER, 'never_seen')).toBe(0);
  });
});
