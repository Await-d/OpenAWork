/**
 * 自定义角色弹窗：在任意层新增 / 编辑一个用户自定义成员。
 *
 * 用户可：
 *   - 填角色名称
 *   - 写「人物设定 / 提示词」，并用「AI 优化」按钮让上游 LLM 润色（复用
 *     workflows/optimize-prompt）
 *   - 勾选工具权限（toolsets）
 *   - 选运行模型（候选池内，可留空走默认解析）
 *
 * 弹窗只负责收集 / 校验，提交时把结果回传给父组件写回 roster。
 */

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { FixedTeamMemberSlot, TeamRuntimeLayer } from '@openAwork/shared';
import { LAYER_ALLOWED_TOOLSETS, TEAM_LAYER_META, TOOLSET_LABEL } from './template-architecture.js';
import { ModelSelect } from './ModelSelect.js';
import type { ModelAssignment, ModelCandidate } from './model-assignment.js';
import type { CapabilityOption } from './use-capability-catalog.js';

const ALL_TOOLS: Array<{ id: string; label: string }> = [
  { id: 'read', label: '只读' },
  { id: 'write', label: '编辑' },
  { id: 'shell', label: '执行' },
  { id: 'lsp', label: 'LSP' },
  { id: 'test', label: '测试' },
  { id: 'review', label: '评审' },
  { id: 'web', label: '联网' },
];

export interface CustomRoleDraft {
  displayName: string;
  systemPrompt: string;
  toolsets: string[];
  required: boolean;
  model: ModelAssignment | null;
  skillIds: string[];
  mcpServerIds: string[];
  routingKeywords: string[];
  variant: string | null;
  dispatchPriority: 'high' | 'normal' | 'low';
}

interface Props {
  open: boolean;
  layer: TeamRuntimeLayer;
  /** 编辑已存在的自定义角色时传入；新增时为 null。 */
  editingSlot: FixedTeamMemberSlot | null;
  poolCandidates: ModelCandidate[];
  /** 可绑定的能力目录（已安装/启用）。 */
  skillOptions: CapabilityOption[];
  mcpOptions: CapabilityOption[];
  /** AI 优化提示词回调：传入原始 prompt，返回优化后的文本（失败时 reject）。 */
  onOptimizePrompt: (prompt: string) => Promise<string>;
  onSubmit: (draft: CustomRoleDraft) => void;
  onClose: () => void;
}

const LABEL: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const INPUT: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-strong)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

function capChipStyle(on: boolean, color: string, tint: string): CSSProperties {
  return {
    appearance: 'none',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 12px',
    borderRadius: 999,
    border: `1px solid ${on ? color : 'var(--border-subtle)'}`,
    background: on ? tint : 'transparent',
    color: on ? color : 'var(--fg-muted)',
    cursor: 'pointer',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

export function CustomRoleModal({
  open,
  layer,
  editingSlot,
  poolCandidates,
  skillOptions,
  mcpOptions,
  onOptimizePrompt,
  onSubmit,
  onClose,
}: Props) {
  const meta = TEAM_LAYER_META[layer];
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [toolsets, setToolsets] = useState<string[]>(['read']);
  const [required, setRequired] = useState(false);
  const [model, setModel] = useState<ModelAssignment | null>(null);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
  /** 路由关键词原始输入（逗号 / 空格分隔），提交时拆成数组。 */
  const [keywordsText, setKeywordsText] = useState('');
  /** 推理强度（仅对支持 reasoning effort 的模型有意义，留空走模型默认）。 */
  const [variant, setVariant] = useState<string | null>(null);
  /** 派发优先级（同分排序权重）。 */
  const [dispatchPriority, setDispatchPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  // 打开 / 切换编辑对象时初始化表单。
  useEffect(() => {
    if (!open) return;
    // 层级工具天花板：编辑老数据 / 导入数据时，先把超出天花板的工具滤掉，
    // 避免出现「禁用却已勾选、又取消不掉」的死状态，也保证保存回去的是合法集合。
    const ceiling = LAYER_ALLOWED_TOOLSETS[layer] ?? [];
    if (editingSlot) {
      setName(editingSlot.displayName);
      setPrompt(editingSlot.systemPrompt ?? '');
      setToolsets(editingSlot.toolsets.filter((t) => ceiling.includes(t)));
      setRequired(editingSlot.required);
      setModel(
        editingSlot.modelId
          ? { providerId: editingSlot.providerId ?? '', modelId: editingSlot.modelId }
          : null,
      );
      setSkillIds([...(editingSlot.skillIds ?? [])]);
      setMcpServerIds([...(editingSlot.mcpServerIds ?? [])]);
      setKeywordsText((editingSlot.routingKeywords ?? []).join('、'));
      setVariant(editingSlot.variant ?? null);
      setDispatchPriority(editingSlot.dispatchPriority ?? 'normal');
    } else {
      setName('');
      setPrompt('');
      setToolsets(['read']);
      setRequired(false);
      setModel(null);
      setSkillIds([]);
      setMcpServerIds([]);
      setKeywordsText('');
      setVariant(null);
      setDispatchPriority('normal');
    }
    setOptimizeError(null);
  }, [open, editingSlot, layer]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const canSubmit = useMemo(
    () => name.trim().length > 0 && prompt.trim().length > 0 && toolsets.length > 0,
    [name, prompt, toolsets],
  );

  if (!open) return null;

  const allowedTools = LAYER_ALLOWED_TOOLSETS[layer] ?? [];
  const toggleTool = (id: string) => {
    if (!allowedTools.includes(id)) return; // 层级天花板外的工具不可勾选
    setToolsets((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const handleOptimize = async () => {
    const base = prompt.trim();
    if (base.length === 0) {
      setOptimizeError('请先填写一些提示词内容，再让 AI 优化');
      return;
    }
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const improved = await onOptimizePrompt(base);
      if (improved && improved.trim().length > 0) {
        setPrompt(improved.trim());
      } else {
        setOptimizeError('AI 未返回优化结果');
      }
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : 'AI 优化失败');
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 10000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-overlay)',
          borderRadius: 14,
          width: 'min(560px, 100%)',
          maxHeight: '88vh',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          border: '1px solid var(--border-default)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: meta.color,
              boxShadow: `0 0 0 3px ${meta.tint}`,
              flexShrink: 0,
            }}
          />
          <div style={{ display: 'grid', gap: 1, flex: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
              {editingSlot ? '编辑自定义角色' : '新增自定义角色'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              {meta.label} · 提示词 + 工具权限 + 运行模型
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--bg-surface)',
              borderRadius: 8,
              width: 30,
              height: 30,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: 'var(--fg-muted)',
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: 18, display: 'grid', gap: 14 }}>
          {/* Name */}
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={LABEL}>角色名称</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：性能优化专家 / 移动端工程师"
              style={INPUT}
            />
          </label>

          {/* System prompt + AI optimize */}
          <div style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={LABEL}>人物设定 / 提示词</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => void handleOptimize()}
                disabled={optimizing || prompt.trim().length === 0}
                style={{
                  appearance: 'none',
                  border: '1px solid var(--accent)',
                  background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 7,
                  cursor: optimizing || prompt.trim().length === 0 ? 'not-allowed' : 'pointer',
                  opacity: optimizing || prompt.trim().length === 0 ? 0.5 : 1,
                }}
              >
                {optimizing ? '正在优化…' : '✨ AI 优化'}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="描述这个角色的职责、专长、工作方式和约束。例如：你是一名资深性能优化工程师，擅长定位前端渲染瓶颈与后端慢查询，给出可量化的优化方案…"
              style={{
                ...INPUT,
                resize: 'vertical',
                minHeight: 110,
                fontFamily: 'inherit',
                lineHeight: 1.6,
              }}
            />
            {optimizeError && (
              <span style={{ fontSize: 10, color: 'var(--danger)' }}>{optimizeError}</span>
            )}
          </div>

          {/* Routing keywords — 让上游派发动态识别该角色擅长什么 */}
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={LABEL}>擅长领域 / 路由关键词</span>
            <input
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder="如：性能、渲染、慢查询、profiling（用、或空格分隔）"
              style={INPUT}
            />
            <span style={{ fontSize: 10, color: 'var(--fg-subtle)', lineHeight: 1.5 }}>
              填写该角色擅长处理的关键词。上游（PM2）派活时，任务命中这些词会优先派给本角色，
              让自定义角色也能被动态识别与关联，而不是只靠层级兜底。
            </span>
          </label>

          {/* Toolsets */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={LABEL}>工具权限</span>
              <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>
                {meta.label}天花板：{allowedTools.map((t) => TOOLSET_LABEL[t] ?? t).join(' / ')}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALL_TOOLS.map((tool) => {
                const allowed = allowedTools.includes(tool.id);
                const enabled = toolsets.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    disabled={!allowed}
                    title={allowed ? undefined : `${meta.label}不允许使用「${tool.label}」工具`}
                    style={{
                      appearance: 'none',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '5px 12px',
                      borderRadius: 999,
                      border: `1px solid ${enabled ? meta.color : 'var(--border-subtle)'}`,
                      background: enabled ? meta.tint : 'transparent',
                      color: enabled ? meta.color : 'var(--fg-muted)',
                      cursor: allowed ? 'pointer' : 'not-allowed',
                      opacity: allowed ? 1 : 0.4,
                    }}
                  >
                    {enabled ? '✓ ' : ''}
                    {tool.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Skills */}
          {skillOptions.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={LABEL}>Skills（已安装启用）· 已选 {skillIds.length}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {skillOptions.map((opt) => {
                  const on = skillIds.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.description}
                      onClick={() =>
                        setSkillIds((prev) =>
                          prev.includes(opt.id)
                            ? prev.filter((x) => x !== opt.id)
                            : [...prev, opt.id],
                        )
                      }
                      style={capChipStyle(on, meta.color, meta.tint)}
                    >
                      {on ? '✓ ' : ''}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* MCP servers */}
          {mcpOptions.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={LABEL}>MCP 服务（已配置启用）· 已选 {mcpServerIds.length}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {mcpOptions.map((opt) => {
                  const on = mcpServerIds.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.description}
                      onClick={() =>
                        setMcpServerIds((prev) =>
                          prev.includes(opt.id)
                            ? prev.filter((x) => x !== opt.id)
                            : [...prev, opt.id],
                        )
                      }
                      style={capChipStyle(on, meta.color, meta.tint)}
                    >
                      {on ? '✓ ' : ''}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model + required */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 5, flex: 1, minWidth: 200 }}>
              <span style={LABEL}>运行模型</span>
              {poolCandidates.length > 0 ? (
                <ModelSelect
                  value={model}
                  options={poolCandidates}
                  editable
                  placeholder="默认（自动解析）"
                  onChange={setModel}
                  style={{ width: '100%', fontSize: 12, padding: '7px 24px 7px 10px' }}
                />
              ) : (
                <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
                  模型池为空，将走默认解析（可在「配置模型」里先勾选）
                </span>
              )}
            </label>
            <label
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 12,
                color: 'var(--fg-default)',
                cursor: 'pointer',
                paddingBottom: 7,
              }}
            >
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                style={{ accentColor: meta.color }}
              />
              固定必选
            </label>
          </div>

          {/* 推理强度 + 派发优先级 */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 5, flex: 1, minWidth: 180 }}>
              <span style={LABEL}>推理强度（仅推理类模型生效）</span>
              <select
                value={variant ?? ''}
                onChange={(e) => setVariant(e.target.value || null)}
                style={{ ...INPUT, fontSize: 12, cursor: 'pointer' }}
              >
                <option value="">默认（跟随模型）</option>
                <option value="minimal">minimal · 最低</option>
                <option value="low">low · 低</option>
                <option value="medium">medium · 中</option>
                <option value="high">high · 高</option>
                <option value="xhigh">xhigh · 最高</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, flex: 1, minWidth: 180 }}>
              <span style={LABEL}>派发优先级（同分排序）</span>
              <select
                value={dispatchPriority}
                onChange={(e) => setDispatchPriority(e.target.value as 'high' | 'normal' | 'low')}
                style={{ ...INPUT, fontSize: 12, cursor: 'pointer' }}
              >
                <option value="high">高 · 优先派发</option>
                <option value="normal">常规</option>
                <option value="low">低 · 兜底</option>
              </select>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              appearance: 'none',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-base)',
              color: 'var(--fg-muted)',
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                displayName: name.trim(),
                systemPrompt: prompt.trim(),
                toolsets,
                required,
                model,
                skillIds,
                mcpServerIds,
                routingKeywords: Array.from(
                  new Set(
                    keywordsText
                      .split(/[,，、\s]+/)
                      .map((k) => k.trim())
                      .filter((k) => k.length > 0),
                  ),
                ).slice(0, 30),
                variant,
                dispatchPriority,
              })
            }
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 800,
              padding: '8px 20px',
              borderRadius: 8,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {editingSlot ? '保存角色' : '添加角色'}
          </button>
        </div>
      </div>
    </div>
  );
}
