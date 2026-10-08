import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  WORKSPACE_ALIAS_MAX_LENGTH,
  readWorkspaceAlias,
  validateWorkspaceAlias,
} from '../../../utils/workspace-alias.js';

export interface WorkspaceRenameDialogProps {
  open: boolean;
  /** 工作区路径；为空表示未绑定工作区，此时不允许重命名。 */
  workspacePath: string | null;
  /** 路径末段：作为默认名提示与「恢复默认名」的目标。 */
  defaultName: string;
  onCancel: () => void;
  /** 提交别名；空串表示清除别名、恢复默认名。 */
  onSubmit: (alias: string) => void;
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  dialog: {
    width: 440,
    maxWidth: 'calc(100vw - 32px)',
    borderRadius: 16,
    border: '1px solid var(--border-subtle)',
    background: 'linear-gradient(180deg, var(--bg-overlay) 0%, var(--bg-base)',
    boxShadow: 'var(--shadow-lg)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    padding: '4px 10px',
    borderRadius: 999,
    background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
    color: 'var(--accent)',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 800,
    color: 'var(--fg-strong)',
    lineHeight: 1.35,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--fg-muted)',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: 10,
    border: '1px solid var(--border-default)',
    background: 'var(--bg-overlay)',
    color: 'var(--fg-strong)',
    fontSize: 13,
    lineHeight: 1.4,
  },
  pathCard: {
    borderRadius: 12,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-overlay)',
    padding: '10px 12px',
    fontSize: 11,
    color: 'var(--fg-muted)',
    lineHeight: 1.6,
    wordBreak: 'break-all',
  },
  hint: {
    margin: 0,
    fontSize: 11,
    color: 'var(--fg-muted)',
    lineHeight: 1.7,
  },
  error: {
    margin: 0,
    fontSize: 11,
    color: 'var(--danger)',
    lineHeight: 1.6,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  footerRight: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  ghostButton: {
    border: 'none',
    background: 'transparent',
    color: 'var(--fg-muted)',
    borderRadius: 10,
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid var(--border-subtle)',
    background: 'transparent',
    color: 'var(--fg-default)',
    borderRadius: 10,
    padding: '9px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryButton: {
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--fg-on-accent)',
    borderRadius: 10,
    padding: '9px 14px',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 10px 24px color-mix(in srgb, var(--accent) 26%, transparent)',
  },
};

/**
 * 工作区重命名对话框。
 *
 * 重命名只改展示名，不移动目录、不影响会话绑定；实际路径始终以副标题展示，
 * 避免改名后用户误以为工作区被移动。清空输入即恢复默认名。
 */
export function WorkspaceRenameDialog({
  open,
  workspacePath,
  defaultName,
  onCancel,
  onSubmit,
}: WorkspaceRenameDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const validation = validateWorkspaceAlias(value);
  const trimmedLength = value.trim().length;

  // 每次打开都以「当前别名 ?? 默认名」作为初值：
  // 上一次的重命名结果不应该污染下一次编辑起点。
  useEffect(() => {
    if (!open) {
      return;
    }

    setValue(readWorkspaceAlias(workspacePath) || defaultName);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [defaultName, open, workspacePath]);

  if (!open || !workspacePath) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validation.ok) {
      return;
    }
    onSubmit(validation.alias);
  };

  return (
    <div style={styles.overlay}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        style={styles.dialog}
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <span style={styles.badge}>重命名工作区</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 id={`${inputId}-title`} style={styles.title}>
            为这个工作区设置一个易识别的名称
          </h3>
          <p style={styles.hint}>
            名称仅用于界面展示，会话的目录绑定不会改变；清空可恢复默认名「{defaultName}」。
          </p>
        </div>

        <div style={styles.field}>
          <label htmlFor={inputId} style={styles.label}>
            工作区名称
          </label>
          <input
            id={inputId}
            ref={inputRef}
            value={value}
            maxLength={WORKSPACE_ALIAS_MAX_LENGTH * 2}
            placeholder={defaultName}
            onChange={(event) => setValue(event.target.value)}
            style={{
              ...styles.input,
              borderColor: !validation.ok ? 'var(--danger)' : 'var(--border-default)',
            }}
          />
        </div>

        <div style={styles.pathCard}>{workspacePath}</div>

        {!validation.ok && <p style={styles.error}>{validation.reason}</p>}
        {validation.ok && trimmedLength === 0 && (
          <p style={styles.hint}>提交后将恢复为默认名「{defaultName}」。</p>
        )}

        <div style={styles.footer}>
          <button
            type="button"
            onClick={() => setValue(defaultName)}
            style={styles.ghostButton}
            title="用路径末段作为名称"
          >
            恢复默认名
          </button>
          <div style={styles.footerRight}>
            <button type="button" onClick={onCancel} style={styles.secondaryButton}>
              取消
            </button>
            <button
              type="submit"
              disabled={!validation.ok}
              style={{
                ...styles.primaryButton,
                opacity: validation.ok ? 1 : 0.55,
                cursor: validation.ok ? 'pointer' : 'not-allowed',
              }}
            >
              保存
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
