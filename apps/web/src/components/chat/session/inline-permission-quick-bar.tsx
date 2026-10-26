import type { AlwaysScopeLevel } from '@openAwork/shared-ui';

import type { ResolveInlinePermissionActionsFn } from './ChatPageSections.js';

export function isScopeLevelSelected(
  level: AlwaysScopeLevel,
  actions: NonNullable<ReturnType<ResolveInlinePermissionActionsFn>>,
): boolean {
  return (
    actions.selectedScopeCategory === level.category ||
    actions.selectedScopePattern === level.pattern
  );
}

export function renderCompactScopeSelector(
  actions: NonNullable<ReturnType<ResolveInlinePermissionActionsFn>>,
  buttonStyle: React.CSSProperties,
): React.ReactNode {
  if (!actions.scopeLevels || actions.scopeLevels.length === 0 || !actions.onSelectScopeLevel) {
    return null;
  }

  return actions.scopeLevels.map((level) => {
    const isSelected = isScopeLevelSelected(level, actions);
    return (
      <button
        key={level.category}
        type="button"
        onClick={() => actions.onSelectScopeLevel?.(level)}
        title={`${level.description} ${level.pattern}`}
        aria-pressed={isSelected}
        style={{
          ...buttonStyle,
          border: isSelected
            ? '1px solid var(--accent)'
            : '1px solid color-mix(in srgb, var(--accent) 24%, var(--border-default))',
          background: isSelected
            ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
            : 'var(--bg-overlay)',
          color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
        }}
      >
        {level.label}
      </button>
    );
  });
}

export interface InlinePermissionQuickBarProps {
  permissions: Array<{
    requestId: string;
    toolName: string;
    reason: string;
    scope: string;
    riskLevel: string;
    previewAction?: string;
  }>;
  resolveActions: ResolveInlinePermissionActionsFn;
  /**
   * 紧凑模式：去掉为「对话气泡左侧头像列」预留的 40px 缩进。
   * 卡片墙等窄容器（<280px）里必须开 —— 否则可用宽度被白白吃掉六分之一。
   */
  dense?: boolean;
}

export function InlinePermissionQuickBar({
  permissions,
  resolveActions,
  dense = false,
}: InlinePermissionQuickBarProps) {
  if (permissions.length === 0) return null;

  return (
    <div
      data-testid="inline-permission-quick-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        paddingLeft: dense ? 0 : 40,
      }}
    >
      {permissions.map((permission) => {
        const actions = resolveActions(permission.requestId);
        return (
          <div
            key={permission.requestId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              fontSize: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'var(--warning)',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{permission.toolName}</span>
              <span
                style={{
                  color: 'var(--fg-default)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {permission.reason}
              </span>
              {actions &&
                renderCompactScopeSelector(actions, {
                  appearance: 'none',
                  height: 20,
                  padding: '0 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  cursor: 'pointer',
                  flexShrink: 0,
                })}
              {actions &&
                actions.items.length > 0 &&
                actions.items.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={action.disabled}
                    onClick={action.onClick}
                    title={action.hint}
                    style={{
                      appearance: 'none',
                      height: 20,
                      padding: '0 7px',
                      borderRadius: 999,
                      border: 'none',
                      background: action.primary
                        ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                        : action.danger
                          ? 'color-mix(in srgb, var(--danger) 14%, transparent)'
                          : 'color-mix(in srgb, var(--accent) 10%, transparent)',
                      color: action.danger ? 'var(--danger)' : 'var(--accent)',
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1,
                      cursor: action.disabled ? 'not-allowed' : 'pointer',
                      opacity: action.disabled ? 0.55 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              {actions?.errorMessage && (
                <span style={{ color: 'var(--danger)' }}>{actions.errorMessage}</span>
              )}
            </div>
            {permission.previewAction && (
              <div
                style={{
                  marginLeft: 11,
                  maxWidth: '100%',
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={permission.previewAction}
              >
                {permission.previewAction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
