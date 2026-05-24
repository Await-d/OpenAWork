import type { PendingPermissionRequest } from '@openAwork/web-client';

export function resolvePermissionAlwaysOverride(
  request: Pick<PendingPermissionRequest, 'always' | 'scope'>,
): string[] {
  const candidates = [request.scope, ...(request.always ?? [])]
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
  const unique = [...new Set(candidates)];
  return unique.length > 0 ? [unique[unique.length - 1]!] : [];
}
