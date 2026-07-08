import type { MCPServerEntry } from '@openAwork/shared-ui';

type PersistableMcpServerSource = Exclude<MCPServerEntry['source'], 'builtin' | undefined>;

function isProtectedBuiltinMcpKind(kind: MCPServerEntry['builtinKind'] | undefined): boolean {
  return kind === 'virtual' || kind === 'adapter';
}

export function resolvePersistableMcpServerSource(
  current: Pick<MCPServerEntry, 'builtin' | 'builtinKind' | 'source'>,
  nextSource: MCPServerEntry['source'] | undefined,
): PersistableMcpServerSource {
  const source = nextSource ?? current.source;
  if (source === 'system' || source === 'user') {
    return source;
  }
  if (current.builtin && current.source === 'builtin') {
    return isProtectedBuiltinMcpKind(current.builtinKind) ? 'system' : 'user';
  }
  return 'user';
}
