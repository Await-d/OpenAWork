import { describe, expect, it } from 'vitest';
import {
  isReviewPanelFileActionable,
  isReviewPanelManualRevert,
  selectReviewPanelPendingFiles,
  selectReviewPanelReviewTarget,
} from './review-panel-model.js';
import { makeReviewPanelDiffEntry } from './review-panel-test-fixtures.js';

describe('review-panel-model manual_revert 处理', () => {
  it('把 manual_revert 行识别为非人工审查目标', () => {
    const reverted = makeReviewPanelDiffEntry('src/rolled-back.ts', {
      sourceKind: 'manual_revert',
    });

    expect(isReviewPanelManualRevert(reverted)).toBe(true);
    expect(isReviewPanelFileActionable(reverted)).toBe(false);
    expect(selectReviewPanelReviewTarget(reverted)).toBeNull();
  });

  it('selectReviewPanelPendingFiles 排除 manual_revert 行，同时保留真实待审查变更', () => {
    const pendingNormal = makeReviewPanelDiffEntry('src/pending.ts');
    const reverted = makeReviewPanelDiffEntry('src/rolled-back.ts', {
      sourceKind: 'manual_revert',
    });
    const alreadyAccepted = makeReviewPanelDiffEntry('src/accepted.ts', {
      reviewStatus: 'accepted',
    });
    const withoutRequest = makeReviewPanelDiffEntry('src/no-request.ts', {
      requestId: undefined,
    });

    const actionable = selectReviewPanelPendingFiles([
      pendingNormal,
      reverted,
      alreadyAccepted,
      withoutRequest,
    ]);

    expect(actionable).toEqual([pendingNormal]);
    expect(actionable.some((file) => file.sourceKind === 'manual_revert')).toBe(false);
  });

  it('即使携带 requestId 与无审查状态，manual_revert 也不会进入可操作集合', () => {
    const reverted = makeReviewPanelDiffEntry('src/rolled-back.ts', {
      requestId: 'request:src/rolled-back.ts',
      reviewStatus: undefined,
      sourceKind: 'manual_revert',
    });

    expect(Boolean(reverted.requestId)).toBe(true);
    expect(reverted.reviewStatus).toBeUndefined();
    expect(selectReviewPanelPendingFiles([reverted])).toHaveLength(0);
  });
});
