/**
 * 260517-chat-session-skeleton · 会话首屏酷炫骨架
 *
 * 关联样式：`.omo-skeleton-cool`、`@keyframes omo-skeleton-shimmer` 等
 * 已统一收纳到 `src/styles/loaders.css`，由 `main.tsx` 一次性 import。
 *
 * 设计特点：
 *  - 渐变流光扫过（shimmer effect）
 *  - 头像光晕脉冲（accent 呼吸环）
 *  - 逐行错峰入场（staggered line-in）
 *  - 代码块高亮区域（模拟 code block）
 */

const SKELETON_AVATAR_STYLE: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  flexShrink: 0,
  animation: 'omo-skeleton-avatar-pulse 2s ease-in-out infinite',
  background:
    'linear-gradient(135deg, color-mix(in oklch, var(--accent) 18%, var(--bg-surface)), var(--bg-surface) 70%)',
};

interface SkeletonLineProps {
  width: string;
  delay?: number;
  height?: number;
}

function SkeletonLine({ width, delay = 0, height = 12 }: SkeletonLineProps) {
  return (
    <div
      className="omo-skeleton-cool"
      style={{
        height,
        width,
        borderRadius: height > 12 ? 8 : 5,
        animationDelay: `${delay}ms`,
        animationFillMode: 'both',
        animationName: 'omo-skeleton-line-in, omo-skeleton-shimmer',
        animationDuration: '280ms, 2.2s',
        animationTimingFunction: 'cubic-bezier(0.22, 0.61, 0.36, 1), ease-in-out',
        animationIterationCount: '1, infinite',
      }}
    />
  );
}

interface SkeletonRowProps {
  isUser: boolean;
  rowIndex: number;
}

function SkeletonRow({ isUser, rowIndex }: SkeletonRowProps) {
  const baseDelay = rowIndex * 60;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        animation: `omo-content-fade-up 320ms cubic-bezier(0.22, 0.61, 0.36, 1) ${baseDelay}ms both`,
      }}
    >
      <div style={SKELETON_AVATAR_STYLE} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: 1,
          minWidth: 0,
          maxWidth: isUser ? '72%' : '88%',
        }}
      >
        {/* Name + timestamp row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SkeletonLine width={isUser ? '64px' : '74px'} height={11} delay={baseDelay} />
          <SkeletonLine width="48px" height={9} delay={baseDelay + 40} />
        </div>

        {/* Content lines */}
        <SkeletonLine width={isUser ? '58%' : '82%'} delay={baseDelay + 80} />
        <SkeletonLine width={isUser ? '42%' : '68%'} delay={baseDelay + 120} />
        {!isUser && <SkeletonLine width="54%" delay={baseDelay + 160} />}

        {/* Code block simulation for assistant messages */}
        {!isUser && rowIndex === 1 && (
          <div
            className="omo-skeleton-cool"
            style={{
              height: 52,
              width: '92%',
              borderRadius: 8,
              marginTop: 4,
              animationDelay: `${baseDelay + 200}ms`,
              animationFillMode: 'both',
              animationName: 'omo-skeleton-line-in, omo-skeleton-shimmer',
              animationDuration: '280ms, 2.2s',
              animationTimingFunction: 'cubic-bezier(0.22, 0.61, 0.36, 1), ease-in-out',
              animationIterationCount: '1, infinite',
            }}
          />
        )}
      </div>
    </div>
  );
}

export function ChatSessionSkeleton() {
  return (
    <div
      data-testid="chat-session-skeleton"
      aria-busy="true"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        paddingTop: 12,
      }}
    >
      {/* 顶部状态栏骨架 */}
      <div
        className="omo-skeleton-cool"
        style={{
          height: 28,
          width: '38%',
          borderRadius: 14,
          alignSelf: 'center',
          marginBottom: 8,
        }}
      />

      {[0, 1, 2, 3].map((row) => {
        const isUser = row % 2 === 0;
        return <SkeletonRow key={`cool-skel-${row}`} isUser={isUser} rowIndex={row} />;
      })}

      {/* 底部输入框骨架 */}
      <div
        className="omo-skeleton-cool"
        style={{
          height: 44,
          width: '100%',
          borderRadius: 22,
          marginTop: 12,
        }}
      />
    </div>
  );
}
