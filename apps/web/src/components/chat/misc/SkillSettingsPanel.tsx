/**
 * In-chat skill settings panel — embedded as the `skills` tab inside
 * `apps/web/src/pages/chat-page/chat-right-panel.tsx`. Provides the same
 * functional surface as the standalone `apps/web/src/pages/SkillSelectionPage.tsx`
 * but compacted into the slim right-panel column so the user can adjust
 * the skill selection set without leaving chat.
 *
 * Two scopes are exposed via a tab strip at the top:
 *
 *   - "本会话" (session-level): per-row enable/pin toggles call
 *     `PATCH /skills/selection/session/:sessionId` immediately; the
 *     "恢复 workspace 默认" button calls `DELETE` on the same path.
 *
 *   - "Workspace 默认" (workspace-level): per-row enable/pin updates
 *     accumulate in local state until the user clicks "保存", which issues
 *     `PUT /skills/selection`. Pinned drag-and-drop reordering, the token
 *     estimate bar, AI recommendation diff, and JSON import / export are
 *     surfaced here because they all operate on the workspace snapshot.
 *
 * BUILTIN skills are surfaced read-only at the bottom of either scope —
 * they are always available and cannot be filtered or pinned per the spec
 * `.agentdocs/workflow/260509-skill-workspace-selection-spec.md`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { createSkillsClient } from '@openAwork/web-client';
import SkillRecommendationDrawer from '../../../pages/skills/recommendation/SkillRecommendationDrawer.js';
import {
  buildSelectionExport,
  estimatePinnedTokenUsage,
  parseImportedSelection,
  reorderRowsByMove,
  type PinnedTokenEstimate,
} from '../../../pages/skills/selection/skill-selection-helpers.js';

interface InstalledSkillDto {
  skillId: string;
  manifest: {
    id: string;
    name?: string;
    displayName?: string;
    description?: string;
    version?: string;
    capabilities?: string[];
  };
  enabled: boolean;
}

interface EffectiveSkillDto {
  skillId: string;
  enabled: boolean;
  pinned: boolean;
  origin: 'workspace' | 'workspace-fallback' | 'session-override' | 'builtin';
  reason?: string;
  displayName?: string;
  description?: string;
  capabilities?: string[];
}

interface SessionOverrideDto {
  skillId: string;
  enabled: boolean;
  pinned: boolean | null;
  updatedAt: number;
}

interface SelectionGetResponse {
  workspacePath: string;
  workspaceSelections: Array<{
    skillId: string;
    enabled: boolean;
    pinned: boolean;
    reason: string | null;
    source: string;
    updatedAt: number;
  }>;
  sessionOverrides: SessionOverrideDto[];
  effective: EffectiveSkillDto[];
}

interface RowState {
  skillId: string;
  displayName: string;
  description: string;
  version: string;
  capabilities: string[];
  isBuiltin: boolean;
  isInstalled: boolean;
  enabled: boolean;
  pinned: boolean;
  origin?: EffectiveSkillDto['origin'];
  reason?: string;
}

export interface SkillSettingsPanelProps {
  sessionId: string | null;
  workspacePath: string | null | undefined;
  /** Required for fetch authorization. Panel renders nothing when null. */
  accessToken: string | null | undefined;
  /** Gateway base URL — passed in instead of read directly so the panel can be embedded by callers that already have an authenticated client. */
  gatewayUrl: string;
}

type ScopeTab = 'session' | 'workspace';

const TABS_BAR: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
};

const TAB_BUTTON_BASE: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 11,
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-subtle)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  cursor: 'pointer',
};

const TAB_BUTTON_ACTIVE: React.CSSProperties = {
  ...TAB_BUTTON_BASE,
  borderColor: 'var(--accent)',
  color: 'var(--accent)',
  background: 'var(--accent-soft, rgba(99,102,241,0.08))',
};

const SECTION: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  padding: 10,
};

const SECTION_HEADING: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-default)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 6,
};

const ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  gap: 8,
  alignItems: 'center',
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-2, var(--bg-overlay))',
};

const PILL: React.CSSProperties = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 6,
  background: 'var(--accent-soft, rgba(99,102,241,0.12))',
  color: 'var(--accent)',
};

const TOOL_BUTTON_BASE: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 11,
  cursor: 'pointer',
};

const TOOL_BUTTON_ACCENT: React.CSSProperties = {
  ...TOOL_BUTTON_BASE,
  borderColor: 'var(--accent)',
  color: 'var(--accent)',
  background: 'transparent',
};

const TOOL_BUTTON_PRIMARY: React.CSSProperties = {
  ...TOOL_BUTTON_BASE,
  borderColor: 'transparent',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent))',
};

const ORIGIN_LABEL: Record<EffectiveSkillDto['origin'], string> = {
  workspace: 'workspace',
  'workspace-fallback': 'fallback',
  'session-override': 'override',
  builtin: 'builtin',
};

const ORIGIN_PILL_STYLE: Record<EffectiveSkillDto['origin'], React.CSSProperties> = {
  workspace: { background: 'var(--accent-soft, rgba(99,102,241,0.12))', color: 'var(--accent)' },
  'workspace-fallback': { background: 'var(--warning-muted)', color: 'var(--warning))' },
  'session-override': { background: 'var(--danger-muted)', color: 'var(--danger))' },
  builtin: { background: 'rgba(100,116,139,0.16)', color: 'var(--fg-muted)' },
};

const DRAG_HANDLE_STYLE: React.CSSProperties = {
  cursor: 'grab',
  fontSize: 12,
  color: 'var(--fg-muted)',
  padding: '0 4px',
  userSelect: 'none',
};

function buildRows(installed: InstalledSkillDto[], effective: EffectiveSkillDto[]): RowState[] {
  const effectiveByid = new Map(effective.map((entry) => [entry.skillId, entry]));
  const rows: RowState[] = [];
  const seen = new Set<string>();

  for (const inst of installed) {
    if (!inst.enabled) continue;
    const eff = effectiveByid.get(inst.skillId);
    rows.push({
      skillId: inst.skillId,
      displayName:
        eff?.displayName ?? inst.manifest.displayName ?? inst.manifest.name ?? inst.skillId,
      description: eff?.description ?? inst.manifest.description ?? '',
      version: inst.manifest.version ?? '',
      capabilities: eff?.capabilities ?? inst.manifest.capabilities ?? [],
      isBuiltin: false,
      isInstalled: true,
      enabled: eff ? eff.enabled : false,
      pinned: eff ? eff.pinned : false,
      origin: eff?.origin,
      reason: eff?.reason,
    });
    seen.add(inst.skillId);
  }

  for (const eff of effective) {
    if (seen.has(eff.skillId)) continue;
    if (eff.origin === 'builtin') {
      rows.push({
        skillId: eff.skillId,
        displayName: eff.displayName ?? eff.skillId,
        description: eff.description ?? '',
        version: '',
        capabilities: eff.capabilities ?? [],
        isBuiltin: true,
        isInstalled: false,
        enabled: true,
        pinned: false,
        origin: 'builtin',
      });
      continue;
    }
    rows.push({
      skillId: eff.skillId,
      displayName: eff.displayName ?? eff.skillId,
      description: eff.description ?? '',
      version: '',
      capabilities: eff.capabilities ?? [],
      isBuiltin: false,
      isInstalled: false,
      enabled: eff.enabled,
      pinned: eff.pinned,
      origin: eff.origin,
      reason: eff.reason,
    });
  }
  return rows;
}

export default function SkillSettingsPanel(
  props: SkillSettingsPanelProps,
): React.ReactElement | null {
  const { sessionId, workspacePath, accessToken, gatewayUrl } = props;

  const [tab, setTab] = useState<ScopeTab>(sessionId ? 'session' : 'workspace');
  const [rows, setRows] = useState<RowState[]>([]);
  const [serverData, setServerData] = useState<SelectionGetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-evaluate the default tab whenever the active session changes (e.g. the
  // user navigates from the empty welcome view into a real chat).
  useEffect(() => {
    setTab(sessionId ? 'session' : 'workspace');
  }, [sessionId]);

  const skillsClient = useMemo(() => createSkillsClient(gatewayUrl), [gatewayUrl]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [selection, installed] = await Promise.all([
        skillsClient.getSelection(accessToken, {
          ...(workspacePath && workspacePath.trim().length > 0
            ? { workspacePath: workspacePath.trim() }
            : {}),
          ...(sessionId ? { sessionId } : {}),
        }) as Promise<SelectionGetResponse>,
        skillsClient.listInstalled(accessToken) as Promise<{ skills: InstalledSkillDto[] }>,
      ]);
      setServerData(selection);
      setRows(buildRows(installed.skills, selection.effective));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accessToken, skillsClient, sessionId, workspacePath]);

  // Refresh on initial mount and whenever the workspace / session changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---------------------------------------------------------------------
  // Workspace-tab actions (PUT /skills/selection)
  // ---------------------------------------------------------------------

  const updateRow = useCallback((skillId: string, patch: Partial<RowState>): void => {
    setRows((prev) => prev.map((row) => (row.skillId === skillId ? { ...row, ...patch } : row)));
  }, []);

  const reorderPinned = useCallback((fromSkillId: string, toSkillId: string): void => {
    if (fromSkillId === toSkillId) return;
    setRows((prev) => reorderRowsByMove(prev, fromSkillId, toSkillId));
    setHint('优先级已调整。点击「保存」生效。');
  }, []);

  const saveWorkspace = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const items = rows
        .filter((row) => !row.isBuiltin && row.isInstalled)
        .map((row) => ({
          skillId: row.skillId,
          enabled: row.enabled,
          pinned: row.pinned,
          reason: row.reason,
        }));
      await skillsClient.putSelection(accessToken ?? '', {
        workspacePath: workspacePath?.trim() || null,
        items,
      });
      setHint('已保存。下次新建会话生效。');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [skillsClient, accessToken, refresh, rows, workspacePath]);

  const tokenEstimate = useMemo<PinnedTokenEstimate>(
    () =>
      estimatePinnedTokenUsage(
        rows.map((row) => ({
          skillId: row.skillId,
          displayName: row.displayName,
          description: row.description,
          capabilities: row.capabilities,
          pinned: row.pinned,
          enabled: row.enabled,
          isBuiltin: row.isBuiltin,
        })),
      ),
    [rows],
  );

  const exportSelection = useCallback((): void => {
    const doc = buildSelectionExport({
      workspacePath: workspacePath?.trim() || null,
      rows,
    });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.download = `skill-selection-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    setHint('已导出选择集 JSON。');
  }, [rows, workspacePath]);

  const handleImportFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0] ?? null;
      if (event.target) event.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseImportedSelection(text);
        if (!parsed.ok) {
          setError(`导入失败：${parsed.error}`);
          return;
        }
        setRows((prev) => {
          const installedIds = new Set(
            prev.filter((row) => row.isInstalled && !row.isBuiltin).map((row) => row.skillId),
          );
          let appliedCount = 0;
          const next = prev.map((row) => {
            if (row.isBuiltin || !row.isInstalled) return row;
            const incoming = parsed.items.find((entry) => entry.skillId === row.skillId);
            if (!incoming) return row;
            appliedCount += 1;
            return {
              ...row,
              enabled: incoming.enabled,
              pinned: incoming.pinned && incoming.enabled,
              reason: incoming.reason ?? row.reason,
            };
          });
          const skipped = parsed.items.filter((entry) => !installedIds.has(entry.skillId));
          setHint(
            `已应用导入项 ${appliedCount}。` +
              (skipped.length > 0 ? ` ${skipped.length} 项未安装已忽略。` : ''),
          );
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Session-tab actions (PATCH/DELETE /skills/selection/session/:id)
  // ---------------------------------------------------------------------

  const writeSessionOverride = useCallback(
    async (skillId: string, patch: { enabled?: boolean; pinned?: boolean }): Promise<void> => {
      if (!sessionId || !serverData) return;
      // Three-way precedence for the `pinned` field: an unrelated `enabled`
      // toggle must NOT concretize an inherit-pinned override (NULL in the
      // store) into a sticky boolean. Order: explicit patch > existing override
      // value (boolean | null) > NULL = inherit workspace pinned.
      const overridesById = new Map<string, { enabled: boolean; pinned: boolean | null }>();
      for (const override of serverData.sessionOverrides) {
        overridesById.set(override.skillId, {
          enabled: override.enabled,
          pinned: override.pinned,
        });
      }
      const existingForRow = overridesById.get(skillId);
      const effectiveRow = serverData.effective.find((entry) => entry.skillId === skillId);
      const newEnabled = patch.enabled ?? existingForRow?.enabled ?? effectiveRow?.enabled ?? true;
      let newPinned: boolean | null;
      if (patch.pinned !== undefined) newPinned = patch.pinned;
      else if (existingForRow !== undefined) newPinned = existingForRow.pinned;
      else newPinned = null;
      overridesById.set(skillId, { enabled: newEnabled, pinned: newPinned });

      const body = {
        items: Array.from(overridesById.entries()).map(([id, value]) => ({
          skillId: id,
          enabled: value.enabled,
          ...(value.pinned !== null ? { pinned: value.pinned } : {}),
        })),
      };
      await skillsClient.patchSessionSelection(accessToken ?? '', sessionId, body);
    },
    [skillsClient, accessToken, serverData, sessionId],
  );

  const handleSessionToggleEnabled = useCallback(
    async (skillId: string, enabled: boolean): Promise<void> => {
      try {
        await writeSessionOverride(skillId, { enabled, pinned: enabled ? undefined : false });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh, writeSessionOverride],
  );

  const handleSessionTogglePinned = useCallback(
    async (skillId: string, pinned: boolean): Promise<void> => {
      try {
        await writeSessionOverride(skillId, { pinned });
        setHint('Pinned 变更将在下一次新建会话生效。');
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh, writeSessionOverride],
  );

  const handleResetSessionOverride = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    try {
      await skillsClient.removeSessionSelection(accessToken ?? '', sessionId);
      setHint('已恢复 workspace 默认。');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [skillsClient, accessToken, refresh, sessionId]);

  const grouped = useMemo(() => {
    const pinned: RowState[] = [];
    const enabled: RowState[] = [];
    const disabled: RowState[] = [];
    const builtins: RowState[] = [];
    const orphaned: RowState[] = [];
    for (const row of rows) {
      if (row.isBuiltin) builtins.push(row);
      else if (!row.isInstalled) orphaned.push(row);
      else if (row.pinned) pinned.push(row);
      else if (row.enabled) enabled.push(row);
      else disabled.push(row);
    }
    return { pinned, enabled, disabled, builtins, orphaned };
  }, [rows]);

  const hasSessionOverride = serverData?.sessionOverrides.length
    ? serverData.sessionOverrides.length > 0
    : false;

  const managePanelHref = workspacePath
    ? `/skills/selection?workspacePath=${encodeURIComponent(workspacePath)}`
    : '/skills/selection';

  if (!accessToken) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>
        请先登录后再调整 skill 选择集。
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}
      data-testid="skill-settings-panel"
    >
      <div style={TABS_BAR}>
        <button
          type="button"
          style={tab === 'session' ? TAB_BUTTON_ACTIVE : TAB_BUTTON_BASE}
          onClick={() => setTab('session')}
          disabled={!sessionId}
          title={sessionId ? '调整本会话覆盖' : '当前无活动会话'}
        >
          本会话{hasSessionOverride ? ' · 有覆盖' : ''}
        </button>
        <button
          type="button"
          style={tab === 'workspace' ? TAB_BUTTON_ACTIVE : TAB_BUTTON_BASE}
          onClick={() => setTab('workspace')}
        >
          Workspace 默认
        </button>
        {loading ? (
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', alignSelf: 'center' }}>
            加载中…
          </span>
        ) : null}
      </div>

      {error ? (
        <div style={{ padding: 8, color: 'var(--danger))', fontSize: 11 }}>{error}</div>
      ) : null}
      {hint ? <div style={{ padding: 8, color: 'var(--accent)', fontSize: 11 }}>{hint}</div> : null}

      {tab === 'workspace' ? (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setRecommendOpen(true)}
              disabled={loading}
              style={{
                ...TOOL_BUTTON_ACCENT,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              AI 推荐
            </button>
            <button
              type="button"
              onClick={exportSelection}
              disabled={loading || rows.length === 0}
              style={{
                ...TOOL_BUTTON_BASE,
                cursor: loading || rows.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              导出
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              style={{
                ...TOOL_BUTTON_BASE,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              导入
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(event) => void handleImportFileChange(event)}
            />
            <button
              type="button"
              onClick={() => void saveWorkspace()}
              disabled={saving || loading}
              style={{
                ...TOOL_BUTTON_PRIMARY,
                cursor: saving || loading ? 'wait' : 'pointer',
                marginLeft: 'auto',
              }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>

          <ScopeHelp scope="workspace" />
          <TokenEstimateBar estimate={tokenEstimate} />

          <Group
            title="Pinned (新会话自动注入 · 拖拽排序)"
            rows={grouped.pinned}
            onChange={updateRow}
            onReorder={reorderPinned}
          />
          <Group
            title="Enabled (按需通过 skill 工具加载)"
            rows={grouped.enabled}
            onChange={updateRow}
          />
          <Group title="Disabled" rows={grouped.disabled} onChange={updateRow} />
          {grouped.orphaned.length > 0 ? (
            <Group
              title="选择集中已不存在 (建议保存清理)"
              rows={grouped.orphaned}
              onChange={updateRow}
              orphan
            />
          ) : null}
          <BuiltinGroup rows={grouped.builtins} />
        </>
      ) : (
        <>
          <ScopeHelp scope="session" />
          <SessionGroup
            rows={rows}
            disabled={!sessionId}
            onToggleEnabled={(id, enabled) => void handleSessionToggleEnabled(id, enabled)}
            onTogglePinned={(id, pinned) => void handleSessionTogglePinned(id, pinned)}
            onReset={() => void handleResetSessionOverride()}
            canReset={Boolean(sessionId) && hasSessionOverride}
          />
        </>
      )}

      <div
        style={{
          paddingTop: 6,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--fg-muted)',
        }}
      >
        <Link to={managePanelHref} style={{ color: 'var(--accent)' }}>
          打开完整管理面板 →
        </Link>
        <span>{rows.length} skills 可用</span>
      </div>

      <SkillRecommendationDrawer
        open={recommendOpen}
        onClose={() => setRecommendOpen(false)}
        gatewayUrl={gatewayUrl}
        token={accessToken ?? ''}
        workspacePath={workspacePath?.trim() || ''}
        currentSelection={rows
          .filter((row) => !row.isBuiltin && row.isInstalled && row.enabled)
          .map((row) => ({
            skillId: row.skillId,
            enabled: row.enabled,
            pinned: row.pinned,
            displayName: row.displayName,
          }))}
        onApplied={async () => {
          setHint('已应用 AI 推荐。下次新建会话生效。');
          await refresh();
        }}
      />
    </div>
  );
}

interface GroupProps {
  title: string;
  rows: RowState[];
  onChange: (skillId: string, patch: Partial<RowState>) => void;
  onReorder?: (fromSkillId: string, toSkillId: string) => void;
  orphan?: boolean;
}

function Group({
  title,
  rows,
  onChange,
  onReorder,
  orphan = false,
}: GroupProps): React.ReactElement {
  const draggable = onReorder !== undefined;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <section style={SECTION}>
      <div style={SECTION_HEADING}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: 4 }}>—</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row) => (
            <div
              key={row.skillId}
              style={{
                ...ROW,
                gridTemplateColumns: draggable ? 'auto 1fr auto auto' : '1fr auto auto',
                opacity: draggingId === row.skillId ? 0.5 : 1,
                outline:
                  dragOverId === row.skillId && draggingId && draggingId !== row.skillId
                    ? '2px solid var(--accent)'
                    : 'none',
                outlineOffset: -2,
              }}
              draggable={draggable}
              onDragStart={
                draggable
                  ? (event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', row.skillId);
                      setDraggingId(row.skillId);
                    }
                  : undefined
              }
              onDragEnd={
                draggable
                  ? () => {
                      setDraggingId(null);
                      setDragOverId(null);
                    }
                  : undefined
              }
              onDragOver={
                draggable
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      if (dragOverId !== row.skillId) setDragOverId(row.skillId);
                    }
                  : undefined
              }
              onDragLeave={
                draggable
                  ? () => {
                      if (dragOverId === row.skillId) setDragOverId(null);
                    }
                  : undefined
              }
              onDrop={
                draggable
                  ? (event) => {
                      event.preventDefault();
                      const sourceId = event.dataTransfer.getData('text/plain');
                      setDraggingId(null);
                      setDragOverId(null);
                      if (sourceId && sourceId !== row.skillId && onReorder) {
                        onReorder(sourceId, row.skillId);
                      }
                    }
                  : undefined
              }
            >
              {draggable ? (
                <div style={DRAG_HANDLE_STYLE} aria-label="拖拽调整优先级" title="拖拽调整优先级">
                  ⋮⋮
                </div>
              ) : null}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={row.skillId}
                >
                  {row.displayName}
                  {row.version ? (
                    <span style={{ ...PILL, marginLeft: 6 }}>v{row.version}</span>
                  ) : null}
                </div>
                {row.description ? (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      marginTop: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.description}
                  </div>
                ) : null}
                {row.reason ? (
                  <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 1 }}>
                    {row.reason}
                  </div>
                ) : null}
              </div>
              <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={orphan}
                  onChange={(event) =>
                    onChange(row.skillId, {
                      enabled: event.target.checked,
                      pinned: event.target.checked ? row.pinned : false,
                    })
                  }
                />
                启用
              </label>
              <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  type="checkbox"
                  checked={row.pinned}
                  disabled={!row.enabled || orphan}
                  onChange={(event) => onChange(row.skillId, { pinned: event.target.checked })}
                />
                Pin
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface SessionGroupProps {
  rows: RowState[];
  disabled: boolean;
  onToggleEnabled: (skillId: string, enabled: boolean) => void;
  onTogglePinned: (skillId: string, pinned: boolean) => void;
  /** Invoked when the user clicks the small "重置覆盖" link in the section header. */
  onReset: () => void;
  /** Whether `onReset` should render as enabled. */
  canReset: boolean;
}

function SessionGroup({
  rows,
  disabled,
  onToggleEnabled,
  onTogglePinned,
  onReset,
  canReset,
}: SessionGroupProps): React.ReactElement {
  const visible = rows.filter((row) => row.isInstalled || row.isBuiltin || row.origin);
  return (
    <section style={SECTION}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <div style={{ ...SECTION_HEADING, marginBottom: 0 }}>本会话 effective skills</div>
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset}
          title={canReset ? '清除本会话所有 skill 覆盖，恢复 workspace 默认' : '当前没有会话覆盖'}
          style={{
            fontSize: 10,
            border: 'none',
            background: 'transparent',
            color: canReset ? 'var(--accent)' : 'var(--fg-muted)',
            cursor: canReset ? 'pointer' : 'not-allowed',
            padding: '2px 4px',
          }}
        >
          重置覆盖
        </button>
      </div>
      {visible.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: 4 }}>—</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map((row) => {
            const isBuiltin = row.isBuiltin;
            return (
              <div
                key={row.skillId}
                style={{
                  ...ROW,
                  // Builtins collapse the two checkbox columns into one
                  // "始终可用" label so the row is visually lighter than
                  // user-controllable rows.
                  gridTemplateColumns: isBuiltin ? '1fr auto' : '1fr auto auto',
                  opacity: isBuiltin ? 0.7 : 1,
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={row.skillId}
                  >
                    {row.displayName}
                  </span>
                  {row.origin ? (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 4,
                        ...ORIGIN_PILL_STYLE[row.origin],
                      }}
                      title={`origin: ${row.origin}`}
                    >
                      {ORIGIN_LABEL[row.origin]}
                    </span>
                  ) : null}
                </div>
                {isBuiltin ? (
                  <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>始终可用</span>
                ) : (
                  <>
                    <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        disabled={disabled}
                        onChange={(event) => onToggleEnabled(row.skillId, event.target.checked)}
                      />
                      启用
                    </label>
                    <label
                      style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}
                      title="把 skill manifest 钉到新会话的 system prompt — 模型首轮就能直接调用，无需 list_skills"
                    >
                      <input
                        type="checkbox"
                        checked={row.pinned}
                        disabled={disabled || !row.enabled}
                        onChange={(event) => onTogglePinned(row.skillId, event.target.checked)}
                      />
                      Pin
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Compact help banner displayed at the top of each scope tab. Defines what
 * "启用" and "Pin" mean so first-time users do not have to consult docs.
 */
function ScopeHelp({ scope }: { scope: ScopeTab }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.55,
        color: 'var(--fg-default)',
        padding: '7px 9px',
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
      }}
    >
      <div>
        <span style={{ fontWeight: 600 }}>启用</span>
        <span style={{ color: 'var(--fg-muted)' }}>：当前作用域是否可被模型发现 / 调用</span>
      </div>
      <div>
        <span style={{ fontWeight: 600 }}>Pin</span>
        <span style={{ color: 'var(--fg-muted)' }}>
          ：把 manifest 钉到新会话 system prompt（首轮直接可用，会占 token）
        </span>
      </div>
      {scope === 'session' ? (
        <div style={{ marginTop: 4, color: 'var(--accent)' }}>
          仅本会话生效。Pin 变更需在下次新建会话才会注入。
        </div>
      ) : (
        <div style={{ marginTop: 4, color: 'var(--fg-muted)' }}>
          保存后作为该 workspace 的默认值，所有新会话生效。
        </div>
      )}
    </div>
  );
}

function TokenEstimateBar({ estimate }: { estimate: PinnedTokenEstimate }): React.ReactElement {
  const overCap = estimate.ratio > 1.0;
  const nearCap = estimate.ratio > 0.75 && !overCap;
  const fillPct = Math.min(100, estimate.ratio * 100);
  const barColor = overCap ? 'var(--danger))' : nearCap ? 'var(--warning))' : 'var(--accent)';
  const message = overCap
    ? '超出上限，后端会从低优先级开始截断'
    : nearCap
      ? '接近上限，考虑减少 pinned skill'
      : '在安全阈值内';
  return (
    <section style={SECTION}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <div style={{ ...SECTION_HEADING, marginBottom: 0 }}>Pinned tokens</div>
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          {estimate.pinnedCount} · ~{estimate.estimatedTokens} / {estimate.capTokens}
        </div>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: 'var(--border-subtle)',
          overflow: 'hidden',
        }}
        aria-label="pinned skill token usage"
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: '100%',
            background: barColor,
            transition: 'width 200ms ease',
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: barColor, marginTop: 4 }}>{message}</div>
    </section>
  );
}

function BuiltinGroup({ rows }: { rows: RowState[] }): React.ReactElement {
  return (
    <section style={{ ...SECTION, opacity: 0.85 }}>
      <div style={SECTION_HEADING}>Built-in (Always available)</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: 4 }}>—</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row) => (
            <div key={row.skillId} style={ROW}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{row.displayName}</div>
              </div>
              <span style={PILL}>builtin</span>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>始终可用</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
