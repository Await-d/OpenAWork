/**
 * NewTeamWorkspaceModal · 创建团队工作区弹窗（双栏丰富版）
 *
 * 入口：
 * - WorkspaceSwitcher dropdown 末尾的 "+ 新建工作区"
 *
 * 字段：
 * - name (必填) — 工作区名称（支持重名校验，trim + 不区分大小写）
 * - description — 描述
 * - defaultWorkingRoot — 默认工作目录（可选，c/d/e 派生默认绑定）
 *   通过 chat 同款 \`<WorkspacePickerModal/>\` 浏览选择
 *
 * 设计：
 * - 左侧 hero 区：插画 + 工作区作用说明 + checklist
 * - 右侧表单：name / description / defaultWorkingRoot
 * - 选择目录后自动填充名称（仅当 name 仍为空）
 * - 提交前进行重名校验（同 trim + lowercase 名称已存在则拒绝）
 *
 * 提交后通过 useTeamRuntimeReferenceViewData().createWorkspace 走 reference-data 层，
 * 成功后调 onCreated(newId)，由父级决定是否 navigate。
 */

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import WorkspacePickerModal from '../../../../../components/common/modal/WorkspacePickerModal.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { XIcon } from '../../shared/TeamIcons.js';

export interface NewTeamWorkspaceModalProps {
  onClose: () => void;
  /** 创建成功后回调，参数为新工作区 id（如有，由 reference-data 提供）。 */
  onCreated?: (newWorkspaceId?: string) => void;
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 800,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  padding: 16,
};

const MODAL_STYLE: CSSProperties = {
  position: 'relative',
  width: 720,
  maxWidth: '96vw',
  maxHeight: '90vh',
  overflow: 'hidden',
  borderRadius: 18,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
  display: 'grid',
  gridTemplateColumns: '260px 1fr',
};

const HERO_PANE_STYLE: CSSProperties = {
  background:
    'linear-gradient(160deg, color-mix(in srgb, var(--accent) 90%, var(--bg-overlay) 0%, color-mix(in srgb, var(--accent) 55%, var(--bg-overlay) 100%)',
  color: 'var(--fg-on-accent)',
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  position: 'relative',
  overflow: 'hidden',
};

const HERO_DECOR_STYLE: CSSProperties = {
  position: 'absolute',
  right: -40,
  top: -40,
  width: 180,
  height: 180,
  borderRadius: '50%',
  background: 'rgba(255, 255, 255, 0.1)',
  pointerEvents: 'none',
};

const HERO_DECOR_2_STYLE: CSSProperties = {
  position: 'absolute',
  left: -50,
  bottom: -30,
  width: 140,
  height: 140,
  borderRadius: '50%',
  background: 'rgba(255, 255, 255, 0.08)',
  pointerEvents: 'none',
};

const HERO_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 20,
  background: 'rgba(255, 255, 255, 0.18)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  alignSelf: 'flex-start',
  textTransform: 'uppercase',
  position: 'relative',
};

const HERO_TITLE_STYLE: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1.3,
  position: 'relative',
};

const HERO_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--bg-raised)',
  position: 'relative',
};

const HERO_LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  marginTop: 'auto',
  fontSize: 11,
  color: 'rgba(255, 255, 255, 0.95)',
  position: 'relative',
};

const HERO_LIST_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  lineHeight: 1.5,
};

const HERO_LIST_ICON_STYLE: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 6,
  background: 'rgba(255, 255, 255, 0.22)',
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  marginTop: 1,
};

const FORM_PANE_STYLE: CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflowY: 'auto',
  maxHeight: '90vh',
};

const FORM_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
};

const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base)',
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontFamily: 'inherit',
  transition: 'border-color 120ms ease',
};

const INPUT_ERROR_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  borderColor: 'var(--error)',
};

const TEXTAREA_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  resize: 'vertical',
  minHeight: 60,
};

const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: '9px 22px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  padding: '9px 18px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 13,
  cursor: 'pointer',
};

const ERROR_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--error)',
  background: 'color-mix(in srgb, var(--error) 10%, transparent)',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
};

const FIELD_ERROR_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--error)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const HEADER_TITLE_STYLE: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: 'var(--fg-strong)',
};

const HEADER_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
  marginTop: 4,
};

interface ChecklistItem {
  icon: React.ReactNode;
  text: string;
}

const CHECK_ICON = (
  <svg
    aria-hidden="true"
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CHECKLIST: ChecklistItem[] = [
  { icon: CHECK_ICON, text: '隔离的 constitution 与角色绑定' },
  { icon: CHECK_ICON, text: '独立的会话与产物追踪' },
  { icon: CHECK_ICON, text: '默认工作目录加速派生流程' },
];

export function NewTeamWorkspaceModal({ onClose, onCreated }: NewTeamWorkspaceModalProps) {
  const data = useTeamRuntimeReferenceViewData();
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultWorkingRoot, setDefaultWorkingRoot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // 现有名称集合（trim + lowercase）用于重名检测
  const existingNames = useMemo(() => {
    const set = new Set<string>();
    for (const ws of data.workspaces) {
      set.add(ws.name.trim().toLowerCase());
    }
    return set;
  }, [data.workspaces]);

  const trimmedName = name.trim();
  const nameError = useMemo(() => {
    if (!trimmedName) return null; // 空时不强制提示，提交时再校验
    if (existingNames.has(trimmedName.toLowerCase())) {
      return `名称「${trimmedName}」已存在，请换一个`;
    }
    return null;
  }, [existingNames, trimmedName]);

  // ─── workspace picker fetch 适配 ──
  const fetchWorkspaceRoots = useCallback(async (): Promise<string[]> => {
    const roots = await workspaceClient.listRoots(accessToken ?? '');
    if (roots.length === 0) {
      throw new Error('fetchWorkspaceRoots failed: no workspace roots');
    }
    return roots;
  }, [accessToken, workspaceClient]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('fetchRootPath failed: no workspace roots');
    }
    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 2) =>
      workspaceClient.fetchTree(accessToken ?? '', path, { depth }),
    [accessToken, workspaceClient],
  );

  const validatePath = useCallback(
    async (path: string) => workspaceClient.validatePath(accessToken ?? '', path),
    [accessToken, workspaceClient],
  );

  const canSubmit = trimmedName.length > 0 && !nameError && !submitting;

  const handleSubmit = async () => {
    if (!trimmedName) {
      setError('工作区名称必填');
      return;
    }
    if (nameError) {
      setError(nameError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ok = await data.createWorkspace({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(defaultWorkingRoot.trim() ? { defaultWorkingRoot: defaultWorkingRoot.trim() } : {}),
      });
      if (!ok) {
        setError('创建失败，请重试或检查权限');
        return;
      }
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
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
          {/* ─── 左侧 hero 装饰区 ─── */}
          <div style={HERO_PANE_STYLE} aria-hidden="true">
            <div style={HERO_DECOR_STYLE} />
            <div style={HERO_DECOR_2_STYLE} />

            <div style={HERO_BADGE_STYLE}>
              <svg
                aria-hidden="true"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <circle cx="12" cy="12" r="6" />
              </svg>
              <span>Workspace</span>
            </div>

            <div style={HERO_TITLE_STYLE}>新建工作区</div>

            <div style={HERO_DESC_STYLE}>
              工作区是团队会话与产物的隔离单元，为不同项目或主题保留独立上下文，方便切换与回溯。
            </div>

            <div style={HERO_LIST_STYLE}>
              {CHECKLIST.map((item, i) => (
                <div key={i} style={HERO_LIST_ITEM_STYLE}>
                  <span style={HERO_LIST_ICON_STYLE}>{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ─── 右侧表单 ─── */}
          <div style={FORM_PANE_STYLE}>
            <div style={FORM_HEADER_STYLE}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div id="new-ws-title" style={HEADER_TITLE_STYLE}>
                  填写工作区信息
                </div>
                <div style={HEADER_DESC_STYLE}>提交后立即生效，可在工作区列表中查看与切换。</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--fg-muted)',
                  padding: 4,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                <XIcon size={14} color="var(--fg-muted)" />
              </button>
            </div>

            <div style={FIELD_STYLE}>
              <label htmlFor="new-ws-name" style={LABEL_STYLE}>
                名称 <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                id="new-ws-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="例如：AILinkMarket"
                style={nameError ? INPUT_ERROR_STYLE : INPUT_STYLE}
                autoFocus
                maxLength={80}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'new-ws-name-error' : undefined}
              />
              {nameError ? (
                <span id="new-ws-name-error" style={FIELD_ERROR_STYLE} role="alert">
                  <svg
                    aria-hidden="true"
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {nameError}
                </span>
              ) : (
                <span style={HINT_STYLE}>会显示在顶部切换器和会话列表头部。</span>
              )}
            </div>

            <div style={FIELD_STYLE}>
              <label htmlFor="new-ws-desc" style={LABEL_STYLE}>
                描述
              </label>
              <textarea
                id="new-ws-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话说明这个工作区的用途（可选）"
                style={TEXTAREA_STYLE}
                maxLength={300}
              />
            </div>

            <div style={FIELD_STYLE}>
              <label htmlFor="new-ws-root" style={LABEL_STYLE}>
                默认工作目录
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="new-ws-root"
                  type="text"
                  value={defaultWorkingRoot}
                  onChange={(e) => setDefaultWorkingRoot(e.target.value)}
                  placeholder="选择或输入项目根目录（可选）"
                  style={{ ...INPUT_STYLE, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  style={{
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    color: 'var(--accent)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                  }}
                  title="从工作区列表选择"
                  aria-label="从工作区列表选择目录"
                >
                  <svg
                    aria-hidden="true"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>浏览</span>
                </button>
              </div>
              <span style={HINT_STYLE}>
                c/d/e
                派生的会话将默认绑定此目录；可在创建会话时单独覆盖。选择后会自动用文件夹名作为工作区名称。
              </span>
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
                  opacity: canSubmit ? 1 : 0.6,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                }}
                disabled={!canSubmit}
              >
                {submitting ? (
                  '创建中…'
                ) : (
                  <>
                    <svg
                      aria-hidden="true"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    创建工作区
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      <WorkspacePickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={async (path) => {
          setDefaultWorkingRoot(path);
          // 自动用目录最后一段作为工作区名称（仅当用户尚未填写时不覆盖已有输入）
          if (!name.trim()) {
            const trimmed = path.replace(/\/+$/, '');
            const folderName = trimmed.includes('/')
              ? trimmed.slice(trimmed.lastIndexOf('/') + 1)
              : trimmed;
            if (folderName) {
              // 若文件夹名与已有工作区重名，自动追加后缀避免重名
              let candidate = folderName;
              let suffix = 2;
              while (existingNames.has(candidate.trim().toLowerCase())) {
                candidate = `${folderName}-${suffix}`;
                suffix += 1;
              }
              setName(candidate);
            }
          }
          setShowPicker(false);
        }}
        fetchRootPath={fetchRootPath}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        validatePath={validatePath}
        initialPath={defaultWorkingRoot || undefined}
      />
    </>
  );
}
