import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAgentsClient } from '@openAwork/web-client';
import type {
  CreateManagedAgentInput,
  ManagedAgentRecord,
  UpdateManagedAgentInput,
} from '@openAwork/shared';
import { useAuthStore } from '../../stores/auth/auth.js';
import { AgentsCatalogPanel } from '../../components/agents/agents-catalog-panel.js';
import { AgentsEditorPanel } from '../../components/agents/agents-editor-panel.js';
import { AgentsInspectorPanel } from '../../components/agents/agents-inspector-panel.js';
import { AgentsPageHeader } from '../../components/agents/agents-page-header.js';
import { AgentsToolbar } from '../../components/agents/agents-toolbar.js';
import {
  collectRoleOptions,
  filterAgents,
  sortAgents,
  summarizeAgents,
} from '../../components/agents/agents-page-data.js';
import type { AgentsFilterState } from '../../components/agents/agents-page-data.js';
import {
  emptyEditorState,
  parseAliases,
  toEditorState,
} from '../../components/agents/agents-editor-state.js';
import type { AgentEditorState, EditorMode } from '../../components/agents/agents-editor-state.js';
import { toBuiltinUpdateInput } from './agents-builtin-update-input.js';
import '../../styles/console-surfaces.css';
import '../../components/agents/agents-page.css';

/** 初始筛选条件：全部来源 / 全部角色 / 全部状态 / 空查询。 */
const INITIAL_FILTER: AgentsFilterState = {
  query: '',
  originFilter: 'all',
  roleFilter: 'all',
  statusFilter: 'all',
};

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
    model: state.model.trim() || undefined,
    variant: state.variant.trim() || undefined,
    fallbackModels: parseAliases(state.fallbackModelsText),
    systemPrompt: state.systemPrompt.trim() || undefined,
    note: state.note.trim() || undefined,
    enabled: state.enabled,
  };
}

function toUpdateInput(state: AgentEditorState): UpdateManagedAgentInput {
  return toCreateInput(state);
}

/**
 * 统一的「saving + try/catch/finally」Agent 管理动作包装。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（条件 / 逻辑 / 三元），本页 6 处 try/catch/finally 会让它整体脱靶
 * （实测）。语义逐字照搬：`run` 的全流程仍在 try 内，catch 只做错误文案映射，
 * finally 无条件清 saving；入口的「清空 error / saveMessage」也一并收在这里。
 */
async function runAgentActionOnce(ctx: {
  setSaving: (saving: boolean) => void;
  setError: (message: string | null) => void;
  setSaveMessage: (message: string | null) => void;
  /** catch 的兜底文案（`reason.message` 优先）。 */
  failureMessage: string;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setSaving(true);
  ctx.setError(null);
  ctx.setSaveMessage(null);
  try {
    await ctx.run();
  } catch (reason) {
    ctx.setError(reason instanceof Error ? reason.message : ctx.failureMessage);
  } finally {
    ctx.setSaving(false);
  }
}

export default function AgentsPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [agents, setAgents] = useState<ManagedAgentRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [editorState, setEditorState] = useState<AgentEditorState>(emptyEditorState());
  const [filter, setFilter] = useState<AgentsFilterState>(INITIAL_FILTER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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

  const filteredAgents = useMemo(() => filterAgents(agents, filter), [agents, filter]);

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
  const roleOptions = useMemo(() => collectRoleOptions(agents), [agents]);

  const handleFilterChange = useCallback((patch: Partial<AgentsFilterState>) => {
    setFilter((current) => ({ ...current, ...patch }));
  }, []);

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
    await runAgentActionOnce({
      setSaving,
      setError,
      setSaveMessage,
      failureMessage: '新增 Agent 失败',
      run: async () => {
        const client = createAgentsClient(gatewayUrl);
        const created = await client.create(accessToken, toCreateInput(editorState));
        setAgents((current) => sortAgents([...current, created]));
        setSelectedAgentId(created.id);
        setEditorMode('edit');
        setSaveMessage('已新增自定义 Agent');
      },
    });
  }

  async function handleSave() {
    if (!accessToken || !selectedAgent) {
      return;
    }
    await runAgentActionOnce({
      setSaving,
      setError,
      setSaveMessage,
      failureMessage: '保存 Agent 失败',
      run: async () => {
        const client = createAgentsClient(gatewayUrl);
        const updated = await client.update(
          accessToken,
          selectedAgent.id,
          selectedAgent.origin === 'builtin'
            ? toBuiltinUpdateInput(editorState, selectedAgent)
            : toUpdateInput(editorState),
        );
        updateLocalAgent(updated);
        setSaveMessage('已保存 Agent 实体');
      },
    });
  }

  async function handleToggleEnabled() {
    if (!accessToken || !selectedAgent) {
      return;
    }
    await runAgentActionOnce({
      setSaving,
      setError,
      setSaveMessage,
      failureMessage: '切换启用状态失败',
      run: async () => {
        const client = createAgentsClient(gatewayUrl);
        const updated = await client.update(accessToken, selectedAgent.id, {
          enabled: !selectedAgent.enabled,
        });
        updateLocalAgent(updated);
        setSaveMessage(updated.enabled ? '已启用 Agent' : '已禁用 Agent');
      },
    });
  }

  async function handleResetOne() {
    if (!accessToken || !selectedAgent) {
      return;
    }
    await runAgentActionOnce({
      setSaving,
      setError,
      setSaveMessage,
      failureMessage: '恢复默认失败',
      run: async () => {
        const client = createAgentsClient(gatewayUrl);
        const reset = await client.reset(accessToken, selectedAgent.id);
        updateLocalAgent(reset);
        setSaveMessage('已恢复该 Agent 默认配置');
      },
    });
  }

  async function handleResetAll() {
    if (!accessToken) {
      return;
    }
    await runAgentActionOnce({
      setSaving,
      setError,
      setSaveMessage,
      failureMessage: '恢复全部默认失败',
      run: async () => {
        const client = createAgentsClient(gatewayUrl);
        const reset = await client.resetAll(accessToken);
        const sorted = sortAgents(reset);
        setAgents(sorted);
        setSelectedAgentId(sorted[0]?.id ?? null);
        setEditorMode('edit');
        setSaveMessage('已恢复全部 Agent 默认配置');
      },
    });
  }

  async function handleRemove() {
    if (!accessToken || !selectedAgent || !selectedAgent.removable) {
      return;
    }
    await runAgentActionOnce({
      setSaving,
      setError,
      setSaveMessage,
      failureMessage: '移除 Agent 失败',
      run: async () => {
        const client = createAgentsClient(gatewayUrl);
        await client.remove(accessToken, selectedAgent.id);
        setAgents((current) => current.filter((agent) => agent.id !== selectedAgent.id));
        setSelectedAgentId(null);
        setEditorMode('edit');
        setSaveMessage('已移除自定义 Agent');
      },
    });
  }

  function handleResetDraft() {
    setEditorState(toEditorState(selectedAgent));
    setSaveMessage(null);
  }

  const canSave =
    editorMode === 'create'
      ? editorState.label.trim().length > 0 && editorState.systemPrompt.trim().length > 0
      : selectedAgent?.origin === 'builtin'
        ? true
        : editorState.label.trim().length > 0 && editorState.systemPrompt.trim().length > 0;

  return (
    <div className="agents-console">
      <AgentsPageHeader
        summary={summary}
        saving={saving}
        onCreate={() => {
          setEditorMode('create');
          setSelectedAgentId(null);
        }}
        onResetAll={() => void handleResetAll()}
      />

      <AgentsToolbar
        filter={filter}
        roleOptions={roleOptions}
        matchCount={filteredAgents.length}
        totalCount={agents.length}
        onChange={handleFilterChange}
      />

      {error ? (
        <div className="console-alert" role="alert">
          {error}
        </div>
      ) : null}

      <div className="agents-workbench">
        <AgentsCatalogPanel
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
          onResetDraft={handleResetDraft}
          onSave={() => void handleSave()}
          onToggleEnabled={() => void handleToggleEnabled()}
          onResetOne={() => void handleResetOne()}
          onRemove={() => void handleRemove()}
        />

        <AgentsInspectorPanel agent={editorMode === 'edit' ? selectedAgent : null} />
      </div>
    </div>
  );
}
