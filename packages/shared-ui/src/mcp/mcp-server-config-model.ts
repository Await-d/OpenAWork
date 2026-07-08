import type { CSSProperties } from 'react';

export type MCPBuiltinKind = 'system' | 'virtual' | 'adapter';
export type MCPServerDisplaySource = 'builtin' | 'user' | 'system';

export interface MCPServerEntry {
  id: string;
  name: string;
  transport?: 'sse' | 'stdio';
  type?: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  required?: boolean;
  builtin?: boolean;
  builtinKind?: MCPBuiltinKind;
  source?: MCPServerDisplaySource;
  enabled?: boolean;
  disabledTools?: string[];
  headers?: Record<string, string>;
  oauth?:
    | false
    | {
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
        scope?: string;
      };
}

export interface MCPServerConfigProps {
  servers: MCPServerEntry[];
  onAdd: (entry: MCPServerEntry) => void;
  onRemove: (id: string) => void;
  onUpdate?: (id: string, entry: MCPServerEntry) => void;
  style?: CSSProperties;
}
