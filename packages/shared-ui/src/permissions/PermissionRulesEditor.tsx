import { color } from '../tokens.js';
import React, { useState, useMemo } from 'react';

export type PermissionAction = 'allow' | 'deny' | 'ask';

export interface PermissionRuleEntry {
  permission: string;
  pattern: string;
  action: PermissionAction;
}

export interface PermissionCategoryMeta {
  id: string;
  label: string;
  description: string;
  defaultAction: PermissionAction;
  supportsPatterns: boolean;
}

export interface PermissionRulesEditorProps {
  categories: PermissionCategoryMeta[];
  rules: PermissionRuleEntry[];
  onChange: (rules: PermissionRuleEntry[]) => void;
  saving?: boolean;
  style?: React.CSSProperties;
}

const ACTION_META: Record<PermissionAction, { label: string; color: string; icon: string }> = {
  allow: { label: '允许', color: 'var(--success)', icon: '✓' },
  deny: { label: '禁止', color: 'var(--danger)', icon: '✕' },
  ask: { label: '询问', color: 'var(--warning)', icon: '?' },
};

const ACTIONS: PermissionAction[] = ['allow', 'deny', 'ask'];

const CARD: React.CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 10,
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const INPUT: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  background: 'var(--bg-base)',
  color: 'var(--fg-default)',
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
  flex: 1,
  minWidth: 0,
};

const SELECT: React.CSSProperties = {
  ...INPUT,
  flex: 'none',
  width: 'auto',
  cursor: 'pointer',
  appearance: 'none' as const,
  paddingRight: 22,
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
};

const GHOST_BTN: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 6,
  color: 'var(--fg-muted)',
  fontSize: 11,
  padding: '4px 8px',
  cursor: 'pointer',
  lineHeight: 1.4,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const DANGER_BTN: React.CSSProperties = {
  ...GHOST_BTN,
  color: color.danger,
  borderColor: color.dangerBorder,
};

function ActionToggle({
  value,
  onChange,
  defaultAction,
}: {
  value: PermissionAction;
  onChange: (action: PermissionAction) => void;
  defaultAction: PermissionAction;
}) {
  const isDefault = value === defaultAction;
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {ACTIONS.map((action) => {
        const meta = ACTION_META[action];
        const isActive = action === value;
        return (
          <button
            key={action}
            type="button"
            onClick={() => onChange(action)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: isActive ? 700 : 500,
              padding: '3px 8px',
              borderRadius: 4,
              background: isActive ? `${meta.color}20` : 'transparent',
              color: isActive ? meta.color : 'var(--fg-muted)',
              border: isActive ? `1px solid ${meta.color}40` : '1px solid transparent',
              cursor: 'pointer',
              letterSpacing: 0.3,
              transition: 'all 120ms ease',
              opacity: isActive ? 1 : 0.7,
            }}
          >
            <span style={{ fontSize: 9 }}>{meta.icon}</span>
            {meta.label}
            {isActive && isDefault && (
              <span style={{ fontSize: 8, opacity: 0.6, marginLeft: 2 }}>默认</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PatternRuleRow({
  rule,
  onUpdate,
  onRemove,
}: {
  rule: PermissionRuleEntry;
  onUpdate: (updated: PermissionRuleEntry) => void;
  onRemove: () => void;
}) {
  const meta = ACTION_META[rule.action];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--bg-base)',
        borderRadius: 5,
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        marginLeft: 16,
      }}
    >
      <input
        type="text"
        value={rule.pattern}
        onChange={(e) => onUpdate({ ...rule, pattern: e.target.value })}
        placeholder="匹配模式 (如 src/*.ts)"
        style={{ ...INPUT, fontSize: 11, padding: '4px 6px' }}
      />
      <select
        value={rule.action}
        onChange={(e) => onUpdate({ ...rule, action: e.target.value as PermissionAction })}
        style={{ ...SELECT, fontSize: 11, padding: '4px 6px', minWidth: 64 }}
      >
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {ACTION_META[a].label}
          </option>
        ))}
      </select>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 5px',
          borderRadius: 3,
          background: `${meta.color}15`,
          color: meta.color,
        }}
      >
        {meta.icon}
      </span>
      <button
        type="button"
        style={{ ...DANGER_BTN, padding: '2px 5px', fontSize: 9 }}
        onClick={onRemove}
      >
        删除
      </button>
    </div>
  );
}

function CategoryRow({
  category,
  globalOverride,
  patternRules,
  onGlobalChange,
  onPatternAdd,
  onPatternUpdate,
  onPatternRemove,
  onGlobalReset,
}: {
  category: PermissionCategoryMeta;
  globalOverride: PermissionAction | null;
  patternRules: { rule: PermissionRuleEntry; index: number }[];
  onGlobalChange: (action: PermissionAction) => void;
  onPatternAdd: () => void;
  onPatternUpdate: (index: number, rule: PermissionRuleEntry) => void;
  onPatternRemove: (index: number) => void;
  onGlobalReset: () => void;
}) {
  const effectiveAction = globalOverride ?? category.defaultAction;
  const hasOverride = globalOverride !== null;
  const [expanded, setExpanded] = useState(patternRules.length > 0);

  return (
    <div
      style={{
        borderRadius: 8,
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        background: 'var(--bg-base)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
              {category.label}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: 'var(--fg-muted)',
                background: 'var(--bg-overlay)',
                padding: '1px 5px',
                borderRadius: 3,
              }}
            >
              {category.id}
            </span>
            {hasOverride && (
              <button
                type="button"
                onClick={onGlobalReset}
                style={{
                  fontSize: 9,
                  color: 'var(--fg-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                恢复默认
              </button>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>
            {category.description}
          </div>
        </div>

        <ActionToggle
          value={effectiveAction}
          onChange={onGlobalChange}
          defaultAction={category.defaultAction}
        />

        {category.supportsPatterns && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              ...GHOST_BTN,
              padding: '2px 6px',
              fontSize: 9,
              borderColor: expanded ? 'var(--accent)' : undefined,
              color: expanded ? 'var(--accent)' : undefined,
            }}
          >
            {expanded ? '收起' : '模式'}
          </button>
        )}
      </div>

      {expanded && category.supportsPatterns && (
        <div
          style={{
            borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            padding: '6px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {patternRules.map(({ rule, index }) => (
            <PatternRuleRow
              key={`${rule.pattern}-${index}`}
              rule={rule}
              onUpdate={(updated) => onPatternUpdate(index, updated)}
              onRemove={() => onPatternRemove(index)}
            />
          ))}
          <button
            type="button"
            onClick={onPatternAdd}
            style={{
              ...GHOST_BTN,
              alignSelf: 'flex-start',
              marginLeft: 16,
              fontSize: 10,
              padding: '3px 8px',
              borderStyle: 'dashed',
            }}
          >
            + 添加模式规则
          </button>
        </div>
      )}
    </div>
  );
}

export function PermissionRulesEditor({
  categories,
  rules,
  onChange,
  saving,
  style,
}: PermissionRulesEditorProps) {
  const overrideCount = useMemo(() => {
    const globalOverrides = new Set(
      rules.filter((r) => r.pattern === '*').map((r) => r.permission),
    );
    const cats = new Set(categories.map((c) => c.id));
    let count = 0;
    for (const id of globalOverrides) {
      if (cats.has(id)) count++;
    }
    count += rules.filter((r) => r.pattern !== '*').length;
    return count;
  }, [rules, categories]);

  function getGlobalOverride(categoryId: string): PermissionAction | null {
    const rule = rules.find((r) => r.permission === categoryId && r.pattern === '*');
    return rule?.action ?? null;
  }

  function getPatternRules(categoryId: string): { rule: PermissionRuleEntry; index: number }[] {
    return rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.permission === categoryId && rule.pattern !== '*');
  }

  function handleGlobalChange(categoryId: string, action: PermissionAction) {
    const existing = rules.findIndex((r) => r.permission === categoryId && r.pattern === '*');
    if (existing >= 0) {
      const next = rules.map((r, i) => (i === existing ? { ...r, action } : r));
      onChange(next);
    } else {
      onChange([...rules, { permission: categoryId, pattern: '*', action }]);
    }
  }

  function handleGlobalReset(categoryId: string) {
    onChange(rules.filter((r) => !(r.permission === categoryId && r.pattern === '*')));
  }

  function handlePatternAdd(categoryId: string) {
    onChange([...rules, { permission: categoryId, pattern: '', action: 'ask' }]);
  }

  function handlePatternUpdate(index: number, updated: PermissionRuleEntry) {
    const next = rules.map((r, i) => (i === index ? updated : r));
    onChange(next);
  }

  function handlePatternRemove(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
            权限配置
          </span>
          {overrideCount > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 8,
                background: 'var(--accent)',
                color: color.fgOnAccent,
              }}
            >
              {overrideCount} 项覆盖
            </span>
          )}
        </div>
        {saving && <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>保存中…</span>}
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          lineHeight: 1.5,
          padding: '0 0 2px',
        }}
      >
        每个工具类别都有内置默认行为，你可以按需覆盖。支持按模式（如{' '}
        <code style={{ fontSize: 10 }}>src/*.ts</code>）细粒度控制。
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {categories.map((cat) => (
          <CategoryRow
            key={cat.id}
            category={cat}
            globalOverride={getGlobalOverride(cat.id)}
            patternRules={getPatternRules(cat.id)}
            onGlobalChange={(action) => handleGlobalChange(cat.id, action)}
            onPatternAdd={() => handlePatternAdd(cat.id)}
            onPatternUpdate={handlePatternUpdate}
            onPatternRemove={handlePatternRemove}
            onGlobalReset={() => handleGlobalReset(cat.id)}
          />
        ))}
      </div>
    </div>
  );
}
