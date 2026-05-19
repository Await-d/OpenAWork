import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import fuzzysort from 'fuzzysort';

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  shortcut?: string;
  icon?: string;
  onExecute: () => void;
}

interface CommandPaletteProps {
  items: CommandPaletteItem[];
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ items, isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const results = fuzzysort.go(query, items, {
      keys: ['label', 'description', 'category'],
      threshold: -500,
    });
    return results.map((r) => r.obj);
  }, [items, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  const executeItem = useCallback(
    (item: CommandPaletteItem) => {
      onClose();
      // Defer execution so the palette closes first
      requestAnimationFrame(() => item.onExecute());
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length,
        );
        return;
      }
      if (e.key === 'Enter' && filteredItems.length > 0) {
        e.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item) executeItem(item);
      }
    },
    [filteredItems, selectedIndex, executeItem, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector('[data-selected="true"]') as HTMLElement | null;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const groupedItems = groupByCategory(filteredItems);

  return (
    <div
      className="command-palette-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-label="命令面板"
        data-testid="command-palette"
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令或操作…"
            aria-label="搜索命令"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-1)',
              fontSize: 14,
              lineHeight: 1.4,
            }}
          />
          <kbd
            style={{
              fontSize: 10,
              padding: '2px 5px',
              borderRadius: 4,
              border: '1px solid var(--border-subtle)',
              color: 'var(--fg-muted)',
              background: 'color-mix(in oklch, var(--bg-overlay) 60%, transparent)',
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          role="listbox"
          aria-label="命令列表"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {filteredItems.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'var(--fg-muted)',
                fontSize: 13,
              }}
            >
              没有匹配的命令
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.category ?? '__default'}>
                {group.category && (
                  <div
                    style={{
                      padding: '6px 16px 2px',
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--fg-muted)',
                    }}
                  >
                    {group.category}
                  </div>
                )}
                {group.items.map((item) => {
                  const globalIndex = filteredItems.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isSelected}
                      data-selected={isSelected ? 'true' : undefined}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 16px',
                        cursor: 'pointer',
                        borderRadius: 6,
                        margin: '0 4px',
                        background: isSelected
                          ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                          : 'transparent',
                        transition: 'background 80ms ease',
                      }}
                    >
                      {item.icon && (
                        <span
                          style={{ fontSize: 14, flexShrink: 0, width: 20, textAlign: 'center' }}
                        >
                          {item.icon}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: 'var(--text-1)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.label}
                        </div>
                        {item.description && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--fg-muted)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginTop: 1,
                            }}
                          >
                            {item.description}
                          </div>
                        )}
                      </div>
                      {item.shortcut && (
                        <kbd
                          style={{
                            fontSize: 10,
                            padding: '2px 5px',
                            borderRadius: 4,
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--fg-muted)',
                            background: 'color-mix(in oklch, var(--bg-overlay) 60%, transparent)',
                            flexShrink: 0,
                          }}
                        >
                          {item.shortcut}
                        </kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface GroupedItems {
  category: string | undefined;
  items: CommandPaletteItem[];
}

function groupByCategory(items: CommandPaletteItem[]): GroupedItems[] {
  const groups = new Map<string | undefined, CommandPaletteItem[]>();
  for (const item of items) {
    const key = item.category;
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return Array.from(groups.entries()).map(([category, groupItems]) => ({
    category,
    items: groupItems,
  }));
}

// ---------------------------------------------------------------------------
// Hook: useCommandPalette — global keyboard shortcut + state
// ---------------------------------------------------------------------------

export interface UseCommandPaletteOptions {
  items: CommandPaletteItem[];
  enabled?: boolean;
}

export interface UseCommandPaletteReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  items: CommandPaletteItem[];
}

export function useCommandPalette({
  items,
  enabled = true,
}: UseCommandPaletteOptions): UseCommandPaletteReturn {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  return {
    isOpen,
    open: useCallback(() => setIsOpen(true), []),
    close: useCallback(() => setIsOpen(false), []),
    toggle: useCallback(() => setIsOpen((prev) => !prev), []),
    items,
  };
}
