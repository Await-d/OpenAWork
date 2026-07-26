/**
 * Type declarations for Node.js 22.5+ `node:sqlite` built-in module.
 *
 * These are only needed until @types/node is upgraded to >=22.5.
 * The runtime uses `createRequire` to load the module, so this file
 * exists solely to satisfy the TypeScript compiler during type-checking.
 */

declare module 'node:sqlite' {
  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedIdentifierParsing?: boolean;
    allowExtensionLoading?: boolean;
  }

  interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    setAllowBareNamedParameters(allow: boolean): void;
    setAllowUnknownNamedParameters(allow: boolean): void;
    sourceSQL(): string;
    readonly columnNames: string[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    open(): void;
    prepare(sql: string): StatementSync;
    readonly isOpen: boolean;
  }
}
