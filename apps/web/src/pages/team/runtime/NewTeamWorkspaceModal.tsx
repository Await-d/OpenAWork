/**
 * NewTeamWorkspaceModal · 创建团队工作区弹窗
 *
 * 入口：
 * - WorkspaceSwitcher dropdown 末尾的 "+ 新建工作区"
 * - 也可由其他地方主动打开（传 onClose 回调）
 *
 * 字段：
 * - name (必填) — 工作区名称
 * - description — 描述
 * - defaultWorkingRoot — 默认工作目录（可选，给 c/d/e 用）
 * - visibility — private (默认) / closed / open
 *
 * 提交后通过 useTeamRuntimeReferenceViewData().createWorkspace 走 reference-data 层，
 * 成功后调 onCreated(newId)，由父级决定是否 navigate。
 */

import { useState, type CSSProperties } from 'react';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { XIcon } from './TeamIcons.js';

export interface NewTeamWorkspaceModalProps {
  onClose: () => void;
  /** 创建成功后回调，参数为新工作区 id（如有，由 reference-data 提供）。 */
  onCreated?: (newWorkspaceId?: string) => void;
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'grid',
  placeItems: 'center',
  background: 'oklch(0 0 0 / 0.6)',
  backdropFilter: 'blur(4px)',
};

const MODAL_STYLE: CSSProperties = {
  position: 'relative',
  width: 480,
  maxWidth: '92vw',
  maxHeight: '90vh',
  overflow: 'auto',
  borderRadius: 16,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: '0 24px 64px oklch(0 0 0 / 0.4)',
  padding: 22,
  display: 'grid',
  gap: 16,
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-2)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  lineHeight: 1.5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-2) 70%, var(--bg))',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const TEXTAREA_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  resize: 'vertical',
  minHeight: 60,
};

const VISIBILITY_OPTIONS: Array<{
  value: 'private' | 'closed' | 'open';
  label: string;
  description: string;
}> = [
  { value: 'private', label: '私有', description: '仅自己可见与操作' },
  { value: 'closed', label: '受限', description: '团队成员可见，外部需邀请' },
  { value: 'open', label: '公开', description: '所有用户可加入与查看' },
];

const VISIBILITY_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
};

const VISIBILITY_OPTION_BASE_STYLE: CSSProperties = {
  flex: 1,
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 150ms ease',
};

const VISIBILITY_OPTION_ACTIVE_STYLE: CSSProperties = {
  ...VISIBILITY_OPTION_BASE_STYLE,
  border: '1px solid color-mix(in srgb, var(--accent) 60%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  color: 'var(--accent)',
  fontWeight: 600,
};

const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-text, #fff)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 13,
  cursor: 'pointer',
};

const ERROR_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--error, #ef4444)',
  background: 'color-mix(in srgb, var(--error, #ef4444) 10%, transparent)',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--error, #ef4444) 30%, transparent)',
};

export function NewTeamWorkspaceModal({ onClose, onCreated }: NewTeamWorkspaceModalProps) {
  const data = useTeamRuntimeReferenceViewData();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultWorkingRoot, setDefaultWorkingRoot] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'closed' | 'open'>('private');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('工作区名称必填');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ok = await data.createWorkspace({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(defaultWorkingRoot.trim() ? { defaultWorkingRoot: defaultWorkingRoot.trim() } : {}),
      });
      if (!ok) {
        setError('创建失败，请重试或检查权限');
        return;
      }
      // reference-data 的 createWorkspace 当前不返回新 id；
      // 父级可以通过 onCreated() 回调触发 workspaces 列表刷新 + 选中最新一个
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={OVERLAY_STYLE}>
      <button
        type="button"
        aria-label="关闭新建工作区弹窗"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-labelledby="new-ws-title">
        <div style={HEADER_ROW_STYLE}>
          <div style={{ display: 'grid', gap: 5 }}>
            <span id="new-ws-title" style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              新建工作区
            </span>
            <span style={HINT_STYLE}>
              工作区是团队会话与产物的隔离单元，每个工作区有独立的 constitution / 角色绑定 /
              任务清单。
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              padding: 4,
              cursor: 'pointer',
              display: 'inline-flex',
              borderRadius: 4,
            }}
          >
            <XIcon size={14} color="var(--text-3)" />
          </button>
        </div>

        <div style={FIELD_STYLE}>
          <label htmlFor="new-ws-name" style={LABEL_STYLE}>
            名称 <span style={{ color: 'var(--error, #ef4444)' }}>*</span>
          </label>
          <input
            id="new-ws-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：AILinkMarket"
            style={INPUT_STYLE}
            autoFocus
            maxLength={80}
          />
        </div>

        <div style={FIELD_STYLE}>
          <label htmlFor="new-ws-desc" style={LABEL_STYLE}>
            描述
          </label>
          <textarea
            id="new-ws-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话说明这个工作区做什么（可选）"
            style={TEXTAREA_STYLE}
            maxLength={300}
          />
        </div>

        <div style={FIELD_STYLE}>
          <label htmlFor="new-ws-root" style={LABEL_STYLE}>
            默认工作目录
          </label>
          <input
            id="new-ws-root"
            type="text"
            value={defaultWorkingRoot}
            onChange={(e) => setDefaultWorkingRoot(e.target.value)}
            placeholder="例如：/home/user/projects/ailinkmarket（可选）"
            style={INPUT_STYLE}
          />
          <span style={HINT_STYLE}>c/d/e 派生的会话将默认绑定此目录；可在创建会话时单独覆盖。</span>
        </div>

        <div style={FIELD_STYLE}>
          <span style={LABEL_STYLE}>可见性</span>
          <div style={VISIBILITY_GROUP_STYLE}>
            {VISIBILITY_OPTIONS.map((opt) => {
              const active = visibility === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVisibility(opt.value)}
                  style={active ? VISIBILITY_OPTION_ACTIVE_STYLE : VISIBILITY_OPTION_BASE_STYLE}
                  aria-pressed={active}
                >
                  <span style={{ fontWeight: 700 }}>{opt.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4 }}>
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div role="alert" style={ERROR_STYLE}>
            {error}
          </div>
        ) : null}

        <div style={ACTIONS_ROW_STYLE}>
          <button
            type="button"
            onClick={onClose}
            style={SECONDARY_BUTTON_STYLE}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            style={{
              ...PRIMARY_BUTTON_STYLE,
              opacity: submitting || !name.trim() ? 0.6 : 1,
              cursor: submitting || !name.trim() ? 'not-allowed' : 'pointer',
            }}
            disabled={submitting || !name.trim()}
          >
            {submitting ? '创建中…' : '创建工作区'}
          </button>
        </div>
      </div>
    </div>
  );
}
