import React, { useEffect, useMemo, useState } from 'react';
import { createAgentsClient } from '@openAwork/web-client';
import { formatCanonicalRole } from '@openAwork/shared';
import type {
  CreateManagedAgentInput,
  CoreRole,
  ManagedAgentRecord,
  RolePreset,
  UpdateManagedAgentInput,
} from '@openAwork/shared';
import { useAuthStore } from '../stores/auth.js';
import {
  AgentsEditorPanel,
  AgentsFilters,
  AgentsHero,
  AgentsListPanel,
  type AgentEditorState,
  type AgentStatusFilter,
  type EditorMode,
  emptyEditorState,
  formatCanonicalRoleZh,
  localizeAgentDescription,
  parseAliases,
  toEditorState,
} from '../components/agents/AgentsPageSections.js';

function toCreateInput(state: AgentEditorState): CreateManagedAgentInput {
  return {
    label: state.label.trim(),
    description: state.description.trim(),
    aliases: parseAliases(state.aliasesText),
    canonicalRole: state.coreRole
      ? {
          coreRole: state.coreRole,
          preset: state.preset || undefined,
          confidence: 'medium',
        }
      : undefined,
    systemPrompt: state.systemPrompt.trim() || undefined,
    note: state.note.trim() || undefined,
    enabled: state.enabled,
  };
}

function toUpdateInput(state: AgentEditorState): UpdateManagedAgentInput {
  return toCreateInput(state);
}

function summarizeAgents(agents: ManagedAgentRecord[]) {
  return {
    total: agents.length,
    enabled: agents.filter((agent) => agent.enabled).length,
    disabled: agents.filter((agent) => !agent.enabled).length,
    custom: agents.filter((agent) => agent.origin === 'custom').length,
  };
}

function sortAgents(agents: ManagedAgentRecord[]): ManagedAgentRecord[] {
  return [...agents].sort((left, right) => {
    const statusDelta = Number(right.enabled) - Number(left.enabled);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const originDelta = Number(left.origin === 'builtin') - Number(right.origin === 'builtin');
    if (originDelta !== 0) {
      return -originDelta;
    }
    return left.label.localeCompare(right.label, 'zh-CN');
  });
}

export default function AgentsPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [agents, setAgents] = useState<ManagedAgentRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [editorState, setEditorState] = useState<AgentEditorState>(emptyEditorState());
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | ManagedAgentRecord['source']>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | CoreRole>('all');
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 1080 : false,
  );

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth <= 1080);
    handler();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setAgents([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const client = createAgentsClient(gatewayUrl);
    setLoading(true);
    setError(null);
    void client
      .list(accessToken)
      .then((records) => {
        if (cancelled) {
          return;
        }
        const sorted = sortAgents(records);
        setAgents(sorted);
        setSelectedAgentId((current) => current ?? sorted[0]?.id ?? null);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '加载 Agent 列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl]);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortAgents(agents).filter((agent) => {
      if (sourceFilter !== 'all' && agent.source !== sourceFilter) {
        return false;
      }
      if (roleFilter !== 'all' && agent.canonicalRole?.coreRole !== roleFilter) {
        return false;
      }
      if (statusFilter === 'enabled' && !agent.enabled) {
        return false;
      }
      if (statusFilter === 'disabled' && agent.enabled) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        agent.id,
        agent.label,
        agent.description,
        localizeAgentDescription(agent),
        agent.canonicalRole ? formatCanonicalRole(agent.canonicalRole) : '',
        formatCanonicalRoleZh(agent) ?? '',
        agent.note ?? '',
        agent.systemPrompt ?? '',
        ...agent.aliases,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [agents, query, roleFilter, sourceFilter, statusFilter]);

  useEffect(() => {
    if (editorMode === 'create') {
      return;
    }
    if (filteredAgents.length === 0) {
      setSelectedAgentId(null);
      return;
    }
    if (!selectedAgentId || !filteredAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(filteredAgents[0]!.id);
    }
  }, [editorMode, filteredAgents, selectedAgentId]);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  useEffect(() => {
    if (editorMode === 'create') {
      setEditorState(emptyEditorState());
      setSaveMessage(null);
      return;
    }
    setEditorState(toEditorState(selectedAgent));
    setSaveMessage(null);
  }, [editorMode, selectedAgent]);

  const summary = useMemo(() => summarizeAgents(agents), [agents]);
  const roleOptions = Array.from(
    new Set(
      agents
        .map((agent) => agent.canonicalRole?.coreRole)
        .filter((role): role is CoreRole => typeof role === 'string'),
    ),
  );

  function updateLocalAgent(next: ManagedAgentRecord) {
    setAgents((current) =>
      sortAgents(current.map((agent) => (agent.id === next.id ? next : agent))),
    );
    setSelectedAgentId(next.id);
    setEditorMode('edit');
  }

  async function handleCreate() {
    if (!accessToken) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const client = createAgentsClient(gatewayUrl);
      const created = await client.create(accessToken, toCreateInput(editorState));
      setAgents((current) => sortAgents([...current, created]));
      setSelectedAgentId(created.id);
      setEditorMode('edit');
      setSaveMessage('已新增自定义 Agent');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新增 Agent 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!accessToken || !selectedAgent) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const client = createAgentsClient(gatewayUrl);
      const updated = await client.update(
        accessToken,
        selectedAgent.id,
        toUpdateInput(editorState),
      );
      updateLocalAgent(updated);
      setSaveMessage('已保存 Agent 实体');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存 Agent 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    if (!accessToken || !selectedAgent) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const client = createAgentsClient(gatewayUrl);
      const updated = await client.update(accessToken, selectedAgent.id, {
        enabled: !selectedAgent.enabled,
      });
      updateLocalAgent(updated);
      setSaveMessage(updated.enabled ? '已启用 Agent' : '已禁用 Agent');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '切换启用状态失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetOne() {
    if (!accessToken || !selectedAgent) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const client = createAgentsClient(gatewayUrl);
      const reset = await client.reset(accessToken, selectedAgent.id);
      updateLocalAgent(reset);
      setSaveMessage('已恢复该 Agent 默认配置');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复默认失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetAll() {
    if (!accessToken) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const client = createAgentsClient(gatewayUrl);
      const reset = await client.resetAll(accessToken);
      const sorted = sortAgents(reset);
      setAgents(sorted);
      setSelectedAgentId(sorted[0]?.id ?? null);
      setEditorMode('edit');
      setSaveMessage('已恢复全部 Agent 默认配置');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复全部默认失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!accessToken || !selectedAgent || !selectedAgent.removable) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const client = createAgentsClient(gatewayUrl);
      await client.remove(accessToken, selectedAgent.id);
      setAgents((current) => current.filter((agent) => agent.id !== selectedAgent.id));
      setSelectedAgentId(null);
      setEditorMode('edit');
      setSaveMessage('已移除自定义 Agent');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除 Agent 失败');
    } finally {
      setSaving(false);
    }
  }

  const canSave = editorState.label.trim().length > 0;

  return (
    <div className="page-root">
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            width: '100%',
            maxWidth: isNarrow ? '100%' : 1380,
            margin: '0 auto',
            display: 'grid',
            gap: 16,
            padding: isNarrow ? '0 2px 14px' : '2px 4px 20px',
          }}
        >
          <AgentsHero
            summary={summary}
            saving={saving}
            onCreate={() => {
              setEditorMode('create');
              setSelectedAgentId(null);
            }}
            onResetAll={() => void handleResetAll()}
          />

          <AgentsFilters
            isNarrow={isNarrow}
            query={query}
            sourceFilter={sourceFilter}
            roleFilter={roleFilter}
            statusFilter={statusFilter}
            roleOptions={roleOptions}
            onQueryChange={setQuery}
            onSourceFilterChange={setSourceFilter}
            onRoleFilterChange={setRoleFilter}
            onStatusFilterChange={setStatusFilter}
          />

          {error && (
            <section
              style={{
                borderRadius: 18,
                border: '1px solid rgba(248, 113, 113, 0.45)',
                background: 'rgba(127, 29, 29, 0.12)',
                padding: '14px 16px',
              }}
            >
              <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>
            </section>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 1.15fr) minmax(340px, 460px)',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <AgentsListPanel
              loading={loading}
              filteredAgents={filteredAgents}
              editorMode={editorMode}
              selectedAgentId={selectedAgentId}
              saving={saving}
              onSelect={(agentId) => {
                setEditorMode('edit');
                setSelectedAgentId(agentId);
              }}
            />

            <AgentsEditorPanel
              editorMode={editorMode}
              selectedAgent={selectedAgent}
              editorState={editorState}
              setEditorState={setEditorState}
              canSave={canSave}
              saving={saving}
              saveMessage={saveMessage}
              onCreate={() => void handleCreate()}
              onCancelCreate={() => {
                setEditorMode('edit');
                setEditorState(toEditorState(selectedAgent));
              }}
              onSave={() => void handleSave()}
              onToggleEnabled={() => void handleToggleEnabled()}
              onResetOne={() => void handleResetOne()}
              onRemove={() => void handleRemove()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
