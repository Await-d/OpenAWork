import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { color, font, radius, spacing } from '../tokens.js';

export interface AppErrorBoundaryProps {
  children: ReactNode;
  /**
   * 错误记录回调。**必填**：没有它，错误只停留在渲染控制台，刷新即丢，
   * 开发者无法复现也无法定位——这正是本组件要解决的核心问题。
   *
   * 建议实现：`ClientErrorRecorder.record({ source: 'react-boundary', error, context })`。
   */
  onError: (error: Error, componentStack: string | null) => void;
  /** 诊断信息正文。缺省用错误本身拼装；传入后可一并带上 requestId、历史错误等。 */
  buildDiagnostics?: (error: Error) => string;
  /** 自定义兜底 UI；缺省为内置的错误页。 */
  fallback?: (payload: {
    error: Error;
    diagnostics: string;
    onRetry: () => void;
    onCopy: () => void;
    copied: boolean;
  }) => ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
  /** 递增的重试键：把子树整体重挂载，避免复用已损坏的组件状态。 */
  retryKey: number;
}

/**
 * 按钮外观。
 *
 * focus ring 规范（`outline: 2px solid accent` + `4px accent-subtle` 阴影）必须
 * 只在 `:focus` 时出现。inline style 无法表达伪类，因此由 `onFocus` / `onBlur`
 * 驱动一个局部 state——顺带覆盖键盘操作（Tab 导航）与鼠标点击两种聚焦路径。
 */
function FocusRingButton({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant: 'primary' | 'secondary';
}) {
  const [focused, setFocused] = useState(false);

  const base = {
    height: 36,
    padding: `0 ${spacing[4]}px`,
    borderRadius: radius.sm,
    fontSize: 13,
    cursor: 'pointer',
    transition: `background ${'100ms cubic-bezier(0.4, 0, 0.2, 1)'}`,
  } as const;

  const skin =
    variant === 'primary'
      ? {
          border: '1px solid transparent',
          background: color.accent,
          color: color.fgOnAccent,
          fontWeight: 600,
        }
      : {
          border: `1px solid ${color.borderDefault}`,
          background: color.bgSurface,
          color: color.fgDefault,
          fontWeight: 500,
        };

  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...base,
        ...skin,
        ...(focused
          ? {
              outline: `2px solid ${color.accent}`,
              outlineOffset: '2px',
              boxShadow: `0 0 0 4px ${color.accentSubtle}`,
            }
          : { outline: 'none' }),
      }}
    >
      {label}
    </button>
  );
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null, copied: false, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error, copied: false };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 先记录再考虑 UI：错误记录器是最后一道防线，绝不能因回调抛错而丢现场。
    try {
      this.props.onError(error, errorInfo.componentStack ?? null);
    } catch {
      // 记录失败不应再抛——否则会用第二个错误覆盖掉真正的故障现场。
    }
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private handleRetry = (): void => {
    this.setState((prev) => ({ error: null, componentStack: null, copied: false, retryKey: prev.retryKey + 1 }));
  };

  private handleCopy = (): void => {
    const { error } = this.state;
    if (!error) return;
    const diagnostics = this.buildDiagnostics(error);
    void this.copyText(diagnostics);
  };

  /**
   * 复制到剪贴板。
   *
   * `navigator.clipboard` 在非安全上下文（http 局域网访问）与 Tauri WebView 的
   * 部分版本上不可用，因此必须保留 `execCommand` 兜底——否则「复制诊断信息」
   * 这个排障入口在最需要它的环境里恰好失效。
   */
  private async copyText(text: string): Promise<void> {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(text);
        this.setState({ copied: true });
        return;
      }
      throw new Error('clipboard unavailable');
    } catch {
      try {
        const doc = globalThis.document;
        if (!doc) return;
        const area = doc.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        doc.body.appendChild(area);
        area.select();
        const succeeded = doc.execCommand('copy');
        doc.body.removeChild(area);
        if (succeeded) this.setState({ copied: true });
      } catch {
        // 复制不可用时保持原状：诊断正文仍完整展示在页面上，可手动选中。
      }
    }
  }

  private buildDiagnostics(error: Error): string {
    const { componentStack } = this.state;
    const custom = this.props.buildDiagnostics?.(error);
    if (custom) return custom;
    const sections = [`错误：${error.name}: ${error.message}`];
    if (error.stack) sections.push(`堆栈：\n${error.stack}`);
    if (componentStack) sections.push(`组件栈：\n${componentStack}`);
    sections.push(`时间：${new Date().toISOString()}`);
    return sections.join('\n\n');
  }

  override render(): ReactNode {
    const { error, copied, retryKey } = this.state;
    if (!error) {
      // retryKey 作为子树 key：重试时整棵子树重新挂载，状态彻底重置。
      return <div key={retryKey} style={{ display: 'contents' }}>{this.props.children}</div>;
    }

    const diagnostics = this.buildDiagnostics(error);
    if (this.props.fallback) {
      return this.props.fallback({
        error,
        diagnostics,
        onRetry: this.handleRetry,
        onCopy: this.handleCopy,
        copied,
      });
    }

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing[6],
          background: color.bgBase,
          color: color.fgDefault,
          fontFamily: font.sans,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 560,
            padding: `${spacing[12]}px ${spacing[8]}px`,
            borderRadius: radius.lg,
            background: color.bgOverlay,
            border: `1px dashed ${color.borderEmphasis}`,
            textAlign: 'center',
          }}
        >
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color.danger}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{ opacity: 0.9 }}
          >
            <path d="M12 3.5 2.6 19.5a1 1 0 0 0 .87 1.5h17.06a1 1 0 0 0 .87-1.5L12 3.5Z" />
            <path d="M12 9.5v4.5" />
            <path d="M12 17.4h.01" />
          </svg>

          <h1
            style={{
              margin: `${spacing[3]}px 0 ${spacing[2]}px`,
              fontSize: 16,
              fontWeight: 600,
              color: color.fgStrong,
            }}
          >
            界面渲染出错
          </h1>
          <p
            style={{
              margin: `0 auto ${spacing[4]}px`,
              maxWidth: 360,
              fontSize: 13,
              lineHeight: 1.5,
              color: color.fgMuted,
            }}
          >
            错误详情已记录在本地。请复制下方诊断信息反馈给维护者，重试通常可以恢复当前页面。
          </p>

          <div
            style={{
              display: 'flex',
              gap: spacing[2],
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginBottom: spacing[4],
            }}
          >
            <FocusRingButton label="重试" onClick={this.handleRetry} variant="primary" />
            <FocusRingButton
              label={copied ? '已复制诊断信息' : '复制诊断信息'}
              onClick={this.handleCopy}
              variant="secondary"
            />
          </div>

          <details
            style={{ textAlign: 'left', borderTop: `1px solid ${color.borderSubtle}`, paddingTop: spacing[3] }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
                color: color.fgMuted,
              }}
            >
              错误详情
            </summary>
            <pre
              style={{
                margin: `${spacing[2]}px 0 0`,
                maxHeight: 240,
                overflow: 'auto',
                padding: spacing[3],
                borderRadius: radius.sm,
                background: color.bgSurface,
                border: `1px solid ${color.borderSubtle}`,
                fontFamily: font.mono,
                fontSize: 11,
                lineHeight: 1.6,
                color: color.fgMuted,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {diagnostics}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}