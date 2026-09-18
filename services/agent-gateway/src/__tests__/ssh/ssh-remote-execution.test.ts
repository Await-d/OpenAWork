import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ExecResult,
  SSHConnection,
  SSHConnectionManager,
  SSHExecOptions,
  SSHFileEntry,
  SSHFilePreview,
} from '@openAwork/agent-core';
import type * as DbModule from '../../infra/db.js';
import type * as SshServiceModule from '../../ssh/ssh-service.js';
import type * as SshStoreModule from '../../ssh/ssh-store.js';
import type * as RemoteExecutionModule from '../../tools/ssh-remote-execution.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let connectDb: typeof DbModule.connectDb;
let migrate: typeof DbModule.migrate;
let closeDb: typeof DbModule.closeDb;
let sqliteRun: typeof DbModule.sqliteRun;
let SshService: typeof SshServiceModule.SshService;
let setSshService: typeof SshServiceModule.setSshService;
let __resetSshServiceForTests: typeof SshServiceModule.__resetSshServiceForTests;
let __resetSshStoreForTests: typeof SshStoreModule.__resetSshStoreForTests;
let remoteExecution: typeof RemoteExecutionModule;

const TEST_USER = 'u-ssh-remote';
const CONNECTION_ID = 'conn-1';

interface FakeSshState {
  status: SSHConnection['status'];
  execCalls: Array<{ command: string; timeoutMs?: number }>;
  written: Array<{ path: string; content: string }>;
  files: Map<string, string>;
  dirs: Map<string, SSHFileEntry[]>;
  execHandler: (command: string) => ExecResult;
}

function createState(): FakeSshState {
  return {
    status: 'connected',
    execCalls: [],
    written: [],
    files: new Map(),
    dirs: new Map(),
    execHandler: (command: string) =>
      command.includes('"$HOME"')
        ? { stdout: '/home/deploy', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: '', exitCode: 0 },
  };
}

function createFakeManager(state: FakeSshState): SSHConnectionManager {
  const connection: SSHConnection = {
    id: CONNECTION_ID,
    name: 'box',
    host: 'h.example',
    port: 22,
    username: 'deploy',
    authType: 'password',
    status: state.status,
    createdAt: 1,
  };

  return {
    addConnection: () => undefined,
    getConnection: () => ({ ...connection, status: state.status }),
    listConnections: () => [{ ...connection, status: state.status }],
    connect: async () => {
      state.status = 'connected';
    },
    disconnect: async () => {
      state.status = 'disconnected';
    },
    execCommand: async (_id: string, command: string, options?: SSHExecOptions) => {
      state.execCalls.push({
        command,
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      });
      return state.execHandler(command);
    },
    readFile: async (_id: string, remotePath: string): Promise<SSHFilePreview> => {
      const content = state.files.get(remotePath);
      if (content === undefined) {
        const error: Error & { code?: number } = new Error(`No such file: ${remotePath}`);
        error.code = 2;
        throw error;
      }
      return { path: remotePath, content, encoding: 'utf8', truncated: false };
    },
    writeFile: async (_id: string, remotePath: string, content: string | Uint8Array) => {
      const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
      state.files.set(remotePath, text);
      state.written.push({ path: remotePath, content: text });
    },
    listFiles: async (_id: string, remotePath: string): Promise<SSHFileEntry[]> => {
      const entries = state.dirs.get(remotePath);
      if (!entries) {
        const error: Error & { code?: number } = new Error(`No such directory: ${remotePath}`);
        error.code = 2;
        throw error;
      }
      return entries;
    },
    getStatus: () => state.status,
  };
}

function buildService(state: FakeSshState): SshServiceModule.SshService {
  const service = new SshService({ manager: createFakeManager(state) });
  setSshService(service);
  return service;
}

beforeAll(async () => {
  ({ connectDb, migrate, closeDb, sqliteRun } = await import('../../infra/db.js'));
  ({ SshService, setSshService, __resetSshServiceForTests } =
    await import('../../ssh/ssh-service.js'));
  ({ __resetSshStoreForTests } = await import('../../ssh/ssh-store.js'));
  remoteExecution = await import('../../tools/ssh-remote-execution.js');
  await connectDb();
  await migrate();
  sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    TEST_USER,
    'ssh-remote@example.test',
    'x',
  ]);
});

beforeEach(() => {
  __resetSshStoreForTests();
});

afterEach(() => {
  __resetSshServiceForTests(null);
});

afterAll(async () => {
  await closeDb();
});

describe('classifySshRemoteToolPolicy', () => {
  it('classifies executable, blocked and unmanaged tools', () => {
    expect(remoteExecution.classifySshRemoteToolPolicy('bash')).toBe('remote');
    expect(remoteExecution.classifySshRemoteToolPolicy('edit')).toBe('remote');
    expect(remoteExecution.classifySshRemoteToolPolicy('apply_patch')).toBe('blocked');
    expect(remoteExecution.classifySshRemoteToolPolicy('lsp_rename')).toBe('blocked');
    expect(remoteExecution.classifySshRemoteToolPolicy('websearch')).toBe('unmanaged');
  });
});

describe('resolveRemotePath', () => {
  const context = { baseDir: '/home/deploy' };

  it('resolves absolute, relative and home-relative paths', () => {
    expect(remoteExecution.resolveRemotePath(context, '/var/www/app')).toBe('/var/www/app');
    expect(remoteExecution.resolveRemotePath(context, 'src/index.ts')).toBe(
      '/home/deploy/src/index.ts',
    );
    expect(remoteExecution.resolveRemotePath(context, '~')).toBe('/home/deploy');
    expect(remoteExecution.resolveRemotePath(context, '~/work/a.ts')).toBe(
      '/home/deploy/work/a.ts',
    );
    expect(remoteExecution.resolveRemotePath(context, './a/../b.ts')).toBe('/home/deploy/b.ts');
  });
});

describe('resolveSshRemoteExecutionContext', () => {
  it('returns unbound for sessions without any binding', async () => {
    buildService(createState());
    const resolution = await remoteExecution.resolveSshRemoteExecutionContext('session-free');
    expect(resolution.kind).toBe('unbound');
  });

  it('returns unavailable when the bound connection is not connected', async () => {
    const state = createState();
    state.status = 'disconnected';
    const service = buildService(state);
    service.getBindings().bind('session-1', CONNECTION_ID);

    const resolution = await remoteExecution.resolveSshRemoteExecutionContext('session-1');
    expect(resolution.kind).toBe('unavailable');
    if (resolution.kind === 'unavailable') {
      expect(resolution.reason).toBe('disconnected');
      expect(resolution.connectionId).toBe(CONNECTION_ID);
    }
  });

  it('resolves a ready context and caches the remote home lookup', async () => {
    const state = createState();
    const service = buildService(state);
    service.getBindings().bind('session-1', CONNECTION_ID);

    const first = await remoteExecution.resolveSshRemoteExecutionContext('session-1');
    expect(first.kind).toBe('ready');
    if (first.kind === 'ready') {
      expect(first.context.baseDir).toBe('/home/deploy');
      expect(first.context.host).toBe('h.example');
    }

    const second = await remoteExecution.resolveSshRemoteExecutionContext('session-1');
    expect(second.kind).toBe('ready');
    const homeLookups = state.execCalls.filter((call) => call.command.includes('"$HOME"'));
    expect(homeLookups).toHaveLength(1);
  });

  it('inherits the binding from a parent session through the parent chain', async () => {
    const state = createState();
    const service = buildService(state);
    sqliteRun('INSERT OR REPLACE INTO sessions (id, user_id, metadata_json) VALUES (?, ?, ?)', [
      'session-parent',
      TEST_USER,
      '{}',
    ]);
    sqliteRun('INSERT OR REPLACE INTO sessions (id, user_id, metadata_json) VALUES (?, ?, ?)', [
      'session-child',
      TEST_USER,
      JSON.stringify({ parentSessionId: 'session-parent' }),
    ]);
    service.getBindings().bind('session-parent', CONNECTION_ID);

    const resolution = await remoteExecution.resolveSshRemoteExecutionContext('session-child');
    expect(resolution.kind).toBe('ready');
    if (resolution.kind === 'ready') {
      expect(resolution.context.boundSessionId).toBe('session-parent');
    }
  });

  it('prefers the session remote working directory over the remote home', async () => {
    const state = createState();
    const service = buildService(state);
    service.getBindings().bind('session-remote-cwd', CONNECTION_ID);
    sqliteRun('INSERT OR REPLACE INTO sessions (id, user_id, metadata_json) VALUES (?, ?, ?)', [
      'session-remote-cwd',
      TEST_USER,
      JSON.stringify({ sshConnectionId: CONNECTION_ID, workingDirectory: '/srv/app' }),
    ]);

    const resolution = await remoteExecution.resolveSshRemoteExecutionContext('session-remote-cwd');
    expect(resolution.kind).toBe('ready');
    if (resolution.kind === 'ready') {
      expect(resolution.context.baseDir).toBe('/srv/app');
    }
    // 会话已指定远端工作目录时不再查询远端 home。
    const homeLookups = state.execCalls.filter((call) => call.command.includes('"$HOME"'));
    expect(homeLookups).toHaveLength(0);
  });
});

describe('executeSshRemoteTool', () => {
  async function buildReadyContext(): Promise<{
    state: FakeSshState;
    context: RemoteExecutionModule.SshRemoteExecutionContext;
  }> {
    const state = createState();
    const service = buildService(state);
    service.getBindings().bind('session-1', CONNECTION_ID);
    const resolution = await remoteExecution.resolveSshRemoteExecutionContext('session-1');
    if (resolution.kind !== 'ready') throw new Error('expected ready resolution');
    return { state, context: resolution.context };
  }

  it('returns null for tools outside the remote executable set', async () => {
    const { context } = await buildReadyContext();
    const result = await remoteExecution.executeSshRemoteTool({
      request: { toolCallId: 'c-1', toolName: 'websearch', rawInput: { query: 'x' } },
      sessionId: 'session-1',
      context,
    });
    expect(result).toBeNull();
  });

  it('executes bash remotely with cd + merged output and exit-code mapping', async () => {
    const { state, context } = await buildReadyContext();
    state.execHandler = (command) => {
      if (command.includes('"$HOME"')) return { stdout: '/home/deploy', stderr: '', exitCode: 0 };
      return { stdout: 'hello\n', stderr: 'warn\n', exitCode: 3 };
    };

    const result = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-bash',
        toolName: 'bash',
        rawInput: { command: 'echo hello', workdir: 'proj', description: 'echo hello' },
      },
      sessionId: 'session-1',
      context,
    });

    expect(result).not.toBeNull();
    const bashCall = state.execCalls.find((call) => call.command.includes('echo hello'));
    expect(bashCall?.command).toBe("cd '/home/deploy/proj' && echo hello");

    const output = result?.output as {
      cwd: string;
      exitCode: number;
      kind: string;
      output: string;
      truncated: boolean;
    };
    expect(output.cwd).toBe('/home/deploy/proj');
    expect(output.exitCode).toBe(3);
    expect(output.kind).toBe('exit');
    expect(output.output).toContain('hello');
    expect(output.output).toContain('warn');
    expect(output.output).toContain('[ssh] executed on deploy@h.example:22');
    expect(result?.isError).toBe(true);
  });

  it('reads a remote file with the shared line window', async () => {
    const { state, context } = await buildReadyContext();
    state.files.set('/home/deploy/app.ts', 'line1\nline2\nline3\n');

    const result = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-read',
        toolName: 'read',
        rawInput: { path: 'app.ts', offset: 2, limit: 1 },
      },
      sessionId: 'session-1',
      context,
    });

    const output = result?.output as {
      path: string;
      content: string;
      lineStart: number;
      lineEnd: number;
      totalLines: number;
    };
    expect(output.path).toBe('/home/deploy/app.ts');
    expect(output.content).toBe('line2');
    expect(output.lineStart).toBe(2);
    expect(output.lineEnd).toBe(2);
    expect(output.totalLines).toBe(4);
  });

  it('falls back to a directory listing when read targets a directory', async () => {
    const { state, context } = await buildReadyContext();
    state.dirs.set('/home/deploy/src', [
      { name: 'index.ts', path: '/home/deploy/src/index.ts', kind: 'file' },
      { name: 'nested', path: '/home/deploy/src/nested', kind: 'directory' },
    ]);

    const result = await remoteExecution.executeSshRemoteTool({
      request: { toolCallId: 'c-read-dir', toolName: 'read', rawInput: { path: 'src' } },
      sessionId: 'session-1',
      context,
    });

    const output = result?.output as { content: string };
    expect(output.content).toBe('dir nested\nfile index.ts');
  });

  it('writes a remote file and reports created/before state', async () => {
    const { state, context } = await buildReadyContext();

    const created = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-write-new',
        toolName: 'write',
        rawInput: { path: 'new.ts', content: 'export {};\n' },
      },
      sessionId: 'session-1',
      context,
    });
    const createdOutput = created?.output as {
      created: boolean;
      before: string;
      after: string;
      path: string;
      bytes: number;
    };
    expect(createdOutput.created).toBe(true);
    expect(createdOutput.before).toBe('');
    expect(createdOutput.path).toBe('/home/deploy/new.ts');
    expect(createdOutput.bytes).toBe(Buffer.byteLength('export {};\n', 'utf8'));
    expect(state.files.get('/home/deploy/new.ts')).toBe('export {};\n');

    state.files.set('/home/deploy/existing.ts', 'old\n');
    const overwritten = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-write-existing',
        toolName: 'write',
        rawInput: { path: 'existing.ts', content: 'new\n' },
      },
      sessionId: 'session-1',
      context,
    });
    const overwrittenOutput = overwritten?.output as { created: boolean; before: string };
    expect(overwrittenOutput.created).toBe(false);
    expect(overwrittenOutput.before).toBe('old\n');
  });

  it('requires read evidence before allowing a remote edit', async () => {
    const { state, context } = await buildReadyContext();
    state.files.set('/home/deploy/app.ts', 'const a = 1;\n');
    sqliteRun('INSERT OR REPLACE INTO sessions (id, user_id, metadata_json) VALUES (?, ?, ?)', [
      'session-1',
      TEST_USER,
      '{}',
    ]);

    const denied = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-edit-denied',
        toolName: 'edit',
        rawInput: { filePath: 'app.ts', oldString: 'const a = 1;', newString: 'const a = 2;' },
      },
      sessionId: 'session-1',
      context,
    });
    expect(denied?.isError).toBe(true);
    expect(String(denied?.output)).toContain('You must read file');

    sqliteRun(
      `INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [
        'session-1',
        'read',
        'req-read',
        JSON.stringify({ path: 'app.ts' }),
        JSON.stringify({ path: '/home/deploy/app.ts' }),
      ],
    );

    const applied = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-edit-applied',
        toolName: 'edit',
        rawInput: { filePath: 'app.ts', oldString: 'const a = 1;', newString: 'const a = 2;' },
      },
      sessionId: 'session-1',
      context,
    });
    expect(applied?.isError).toBe(false);
    expect(state.files.get('/home/deploy/app.ts')).toBe('const a = 2;\n');
    const appliedOutput = applied?.output as { replacements: number; path: string };
    expect(appliedOutput.replacements).toBe(1);
    expect(appliedOutput.path).toBe('/home/deploy/app.ts');
  });

  it('applies multiple sequential edits through multi_edit', async () => {
    const { state, context } = await buildReadyContext();
    state.files.set('/home/deploy/app.ts', 'one\ntwo\n');
    sqliteRun('INSERT OR REPLACE INTO sessions (id, user_id, metadata_json) VALUES (?, ?, ?)', [
      'session-1',
      TEST_USER,
      '{}',
    ]);
    sqliteRun(
      `INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [
        'session-1',
        'read',
        'req-read',
        JSON.stringify({ path: '/home/deploy/app.ts' }),
        JSON.stringify({ path: '/home/deploy/app.ts' }),
      ],
    );

    const result = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-multi-edit',
        toolName: 'multi_edit',
        rawInput: {
          filePath: '/home/deploy/app.ts',
          edits: [
            { oldString: 'one', newString: 'ONE' },
            { oldString: 'two', newString: 'TWO' },
          ],
        },
      },
      sessionId: 'session-1',
      context,
    });

    expect(result?.isError).toBe(false);
    expect(state.files.get('/home/deploy/app.ts')).toBe('ONE\nTWO\n');
    const output = result?.output as { editsApplied: number };
    expect(output.editsApplied).toBe(2);
  });

  it('runs glob remotely and matches with the shared pattern semantics', async () => {
    const { state, context } = await buildReadyContext();
    state.execHandler = (command) => {
      if (command.includes('"$HOME"')) return { stdout: '/home/deploy', stderr: '', exitCode: 0 };
      return { stdout: './a.ts\n./b.js\n./nested/c.ts\n', stderr: '', exitCode: 0 };
    };

    const result = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-glob',
        toolName: 'glob',
        rawInput: { path: 'src', pattern: '**/*.ts' },
      },
      sessionId: 'session-1',
      context,
    });

    const lines = String(result?.output).split('\n');
    expect(lines).toEqual(['/home/deploy/src/a.ts', '/home/deploy/src/nested/c.ts']);
  });

  it('runs grep remotely and parses content matches', async () => {
    const { state, context } = await buildReadyContext();
    state.execHandler = (command) => {
      if (command.includes('"$HOME"')) return { stdout: '/home/deploy', stderr: '', exitCode: 0 };
      expect(command).toContain('grep');
      expect(command).toContain('-n');
      return {
        stdout: './a.ts:3:TODO fix\n./b.ts:7:TODO later\n',
        stderr: '',
        exitCode: 0,
      };
    };

    const result = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-grep',
        toolName: 'grep',
        rawInput: { pattern: 'TODO', path: 'src', output_mode: 'content' },
      },
      sessionId: 'session-1',
      context,
    });

    expect(String(result?.output)).toBe(
      '/home/deploy/src/a.ts:3: TODO fix\n/home/deploy/src/b.ts:7: TODO later',
    );
  });

  it('returns a clear message when grep fails on the remote', async () => {
    const { state, context } = await buildReadyContext();
    state.execHandler = () => ({
      stdout: '',
      stderr: 'grep: Invalid regular expression',
      exitCode: 2,
    });

    const result = await remoteExecution.executeSshRemoteTool({
      request: {
        toolCallId: 'c-grep-fail',
        toolName: 'grep',
        rawInput: { pattern: '([', output_mode: 'content' },
      },
      sessionId: 'session-1',
      context,
    });

    expect(result?.isError).toBe(true);
    expect(String(result?.output)).toContain('Invalid regular expression');
  });
});

describe('SSH rejection messages', () => {
  it('formats blocked-tool and unavailable-connection messages', () => {
    const blocked = remoteExecution.formatSshBlockedToolMessage('apply_patch', {
      kind: 'ready',
      context: {
        sessionId: 'session-1',
        boundSessionId: 'session-1',
        connectionId: CONNECTION_ID,
        host: 'h.example',
        username: 'deploy',
        port: 22,
        baseDir: '/home/deploy',
        proxy: {
          execCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
          readFile: async () => ({ path: '/x', content: '', encoding: 'utf8', truncated: false }),
          writeFile: async () => undefined,
          listFiles: async () => [],
        },
      },
    });
    expect(blocked).toContain('apply_patch');
    expect(blocked).toContain('deploy@h.example:22');

    const unavailable = remoteExecution.formatSshUnavailableToolMessage('bash', {
      kind: 'unavailable',
      boundSessionId: 'session-1',
      connectionId: CONNECTION_ID,
      hostLabel: 'deploy@h.example:22',
      reason: 'disconnected',
    });
    expect(unavailable).toContain('bash');
    expect(unavailable).toContain('未连接');
  });
});
