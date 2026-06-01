/**
 * 模板管理页（v2 · 复查重构）
 *
 * 设计与五层架构（L1.1）+ visible member slot（L1.2A）一致：
 *   - 模板 = 一份按 reception/pm1/pm2/executor/reviewer 分组的成员花名册 + 元数据
 *   - 同层多 specialty（如 executor 同时含前端 / 后端 / DevOps）通过 personaKey 区分
 *   - 创建 session 时直接以模板的 memberSlots 作为默认花名册写入 session 不可变快照
 *
 * 交互（复查重点：让配置 / 编辑更顺手）：
 *   - 选中用户模板即进入「直接编辑」，不再需要先点「编辑」按钮
 *   - 改动后底部出现 sticky 保存条（保存 / 放弃），未改动不打扰
 *   - 系统种子模板只读，提供「复制为我的模板」直接派生
 *   - 中部 roster 用 checklist 勾选 + 快捷预设（恢复默认 / 仅必选 / 清空 / 按规模重置）
 *
 * 三栏布局：[左] 模板列表 · [中] 五层 roster 编辑器 · [右] 元数据
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  createWorkflowsClient,
  type UpdateWorkflowTemplateInput,
  type WorkflowTemplateScale,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  TEAM_RUNTIME_LAYER_ORDER,
  type TeamRuntimeLayer,
  type FixedTeamMemberSlot,
} from '@openAwork/shared';
import { useTeamWorkflowTemplates } from '../runtime/hooks/use-team-workflow-templates.js';
import { SHELL_BACKGROUND } from '../runtime/shared/team-runtime-shared.js';
import {
  CollapseLeftIcon,
  CopyIcon,
  PlusIcon,
  SyncIcon,
  TemplateIcon,
} from '../runtime/shared/TeamIcons.js';
import { SPECIALTY_LABEL } from './templates/template-architecture.js';
import { TemplateListSidebar } from './templates/TemplateListSidebar.js';
import { TemplateLayerRosterEditor } from './templates/TemplateLayerRosterEditor.js';
import { RolePromptPreviewPanel } from '../runtime/shared/RolePromptPreviewPanel.js';
import { TemplateMetaHeader } from './templates/TemplateMetaHeader.js';
import { TemplateRosterToolbar } from './templates/TemplateRosterToolbar.js';
import { TemplateModelConfigModal } from './templates/TemplateModelConfigModal.js';
import { CustomRoleModal, type CustomRoleDraft } from './templates/CustomRoleModal.js';
import { useModelCatalog } from './templates/use-model-catalog.js';
import { useCapabilityCatalog } from './templates/use-capability-catalog.js';
import { useTemplatePreferences } from './templates/use-template-preferences.js';
import {
  clearAllModels,
  countAssignedModels,
  setLayerModel,
  type ModelCandidate,
} from './templates/model-assignment.js';
import {
  addCustomSlot,
  buildRequiredOnlyRoster,
  buildRosterForScale,
  cloneDefaultRoster,
  cloneRoster,
  collectTemplateIssues,
  diffTemplateStates,
  EMPTY_TEMPLATE_STATE,
  editorStateToMetadata,
  exportTemplateState,
  groupRosterByLayer,
  importTemplateState,
  isSeedTemplate,
  modelPoolEquals,
  moveCustomSlotToLayer,
  rosterEquals,
  templateToEditorState,
  updateCustomSlot,
  validateTemplateState,
  type TemplateEditorState,
  type TemplateIssue,
} from './templates/template-roster-state.js';

/**
 * 工作区内容带宽度上限。
 *
 * 原值 920px 在宽屏下纵向过长、右侧大片留白。放宽到 1080px 后配合 roster 编辑器
 * 的「左层信息 + 右成员 chips」横向行布局，可铺满横向空间、显著减少纵向滚动；
 * 窄屏由各组件内部的 flex-wrap 自动回落，不会溢出。
 */
const WORKSPACE_MAX_WIDTH = 1080;

export default function TeamTemplatesPage() {
  const navigate = useNavigate();
  const {
    canCreateTemplate,
    createTemplate,
    duplicateTemplate,
    error: templateError,
    loading: templateLoading,
    busy: templateBusy,
    refresh,
    removeTemplate,
    templates,
    templateCount,
    updateTemplate,
  } = useTeamWorkflowTemplates();

  const {
    providers: modelProviders,
    allModels,
    loading: modelCatalogLoading,
    error: modelCatalogError,
    reload: reloadModelCatalog,
  } = useModelCatalog();

  const { skills: skillOptions, mcpServers: mcpOptions } = useCapabilityCatalog();
  const templatePrefs = useTemplatePreferences();

  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const workflowsClient = useMemo(() => createWorkflowsClient(gatewayUrl), [gatewayUrl]);
  /** 智能分配进行中（调上游 LLM），用于按钮 loading 态。 */
  const [assigningModels, setAssigningModels] = useState(false);
  /** 最近一次智能分配的「每层推荐理由」（layer -> reason），用于弹窗展示。 */
  const [assignReasons, setAssignReasons] = useState<Record<string, string>>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 是否处于「新建模板」草稿态（尚未落库）。 */
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<TemplateEditorState>(EMPTY_TEMPLATE_STATE);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  /** 自定义角色弹窗：{ layer, editingSlot } 打开，null 关闭。 */
  const [customRoleModal, setCustomRoleModal] = useState<{
    layer: TeamRuntimeLayer;
    editingSlot: FixedTeamMemberSlot | null;
  } | null>(null);
  /** 角色提示词预览面板：选中某层时打开（只读预览该层 SOUL + 指令栈），null 关闭。 */
  const [previewLayer, setPreviewLayer] = useState<TeamRuntimeLayer | null>(null);
  /** 隐藏的文件输入，用于「导入模板 JSON」。 */
  const importInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const isReadOnly = !creating && (!selectedTemplate || isSeedTemplate(selectedTemplate));
  const editorEditable = creating || (!!selectedTemplate && !isSeedTemplate(selectedTemplate));

  /**
   * 当前模板候选模型池解析为带能力元数据的 ModelCandidate 列表。
   * 只保留仍存在于真实 catalog 中的模型（失活模型自动剔除），供智能分配与下拉使用。
   */
  const poolCandidates = useMemo<ModelCandidate[]>(() => {
    if (draft.modelPool.length === 0) return [];
    const byKey = new Map(allModels.map((m) => [`${m.providerId}::${m.modelId}`, m]));
    return draft.modelPool
      .map((ref) => byKey.get(`${ref.providerId}::${ref.modelId}`))
      .filter((m): m is ModelCandidate => m !== undefined);
  }, [draft.modelPool, allModels]);

  // Sync draft from the selected template (unless we're in create mode).
  useEffect(() => {
    if (creating) return;
    if (selectedTemplate) {
      setDraft(templateToEditorState(selectedTemplate));
    } else {
      setDraft(EMPTY_TEMPLATE_STATE);
    }
    // Only re-hydrate when the *identity* of the selected template changes,
    // so editing a selected template won't be clobbered by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, creating]);

  // Auto-select first template when list loads
  useEffect(() => {
    if (selectedId === null && !creating && templates.length > 0) {
      setSelectedId(templates[0]!.id);
    }
  }, [creating, selectedId, templates]);

  // 列表加载完成后清理偏好里已不存在的模板 id（删除后避免脏数据残留）。
  const prunePrefs = templatePrefs.prune;
  useEffect(() => {
    if (templateLoading || templates.length === 0) return;
    prunePrefs(new Set(templates.map((t) => t.id)));
  }, [templateLoading, templates, prunePrefs]);

  // Auto-clear feedback
  useEffect(() => {
    if (!feedback) return undefined;
    const handle = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(handle);
  }, [feedback]);

  const dirty = useMemo(() => {
    if (creating) return true;
    if (!selectedTemplate || isSeedTemplate(selectedTemplate)) return false;
    const original = templateToEditorState(selectedTemplate);
    return (
      draft.name !== original.name ||
      draft.description !== original.description ||
      draft.defaultProvider !== original.defaultProvider ||
      draft.scale !== original.scale ||
      draft.focus !== original.focus ||
      draft.recommendedFor !== original.recommendedFor ||
      draft.recommendedDefault !== original.recommendedDefault ||
      draft.modelAssignStrategy !== original.modelAssignStrategy ||
      !modelPoolEquals(draft.modelPool, original.modelPool) ||
      !rosterEquals(draft.memberSlots, original.memberSlots)
    );
  }, [creating, draft, selectedTemplate]);

  const validation = useMemo(() => validateTemplateState(draft), [draft]);
  /** 实时校验问题清单（错误 + 警告），仅在可编辑态展示。 */
  const templateIssues = useMemo(
    () => (editorEditable ? collectTemplateIssues(draft) : []),
    [editorEditable, draft],
  );
  /** 相对已保存版本的变更清单（仅编辑已有模板时有意义；新建无对照）。 */
  const templateChanges = useMemo(() => {
    if (creating || !selectedTemplate || isSeedTemplate(selectedTemplate)) return [];
    return diffTemplateStates(templateToEditorState(selectedTemplate), draft);
  }, [creating, selectedTemplate, draft]);
  /** 变更明细是否展开。 */
  const [showChanges, setShowChanges] = useState(false);

  const patchDraft = useCallback((patch: Partial<TemplateEditorState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 导出当前模板为 JSON 文件下载。 */
  const handleExport = useCallback(() => {
    try {
      const json = exportTemplateState(draft);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (draft.name.trim() || 'team-template').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      a.download = `${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({ kind: 'success', message: '模板已导出为 JSON' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : '导出失败',
      });
    }
  }, [draft]);

  /** 触发文件选择 → 读取 JSON → 导入为新建草稿。 */
  const handleImportFile = useCallback((file: File) => {
    void file
      .text()
      .then((text) => {
        const result = importTemplateState(text);
        if (!result.ok) {
          setFeedback({ kind: 'error', message: `导入失败：${result.error}` });
          return;
        }
        // 导入一律进入「新建草稿」态，避免覆盖已有模板；名称带「(导入)」后缀去重提示。
        setCreating(true);
        setSelectedId(null);
        setDraft({
          ...result.state,
          name: result.state.name.trim() ? `${result.state.name}（导入）` : '导入的模板',
        });
        setFeedback({ kind: 'success', message: '已导入为新建草稿，确认后保存' });
      })
      .catch((err: unknown) => {
        setFeedback({
          kind: 'error',
          message: err instanceof Error ? err.message : '读取文件失败',
        });
      });
  }, []);

  /** 自定义角色弹窗提交：新增或更新一个 custom 成员，写回 roster。 */
  const handleCustomRoleSubmit = useCallback(
    (input: CustomRoleDraft) => {
      if (!customRoleModal) return;
      const { layer, editingSlot } = customRoleModal;
      setDraft((prev) => {
        const patch = {
          displayName: input.displayName,
          systemPrompt: input.systemPrompt,
          toolsets: input.toolsets,
          required: input.required,
          skillIds: input.skillIds,
          mcpServerIds: input.mcpServerIds,
          routingKeywords: input.routingKeywords,
          dispatchPriority: input.dispatchPriority,
          ...(input.variant ? { variant: input.variant } : { variant: undefined }),
          ...(input.model
            ? { providerId: input.model.providerId, modelId: input.model.modelId }
            : { providerId: undefined, modelId: undefined }),
        };
        const nextRoster = editingSlot
          ? updateCustomSlot(prev.memberSlots, editingSlot.id, patch)
          : addCustomSlot(prev.memberSlots, layer, {
              displayName: input.displayName,
              systemPrompt: input.systemPrompt,
              toolsets: input.toolsets,
              required: input.required,
              skillIds: input.skillIds,
              mcpServerIds: input.mcpServerIds,
              routingKeywords: input.routingKeywords,
              dispatchPriority: input.dispatchPriority,
              ...(input.variant ? { variant: input.variant } : {}),
              ...(input.model
                ? { providerId: input.model.providerId, modelId: input.model.modelId }
                : {}),
            });
        return { ...prev, memberSlots: nextRoster };
      });
      setCustomRoleModal(null);
    },
    [customRoleModal],
  );

  /** AI 优化角色提示词：复用 workflows/optimize-prompt，取推荐候选文本。 */
  const handleOptimizeRolePrompt = useCallback(
    async (text: string): Promise<string> => {
      if (!accessToken) throw new Error('未登录');
      const result = await workflowsClient.optimizePrompt(accessToken, {
        originalPrompt: text,
        context: '这是一个团队成员（AI 角色）的人物设定 / 系统提示词，用于多 Agent 协作团队。',
        candidateCount: 1,
      });
      const best =
        result.candidates.find((c) => c.id === result.recommended)?.text ??
        result.candidates[0]?.text ??
        result.recommended;
      return best ?? text;
    },
    [accessToken, workflowsClient],
  );

  /**
   * 一键智能分配模型：调后端 `/workflows/assign-team-models`，让真实 AI 上游
   * 按策略给每层推荐模型；返回的 per-layer 结果写回 roster（整层统一）。
   * 后端在上游不可用 / 返回非法时已内置规则引擎兜底，这里据 source 给出不同提示。
   */
  const handleAssignModels = useCallback(async () => {
    if (!accessToken) {
      setFeedback({ kind: 'error', message: '未登录，无法调用模型分配' });
      return;
    }
    if (poolCandidates.length === 0) {
      setFeedback({ kind: 'error', message: '请先在模型池里勾选候选模型' });
      return;
    }
    setAssigningModels(true);
    try {
      const grouped = groupRosterByLayer(draft.memberSlots);
      const layers = Array.from(grouped.entries())
        .filter(([, slots]) => slots.length > 0)
        .map(([layer, slots]) => ({
          layer,
          memberLabels: slots.map((s) => s.displayName || SPECIALTY_LABEL[s.specialty]),
        }));
      if (layers.length === 0) {
        setFeedback({ kind: 'error', message: '花名册为空，无法分配模型' });
        return;
      }
      const result = await workflowsClient.assignTeamModels(accessToken, {
        strategy: draft.modelAssignStrategy,
        pool: poolCandidates.map((m) => ({
          providerId: m.providerId,
          providerName: m.providerName,
          modelId: m.modelId,
          label: m.label,
          ...(typeof m.contextWindow === 'number' ? { contextWindow: m.contextWindow } : {}),
          ...(typeof m.supportsTools === 'boolean' ? { supportsTools: m.supportsTools } : {}),
          ...(typeof m.supportsThinking === 'boolean'
            ? { supportsThinking: m.supportsThinking }
            : {}),
          ...(typeof m.supportsVision === 'boolean' ? { supportsVision: m.supportsVision } : {}),
          ...(typeof m.inputPricePerMillion === 'number'
            ? { inputPricePerMillion: m.inputPricePerMillion }
            : {}),
          ...(typeof m.outputPricePerMillion === 'number'
            ? { outputPricePerMillion: m.outputPricePerMillion }
            : {}),
        })),
        layers,
      });
      // 把每层分配结果应用到 roster（整层统一）。
      let nextRoster = draft.memberSlots;
      const validLayers = new Set<string>(TEAM_RUNTIME_LAYER_ORDER);
      const reasons: Record<string, string> = {};
      for (const a of result.assignments) {
        if (!validLayers.has(a.layer)) continue;
        nextRoster = setLayerModel(nextRoster, a.layer as TeamRuntimeLayer, {
          providerId: a.providerId,
          modelId: a.modelId,
        });
        if (a.reason) reasons[a.layer] = a.reason;
      }
      setDraft((prev) => ({ ...prev, memberSlots: nextRoster }));
      setAssignReasons(reasons);
      if (result.source === 'llm') {
        setFeedback({
          kind: 'success',
          message: `已由 AI 推荐分配 ${result.assignments.length} 层模型`,
        });
      } else {
        const why =
          result.fallbackReasonCode === 'llm-error'
            ? `AI 调用失败（${result.fallbackMessage ?? '上游错误'}）`
            : result.fallbackReasonCode === 'llm-empty'
              ? `AI 返回无法解析${result.llmRawSnippet ? `（${result.llmRawSnippet.slice(0, 60)}…）` : ''}`
              : '上游不可用';
        setFeedback({
          kind: 'error',
          message: `${why}，已用规则引擎分配 ${result.assignments.length} 层模型`,
        });
      }
    } catch (reason) {
      setFeedback({
        kind: 'error',
        message: reason instanceof Error ? reason.message : '智能分配模型失败',
      });
    } finally {
      setAssigningModels(false);
    }
  }, [accessToken, draft.memberSlots, draft.modelAssignStrategy, poolCandidates, workflowsClient]);

  const guardSwitch = useCallback(() => {
    if (dirty) {
      return window.confirm('当前有未保存的修改，确定要切换吗？');
    }
    return true;
  }, [dirty]);

  const handleStartCreate = useCallback(() => {
    if (!guardSwitch()) return;
    setSelectedId(null);
    setDraft({
      ...EMPTY_TEMPLATE_STATE,
      memberSlots: cloneRoster(EMPTY_TEMPLATE_STATE.memberSlots),
    });
    setCreating(true);
  }, [guardSwitch]);

  const handleDiscard = useCallback(() => {
    if (creating) {
      setCreating(false);
      setDraft(EMPTY_TEMPLATE_STATE);
      if (templates.length > 0) setSelectedId(templates[0]!.id);
      return;
    }
    if (selectedTemplate) {
      setDraft(templateToEditorState(selectedTemplate));
    }
  }, [creating, selectedTemplate, templates]);

  const handleSave = useCallback(async () => {
    if (!validation.valid) {
      setFeedback({ kind: 'error', message: validation.reason });
      return;
    }
    if (creating) {
      const ok = await createTemplate({
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        provider: draft.defaultProvider ?? '',
        optionalAgentIds: [],
        memberSlots: draft.memberSlots,
        modelPool: draft.modelPool,
        modelAssignStrategy: draft.modelAssignStrategy,
        templateExtra: {
          templateScale: draft.scale,
          templateFocus: draft.focus.trim() || null,
          recommendedFor: draft.recommendedFor.trim() || null,
          recommendedDefault: draft.recommendedDefault,
        },
      });
      if (ok) {
        setCreating(false);
        setSelectedId(null); // auto-select effect picks the newest (index 0)
        setFeedback({ kind: 'success', message: '模板已创建' });
      } else {
        setFeedback({ kind: 'error', message: '创建模板失败' });
      }
      return;
    }
    if (selectedTemplate) {
      const patch: UpdateWorkflowTemplateInput = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        metadata: editorStateToMetadata(draft),
      };
      const ok = await updateTemplate(selectedTemplate.id, patch);
      setFeedback(
        ok ? { kind: 'success', message: '已保存修改' } : { kind: 'error', message: '保存失败' },
      );
    }
  }, [createTemplate, creating, draft, selectedTemplate, updateTemplate, validation]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedTemplate) return;
    if (!guardSwitch()) return;
    const ok = await duplicateTemplate(selectedTemplate);
    if (ok) {
      templatePrefs.recordUsage(selectedTemplate.id); // 复制是「采用该模板」的强信号
      setSelectedId(null); // newest copy lands at index 0
      setFeedback({ kind: 'success', message: '已复制为我的模板，可直接编辑' });
    } else {
      setFeedback({ kind: 'error', message: '复制失败' });
    }
  }, [duplicateTemplate, guardSwitch, selectedTemplate, templatePrefs]);

  const handleDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    const ok = await removeTemplate(confirmDeleteId);
    if (ok) {
      setConfirmDeleteId(null);
      if (selectedId === confirmDeleteId) setSelectedId(null);
      setFeedback({ kind: 'success', message: '模板已删除' });
    } else {
      setFeedback({ kind: 'error', message: '删除失败' });
    }
  }, [confirmDeleteId, removeTemplate, selectedId]);

  const showWorkspace = creating || selectedTemplate !== null;

  return (
    <div
      className="page-root"
      style={{
        background: SHELL_BACKGROUND,
        // 用 100% 而非 100dvh：页面被 Layout 外壳包裹（含内边距 + overflow:hidden），
        // 100dvh 会超出实际可用高度，导致左侧列表底部（含「+ 组建新模板」按钮）被裁掉。
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        fontFamily:
          'Inter, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-overlay)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => navigate('/team')}
            className="ui-hover-text-bg"
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--bg-surface)',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: 'var(--fg-default)',
            }}
            title="返回 Team 页面"
          >
            <CollapseLeftIcon size={14} color="currentColor" />
          </button>
          <TemplateIcon size={18} color="var(--accent)" />
          <div style={{ display: 'grid', gap: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg-strong)' }}>
              团队模板
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              五层 roster · 复用至新建会话向导
            </span>
          </div>
          <span
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 6,
              padding: '0 7px',
              display: 'inline-grid',
              placeItems: 'center',
              background: 'var(--bg-surface)',
              color: 'var(--fg-default)',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {templateCount}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {feedback && (
            <span
              style={{
                fontSize: 11,
                color: feedback.kind === 'success' ? 'var(--success)' : 'var(--danger)',
                fontWeight: 600,
              }}
            >
              {feedback.message}
            </span>
          )}
          {templateLoading && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <SyncIcon size={11} color="var(--fg-muted)" />
              同步中…
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={templateLoading}
            style={{
              appearance: 'none',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--fg-default)',
              cursor: templateLoading ? 'not-allowed' : 'pointer',
              opacity: templateLoading ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <SyncIcon size={11} color="currentColor" />
            刷新
          </button>
          {showWorkspace && (
            <button
              type="button"
              onClick={handleExport}
              title="把当前模板导出为 JSON（可备份 / 分享 / 再导入）"
              style={{
                appearance: 'none',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--fg-default)',
                cursor: 'pointer',
              }}
            >
              ⬆ 导出
            </button>
          )}
          {canCreateTemplate && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (!guardSwitch()) return;
                  importInputRef.current?.click();
                }}
                title="从 JSON 文件导入模板（导入为新建草稿）"
                style={{
                  appearance: 'none',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-overlay)',
                  borderRadius: 8,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--fg-default)',
                  cursor: 'pointer',
                }}
              >
                ⬇ 导入
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                  e.target.value = ''; // 允许重复导入同一文件
                }}
              />
            </>
          )}
          {canCreateTemplate && (
            <button
              type="button"
              onClick={handleStartCreate}
              style={{
                appearance: 'none',
                border: '1px solid var(--accent)',
                background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--accent)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PlusIcon size={11} color="currentColor" />
              组建新模板
            </button>
          )}
        </div>
      </header>

      {/* Two-column body: list + full-width workspace */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '256px 1fr',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left column: list */}
        <TemplateListSidebar
          templates={templates}
          selectedId={creating ? null : selectedId}
          loading={templateLoading}
          onSelect={(id) => {
            if (!guardSwitch()) return;
            setCreating(false);
            setSelectedId(id);
          }}
          onCreate={handleStartCreate}
          canCreate={canCreateTemplate}
          isFavorite={templatePrefs.isFavorite}
          onToggleFavorite={templatePrefs.toggleFavorite}
          usage={templatePrefs.prefs.usage}
          recentIds={templatePrefs.prefs.recent}
        />

        {/* Workspace */}
        <div
          style={{
            overflow: 'auto',
            padding: '16px 24px 96px',
            background: 'var(--bg-base)',
            minWidth: 0,
            position: 'relative',
          }}
        >
          {templateError && (
            <div
              style={{
                maxWidth: WORKSPACE_MAX_WIDTH,
                margin: '0 auto 12px',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--danger) 35%, transparent)',
                background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
                color: 'var(--danger)',
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              {templateError}
            </div>
          )}

          {!showWorkspace ? (
            <CenteredEmpty canCreate={canCreateTemplate} onCreate={handleStartCreate} />
          ) : (
            <div
              style={{
                maxWidth: WORKSPACE_MAX_WIDTH,
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Compact metadata band */}
              <TemplateMetaHeader
                state={draft}
                editable={editorEditable}
                creating={creating}
                isSeed={isReadOnly}
                busy={templateBusy}
                modelPoolSize={poolCandidates.length}
                assignedModelCount={countAssignedModels(draft.memberSlots)}
                memberTotal={draft.memberSlots.length}
                onOpenModelConfig={() => setModelModalOpen(true)}
                onChange={patchDraft}
                onApplyScalePreset={(scale: WorkflowTemplateScale) =>
                  patchDraft({ scale, memberSlots: buildRosterForScale(scale) })
                }
                onDuplicate={() => void handleDuplicate()}
                onDelete={() => {
                  if (selectedTemplate) setConfirmDeleteId(selectedTemplate.id);
                }}
              />

              {isReadOnly && (
                <ReadOnlyBanner onDuplicate={() => void handleDuplicate()} busy={templateBusy} />
              )}

              {templateIssues.length > 0 && <ValidationSummary issues={templateIssues} />}

              {/* Roster panel: toolbar header + layer editor, visually grouped */}
              <section
                style={{
                  borderRadius: 12,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-overlay)',
                  overflow: 'hidden',
                }}
              >
                <TemplateRosterToolbar
                  roster={draft.memberSlots}
                  editable={editorEditable}
                  onApplyDefault={() => patchDraft({ memberSlots: cloneDefaultRoster() })}
                  onApplyRequiredOnly={() => patchDraft({ memberSlots: buildRequiredOnlyRoster() })}
                  onClearAll={() => patchDraft({ memberSlots: [] })}
                />
                <div style={{ padding: 12 }}>
                  <TemplateLayerRosterEditor
                    roster={draft.memberSlots}
                    editable={editorEditable}
                    modelPool={poolCandidates}
                    skillOptions={skillOptions}
                    mcpOptions={mcpOptions}
                    onChange={(roster) => patchDraft({ memberSlots: roster })}
                    onAddCustom={(layer) => setCustomRoleModal({ layer, editingSlot: null })}
                    onEditCustom={(slot) =>
                      setCustomRoleModal({ layer: slot.layer, editingSlot: slot })
                    }
                    onPreviewPrompt={(layer) => setPreviewLayer(layer)}
                    onMoveCustom={(slotId, targetLayer) =>
                      patchDraft({
                        memberSlots: moveCustomSlotToLayer(draft.memberSlots, slotId, targetLayer),
                      })
                    }
                  />
                </div>
              </section>
            </div>
          )}

          {/* Sticky save bar (only when there are unsaved changes) */}
          {dirty && editorEditable && (
            <div
              style={{
                position: 'sticky',
                bottom: 16,
                marginTop: 16,
                maxWidth: WORKSPACE_MAX_WIDTH,
                marginLeft: 'auto',
                marginRight: 'auto',
                display: 'grid',
                gap: showChanges && templateChanges.length > 0 ? 8 : 0,
                padding: '10px 16px',
                borderRadius: 12,
                border: '1px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                background: 'color-mix(in oklch, var(--accent) 10%, var(--bg-overlay))',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--fg-default)', fontWeight: 600 }}>
                    {validation.valid
                      ? creating
                        ? '准备创建新模板'
                        : '有未保存的修改'
                      : validation.reason}
                  </span>
                  {!creating && templateChanges.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowChanges((v) => !v)}
                      style={{
                        appearance: 'none',
                        border: '1px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                        background: 'transparent',
                        color: 'var(--accent)',
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 9px',
                        borderRadius: 7,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      {showChanges ? '收起变更 ▲' : `查看变更（${templateChanges.length}）▾`}
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleDiscard}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border-default)',
                      background: 'var(--bg-base)',
                      color: 'var(--fg-muted)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {creating ? '取消' : '放弃'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!validation.valid || templateBusy}
                    style={{
                      padding: '7px 18px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--accent)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: !validation.valid || templateBusy ? 'not-allowed' : 'pointer',
                      opacity: !validation.valid || templateBusy ? 0.5 : 1,
                    }}
                  >
                    {templateBusy ? '保存中…' : creating ? '创建模板' : '保存修改'}
                  </button>
                </div>
              </div>
              {showChanges && templateChanges.length > 0 && (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    display: 'grid',
                    gap: 3,
                    maxHeight: 160,
                    overflowY: 'auto',
                    borderTop: '1px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                    paddingTop: 8,
                  }}
                >
                  {templateChanges.map((change, i) => (
                    <li
                      key={i}
                      style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}
                    >
                      {change}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Model configuration modal (pool + smart assign + per-layer/member tuning) */}
      <TemplateModelConfigModal
        open={modelModalOpen}
        editable={editorEditable}
        roster={draft.memberSlots}
        pool={draft.modelPool}
        poolCandidates={poolCandidates}
        strategy={draft.modelAssignStrategy}
        providers={modelProviders}
        catalogLoading={modelCatalogLoading}
        catalogError={modelCatalogError}
        onReloadCatalog={reloadModelCatalog}
        onChangePool={(modelPool) => patchDraft({ modelPool })}
        onChangeStrategy={(strategy) => patchDraft({ modelAssignStrategy: strategy })}
        assigning={assigningModels}
        assignReasons={assignReasons}
        onAssign={() => void handleAssignModels()}
        onClearAssign={() => {
          patchDraft({ memberSlots: clearAllModels(draft.memberSlots) });
          setAssignReasons({});
        }}
        onChangeRoster={(roster) => patchDraft({ memberSlots: roster })}
        onClose={() => setModelModalOpen(false)}
      />

      {/* Custom role modal (add / edit a user-defined member with AI-optimized prompt) */}
      {customRoleModal && (
        <CustomRoleModal
          open
          layer={customRoleModal.layer}
          editingSlot={customRoleModal.editingSlot}
          poolCandidates={poolCandidates}
          skillOptions={skillOptions}
          mcpOptions={mcpOptions}
          onOptimizePrompt={handleOptimizeRolePrompt}
          onSubmit={handleCustomRoleSubmit}
          onClose={() => setCustomRoleModal(null)}
        />
      )}

      {/* Role prompt preview (read-only SOUL + 7-layer instruction stack for the layer) */}
      <RolePromptPreviewPanel
        layer={previewLayer}
        teamWorkspaceId={null}
        editable
        onClose={() => setPreviewLayer(null)}
      />

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div
          onClick={() => setConfirmDeleteId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-overlay)',
              borderRadius: 12,
              padding: '20px 24px',
              display: 'grid',
              gap: 12,
              maxWidth: 360,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>
              确认删除模板
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.6 }}>
              删除后无法恢复，已使用该模板创建的会话不受影响（roster 已快照写入 session）。
            </span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={templateBusy}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklch, var(--danger) 50%, transparent)',
                  background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                  color: 'var(--danger)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: templateBusy ? 'not-allowed' : 'pointer',
                  opacity: templateBusy ? 0.5 : 1,
                }}
              >
                {templateBusy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyBanner({ onDuplicate, busy }: { onDuplicate: () => void; busy: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid color-mix(in oklch, var(--accent) 25%, transparent)',
        background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>
        系统默认模板为只读，复制一份即可自由编辑。
      </span>
      <button
        type="button"
        onClick={onDuplicate}
        disabled={busy}
        style={{
          appearance: 'none',
          border: '1px solid var(--accent)',
          background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
          color: 'var(--accent)',
          fontSize: 11,
          fontWeight: 700,
          padding: '5px 12px',
          borderRadius: 8,
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.5 : 1,
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <CopyIcon size={11} color="currentColor" />
        复制为我的模板
      </button>
    </div>
  );
}

/** 实时校验摘要：列出错误（红，阻断保存）与警告（黄，建议）。 */
function ValidationSummary({ issues }: { issues: TemplateIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const tone = errors.length > 0 ? 'var(--danger)' : 'var(--warning)';
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid color-mix(in oklch, ${tone} 30%, transparent)`,
        background: `color-mix(in oklch, ${tone} 7%, transparent)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}>
        <span style={{ color: tone }}>
          {errors.length > 0
            ? `⚠ ${errors.length} 个问题需处理`
            : `💡 ${warnings.length} 条优化建议`}
        </span>
        {errors.length > 0 && warnings.length > 0 && (
          <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
            · {warnings.length} 条建议
          </span>
        )}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3 }}>
        {errors.map((issue, i) => (
          <li key={`e-${i}`} style={{ fontSize: 11, color: 'var(--danger)', lineHeight: 1.5 }}>
            {issue.message}
          </li>
        ))}
        {warnings.map((issue, i) => (
          <li key={`w-${i}`} style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CenteredEmpty({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: 14,
        padding: '60px 20px',
      }}
    >
      <TemplateIcon size={48} color="var(--fg-muted)" />
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-default)' }}>
        选择模板查看花名册
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--fg-muted)',
          maxWidth: 320,
          lineHeight: 1.6,
        }}
      >
        从左侧列表选择一个模板来查看 / 编辑五层 roster，或组建一个新模板。
      </span>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          style={{
            minHeight: 36,
            borderRadius: 10,
            border: '1px dashed var(--accent)',
            color: 'var(--accent)',
            background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '8px 22px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <PlusIcon size={14} color="currentColor" />
          组建新模板
        </button>
      )}
    </div>
  );
}
