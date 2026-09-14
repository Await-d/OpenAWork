import { useEffect, useState, useId } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * 应用内弹窗的共享外壳。
 *
 * 桌面端有一批「原来由系统原生 `MessageDialog` 承担」的提示/确认场景（关闭确认、
 * 关于、后续可能还有别的）。原生对话框既不跟随应用主题也没有排版能力，统一改成
 * 这里这套应用内弹窗。
 *
 * 本文件只提供**结构与行为**，不承载业务：
 * - 遮罩 + 卡片外壳、入场动画、`prefers-reduced-motion` 降级；
 * - 头部（徽标 / 标题 / 一句话说明 / 右上角关闭）；
 * - 页脚（左、右两栏，左边常放次要控件如勾选项）；
 * - 统一的交互约定：右上角 X、Esc、点击遮罩一律 = `onDismiss`（取消，不做任何动作）。
 *
 * 业务方（CloseConfirmDialog / AboutDialog）负责传入内容与动作按钮，并把「真正会改变
 * 程序状态」的操作绑定到显式按钮上——不要再用「关闭弹窗」隐式触发状态变更。
 */

/** 弹窗入场动画 + 无障碍降级。内联注入，避免为弹窗新增全局样式文件。 */
const DIALOG_KEYFRAMES = `
@keyframes app-dialog-overlay-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes app-dialog-card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.985) }
  to { opacity: 1; transform: none }
}
@media (prefers-reduced-motion: reduce) {
  [data-app-dialog-overlay],
  [data-app-dialog-card] { animation: none !important }
}
`;

/** 头部 40×40 圆角图标底：强调色渐变 + 柔和外发光。 */
export function DialogIconBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--fg-on-accent)',
        background: 'linear-gradient(140deg, var(--accent-hover), var(--accent-active))',
        boxShadow: 'var(--shadow-glow)',
      }}
    >
      {children}
    </span>
  );
}

/**
 * 页脚动作按钮。主按钮填充强调色，次按钮为描边幽灵样式。
 *
 * 自带 hover 状态管理：项目里大量组件用内联 style + onMouseEnter/Leave 手改样式，
 * 这里收敛成组件，避免每个弹窗重复一遍。
 */
export function DialogActionButton({
  variant,
  icon,
  label,
  disabled,
  onClick,
  buttonRef,
}: {
  variant: 'primary' | 'secondary';
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [hovered, setHovered] = useState(false);
  const primary = variant === 'primary';
  const inactive = disabled ?? false;

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '8px 14px',
    borderRadius: 10,
    fontSize: 12.5,
    fontWeight: 650,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    cursor: inactive ? 'default' : 'pointer',
    opacity: inactive ? 0.55 : 1,
    transition: 'background 140ms ease, border-color 140ms ease, opacity 140ms ease',
  };

  const skin: CSSProperties = primary
    ? {
        border: '1px solid var(--accent-border)',
        background: hovered && !inactive ? 'var(--accent-hover)' : 'var(--accent)',
        color: 'var(--fg-on-accent)',
        boxShadow: 'var(--shadow-glow)',
      }
    : {
        border: `1px solid ${hovered && !inactive ? 'var(--border-strong)' : 'var(--border-default)'}`,
        background: hovered && !inactive ? 'var(--bg-hover)' : 'transparent',
        color: 'var(--fg-default)',
      };

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={inactive}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...skin }}
    >
      {icon}
      {label}
    </button>
  );
}

/** 弹窗内的错误条（动作失败时使用）。 */
export function DialogError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '9px 11px',
        borderRadius: 9,
        fontSize: 11.5,
        lineHeight: 1.55,
        border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
        color: 'var(--danger)',
      }}
    >
      操作失败：{message}
    </div>
  );
}

export interface AppDialogProps {
  /** 头部徽标（自行控制外观，需要渐变底可套 `DialogIconBadge`）。 */
  badge: ReactNode;
  title: string;
  description: string;
  /** 右上角 X / Esc / 点击遮罩统一触发。语义必须是「取消，不做任何动作」。 */
  onDismiss: () => void;
  /** 打开时接收焦点的元素（通常是主按钮）。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 页脚左侧内容，常放次要控件（如勾选项）。 */
  footerLeft?: ReactNode;
  /** 页脚右侧的动作按钮组。 */
  footerRight?: ReactNode;
  /** 卡片最大宽度，默认 468。 */
  maxWidth?: number;
  children: ReactNode;
}

/** 渲染到 body 的应用内弹窗。仅在有业务需要时挂载。 */
export function AppDialog({
  badge,
  title,
  description,
  onDismiss,
  initialFocusRef,
  footerLeft,
  footerRight,
  maxWidth = 468,
  children,
}: AppDialogProps) {
  const titleId = useId();
  const descId = useId();
  const [closeHovered, setCloseHovered] = useState(false);

  // Esc = 取消。与右上角 X、点击遮罩语义一致。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  // 打开时把焦点交给指定元素，键盘用户可直接回车确认。
  useEffect(() => {
    initialFocusRef?.current?.focus();
  }, [initialFocusRef]);

  return createPortal(
    <div
      data-app-dialog-overlay="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'color-mix(in srgb, var(--bg-base) 62%, transparent)',
        backdropFilter: 'blur(10px) saturate(120%)',
        animation: 'app-dialog-overlay-in 160ms ease-out',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <style>{DIALOG_KEYFRAMES}</style>
      <section
        data-app-dialog-card="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        style={{
          width: `min(${maxWidth}px, 100%)`,
          borderRadius: 18,
          overflow: 'hidden',
          border: '1px solid var(--border-emphasis)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 72%, var(--bg-overlay)) 0%, var(--bg-overlay) 100%)',
          boxShadow: 'var(--shadow-lg)',
          animation: 'app-dialog-card-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <header
          style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 20px 16px' }}
        >
          {badge}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 650,
                letterSpacing: '0.01em',
                color: 'var(--fg-strong)',
              }}
            >
              {title}
            </h2>
            <p
              id={descId}
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                lineHeight: 1.55,
                color: 'var(--fg-muted)',
              }}
            >
              {description}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭弹窗，不做任何操作"
            title="关闭（不做任何操作）"
            onClick={onDismiss}
            onMouseEnter={() => setCloseHovered(true)}
            onMouseLeave={() => setCloseHovered(false)}
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 8,
              border: '1px solid transparent',
              background: closeHovered ? 'var(--bg-hover)' : 'transparent',
              color: closeHovered ? 'var(--fg-strong)' : 'var(--fg-muted)',
              cursor: 'pointer',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.1}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 20px 18px' }}>
          {children}
        </div>

        {footerLeft || footerRight ? (
          <footer
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              padding: '14px 20px 18px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'color-mix(in srgb, var(--bg-surface) 45%, transparent)',
            }}
          >
            {footerLeft ?? <span />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{footerRight}</div>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
