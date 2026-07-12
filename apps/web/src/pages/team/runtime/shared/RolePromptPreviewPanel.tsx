/**
 * 260531-team-page · RolePromptPreviewPanel（层级角色提示词只读预览）
 *
 * 从右侧滑出的浮层，给定一个团队层级，预览该层角色的**完整提示词**：
 *
 *   - 「画像」：从 SOUL frontmatter 解析出的 5 维度结构卡（身份 / 语气 / 关注 /
 *     边界 / 输出风格），把原本被 chat markdown 渲染器吞掉的 YAML 头清晰展开。
 *   - 「正文」：SOUL 的 Markdown 正文（frontmatter 之后），干净渲染。
 *   - 「原文」：SOUL 的字面原始文本（含 frontmatter），等宽可复制 —— 解决"看不到
 *     实际提示词"的核心诉求。
 *   - 「指令栈」：最终注入 system prompt 的 7 层稳定块全文（previewInstructionStack），
 *     按层折叠展开。
 *   - 「能力」：该层固定工具/产物/指令护栏 + 默认启用项。
 *
 * 只读：默认仅「查看 + 复制」。当传入 editable 时，额外提供「✎ 编辑」入口。
 *
 * **间距纪律**：本文件所有 padding / gap / radius / 边框 / 表面色一律取自
 * content-kit token（CK_GAP* / CK_PAD* / CK_RADIUS* / CK_BORDER* / CK_SURFACE*），
 * 不写裸数字魔法值，保证与其它 tab 视觉同尺度。
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import MarkdownMessageContent from '../../../../components/chat/markdown/markdown-message-content.js';
import { tryFormatJson } from '../../../../utils/format-json.js';
import {
  createTeamPhaseAClient,
  type InstructionStackPreview,
  type LayerCapabilitySummary,
} from '@openAwork/web-client';
import type { TeamRoleLayer } from '../../../../stores/team/team-events.js';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import {
  mapTeamLayerToSoulLayer,
  useTeamRolePromptPreview,
} from '../hooks/use-team-role-prompt-preview.js';
import {
  parseSoulFrontmatter,
  soulFieldLabel,
  type ParsedSoul,
} from '../data/parse-soul-frontmatter.js';
import {
  parseInstructionStack,
  instructionSegmentLabel,
  isMarkdownSegment,
  type InstructionStackSegment,
} from '../data/parse-instruction-stack.js';
import {
  EmptyState,
  SegmentedToggle,
  CK_BORDER,
  CK_BORDER_SUBTLE,
  CK_SURFACE,
  CK_SURFACE_SOFT,
  CK_DASHED_BORDER,
  CK_RADIUS,
  CK_RADIUS_SM,
  CK_GAP,
  CK_GAP_SM,
  CK_GAP_LG,
  CK_PAD,
  CK_PAD_SM,
  CK_SECTION_LABEL_STYLE,
} from './content-kit/index.js';

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1 · 规划',
  pm2: 'PM2 · 管控',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

/** 指令栈层 key → 中文标签。 */
const STACK_LAYER_LABELS: Record<string, string> = {
  agentsMd: 'AGENTS.md',
  architectureMd: '架构说明',
  constitution: '团队宪法',
  projectMemory: '项目记忆',
  lessonsLearned: '经验沉淀',
  userMemory: '个人记忆',
  soul: '角色 SOUL',
};

const SOUL_GUIDELINE_LIMIT = 2000;
const SOUL_HARD_LIMIT = 64 * 1024;

const BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 119,
  background: 'color-mix(in srgb, var(--bg-base) 45%, transparent)',
  backdropFilter: 'blur(1.5px)',
  animation: 'role-prompt-fade-in 140ms ease',
};

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(680px, 68vw)',
  zIndex: 120,
  display: 'flex',
  flexDirection: 'column',
  background: 'color-mix(in srgb, var(--bg-overlay) 97%, var(--bg-base))',
  borderLeft: `1px solid ${CK_BORDER}`,
  boxShadow: 'var(--shadow-lg)',
  animation: 'role-prompt-slide-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: CK_GAP,
  padding: CK_PAD,
  borderBottom: `1px solid ${CK_BORDER_SUBTLE}`,
  flexShrink: 0,
};

const TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: CK_GAP_SM,
  padding: `${CK_GAP_SM}px ${CK_GAP_LG}px 0`,
  flexShrink: 0,
  flexWrap: 'wrap',
};

const BTN_STYLE: CSSProperties = {
  padding: CK_PAD_SM,
  borderRadius: CK_RADIUS_SM,
  border: `1px solid ${CK_BORDER}`,
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const ACCENT_BTN_STYLE: CSSProperties = {
  ...BTN_STYLE,
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--accent)',
};

const BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: CK_GAP_LG,
  display: 'flex',
  flexDirection: 'column',
  gap: CK_GAP,
};

const CODE_BLOCK_STYLE: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 11.5,
  lineHeight: 1.6,
  color: 'var(--fg-default)',
  margin: 0,
  padding: CK_PAD,
  borderRadius: CK_RADIUS,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE_SOFT,
};

const HINT_TEXT_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.6,
};

const PILL_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: CK_GAP_SM,
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
};

type PreviewMode = 'profile' | 'body' | 'raw' | 'stack' | 'caps';

type CalloutTone = 'danger' | 'warning' | 'info';

function Callout({ tone, children }: { tone: CalloutTone; children: ReactNode }) {
  const color =
    tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--fg-muted)';
  return (
    <div
      style={{
        padding: CK_PAD,
        borderRadius: CK_RADIUS_SM,
        border:
          tone === 'info'
            ? CK_DASHED_BORDER
            : `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        background:
          tone === 'info' ? 'transparent' : `color-mix(in srgb, ${color} 8%, transparent)`,
        color,
        fontSize: tone === 'danger' ? 12 : 11,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export interface RolePromptPreviewPanelProps {
  /** 要预览的层级；null 时不渲染面板。 */
  layer: TeamRoleLayer | null;
  teamWorkspaceId?: string | null;
  /** 允许内联编辑该层 SOUL（保存为当前用户的 persona override）。默认只读。 */
  editable?: boolean;
  onClose: () => void;
}

export function RolePromptPreviewPanel({
  layer,
  teamWorkspaceId,
  editable = false,
  onClose,
}: RolePromptPreviewPanelProps) {
  const [mode, setMode] = useState<PreviewMode>('profile');
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const { supported, loading, error, persona, instructionStack, capability, refresh } =
    useTeamRolePromptPreview({
      layer,
      teamWorkspaceId,
      enabled: layer !== null,
    });

  const soulMd = persona?.effective.soulMd ?? '';
  const isDefault = persona?.effective.isDefault ?? true;
  const parsed = useMemo(() => parseSoulFrontmatter(soulMd), [soulMd]);

  // 内联编辑态：null = 未在编辑；string = 编辑中的草稿。
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const soulLayer = layer ? mapTeamLayerToSoulLayer(layer) : null;
  const phaseAClient = useMemo(
    () => (gatewayUrl ? createTeamPhaseAClient(gatewayUrl) : null),
    [gatewayUrl],
  );
  const isEditing = editDraft !== null;

  // 切层 / 关闭时丢弃未保存的编辑草稿，避免把 A 层的草稿误存到 B 层。
  useEffect(() => {
    setEditDraft(null);
    setSaveError(null);
  }, [layer]);

  // ESC 关闭（编辑中时先退出编辑，避免误丢草稿）+ 打开时锁背景滚动。
  useEffect(() => {
    if (!layer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editDraft !== null) {
        setEditDraft(null);
        setSaveError(null);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [layer, editDraft, onClose]);

  const beginEdit = () => {
    setSaveError(null);
    setEditDraft(soulMd);
  };
  const cancelEdit = () => {
    setEditDraft(null);
    setSaveError(null);
  };
  const saveEdit = () => {
    if (editDraft === null || !phaseAClient || !accessToken || !soulLayer) return;
    setSaving(true);
    setSaveError(null);
    void phaseAClient
      .putPersona(accessToken, soulLayer, { soulMd: editDraft })
      .then(() => {
        setEditDraft(null);
        refresh();
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : '保存失败，请重试。');
      })
      .finally(() => setSaving(false));
  };

  // 重置为最新默认 SOUL：调用 resetPersona 端点，后端用当前内置默认覆盖该层的
  // 自定义 override，并重新标记为「默认副本」——这样后续默认提示词迭代仍会自动下发。
  const [resetting, setResetting] = useState(false);
  const resetToDefault = () => {
    if (!phaseAClient || !accessToken || !soulLayer) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        '确定要恢复为最新默认 SOUL 吗？你对该层的自定义内容会被覆盖，并跟随后续默认更新。',
      );
      if (!ok) return;
    }
    setResetting(true);
    setSaveError(null);
    void phaseAClient
      .resetPersona(accessToken, soulLayer)
      .then(() => {
        setEditDraft(null);
        refresh();
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : '重置失败，请重试。');
      })
      .finally(() => setResetting(false));
  };

  // 当前模式对应的"可复制文本"（原文 / 指令栈）。
  const copyText = mode === 'stack' ? (instructionStack?.stableBlock ?? '') : soulMd;
  const canCopy = copyText.trim().length > 0 && (mode === 'raw' || mode === 'stack');

  if (!layer) return null;

  const body = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 119 }}>
      <div
        style={BACKDROP_STYLE}
        onClick={() => {
          if (editDraft !== null) return; // 编辑中不因点遮罩误丢草稿
          onClose();
        }}
        aria-hidden
      />
      <div
        style={OVERLAY_STYLE}
        role="dialog"
        aria-modal="true"
        aria-label={`${LAYER_LABELS[layer]} 角色提示词预览`}
      >
        <header style={HEADER_STYLE}>
          <span aria-hidden style={{ fontSize: 15 }}>
            🧬
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 13, color: 'var(--fg-strong)' }}>
              {LAYER_LABELS[layer]} · 角色提示词
            </strong>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              {isEditing
                ? '编辑该层 SOUL · 保存后下次新对话生效'
                : editable
                  ? '可查看 / 复制 / 编辑'
                  : '只读预览 · 编辑请到「治理 · 设置」'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {supported && !isEditing && canCopy ? <CopyButton text={copyText} /> : null}
          {supported && editable && !isEditing && !loading ? (
            <button
              type="button"
              style={ACCENT_BTN_STYLE}
              onClick={beginEdit}
              title="编辑该层角色 SOUL"
            >
              ✎ 编辑
            </button>
          ) : null}
          {supported && editable && !isEditing && !loading && !isDefault ? (
            <button
              type="button"
              style={BTN_STYLE}
              onClick={resetToDefault}
              disabled={resetting}
              title="放弃当前自定义，恢复为最新内置默认 SOUL（并跟随后续默认更新）"
            >
              {resetting ? '恢复中…' : '↺ 恢复为最新默认'}
            </button>
          ) : null}
          {supported && !isEditing ? (
            <button type="button" style={BTN_STYLE} onClick={refresh} title="重新拉取">
              刷新
            </button>
          ) : null}
          <button
            type="button"
            style={BTN_STYLE}
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭"
          >
            ✕
          </button>
        </header>

        {!supported ? (
          <div style={BODY_STYLE}>
            <EmptyState
              emoji="🚫"
              title="该层无独立角色提示词"
              description={`${LAYER_LABELS[layer]} 层不绑定独立 SOUL 人格（仅接待 / PM1 / PM2 / 执行 / 评审 五层有）。`}
              style={{ flex: 1 }}
            />
          </div>
        ) : isEditing ? (
          <EditView
            draft={editDraft ?? ''}
            saving={saving}
            saveError={saveError}
            onChange={setEditDraft}
            onCancel={cancelEdit}
            onSave={saveEdit}
          />
        ) : (
          <>
            <div style={TOOLBAR_STYLE}>
              <SegmentedToggle<PreviewMode>
                ariaLabel="提示词预览模式"
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'profile', label: '画像', icon: '🪪' },
                  { value: 'body', label: '正文', icon: '📖' },
                  { value: 'raw', label: '原文', icon: '📄' },
                  { value: 'stack', label: '指令栈', icon: '🧱' },
                  { value: 'caps', label: '能力', icon: '🧰' },
                ]}
              />
              <span
                style={{
                  ...PILL_BASE_STYLE,
                  fontSize: 10,
                  fontWeight: 700,
                  background: isDefault
                    ? 'color-mix(in srgb, var(--fg-muted) 14%, transparent)'
                    : 'color-mix(in srgb, var(--accent) 16%, transparent)',
                  color: isDefault ? 'var(--fg-muted)' : 'var(--accent)',
                }}
              >
                {isDefault ? '默认 SOUL' : '自定义 SOUL'}
              </span>
            </div>

            <div style={BODY_STYLE}>
              {error ? <Callout tone="danger">{error}</Callout> : null}

              {loading ? (
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    flex: 1,
                    color: 'var(--fg-muted)',
                    fontSize: 12,
                  }}
                >
                  加载角色提示词…
                </div>
              ) : mode === 'profile' ? (
                <ProfileView parsed={parsed} soulMd={soulMd} />
              ) : mode === 'body' ? (
                <BodyView parsed={parsed} soulMd={soulMd} />
              ) : mode === 'raw' ? (
                <RawView soulMd={soulMd} />
              ) : mode === 'stack' ? (
                <StackView instructionStack={instructionStack} />
              ) : (
                <CapabilityView capability={capability} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      style={ACCENT_BTN_STYLE}
      onClick={() => {
        const write = navigator.clipboard?.writeText;
        if (!write) return;
        void write
          .call(navigator.clipboard, text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? '✓ 已复制' : '复制全文'}
    </button>
  );
}

function EditView({
  draft,
  saving,
  saveError,
  onChange,
  onCancel,
  onSave,
}: {
  draft: string;
  saving: boolean;
  saveError: string | null;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const overGuideline = draft.length > SOUL_GUIDELINE_LIMIT;
  const tooLong = draft.length > SOUL_HARD_LIMIT;
  const canSave = !saving && !tooLong && draft.trim().length > 0;
  return (
    <div style={BODY_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: CK_GAP_SM, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          编辑该层角色 SOUL（含 frontmatter 画像）。保存为你个人的覆盖版本，下次新对话生效。
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: tooLong || overGuideline ? 'var(--warning)' : 'var(--fg-muted)',
          }}
        >
          {draft.length} 字符
        </span>
      </div>
      {overGuideline && !tooLong ? (
        <Callout tone="warning">
          建议 SOUL 控制在 {SOUL_GUIDELINE_LIMIT} 字符内，以免挤占指令栈 token
          预算。仍可保存，但越长越可能触发自动压缩。
        </Callout>
      ) : null}
      {saveError ? <Callout tone="danger">{saveError}</Callout> : null}
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (canSave) onSave();
          }
        }}
        spellCheck={false}
        aria-label="SOUL 编辑器"
        autoFocus
        style={{
          ...CODE_BLOCK_STYLE,
          flex: 1,
          minHeight: 320,
          resize: 'vertical',
          outline: 'none',
          overflow: 'auto',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: CK_GAP_SM }}>
        <span style={{ flex: 1, fontSize: 10, color: 'var(--fg-subtle)' }}>
          Esc 取消 · ⌘/Ctrl + Enter 保存
        </span>
        <button type="button" style={BTN_STYLE} onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button
          type="button"
          style={{
            ...BTN_STYLE,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontWeight: 800,
            cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.6,
          }}
          onClick={onSave}
          disabled={!canSave}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

function ProfileView({ parsed, soulMd }: { parsed: ParsedSoul; soulMd: string }) {
  if (!soulMd.trim()) {
    return <SoulEmpty />;
  }
  if (!parsed.hasFrontmatter || parsed.fields.length === 0) {
    return (
      <Callout tone="info">
        该 SOUL 未使用 5 维度画像（frontmatter），可切到「正文」或「原文」查看完整内容。
      </Callout>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: CK_GAP }}>
      {parsed.fields.map((field) => (
        <div
          key={field.key}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: CK_GAP_SM,
            padding: CK_PAD,
            borderRadius: CK_RADIUS,
            border: `1px solid ${CK_BORDER_SUBTLE}`,
            background: CK_SURFACE,
          }}
        >
          <span style={CK_SECTION_LABEL_STYLE}>{soulFieldLabel(field.key)}</span>
          {field.items.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              {field.items.map((item, i) => (
                <li key={i} style={{ fontSize: 12.5, color: 'var(--fg-strong)', lineHeight: 1.5 }}>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--fg-strong)', lineHeight: 1.55 }}>
              {field.value ?? '—'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BodyView({ parsed, soulMd }: { parsed: ParsedSoul; soulMd: string }) {
  if (!soulMd.trim()) {
    return <SoulEmpty />;
  }
  const content = parsed.hasFrontmatter ? parsed.body : soulMd;
  if (!content.trim()) {
    return (
      <Callout tone="info">
        该 SOUL 只有画像（frontmatter），没有 Markdown 正文。可切到「画像」或「原文」查看。
      </Callout>
    );
  }
  return (
    <div style={{ color: 'var(--fg-strong)' }}>
      <MarkdownMessageContent content={content} />
    </div>
  );
}

function RawView({ soulMd }: { soulMd: string }) {
  if (!soulMd.trim()) {
    return <SoulEmpty />;
  }
  return <pre style={CODE_BLOCK_STYLE}>{soulMd}</pre>;
}

function SoulEmpty() {
  return (
    <EmptyState
      emoji="📭"
      title="暂无 SOUL 内容"
      description="该层尚未配置角色 SOUL，运行时将使用系统兜底人格。"
      style={{ flex: 1 }}
    />
  );
}

function CapabilityView({ capability }: { capability: LayerCapabilitySummary | null }) {
  if (!capability) {
    return (
      <EmptyState
        emoji="🧰"
        title="暂无能力信息"
        description="无法加载该层的工具 / 产物 / 指令能力，请稍后刷新重试。"
        style={{ flex: 1 }}
      />
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: CK_GAP_LG }}>
      <p style={HINT_TEXT_STYLE}>
        下面是该层的<strong style={{ color: 'var(--fg-default)' }}>能力天花板（固定护栏）</strong>
        ：工具类别、可派发去向、可写产物、可调内置指令均由架构强制，运行时不可越界。标记
        <span style={CAPS_DEFAULT_BADGE_STYLE}>默认启用</span>
        的工具是该层 role-adapter 的默认值；天花板之内的
        <strong style={{ color: 'var(--fg-default)' }}>
          具体启用项可在「治理 · 设置」与团队模板里按成员动态调整
        </strong>
        （含 skill / MCP / 模型）。
      </p>

      {capability.adapterDisplayName || capability.agentImplKey ? (
        <CapsSection title="角色实现">
          <div style={{ display: 'flex', gap: CK_GAP_SM, flexWrap: 'wrap' }}>
            {capability.adapterDisplayName ? (
              <span style={CAPS_PILL_STYLE}>{capability.adapterDisplayName}</span>
            ) : null}
            {capability.agentImplKey ? (
              <span style={CAPS_PILL_MONO_STYLE}>impl: {capability.agentImplKey}</span>
            ) : null}
            <span style={CAPS_PILL_STYLE}>
              {capability.terminal ? '终端层（不再派发）' : '可派发下游'}
            </span>
          </div>
        </CapsSection>
      ) : null}

      <CapsSection title="工具类别（能力天花板）" hint="运行时只能在这些类别内取工具">
        <div style={{ display: 'flex', flexDirection: 'column', gap: CK_GAP_SM }}>
          {capability.toolsetCategories.map((tool) => (
            <div
              key={tool.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: CK_GAP_SM,
                padding: CK_PAD,
                borderRadius: CK_RADIUS_SM,
                border: `1px solid ${CK_BORDER_SUBTLE}`,
                background: CK_SURFACE_SOFT,
              }}
            >
              <span
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)', minWidth: 56 }}
              >
                {tool.label}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-muted)' }}>
                {tool.description}
              </span>
              {tool.defaultEnabled ? <span style={CAPS_DEFAULT_BADGE_STYLE}>默认启用</span> : null}
            </div>
          ))}
        </div>
      </CapsSection>

      {capability.canHandoffTo.length > 0 ? (
        <CapsSection title="可派发去向">
          <div style={{ display: 'flex', gap: CK_GAP_SM, flexWrap: 'wrap' }}>
            {capability.canHandoffTo.map((l) => (
              <span key={l} style={CAPS_PILL_STYLE}>
                {LAYER_LABELS[l as TeamRoleLayer] ?? l}
              </span>
            ))}
          </div>
        </CapsSection>
      ) : null}

      {capability.canWriteArtifactPhases.length > 0 ? (
        <CapsSection title="可写产物">
          <div style={{ display: 'flex', gap: CK_GAP_SM, flexWrap: 'wrap' }}>
            {capability.canWriteArtifactPhases.map((p) => (
              <span key={p} style={CAPS_PILL_MONO_STYLE}>
                {p}
              </span>
            ))}
          </div>
        </CapsSection>
      ) : null}

      {capability.allowedBuiltinInstructions.length > 0 ? (
        <CapsSection title="可调内置指令">
          <div style={{ display: 'flex', gap: CK_GAP_SM, flexWrap: 'wrap' }}>
            {capability.allowedBuiltinInstructions.map((i) => (
              <span key={i} style={CAPS_PILL_MONO_STYLE}>
                {i}
              </span>
            ))}
          </div>
        </CapsSection>
      ) : null}

      <p style={{ ...HINT_TEXT_STYLE, fontSize: 10 }}>
        说明：Skills / MCP / 模型属于天花板内的动态绑定，在「治理 ·
        设置」与团队模板的角色编辑里配置；内置 skill 始终可用且不可禁用。
      </p>
    </div>
  );
}

function CapsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: CK_GAP_SM }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: CK_GAP_SM }}>
        <span style={CK_SECTION_LABEL_STYLE}>{title}</span>
        {hint ? <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

const CAPS_PILL_STYLE: CSSProperties = {
  ...PILL_BASE_STYLE,
  color: 'var(--fg-strong)',
  background: CK_SURFACE,
  border: `1px solid ${CK_BORDER_SUBTLE}`,
};

const CAPS_PILL_MONO_STYLE: CSSProperties = {
  ...CAPS_PILL_STYLE,
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 10.5,
};

const CAPS_DEFAULT_BADGE_STYLE: CSSProperties = {
  ...PILL_BASE_STYLE,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--success)',
  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
};

function StackView({ instructionStack }: { instructionStack: InstructionStackPreview | null }) {
  if (!instructionStack) {
    return (
      <EmptyState
        emoji="🧱"
        title="暂无指令栈预览"
        description="无法生成 7 层指令栈预览，请稍后刷新重试。"
        style={{ flex: 1 }}
      />
    );
  }
  const segments = parseInstructionStack(instructionStack.stableBlock);
  const contentSegments = segments.filter((s) => s.kind !== 'cache-breaker');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: CK_GAP }}>
      <p style={HINT_TEXT_STYLE}>
        这是最终注入该层 system prompt 的稳定段，由 7
        层按序拼接而成。下方徽章显示各层是否注入，再下方按层展开实际内容。
      </p>

      <div style={{ display: 'flex', gap: CK_GAP_SM, flexWrap: 'wrap' }}>
        {Object.entries(instructionStack.layers).map(([key, present]) => (
          <span
            key={key}
            style={{
              ...PILL_BASE_STYLE,
              fontSize: 10,
              border: present
                ? '1px solid color-mix(in srgb, var(--success) 40%, transparent)'
                : `1px solid ${CK_BORDER}`,
              background: present
                ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                : 'transparent',
              color: present ? 'var(--fg-strong)' : 'var(--fg-muted)',
            }}
          >
            <span aria-hidden>{present ? '✓' : '○'}</span>
            {STACK_LAYER_LABELS[key] ?? key}
          </span>
        ))}
      </div>

      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
        估算 tokens：{instructionStack.estimatedTokens.toLocaleString()}
        {instructionStack.oversize ? ' · ⚠ 超过软上限 24K' : ''}
      </span>

      {contentSegments.length === 0 ? (
        <Callout tone="info">
          当前没有任何层注入实际内容（仅有缓存标记）。配置宪法 / 记忆 / SOUL 后会在这里出现。
        </Callout>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: CK_GAP_SM }}>
          {contentSegments.map((seg, i) => (
            <StackSegmentCard key={`${seg.layer}-${i}`} segment={seg} />
          ))}
        </div>
      )}
    </div>
  );
}

function StackSegmentCard({ segment }: { segment: InstructionStackSegment }) {
  const [open, setOpen] = useState(true);
  const label = instructionSegmentLabel(segment.kind);
  const isWarning = segment.kind === 'oversize-warning';
  const accent = isWarning ? 'var(--warning)' : 'var(--accent)';
  return (
    <section
      style={{
        borderRadius: CK_RADIUS,
        border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
        background: CK_SURFACE_SOFT,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: CK_GAP_SM,
          padding: CK_PAD_SM,
          background: `color-mix(in srgb, ${accent} 8%, transparent)`,
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: accent }}>{label}</span>
        <span
          style={{
            fontSize: 9.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--fg-muted)',
          }}
        >
          {segment.layer}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>
      {open ? (
        <div style={{ padding: CK_PAD }}>
          {isMarkdownSegment(segment.kind) ? (
            <div style={{ color: 'var(--fg-strong)' }}>
              <MarkdownMessageContent content={segment.body} />
            </div>
          ) : (
            <pre
              style={{ ...CODE_BLOCK_STYLE, border: 'none', padding: 0, background: 'transparent' }}
            >
              {tryFormatJson(segment.body)}
            </pre>
          )}
        </div>
      ) : null}
    </section>
  );
}
