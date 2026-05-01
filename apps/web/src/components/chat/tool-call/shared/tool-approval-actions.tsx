import type { ToolCallCardProps } from '@openAwork/shared-ui';

/**
 * Approve/Deny/Pause action bar shown beneath a tool card when the gateway
 * is awaiting human confirmation. Renders nothing when no actions are queued
 * (the common case for auto-approved tools).
 */
export function ToolApprovalActions({
  approvalActions,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
}) {
  if (!approvalActions || approvalActions.items.length === 0) {
    return null;
  }

  return (
    <div className="tool-call-approval-actions" data-tool-approval-actions="true">
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
