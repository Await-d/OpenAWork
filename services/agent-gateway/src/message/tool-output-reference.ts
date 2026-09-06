import { createHash } from 'node:crypto';

const MAX_INLINE_REFERENCE_ID_CHARS = 256;

export function buildToolOutputReferenceIdentity(
  toolCallId: string,
): { readonly toolCallId: string } | { readonly toolCallRef: string } {
  if (toolCallId.length <= MAX_INLINE_REFERENCE_ID_CHARS) return { toolCallId };
  return {
    toolCallRef: createHash('sha256').update(toolCallId).digest('hex'),
  };
}

export function matchesToolOutputReference(toolCallId: string, toolCallRef: string): boolean {
  if (toolCallId.length <= MAX_INLINE_REFERENCE_ID_CHARS) return false;
  return createHash('sha256').update(toolCallId).digest('hex') === toolCallRef;
}
