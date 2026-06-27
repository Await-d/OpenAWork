/**
 * 智能输入引导气泡
 *
 * 在输入框上方根据当前团队状态显示上下文感知的引导性提示：
 *   - 任务失败 → 提示用户如何更精确地描述需求
 *   - 空闲态 → 提示可用命令语法（/命令、@文件引用）
 *   - 运行中 → 提示可发送追加指令
 *
 * 以及 / 命令 和 @ 文件引用的悬浮补全菜单。
 */

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

// ─── 样式 ──────────────────────────────────────────────────────────

const BUBBLE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  margin: '0 0 6px',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--aux) 8%, var(--bg-overlay))',
  border: '1px solid color-mix(in srgb, var(--aux) 25%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 11,
  lineHeight: 1.5,
  flexShrink: 0,
};

const BUBBLE_ICON_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 13,
};

const BUBBLE_TEXT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const BUBBLE_EXAMPLE_STYLE: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  margin: '2px 4px 0 0',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 120ms ease',
};

const COMPLETION_MENU_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  minWidth: 220,
  maxWidth: 360,
  maxHeight: 240,
  overflowY: 'auto',
  padding: 4,
  borderRadius: 10,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
};

const COMPLETION_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 7,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 500,
  textAlign: 'left',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const COMPLETION_ITEM_ACTIVE_STYLE: CSSProperties = {
  ...COMPLETION_ITEM_STYLE,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
};

const COMPLETION_ITEM_ICON_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 13,
};

const COMPLETION_ITEM_DESC_STYLE: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontWeight: 400,
  flexShrink: 0,
};

// ─── 类型 ──────────────────────────────────────────────────────────

export type SuggestionContext = 'failure' | 'idle' | 'running' | 'clarifying' | 'default';

export interface SuggestionEntry {
  text: string;
  label?: string;
}

interface CommandEntry {
  name: string;
  description: string;
  icon: string;
}

interface MentionEntry {
  name: string;
  path: string;
  icon: string;
}

// ─── 预设数据 ──────────────────────────────────────────────────────

const COMMAND_SUGGESTIONS: CommandEntry[] = [
  { name: '/new', description: '新建会话', icon: '✨' },
  { name: '/help', description: '查看帮助', icon: '❓' },
  { name: '/template', description: '从模板创建', icon: '📐' },
  { name: '/retry', description: '重试失败任务', icon: '↻' },
  { name: '/pause', description: '暂停运行', icon: '⏸' },
  { name: '/resume', description: '恢复运行', icon: '▶' },
  { name: '/status', description: '查看状态', icon: '📊' },
  { name: '/agent', description: '切换 Agent', icon: '🤖' },
];

const FAILURE_SUGGESTIONS: SuggestionEntry[] = [
  {
    text: '帮我创建一个微信点菜小程序，包含前端页面和后端通知服务',
    label: '更精确的需求描述',
  },
  {
    text: '请检查上一轮失败的任务并修复语法错误后重新执行',
    label: '针对性修复',
  },
  {
    text: '请将需求拆分为更小的步骤逐步执行',
    label: '拆分任务',
  },
];

const IDLE_SUGGESTIONS: SuggestionEntry[] = [
  { text: '帮我实现一个登录功能' },
  { text: '创建一个 React 组件库' },
  { text: '给项目加上单元测试' },
];

// ─── 智能引导气泡 ──────────────────────────────────────────────────

export interface SmartSuggestionBubbleProps {
  context: SuggestionContext;
  failedCount?: number;
  onSelectSuggestion?: (text: string) => void;
  onDismiss?: () => void;
}

export function SmartSuggestionBubble({
  context,
  failedCount = 0,
  onSelectSuggestion,
  onDismiss,
}: SmartSuggestionBubbleProps) {
  const suggestions = useMemo<SuggestionEntry[]>(() => {
    if (context === 'failure') return FAILURE_SUGGESTIONS;
    if (context === 'idle') return IDLE_SUGGESTIONS;
    return [];
  }, [context]);

  if (suggestions.length === 0) return null;

  const hintText =
    context === 'failure'
      ? `💡 系统提示：${failedCount > 0 ? `${failedCount} 个任务失败，` : ''}意图改写失败通常是因为需求较为模糊。您可以尝试这样输入：`
      : context === 'idle'
        ? '💡 提示：支持 /命令 和 @文件引用。试试以下快捷操作：'
        : '';

  return (
    <div style={BUBBLE_STYLE} role="status" aria-live="polite">
      <span style={BUBBLE_ICON_STYLE} aria-hidden>
        {context === 'failure' ? '⚠' : '💡'}
      </span>
      <span style={BUBBLE_TEXT_STYLE}>{hintText}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 14,
            padding: '0 2px',
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      ) : null}
      {suggestions.map((s) => (
        <button
          key={s.text}
          type="button"
          style={BUBBLE_EXAMPLE_STYLE}
          onClick={() => onSelectSuggestion?.(s.text)}
          title={s.text}
        >
          {s.label ?? s.text.slice(0, 20) + (s.text.length > 20 ? '…' : '')}
        </button>
      ))}
    </div>
  );
}

// ─── 命令/文件补全菜单 ─────────────────────────────────────────────

export interface CompletionMenuProps {
  type: 'command' | 'mention';
  query: string;
  anchorRect: DOMRect | null;
  mentions?: MentionEntry[];
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function CompletionMenu({
  type,
  query,
  anchorRect,
  mentions = [],
  onSelect,
  onClose,
}: CompletionMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    if (type === 'command') {
      return COMMAND_SUGGESTIONS.filter((cmd) =>
        cmd.name.toLowerCase().includes(query.toLowerCase()),
      );
    }
    return mentions.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  }, [type, query, mentions]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, type]);

  // 点击外部关闭
  useEffect(() => {
    if (!anchorRect) return undefined;
    const onDown = (e: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRect, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) {
          if (type === 'command') {
            onSelect((item as CommandEntry).name + ' ');
          } else {
            onSelect('@' + (item as MentionEntry).name + ' ');
          }
        }
      }
    },
    [activeIndex, items, onSelect, type],
  );

  if (!anchorRect || items.length === 0) return null;

  const menu = (
    <div
      ref={menuRef}
      role="listbox"
      tabIndex={-1}
      aria-label={type === 'command' ? '命令补全' : '文件引用补全'}
      style={{
        ...COMPLETION_MENU_STYLE,
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
      }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, idx) => {
        const active = idx === activeIndex;
        if (type === 'command') {
          const cmd = item as CommandEntry;
          return (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={active}
              style={active ? COMPLETION_ITEM_ACTIVE_STYLE : COMPLETION_ITEM_STYLE}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => onSelect(cmd.name + ' ')}
            >
              <span style={COMPLETION_ITEM_ICON_STYLE} aria-hidden>
                {cmd.icon}
              </span>
              <span style={{ fontWeight: 700 }}>{cmd.name}</span>
              <span style={COMPLETION_ITEM_DESC_STYLE}>{cmd.description}</span>
            </button>
          );
        }
        const mention = item as MentionEntry;
        return (
          <button
            key={mention.path}
            type="button"
            role="option"
            aria-selected={active}
            style={active ? COMPLETION_ITEM_ACTIVE_STYLE : COMPLETION_ITEM_STYLE}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => onSelect('@' + mention.name + ' ')}
          >
            <span style={COMPLETION_ITEM_ICON_STYLE} aria-hidden>
              {mention.icon}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mention.name}</span>
            <span style={COMPLETION_ITEM_DESC_STYLE}>{mention.path}</span>
          </button>
        );
      })}
    </div>
  );

  return createPortal(menu, document.body);
}

// ─── 输入框补全 Hook ───────────────────────────────────────────────

export function useInputCompletion(
  inputValue: string,
  mentions: MentionEntry[] = [],
): {
  completionType: 'command' | 'mention' | null;
  completionQuery: string;
  anchorRect: DOMRect | null;
  setAnchorRect: (rect: DOMRect | null) => void;
  handleSelect: (value: string) => string;
  closeCompletion: () => void;
} {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const completionType = useMemo<'command' | 'mention' | null>(() => {
    if (!inputValue) return null;
    // 查找最后一个未闭合的 / 或 @ 触发符
    const lastSlash = inputValue.lastIndexOf('/');
    const lastAt = inputValue.lastIndexOf('@');
    const lastSpace = inputValue.lastIndexOf(' ');

    // / 或 @ 必须在最后一个空格之后（即当前正在输入的词）
    if (lastSlash > lastSpace && lastSlash >= 0) {
      const afterSlash = inputValue.slice(lastSlash + 1);
      // 确保不是 URL 中的 /
      if (!afterSlash.includes(' ') && afterSlash.length <= 20) {
        return 'command';
      }
    }
    if (lastAt > lastSpace && lastAt >= 0) {
      const afterAt = inputValue.slice(lastAt + 1);
      if (!afterAt.includes(' ') && afterAt.length <= 30) {
        return 'mention';
      }
    }
    return null;
  }, [inputValue]);

  const completionQuery = useMemo(() => {
    if (!completionType) return '';
    const trigger = completionType === 'command' ? '/' : '@';
    const lastTrigger = inputValue.lastIndexOf(trigger);
    return inputValue.slice(lastTrigger + 1);
  }, [completionType, inputValue]);

  const handleSelect = useCallback(
    (value: string): string => {
      if (!completionType) return inputValue;
      const trigger = completionType === 'command' ? '/' : '@';
      const lastTrigger = inputValue.lastIndexOf(trigger);
      return inputValue.slice(0, lastTrigger) + value;
    },
    [completionType, inputValue],
  );

  const closeCompletion = useCallback(() => {
    setAnchorRect(null);
  }, []);

  return {
    completionType,
    completionQuery,
    anchorRect: completionType ? anchorRect : null,
    setAnchorRect,
    handleSelect,
    closeCompletion,
  };
}
