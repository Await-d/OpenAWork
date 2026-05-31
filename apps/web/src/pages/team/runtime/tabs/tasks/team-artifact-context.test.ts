import { describe, expect, it } from 'vitest';
import type { HandoffRecord } from '@openAwork/web-client';
import {
  extractReviewReport,
  parseDispatchPackage,
  resolveTeamArtifactContext,
} from './team-artifact-context.js';

function createHandoffRecord(
  overrides: Partial<HandoffRecord> & Pick<HandoffRecord, 'id'>,
): HandoffRecord {
  return {
    id: overrides.id,
    userId: overrides.userId ?? 'user-1',
    fromSessionId: overrides.fromSessionId ?? 'session-from',
    fromRoleLayer: overrides.fromRoleLayer ?? 'pm1',
    toRoleLayer: overrides.toRoleLayer ?? 'pm2',
    toSessionId: overrides.toSessionId ?? 'session-to',
    payload: overrides.payload ?? {},
    state: overrides.state ?? 'completed',
    claimToken: overrides.claimToken ?? null,
    claimedAt: overrides.claimedAt ?? null,
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? '2026-05-25T08:00:00.000Z',
    failureReason: overrides.failureReason ?? null,
    retryCount: overrides.retryCount ?? 0,
    createdAt: overrides.createdAt ?? '2026-05-25T07:30:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-25T08:00:00.000Z',
  };
}

describe('resolveTeamArtifactContext', () => {
  it('聚焦执行层 handoff 时回溯到对应 PM2 / PM1 会话', () => {
    const pm2 = createHandoffRecord({
      id: 'handoff-pm2',
      fromSessionId: 'session-pm1',
      toSessionId: 'session-pm2',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      updatedAt: '2026-05-25T09:00:00.000Z',
    });
    const executor = createHandoffRecord({
      id: 'handoff-exec',
      fromSessionId: 'session-pm2',
      toSessionId: 'session-exec',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      updatedAt: '2026-05-25T09:05:00.000Z',
    });

    const context = resolveTeamArtifactContext({
      focusHandoffId: executor.id,
      handoffs: [pm2, executor],
      selectedSessionId: 'session-pm2',
      selectedSessionRoleLayer: 'pm2',
    });

    expect(context.focusHandoff?.id).toBe(executor.id);
    expect(context.pm2Handoff?.id).toBe(pm2.id);
    expect(context.pm1ArtifactSessionId).toBe('session-pm1');
    expect(context.pm2ArtifactSessionId).toBe('session-pm2');
  });

  it('未进入 PM2 前，PM1 选中态仍能定位 spec / plan / tasks 会话', () => {
    const pm1 = createHandoffRecord({
      id: 'handoff-pm1',
      fromSessionId: 'session-reception',
      toSessionId: 'session-pm1',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      updatedAt: '2026-05-25T08:30:00.000Z',
    });

    const context = resolveTeamArtifactContext({
      handoffs: [pm1],
      selectedSessionId: 'session-pm1',
      selectedSessionRoleLayer: 'pm1',
    });

    expect(context.pm2Handoff).toBeNull();
    expect(context.pm1ArtifactSessionId).toBe('session-pm1');
    expect(context.pm2ArtifactSessionId).toBeNull();
  });
});

describe('parseDispatchPackage', () => {
  it('兼容嵌套和扁平 dispatch payload', () => {
    const nested = createHandoffRecord({
      id: 'handoff-nested',
      payload: {
        dispatch_package: {
          goal: 'nested goal',
          role: 'executor',
          toolsets: ['read'],
        },
      },
    });
    const flat = createHandoffRecord({
      id: 'handoff-flat',
      payload: {
        goal: 'flat goal',
        role: 'reviewer',
        toolsets: ['read', 'write'],
      },
    });

    expect(parseDispatchPackage(nested)?.goal).toBe('nested goal');
    expect(parseDispatchPackage(flat)?.goal).toBe('flat goal');
  });
});

describe('extractReviewReport', () => {
  it('优先使用聚焦 handoff 的评审报告', () => {
    const older = createHandoffRecord({
      id: 'handoff-old',
      payload: {
        review_report: {
          markdown: '# old',
          overallVerdict: 'pass',
          specReviewPassed: true,
          qualityReviewPassed: true,
        },
      },
      updatedAt: '2026-05-25T08:00:00.000Z',
      completedAt: '2026-05-25T08:00:00.000Z',
    });
    const focused = createHandoffRecord({
      id: 'handoff-focused',
      payload: {
        review_report: {
          markdown: '# focused',
          overallVerdict: 'implementation-failure',
          specReviewPassed: true,
          qualityReviewPassed: false,
        },
      },
      updatedAt: '2026-05-25T09:00:00.000Z',
      completedAt: '2026-05-25T09:00:00.000Z',
    });

    const review = extractReviewReport([older, focused], focused.id);

    expect(review.markdown).toBe('# focused');
    expect(review.overallVerdict).toBe('implementation-failure');
    expect(review.qualityReviewPassed).toBe(false);
  });
});
