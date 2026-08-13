/**
 * AI skill recommendation diff drawer (PR4 of the skill-workspace-selection
 * spec). Surfaces a side-by-side diff of "current selection" vs "AI proposed
 * selection" with per-row accept/reject + pin toggles, and applies the
 * confirmed merged set as overrides through `POST /skills/recommend/:id/apply`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSkillsClient, HttpError } from '@openAwork/web-client';
import {
  buildSkillRecommendationDecisions,
  summarizeDecisions,
  type CurrentSelectionEntry as CurrentSelection,
  type RecommendationItem,
  type RowDecision,
} from './skill-recommendation-diff.js';

interface RejectedItem {
  skill_id: string;
  reason: string;
}

interface RecommendationResponse {
  recommendationId: string;
  recommendations: RecommendationItem[];
  rejected: RejectedItem[];
  fromCache: boolean;
  fellBackToHeuristic: boolean;
  applied: boolean;
  modelId?: string | null;
  signalDigest?: string;
  workspacePath?: string;
}

interface LatestResponse {
  applied: RecommendationResponse | null;
  pending: RecommendationResponse | null;
}

export interface SkillRecommendationDrawerProps {
  open: boolean;
  onClose: () => void;
  gatewayUrl: string;
  /**
   * Bearer token used for the recommendation endpoints. The drawer used to
   * accept a `headers` HeadersInit for legacy reasons; we now pass a raw token
   * and let `createSkillsClient` build the auth header.
   */
  token: string;
  workspacePath: string;
  currentSelection: CurrentSelection[];
  /** Called after a successful apply so the parent can refresh selections. */
  onApplied: () => void | Promise<void>;
}

const DRAWER_BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'color-mix(in srgb, var(--bg-base) 55%, transparent)',
  zIndex: 50,
  display: 'flex',
  justifyContent: 'flex-end',
};

const DRAWER_PANEL: React.CSSProperties = {
  width: 'min(720px, 100vw)',
  height: '100vh',
  background: 'var(--bg-overlay)',
  borderLeft: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: 'var(--shadow-lg)',
};

const HEADER: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const BODY: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const FOOTER: React.CSSProperties = {
  padding: 16,
  borderTop: '1px solid var(--border-subtle)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
};

const ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  gap: 12,
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-2, var(--bg-overlay)',
};

const SECTION_LABEL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-default)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginTop: 4,
};

const STAT_CARD: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-2, var(--bg-overlay)',
  marginBottom: 6,
};

const STAT_VALUE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  lineHeight: 1.1,
};

const STAT_LABEL: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  marginTop: 2,
};

const PILL: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 6,
  background: 'var(--accent-muted)',
  color: 'var(--accent)',
};

function deltaColor(origin: RowDecision['origin']): string {
  if (origin === 'recommended-only') return 'var(--success)';
  if (origin === 'current-only') return 'var(--danger)';
  return 'var(--fg-muted)';
}

function deltaSectionLabel(origin: RowDecision['origin']): string {
  if (origin === 'recommended-only') return '新增 (AI 建议添加)';
  if (origin === 'current-only') return '移除 (AI 建议丢弃)';
  return '保留 (双方一致)';
}

export default function SkillRecommendationDrawer(
  props: SkillRecommendationDrawerProps,
): React.ReactElement | null {
  const { open, onClose, gatewayUrl, token, workspacePath, currentSelection, onApplied } = props;
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [decisions, setDecisions] = useState<Map<string, RowDecision>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skillsClient = useMemo(() => createSkillsClient(gatewayUrl), [gatewayUrl]);

  const resetState = useCallback(() => {
    setRecommendation(null);
    setDecisions(new Map());
    setError(null);
  }, []);

  const loadLatest = useCallback(async (): Promise<RecommendationResponse | null> => {
    const body = (await skillsClient.getLatestRecommendation(token, {
      ...(workspacePath.trim() ? { workspacePath: workspacePath.trim() } : {}),
    })) as LatestResponse;
    return body.pending ?? body.applied ?? null;
  }, [skillsClient, token, workspacePath]);

  const generate = useCallback(
    async (force: boolean): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const next = (await skillsClient.recommend(token, {
          workspacePath: workspacePath.trim() || null,
          force,
        })) as RecommendationResponse;
        setRecommendation(next);
        setDecisions(buildSkillRecommendationDecisions(currentSelection, next.recommendations));
      } catch (err) {
        const message =
          err instanceof HttpError
            ? `${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [currentSelection, skillsClient, token, workspacePath],
  );

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    setLoading(true);
    setError(null);
    void loadLatest()
      .then((latest) => {
        if (latest) {
          setRecommendation(latest);
          setDecisions(buildSkillRecommendationDecisions(currentSelection, latest.recommendations));
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [open, loadLatest, currentSelection, resetState]);

  const toggleEnabled = (skillId: string, enabled: boolean): void => {
    setDecisions((prev) => {
      const next = new Map(prev);
      const row = next.get(skillId);
      if (row) {
        next.set(skillId, { ...row, enabled, pinned: enabled ? row.pinned : false });
      }
      return next;
    });
  };

  const togglePinned = (skillId: string, pinned: boolean): void => {
    setDecisions((prev) => {
      const next = new Map(prev);
      const row = next.get(skillId);
      if (row && row.enabled) {
        next.set(skillId, { ...row, pinned });
      }
      return next;
    });
  };

  const summary = useMemo(() => summarizeDecisions(decisions), [decisions]);

  const apply = useCallback(async (): Promise<void> => {
    if (!recommendation) return;
    setApplying(true);
    setError(null);
    try {
      const overrides: Record<string, { enabled: boolean; pinned: boolean }> = {};
      for (const [skillId, row] of decisions.entries()) {
        overrides[skillId] = { enabled: row.enabled, pinned: row.pinned };
      }
      await skillsClient.applyRecommendation(token, recommendation.recommendationId, { overrides });
      await onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [decisions, skillsClient, token, onApplied, onClose, recommendation]);

  if (!open) return null;

  const allRows = Array.from(decisions.entries()).sort(([, a], [, b]) => {
    const orderRank = (origin: RowDecision['origin']): number =>
      origin === 'recommended-only' ? 0 : origin === 'both' ? 1 : 2;
    const ra = orderRank(a.origin);
    const rb = orderRank(b.origin);
    if (ra !== rb) return ra - rb;
    return (b.score ?? 0) - (a.score ?? 0);
  });
  // Group rows by delta so the diff is scannable at a glance.
  const grouped: Record<RowDecision['origin'], Array<[string, RowDecision]>> = {
    'recommended-only': [],
    both: [],
    'current-only': [],
  };
  for (const entry of allRows) {
    grouped[entry[1].origin].push(entry);
  }
  const totalRows = allRows.length;

  return (
    <div style={DRAWER_BACKDROP} onClick={onClose} role="dialog" aria-modal="true">
      <div style={DRAWER_PANEL} onClick={(e) => e.stopPropagation()}>
        <header style={HEADER}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>AI 推荐 skill 选择集</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
              {workspacePath || '(全局默认)'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 20,
              cursor: 'pointer',
              color: 'var(--fg-default)',
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div style={BODY}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void generate(false)}
              disabled={loading || applying}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                fontSize: 13,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? '生成中…' : recommendation ? '重新生成 (复用 24h 缓存)' : '生成推荐'}
            </button>
            <button
              type="button"
              onClick={() => void generate(true)}
              disabled={loading || applying}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                fontSize: 13,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              强制刷新（绕过缓存）
            </button>
            {recommendation ? (
              <span
                style={{
                  ...PILL,
                  background: recommendation.fellBackToHeuristic
                    ? 'var(--warning-subtle)'
                    : 'var(--accent-soft)',
                  color: recommendation.fellBackToHeuristic ? 'var(--warning)' : 'var(--accent)',
                  alignSelf: 'center',
                }}
              >
                {recommendation.fellBackToHeuristic
                  ? '启发式回退 (LLM 调用失败)'
                  : recommendation.fromCache
                    ? '24h 缓存命中'
                    : `LLM: ${recommendation.modelId ?? 'default'}`}
              </span>
            ) : null}
          </div>

          {error ? (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>
          ) : null}

          {!recommendation && !loading ? (
            <div
              style={{ fontSize: 13, color: 'var(--fg-muted)', padding: 16, textAlign: 'center' }}
            >
              尚无推荐结果。点击「生成推荐」让 AI 基于项目信号给出建议。
            </div>
          ) : null}

          {totalRows > 0 ? (
            <>
              <div style={STAT_CARD} aria-label="推荐结果汇总">
                <div>
                  <div style={STAT_VALUE}>{totalRows}</div>
                  <div style={STAT_LABEL}>共计</div>
                </div>
                <div>
                  <div style={STAT_VALUE}>{summary.enabled}</div>
                  <div style={STAT_LABEL}>启用</div>
                </div>
                <div>
                  <div style={STAT_VALUE}>{summary.pinned}</div>
                  <div style={STAT_LABEL}>Pinned</div>
                </div>
                <div>
                  <div style={{ ...STAT_VALUE, color: 'var(--success)' }}>+{summary.added}</div>
                  <div style={STAT_LABEL}>新增</div>
                </div>
                <div>
                  <div style={{ ...STAT_VALUE, color: 'var(--danger)' }}>-{summary.removed}</div>
                  <div style={STAT_LABEL}>移除</div>
                </div>
              </div>
              {(['recommended-only', 'both', 'current-only'] as const).map((groupKey) => {
                const groupRows = grouped[groupKey];
                if (groupRows.length === 0) return null;
                return (
                  <React.Fragment key={groupKey}>
                    <div style={SECTION_LABEL}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: deltaColor(groupKey),
                          display: 'inline-block',
                        }}
                      />
                      {deltaSectionLabel(groupKey)} · {groupRows.length}
                    </div>
                    {groupRows.map(([skillId, row]) => (
                      <div
                        key={skillId}
                        style={{
                          ...ROW,
                          border: '1px solid var(--border-default)',
                          background: 'white',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                              }}
                              title={skillId}
                            >
                              {row.displayName ?? skillId}
                            </span>
                            {typeof row.score === 'number' ? (
                              <span style={PILL} title="AI 评分 (0-100)">
                                {row.score}
                              </span>
                            ) : null}
                          </div>
                          {row.reason ? (
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--fg-muted)',
                                marginTop: 2,
                                lineHeight: 1.45,
                              }}
                            >
                              {row.reason}
                            </div>
                          ) : null}
                        </div>
                        <label
                          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => toggleEnabled(skillId, e.target.checked)}
                          />
                          启用
                        </label>
                        <label
                          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                          title="把 manifest 钉到新会话 system prompt — 首轮可直接调用，会占 token"
                        >
                          <input
                            type="checkbox"
                            checked={row.pinned}
                            disabled={!row.enabled}
                            onChange={(e) => togglePinned(skillId, e.target.checked)}
                          />
                          Pin
                        </label>
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </>
          ) : null}

          {recommendation && recommendation.rejected.length > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: 'var(--fg-muted)', cursor: 'pointer' }}>
                AI 建议丢弃 ({recommendation.rejected.length})
              </summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recommendation.rejected.map((entry) => (
                  <div
                    key={entry.skill_id}
                    style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '4px 8px' }}
                  >
                    <strong>{entry.skill_id}</strong> — {entry.reason}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        <footer style={FOOTER}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            点击「应用」会全量替换当前 workspace 的选择集，下次新建会话生效。
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                fontSize: 13,
                cursor: applying ? 'wait' : 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying || !recommendation || totalRows === 0}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                fontSize: 13,
                cursor: applying ? 'wait' : 'pointer',
                opacity: !recommendation || totalRows === 0 ? 0.5 : 1,
              }}
            >
              {applying ? '应用中…' : `应用 (启用 ${summary.enabled})`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
