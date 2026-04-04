import { useEffect, useMemo, useRef, useState } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  onExecute(): void;
}

export interface CommandPaletteProps {
  commands: CommandItem[];
  emptyLabel?: string;
  isOpen: boolean;
  onClose: () => void;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  query?: string;
}

export function CommandPalette({
  commands,
  emptyLabel = '没有匹配的命令',
  isOpen,
  onClose,
  onQueryChange,
  placeholder = '搜索命令…',
  query: controlledQuery,
}: CommandPaletteProps) {
  const [internalQuery, setInternalQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = controlledQuery ?? internalQuery;

  const updateQuery = (value: string) => {
    if (controlledQuery === undefined) {
      setInternalQuery(value);
    }
    onQueryChange?.(value);
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return commands;
    }
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.description ?? ''} ${command.shortcut ?? ''}`
        .trim()
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!isOpen) {
      updateQuery('');
      setSelectedIndex(0);
      return;
    }
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => {
          if (filtered.length === 0) {
            return 0;
          }
          return (prev + 1) % filtered.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => {
          if (filtered.length === 0) {
            return 0;
          }
          return (prev - 1 + filtered.length) % filtered.length;
        });
        return;
      }

      if (event.key === 'Enter') {
        if (filtered.length === 0) {
          return;
        }
        event.preventDefault();
        filtered[selectedIndex]?.onExecute();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [filtered, isOpen, onClose, selectedIndex]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length > 0 ? filtered.length - 1 : 0);
    }
  }, [filtered.length, selectedIndex]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.7)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 999,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(680px, 92vw)',
          background: 'var(--color-surface, #1e293b)',
          border: '1px solid var(--color-border, #334155)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(2, 6, 23, 0.45)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-border, #334155)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              updateQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder={placeholder}
            style={{
              width: '100%',
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 7,
              background: '#0f172a',
              color: 'var(--color-text, #f1f5f9)',
              padding: '0.5rem 0.65rem',
              fontSize: 12,
              outline: 'none',
            }}
          />
        </div>
        <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '0.9rem',
                color: 'var(--color-muted, #94a3b8)',
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              {emptyLabel}
            </div>
          ) : (
            filtered.map((command, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    command.onExecute();
                    onClose();
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderTop: index === 0 ? 'none' : '1px solid var(--color-border, #334155)',
                    background: selected ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: 'var(--color-text, #f1f5f9)',
                    padding: '0.65rem 0.75rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
                      {command.label}
                    </span>
                    {command.description && (
                      <span
                        style={{
                          display: 'block',
                          marginTop: 2,
                          fontSize: 11,
                          color: 'var(--color-muted, #94a3b8)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {command.description}
                      </span>
                    )}
                  </span>
                  {command.shortcut && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--color-muted, #94a3b8)',
                        border: '1px solid var(--color-border, #334155)',
                        borderRadius: 6,
                        padding: '0.15rem 0.4rem',
                        flexShrink: 0,
                      }}
                    >
                      {command.shortcut}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
