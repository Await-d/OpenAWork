/**
 * Skill workspace selection management — manual mode (PR1).
 *
 * Lets the user pin / enable / disable installed and local-discovered skills
 * for a given chat workspace path. BUILTIN skills are shown read-only at the
 * bottom because they are always available and cannot be filtered (per the
 * design spec at .agentdocs/workflow/260509-skill-workspace-selection-spec.md).
 *
 * AI recommendation drawer (PR4) is wired through `SkillRecommendationDrawer`:
 * "AI 推荐" toolbar button surfaces a side-by-side diff of current vs proposed
 * selection and applies the merged set as overrides through
 * `POST /skills/recommend/:id/apply`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSkillsClient } from '@openAwork/web-client';
import { useAuthStore } from '../stores/auth.js';
import SkillRecommendationDrawer from './SkillRecommendationDrawer.js';
import {
  buildSelectionExport,
  estimatePinnedTokenUsage,
  parseImportedSelection,
  reorderRowsByMove,
  type PinnedTokenEstimate,
} from './skill-selection-helpers.js';

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
  reason?: string;
}

const PANEL: React.CSSProperties = {
  borderRadius: 16,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  padding: 20,
  boxShadow: 'var(--shadow-sm)',
};

const SECTION_HEADING: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-2)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 8,
};

const ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  gap: 12,
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-2, var(--surface))',
};

const PILL: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 6,
  background: 'var(--accent-soft, rgba(99,102,241,0.12))',
  color: 'var(--accent)',
};

function readWorkspacePath(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('workspacePath') ?? '';
}

function buildRows(installed: InstalledSkillDto[], effective: EffectiveSkillDto[]): RowState[] {
  const effectiveByid = new Map(effective.map((e) => [e.skillId, e]));
  const installedById = new Map(installed.map((i) => [i.skillId, i]));
  const rows: RowState[] = [];
  const seen = new Set<string>();

  for (const inst of installed) {
    if (!inst.enabled) continue; // user-level hard off
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
      reason: eff?.reason,
    });
    seen.add(inst.skillId);
  }

  for (const eff of effective) {
    if (seen.has(eff.skillId)) continue;
    if (eff.origin !== 'builtin') {
      // Effective row pointing at an uninstalled skill — surface for cleanup.
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
        reason: eff.reason,
      });
      continue;
    }
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
    });
    void installedById; // referenced for type narrowing; not needed at runtime
  }

  return rows;
}

export default function SkillSelectionPage(): React.ReactElement {
  const { gatewayUrl, accessToken } = useAuthStore();
  const [workspacePath, setWorkspacePath] = useState<string>(() => readWorkspacePath());
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const client = createSkillsClient(gatewayUrl);
      const tokenStr = accessToken ?? '';
      const [selection, installed] = await Promise.all([
        client.getSelection(tokenStr, {
          ...(workspacePath.trim().length > 0 ? { workspacePath: workspacePath.trim() } : {}),
        }) as Promise<SelectionGetResponse>,
        client.listInstalled(tokenStr) as Promise<{ skills: InstalledSkillDto[] }>,
      ]);
      setRows(buildRows(installed.skills, selection.effective));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, accessToken, workspacePath]);

  useEffect(() => {
    if (!accessToken) return;
    void refresh();
  }, [accessToken, refresh]);

  const updateRow = (skillId: string, patch: Partial<RowState>): void => {
    setRows((prev) => prev.map((row) => (row.skillId === skillId ? { ...row, ...patch } : row)));
  };

  const save = useCallback(async (): Promise<void> => {
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
      await createSkillsClient(gatewayUrl).putSelection(accessToken ?? '', {
        workspacePath: workspacePath.trim() || null,
        items,
      });
      setHint('已保存。下次新建会话生效。');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [gatewayUrl, accessToken, refresh, rows, workspacePath]);

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
      workspacePath: workspacePath.trim() || null,
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

  /**
   * Move a pinned row immediately before another pinned row in the master
   * `rows` array. Order matters because the Pinned group is rendered in
   * `rows` order and the gateway persists priority by request index — so
   * reordering the local array is enough to flow the new priority through
   * the next PUT.
   */
  const reorderPinned = useCallback((fromSkillId: string, toSkillId: string): void => {
    if (fromSkillId === toSkillId) return;
    setRows((prev) => reorderRowsByMove(prev, fromSkillId, toSkillId));
    setHint('优先级已调整。点击「保存」生效。');
  }, []);

  const handleImportFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0] ?? null;
      // Reset value so re-importing the same file fires onChange again.
      if (event.target) event.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseImportedSelection(text);
        if (!parsed.ok) {
          setError(`导入失败：${parsed.error}`);
          return;
        }
        // Merge imported items over the current row state by skillId. Items not
        // currently shown (e.g. uninstalled) are skipped to keep PUT happy.
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

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Skill 工作区选择集</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6 }}>
          为指定的 chat 工作区选择启用哪些 skill。Pinned 的 skill 会在新会话首轮自动注入到 system
          prompt；BUILTIN 始终可用，不受过滤。留空 workspacePath 会写入「全局默认」选择集。
        </p>
      </header>

      <section style={{ ...PANEL, marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
          Workspace 路径（绝对路径，留空 = 全局默认）
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder="/home/alice/projects/alpha"
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? '加载中…' : '刷新'}
          </button>
          <button
            type="button"
            onClick={exportSelection}
            disabled={loading || rows.length === 0}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 13,
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
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 13,
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
            onClick={() => setRecommendOpen(true)}
            disabled={loading}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            AI 推荐
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor: saving || loading ? 'wait' : 'pointer',
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        {error ? <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</div> : null}
        {hint ? (
          <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 8 }}>{hint}</div>
        ) : null}
      </section>

      <TokenEstimateBar estimate={tokenEstimate} />
      <Group
        title="Pinned (新会话自动注入到 system prompt · 拖拽调整优先级)"
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
          title="选择集中已不存在对应安装 (建议保存以清理)"
          rows={grouped.orphaned}
          onChange={updateRow}
          orphan
        />
      ) : null}
      <BuiltinGroup rows={grouped.builtins} />
      <SkillRecommendationDrawer
        open={recommendOpen}
        onClose={() => setRecommendOpen(false)}
        gatewayUrl={gatewayUrl}
        token={accessToken ?? ''}
        workspacePath={workspacePath}
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
  /**
   * Optional handler invoked when the user drag-drops a row onto another
   * row. `from` / `to` are skill ids. Only the Pinned group passes this
   * because priority ordering only matters there.
   */
  onReorder?: (fromSkillId: string, toSkillId: string) => void;
  orphan?: boolean;
}

const DRAG_HANDLE_STYLE: React.CSSProperties = {
  cursor: 'grab',
  fontSize: 14,
  color: 'var(--text-3)',
  padding: '0 6px',
  userSelect: 'none',
};

function Group({
  title,
  rows,
  onChange,
  onReorder,
  orphan = false,
}: GroupProps): React.ReactElement {
  const draggable = onReorder !== undefined;
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);

  return (
    <section style={{ ...PANEL, marginBottom: 12 }}>
      <div style={SECTION_HEADING}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 8 }}>—</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {row.displayName}
                  {row.version ? (
                    <span style={{ ...PILL, marginLeft: 8 }}>v{row.version}</span>
                  ) : null}
                </div>
                {row.description ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    {row.description}
                  </div>
                ) : null}
                {row.reason ? (
                  <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                    {row.reason}
                  </div>
                ) : null}
                {row.capabilities.length > 0 ? (
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {row.capabilities.map((cap) => (
                      <span key={cap} style={PILL}>
                        {cap}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={orphan}
                  onChange={(e) =>
                    onChange(row.skillId, {
                      enabled: e.target.checked,
                      pinned: e.target.checked ? row.pinned : false,
                    })
                  }
                />
                Enabled
              </label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={row.pinned}
                  disabled={!row.enabled || orphan}
                  onChange={(e) => onChange(row.skillId, { pinned: e.target.checked })}
                />
                Pinned
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TokenEstimateBar({ estimate }: { estimate: PinnedTokenEstimate }): React.ReactElement {
  const overCap = estimate.ratio > 1.0;
  const nearCap = estimate.ratio > 0.75 && !overCap;
  const fillPct = Math.min(100, estimate.ratio * 100);
  const barColor = overCap ? '#dc2626' : nearCap ? '#d97706' : 'var(--accent)';
  const message = overCap
    ? `\u8d85\u51fa\u4e0a\u9650\uff0c\u540e\u7aef\u4f1a\u4ece\u4f4e\u4f18\u5148\u7ea7\u5f00\u59cb\u622a\u65ad`
    : nearCap
      ? `\u63a5\u8fd1\u4e0a\u9650\uff0c\u8003\u8651\u51cf\u5c11 pinned skill`
      : `\u5728\u5b89\u5168\u9608\u503c\u5185`;
  return (
    <section style={{ ...PANEL, marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <div style={{ ...SECTION_HEADING, marginBottom: 0 }}>Pinned token \u4f30\u7b97</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {estimate.pinnedCount} skill \u00b7 ~{estimate.estimatedTokens} / {estimate.capTokens}{' '}
          tokens \u00b7 {estimate.totalChars} / {estimate.capChars} chars
        </div>
      </div>
      <div
        style={{
          height: 8,
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
      <div style={{ fontSize: 11, color: barColor, marginTop: 4 }}>{message}</div>
    </section>
  );
}

function BuiltinGroup({ rows }: { rows: RowState[] }): React.ReactElement {
  return (
    <section style={{ ...PANEL, marginBottom: 12, opacity: 0.85 }}>
      <div style={SECTION_HEADING}>Built-in (Always available)</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 8 }}>—</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <div key={row.skillId} style={ROW}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{row.displayName}</div>
                {row.description ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    {row.description}
                  </div>
                ) : null}
              </div>
              <span style={PILL}>builtin</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>始终可用</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
