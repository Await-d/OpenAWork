import { useEffect, useMemo, useState } from 'react';

const PLACEHOLDER_ROTATION_MS = 4000;

export const COMPOSER_PLACEHOLDER_POOL = [
  '发送消息…（Enter 发送，Shift+Enter 换行，Tab 切换代理）',
  '问点什么…',
  '描述你的需求，我来实现…',
  '输入 / 查看快捷命令，@ 引用文件…',
  '试试描述一个功能或粘贴一段代码…',
] as const;

export function useComposerPlaceholder(input: string, customPlaceholder?: string) {
  const [focused, setFocused] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    if (customPlaceholder || focused || input.length > 0) return;
    const id = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % COMPOSER_PLACEHOLDER_POOL.length);
    }, PLACEHOLDER_ROTATION_MS);
    return () => clearInterval(id);
  }, [customPlaceholder, focused, input.length]);

  const placeholder = useMemo(() => {
    if (customPlaceholder) return customPlaceholder;
    if (input.length > 0) return '';
    if (focused) return COMPOSER_PLACEHOLDER_POOL[0];
    return COMPOSER_PLACEHOLDER_POOL[placeholderIndex] ?? COMPOSER_PLACEHOLDER_POOL[0];
  }, [customPlaceholder, focused, input.length, placeholderIndex]);

  return {
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
