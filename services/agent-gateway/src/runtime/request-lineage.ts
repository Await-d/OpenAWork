export function matchesRequestScope(
  rootClientRequestId: string,
  candidateClientRequestId?: string | null,
) {
  if (typeof candidateClientRequestId !== 'string' || candidateClientRequestId.length === 0) {
    return false;
  }

  return (
    candidateClientRequestId === rootClientRequestId ||
    candidateClientRequestId.startsWith(`${rootClientRequestId}:`)
  );
}
