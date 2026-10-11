/**
 * PromptSnippetsVersionHistory — 提示词版本历史子视图。
 *
 * 从 PromptSnippetsPanel 提取的版本历史渲染块（>80 行、3 层嵌套 JSX），
 * 数据获取与回滚动作仍由父组件驱动，本组件只做展示 + 回滚按钮转发。
 */

import type { CSSProperties } from 'react';
import type { PromptSnippetVersion } from '@openAwork/web-client';

export interface PromptSnippetsVersionHistoryProps {
  versions: PromptSnippetVersion[];
  loading: boolean;
  /** 是否有回滚操作进行中。 */
  restoring: boolean;
  onRestore: (version: number) => void;
  onBack: () => void;
  /** 次要按钮样式（由父组件提供，保持视觉 token 一致）。 */
  smallBtnStyle: CSSProperties;
  actionBtnStyle: CSSProperties;
}

function sourceLabel(source: PromptSnippetVersion['source']): string {
  switch (source) {
    case 'created':
      return '创建';
    case 'restored':
      return '回滚';
    default:
      return '更新';
  }
}

function SpinnerIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 12,
        height: 12,
        borderRadius: 999,
        border: '1.8px solid color-mix(in oklch, var(--accent) 26%, transparent)',
        borderTopColor: 'var(--accent)',
        display: 'inline-block',
        animation: 'prompt-snippets-spin 0.8s linear infinite',
      }}
    />
  );
}

export function PromptSnippetsVersionHistory(props: PromptSnippetsVersionHistoryProps) {
  const { versions, loading, restoring, onRestore, onBack } = props;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>版本历史</span>
        <button type="button" onClick={onBack} style={props.actionBtnStyle}>
          返回
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>加载中…</div>
      ) : versions.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 8 }}>
          暂无历史版本。版本记录从此功能上线后开始累积。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {versions.map((v) => (
            <div
              key={v.id}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface, var(--bg-base))',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--fg-strong)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  v{v.version}
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 999,
                      background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                      color: 'var(--accent)',
                    }}
                  >
                    {sourceLabel(v.source)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRestore(v.version)}
                  disabled={restoring}
                  style={{
                    ...props.smallBtnStyle,
                    width: 'auto',
                    padding: '2px 8px',
                    fontSize: 10,
                  }}
                >
                  {restoring ? <SpinnerIcon /> : '回滚'}
                </button>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {v.content}
              </div>
              <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{v.createdAt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
