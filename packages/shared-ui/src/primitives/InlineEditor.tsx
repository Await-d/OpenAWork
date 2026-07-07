import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

export interface InlineEditorProps {
  readonly value: string;
  readonly label: string;
  readonly onSave: (value: string) => Promise<void> | void;
  readonly disabled?: boolean;
  readonly emptyFallback?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly buttonStyle?: CSSProperties;
  readonly inputStyle?: CSSProperties;
  readonly onSaveError?: (message: string) => void;
}

export function InlineEditor({
  value,
  label,
  onSave,
  disabled = false,
  emptyFallback,
  className,
  style,
  buttonStyle,
  inputStyle,
  onSaveError,
}: InlineEditorProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelNextBlurRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  useEffect(() => {
    if (!editing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = async (): Promise<void> => {
    const nextValue = normalizeDraft(draft, value, emptyFallback);
    cancelNextBlurRef.current = false;
    setEditing(false);
    setDraft(nextValue);
    if (nextValue === value) {
      return;
    }

    setSaving(true);
    try {
      await onSave(nextValue);
    } catch (error) {
      onSaveError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const cancel = (): void => {
    cancelNextBlurRef.current = true;
    setDraft(value);
    setEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        className={className}
        disabled={disabled || saving}
        onDoubleClick={() => setEditing(true)}
        style={{
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--fg-default)',
          cursor: disabled || saving ? 'default' : 'text',
          font: 'inherit',
          minWidth: 0,
          overflow: 'hidden',
          padding: '2px 4px',
          textAlign: 'left',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...style,
          ...buttonStyle,
        }}
      >
        {value}
      </button>
    );
  }

  return (
    <label className={className} style={{ display: 'inline-flex', minWidth: 0, ...style }}>
      <span style={{ height: 1, overflow: 'hidden', position: 'absolute', width: 1 }}>{label}</span>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={draft}
        disabled={saving}
        onBlur={() => {
          if (cancelNextBlurRef.current) {
            cancelNextBlurRef.current = false;
            return;
          }
          void commit();
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--accent-border)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 0 0 4px var(--accent-subtle)',
          color: 'var(--fg-default)',
          font: 'inherit',
          minWidth: 0,
          outline: '2px solid var(--accent)',
          outlineOffset: 2,
          padding: '2px 6px',
          width: '100%',
          ...inputStyle,
        }}
      />
    </label>
  );
}

function normalizeDraft(value: string, currentValue: string, emptyFallback: string | undefined) {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  return emptyFallback ?? currentValue;
}
