import { useEffect, useMemo, useState } from 'react';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';

const PLACEHOLDER_ROTATION_MS = 4000;

export const COMPOSER_PLACEHOLDER_POOL = [
  '发送消息…',
  '问点什么…',
  '描述你的需求，我来实现…',
  '输入 / 查看快捷命令，@ 引用文件…',
  '试试描述一个功能或粘贴一段代码…',
] as const;

export function useComposerPlaceholder(input: string, customPlaceholder?: string) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [focused, setFocused] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  // 依赖布尔值而非长度：否则每敲一个字都会重建一次定时器。
  const hasInput = input.length > 0;

  useEffect(() => {
    // 轮播文案对前庭敏感用户和读屏都是持续干扰，声明 prefers-reduced-motion 时固定首条。
    if (prefersReducedMotion || customPlaceholder || focused || hasInput) return;
    const id = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % COMPOSER_PLACEHOLDER_POOL.length);
    }, PLACEHOLDER_ROTATION_MS);
    return () => clearInterval(id);
  }, [customPlaceholder, focused, hasInput, prefersReducedMotion]);

  const placeholder = useMemo(() => {
    if (customPlaceholder) return customPlaceholder;
    if (hasInput) return '';
    if (focused || prefersReducedMotion) return COMPOSER_PLACEHOLDER_POOL[0];
    return COMPOSER_PLACEHOLDER_POOL[placeholderIndex] ?? COMPOSER_PLACEHOLDER_POOL[0];
  }, [customPlaceholder, focused, hasInput, placeholderIndex, prefersReducedMotion]);

  return {
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
