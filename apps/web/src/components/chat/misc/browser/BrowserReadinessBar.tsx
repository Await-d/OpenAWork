/**
 * 内置浏览器内容区顶部就绪状态条。
 *
 * 只在"需要用户知道点什么"的时候出现：
 *   - 正在重试探测 → 说明服务还没起来，给出第几次 / 下次重试倒计时；
 *   - 探测耗尽    → 明确告诉用户服务不可达，别干等，并给出手动重试。
 * 就绪后立刻消失，不占地方。
 */

import type { PageReadinessState } from './use-page-readiness.js';

export interface BrowserReadinessBarProps {
  state: PageReadinessState;
  attempt: number;
  nextRetryInMs: number | null;
  url: string;
  onRetry: () => void;
}

export function BrowserReadinessBar({
  state,
  attempt,
  nextRetryInMs,
  url,
  onRetry,
}: BrowserReadinessBarProps) {
  if (state !== 'probing' && state !== 'unreachable') return null;
  // 健康服务第一次探测就通，此时弹状态条只会闪一下。等真的失败过一轮
  // （attempt ≥ 2）再显示，纯等待场景才出现。
  if (state === 'probing' && attempt < 2) return null;

  const unreachable = state === 'unreachable';
  const seconds = nextRetryInMs === null ? null : Math.max(1, Math.round(nextRetryInMs / 100) / 10);

  return (
    <div
      role="status"
      data-testid="browser-readiness-bar"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        fontSize: 10.5,
        color: 'var(--fg-default)',
        background: unreachable
          ? 'color-mix(in oklch, var(--bg-overlay) 92%, var(--danger) 8%)'
          : 'color-mix(in oklch, var(--bg-overlay) 92%, var(--warning) 8%)',
        borderBottom: `1px solid ${
          unreachable
            ? 'color-mix(in oklch, var(--danger) 35%, var(--border-default))'
            : 'color-mix(in oklch, var(--warning) 30%, var(--border-default))'
        }`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          flexShrink: 0,
          background: unreachable ? 'var(--danger)' : 'var(--warning)',
          animation: unreachable ? undefined : 'pulse 1.4s ease-in-out infinite',
        }}
      />
      <span
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {unreachable
          ? `服务不可达：${url} 在 ${attempt} 次探测后仍未响应，请确认开发服务器已启动。`
          : `等待服务就绪… 第 ${attempt} 次探测${seconds === null ? '' : ` · 约 ${seconds}s 后重试`}`}
      </span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onRetry}
        style={{
          fontSize: 10.5,
          padding: '2px 8px',
          borderRadius: 4,
          border: '1px solid var(--border-subtle)',
          background: 'transparent',
          color: 'var(--fg-default)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        立即重试
      </button>
    </div>
  );
}
