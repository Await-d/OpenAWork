export type {
  WorkspacePermissionAction as PermissionAction,
  WorkspacePermissionConfig,
  WorkspacePermissionRule as PermissionRule,
} from '@openAwork/agent-core';
export {
  evaluateWorkspacePermissionRules as evaluatePermissionRules,
  loadWorkspacePermissionRules,
  resolveWorkspacePermissionAction as resolvePermissionAction,
  wildcardMatch,
} from '@openAwork/agent-core';
