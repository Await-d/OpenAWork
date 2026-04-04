import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { MessageConnection } from 'vscode-jsonrpc';
import type { Diagnostic } from 'vscode-languageserver-types';

export type RootFunction = (filePath: string) => Promise<string | undefined>;

export interface LSPServerHandle {
  process: ChildProcessWithoutNullStreams;
  initialization?: Record<string, unknown>;
}

export interface LSPServerInfo {
  id: string;
  extensions: string[];
  root: RootFunction;
  spawn(root: string): Promise<LSPServerHandle | undefined>;
}

export interface LSPClientInfo {
  serverID: string;
  root: string;
  connection: MessageConnection;
  diagnostics: Map<string, Diagnostic[]>;
  notify: {
    open(input: { path: string }): Promise<void>;
    change(input: { path: string; text: string }): Promise<void>;
  };
  waitForDiagnostics(input: { path: string; timeoutMs?: number }): Promise<Diagnostic[]>;
  hover(input: { file: string; line: number; character: number }): Promise<unknown>;
  definition(input: { file: string; line: number; character: number }): Promise<unknown[]>;
  implementation(input: { file: string; line: number; character: number }): Promise<unknown[]>;
  references(input: {
    file: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
  }): Promise<unknown[]>;
  documentSymbols(input: { file: string }): Promise<unknown[]>;
  workspaceSymbols(input: { query: string }): Promise<unknown[]>;
  prepareRename(input: { file: string; line: number; character: number }): Promise<unknown>;
  rename(input: {
    file: string;
    line: number;
    character: number;
    newName: string;
  }): Promise<unknown>;
  prepareCallHierarchy(input: {
    file: string;
    line: number;
    character: number;
  }): Promise<unknown[]>;
  incomingCalls(input: { item: unknown }): Promise<unknown[]>;
  outgoingCalls(input: { item: unknown }): Promise<unknown[]>;
  shutdown(): Promise<void>;
}

export interface LSPServerStatus {
  id: string;
  root: string;
  running: boolean;
  fileCount: number;
  diagnosticCount: number;
}

export interface DiagnosticSummary {
  severity: 'error' | 'warning' | 'information' | 'hint';
  line: number;
  col: number;
  message: string;
  source?: string;
  code?: string | number;
}
