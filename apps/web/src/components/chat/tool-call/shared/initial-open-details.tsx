import { useEffect, useRef, type ReactNode } from 'react';

/**
 * `<details>` 的非受控包装：`initialOpen` 只在**挂载时**应用一次，之后完全
 * 交给用户交互。
 *
 * 为什么不直接写 `open={isInsideExpandedCard || undefined}`：在展开卡片内
 * `open` 会变成受控属性，React 每次渲染都把 DOM 的 `open` 写回 `true`，用户
 * 点击 summary 收起后，下一次重渲染又把它弹回来——表现为「展开卡片里的
 * details 怎么点都收不起来」。而在卡片外它又变回非受控，行为随所处上下文
 * 漂移。
 */
export function InitialOpenDetails({
  initialOpen,
  className,
  children,
}: {
  initialOpen: boolean;
  className?: string;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = initialOpen;
    }
  }, [initialOpen]);

  return (
    <details className={className} ref={detailsRef}>
      {children}
    </details>
  );
}
