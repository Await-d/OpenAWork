import type { ToolCallCardProps } from '@openAwork/shared-ui';

/**
 * Approve/Deny/Pause action bar shown beneath a tool card when the gateway
 * is awaiting human confirmation. Renders nothing when no actions are queued
 * (the common case for auto-approved tools).
 */
export function ToolApprovalActions({
  approvalActions,
  permissionRequestId,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  permissionRequestId?: string;
}) {
  if (!approvalActions || approvalActions.items.length === 0) {
    return null;
  }

  return (
    <div
      className="tool-call-approval-actions"
      data-tool-approval-actions="true"
      data-permission-request-id={permissionRequestId}
    >
      {approvalActions.scopeLevels &&
        approvalActions.scopeLevels.length > 0 &&
        approvalActions.onSelectScopeLevel && (
          <div className="tool-call-approval-scope-selector" aria-label="审批范围">
            {approvalActions.scopeLevels.map((level) => {
              const isSelected =
                approvalActions.selectedScopeCategory === level.category ||
                approvalActions.selectedScopePattern === level.pattern;
              return (
                <button
                  key={level.category}
                  type="button"
                  className="tool-call-approval-scope-button"
                  aria-pressed={isSelected}
                  data-selected={isSelected ? 'true' : 'false'}
                  title={`${level.description} ${level.pattern}`}
                  onClick={() => approvalActions.onSelectScopeLevel?.(level)}
                >
                  {level.label}
                </button>
              );
            })}
          </div>
        )}
      <div className="tool-call-approval-buttons">
        {approvalActions.items.map((action) => (
          <button
            key={action.id}
            type="button"
            className="tool-call-approval-button"
            data-variant={action.primary ? 'primary' : action.danger ? 'danger' : 'secondary'}
            disabled={action.disabled}
            title={action.hint}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
      {(approvalActions.pendingLabel ||
        approvalActions.helperMessage ||
        approvalActions.errorMessage) && (
        <div className="tool-call-approval-notes">
          {approvalActions.pendingLabel && (
            <div className="tool-call-approval-note" data-tone="warning">
              {approvalActions.pendingLabel}
            </div>
          )}
          {approvalActions.helperMessage && (
            <div className="tool-call-approval-note" data-tone="muted">
              {approvalActions.helperMessage}
            </div>
          )}
          {approvalActions.errorMessage && (
            <div className="tool-call-approval-note" data-tone="danger">
              {approvalActions.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
