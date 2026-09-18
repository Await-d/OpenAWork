/**
 * T-08 — interactive terminal capability matrix against a real PTY, plus the
 * T-10 Node pipe-degradation probe.
 *
 * This script drives the production persistent-terminal API directly
 * (`spawnPersistentTerminal` / `writeStdinToTerminal` / `resizeTerminal` /
 * `closePersistentTerminal`) with source imports, an in-memory SQLite DB and a
 * throwaway data dir under the OS temp folder. Nothing here is mocked: every
 * assertion is derived from bytes a real child process produced.
 *
 * Runtime split mirrors `pty-backend.detectTerminalBackend()`:
 *   - Bun on non-Windows → real PTY; the interactive matrix runs for real.
 *   - Node (or Bun on Windows) → pipe fallback; PTY-only assertions are
 *     reported as SKIP with the reason from the capability probe, while the
 *     pipe path (output, stdin, resize no-op, seq monotonicity) is exercised.
 *
 * Run:
 *   cd services/agent-gateway && bun src/verification/verify-terminal-pty-interactive.ts
 *   cd services/agent-gateway && pnpm exec tsx src/verification/verify-terminal-pty-interactive.ts
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunEvent, StreamTerminalOutputChunk } from '@openAwork/shared';
import type * as DbModule from '../infra/db.js';
import type * as PersistentModule from '../session/persistent-terminals.js';
import type { TerminalBackendCapabilities } from '../session/pty-backend.js';
import type * as RegistryModule from '../session/session-terminal-registry.js';
import type * as RunEventsModule from '../session/session-run-events.js';

const tempDataDir = mkdtempSync(join(tmpdir(), 'openawork-pty-matrix-'));
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_DATA_DIR'] = tempDataDir;
delete process.env['OPENAWORK_DATABASE_PATH'];
if (!process.env['OPENAWORK_APP_VERSION']) {
  process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
}

type DbApi = typeof DbModule;
type RegistryApi = typeof RegistryModule;
type RunEventsApi = typeof RunEventsModule;
type PersistentApi = typeof PersistentModule;

const SESSION_ID = 'session-pty-matrix';
const USER_ID = 'user-pty-matrix';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type MatrixStatus = 'PASS' | 'FAIL' | 'SKIP';

interface MatrixEntry {
  id: string;
  item: string;
  status: MatrixStatus;
  note: string;
  evidence: string;
}

interface MatrixCase {
  id: string;
  item: string;
  run: () => Promise<{ note: string; evidence: string } | null>;
  skipReason?: () => string | null;
}

function fail(message: string): never {
  throw new Error(message);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function snippet(text: string, max = 420): string {
  const clipped = text.length > max ? `…${text.slice(text.length - max)}` : text;
  return JSON.stringify(clipped);
}

function which(tool: string): string {
  const result = spawnSync('which', [tool], { encoding: 'utf-8' });
  const stdout = (result.stdout ?? '').trim();
  return stdout.length > 0 ? stdout : '';
}

// ---------------------------------------------------------------------------
// Driver — wraps a real persistent terminal plus its run-event stream.
// ---------------------------------------------------------------------------

interface DriverDeps {
  db: DbApi;
  registry: RegistryApi;
  runEvents: RunEventsApi;
  persistent: PersistentApi;
}

interface Driver {
  readonly terminalId: string;
  readonly backend: string;
  readonly events: StreamTerminalOutputChunk[];
  readonly output: () => string;
  send(data: string): void;
  resize(cols: number, rows: number): boolean;
  mark(): number;
  since(mark: number): string;
  waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void>;
  waitForText(needle: string, from: number, timeoutMs: number, label: string): Promise<void>;
  close(): void;
}

function createDriver(deps: DriverDeps, cwd: string): Driver {
  const events: StreamTerminalOutputChunk[] = [];
  let output = '';
  let terminalId = '';
  let closed = false;

  const unsubscribe = deps.runEvents.subscribeSessionRunEvents(SESSION_ID, (event: RunEvent) => {
    if (event.type !== 'terminal_output') return;
    if (terminalId === '' || event.terminalId !== terminalId) return;
    events.push(event);
    output += event.data ?? '';
  });

  const spawned = deps.persistent.spawnPersistentTerminal({
    sessionId: SESSION_ID,
    userId: USER_ID,
    cwd,
    source: 'user',
    description: 'T-08 pty matrix driver',
  });
  terminalId = spawned.terminal.terminalId;

  const backendValue = spawned.terminal.metadata['backend'];
  const driver: Driver = {
    terminalId,
    backend: typeof backendValue === 'string' ? backendValue : 'unknown',
    events,
    output: () => output,
    send(data) {
      const result = deps.persistent.writeStdinToTerminal(terminalId, data);
      if (!result.ok) fail(`writeStdinToTerminal failed: ${result.error ?? 'unknown'}`);
    },
    resize(cols, rows) {
      const result = deps.persistent.resizeTerminal({ terminalId, cols, rows });
      expect(result.ok === true, 'resizeTerminal should report ok for a live terminal');
      return result.ok;
    },
    mark: () => output.length,
    since: (mark) => output.slice(mark),
    async waitFor(predicate, timeoutMs, label) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await sleep(50);
      }
      fail(`timeout waiting for ${label}`);
    },
    async waitForText(needle, from, timeoutMs, label) {
      await driver.waitFor(() => output.indexOf(needle, from) !== -1, timeoutMs, label);
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      deps.persistent.closePersistentTerminal(terminalId);
    },
  };
  return driver;
}

// ---------------------------------------------------------------------------
// Matrix cases
// ---------------------------------------------------------------------------

interface RunnerState {
  deps: DriverDeps;
  capabilities: TerminalBackendCapabilities;
  tempDir: string;
}

function ptySkipReason(state: RunnerState): string | null {
  if (state.capabilities.kind === 'pty') return null;
  return `PTY-only assertion skipped under ${state.capabilities.runtime}: ${
    state.capabilities.reason ?? 'no PTY'
  }`;
}

function missingToolReason(tool: string): string | null {
  return which(tool).length > 0 ? null : `'${tool}' 未安装 (which ${tool} 无输出)`;
}

async function caseIsatty(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send("test -t 0 && printf 'ISATTY_%s\\n' TRUE || printf 'ISATTY_%s\\n' FALSE\r");
    await driver.waitFor(
      () => {
        const segment = driver.since(mark);
        return segment.includes('ISATTY_TRUE') || segment.includes('ISATTY_FALSE');
      },
      5_000,
      'isatty result output',
    );
    const segment = driver.since(mark);
    expect(segment.includes('ISATTY_TRUE'), 'stdin of the persistent shell should be a tty');
    expect(!segment.includes('ISATTY_FALSE'), 'isatty(0) must not be false');
    return { note: 'test -t 0 -> ISATTY_TRUE', evidence: snippet(segment) };
  } finally {
    driver.close();
  }
}

async function caseResizeSigwinch(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('trap "printf \'WINCH_%s\\n\' TRAP_FIRED" WINCH\r');
    driver.send("printf 'TRAP_%s\\n' READY\r");
    await driver.waitForText('TRAP_READY', mark, 5_000, 'trap ready');

    driver.resize(100, 30);
    driver.send('printf \'GEOM_%s_%s\\n\' "$(tput cols)" "$(tput lines)"\r');
    driver.send('printf \'STTYOUT_%s\\n\' "$(stty size)"\r');
    await driver.waitFor(
      () => {
        const segment = driver.since(mark);
        return segment.includes('GEOM_100_30') && segment.includes('STTYOUT_30 100');
      },
      5_000,
      'geometry output',
    );
    const segment = driver.since(mark);
    expect(segment.includes('GEOM_100_30'), `tput should report 100x30, got: ${snippet(segment)}`);
    expect(
      segment.includes('STTYOUT_30 100'),
      `stty size should report "30 100", got: ${snippet(segment)}`,
    );

    const mark2 = driver.mark();
    driver.resize(42, 13);
    await driver.waitForText('WINCH_TRAP_FIRED', mark2, 5_000, 'SIGWINCH trap');
    const winchSegment = driver.since(mark2);
    expect(winchSegment.includes('WINCH_TRAP_FIRED'), 'resize must deliver SIGWINCH to the shell');
    return {
      note: 'resize(100x30) -> tput/stty reflect it; resize(42x13) fires WINCH trap',
      evidence: `${snippet(segment)} | winch=${snippet(winchSegment, 80)}`,
    };
  } finally {
    driver.close();
  }
}

async function caseCtrlC(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('sleep 30\r');
    await sleep(400);
    driver.send('\x03');
    await sleep(250);
    driver.send("printf 'AFTER_%s\\n' SIGINT\r");
    await driver.waitForText('AFTER_SIGINT', mark, 5_000, 'shell survival after Ctrl+C');
    driver.send('jobs\r');
    await sleep(300);
    const segment = driver.since(mark);
    expect(segment.includes('^C'), `Ctrl+C should echo ^C, got: ${snippet(segment)}`);
    expect(segment.includes('AFTER_SIGINT'), 'shell must survive Ctrl+C and accept new input');
    const jobsTail = segment.slice(segment.lastIndexOf('jobs'));
    expect(
      !jobsTail.includes('sleep 30') || !jobsTail.includes('Running'),
      `interrupted sleep must not remain a running job, got: ${snippet(jobsTail)}`,
    );
    return {
      note: 'sleep 30 + \\x03 -> ^C, prompt returns, echo works, no running job',
      evidence: snippet(segment),
    };
  } finally {
    driver.close();
  }
}

async function caseBackgroundJobs(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('sleep 20 &\r');
    await driver.waitFor(() => driver.since(mark).includes('[1] '), 5_000, 'background job banner');
    driver.send('jobs\r');
    await driver.waitForText('Running', mark, 5_000, 'jobs output');
    const jobsSegment = driver.since(mark);
    expect(
      jobsSegment.includes('Running') && jobsSegment.includes('sleep 20'),
      `jobs should list the background job, got: ${snippet(jobsSegment)}`,
    );

    const mark2 = driver.mark();
    driver.send('kill %1\r');
    await sleep(400);
    driver.send('jobs\r');
    await sleep(300);
    const afterKill = driver.since(mark2);
    expect(
      afterKill.includes('Terminated') || !afterKill.includes('Running'),
      `kill %1 should clear the job, got: ${snippet(afterKill)}`,
    );
    return {
      note: 'sleep 20 & -> jobs shows Running -> kill %1 cleans up',
      evidence: `jobs=${snippet(jobsSegment, 160)} | afterKill=${snippet(afterKill, 200)}`,
    };
  } finally {
    driver.close();
  }
}

async function caseCtrlZForeground(
  state: RunnerState,
): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('sleep 20\r');
    await sleep(400);
    driver.send('\x1a');
    await driver.waitForText('Stopped', mark, 5_000, 'Ctrl+Z stopped job');
    driver.send('jobs\r');
    await driver.waitForText('Stopped', mark, 5_000, 'jobs after Ctrl+Z');
    const stoppedSegment = driver.since(mark);
    expect(
      stoppedSegment.includes('Stopped') && stoppedSegment.includes('sleep 20'),
      `Ctrl+Z should stop the foreground job, got: ${snippet(stoppedSegment)}`,
    );

    driver.send('fg\r');
    await sleep(500);
    driver.send('\x03');
    await sleep(250);
    const mark2 = driver.mark();
    driver.send('echo AFTER_FG\r');
    await driver.waitForText('AFTER_FG', mark2, 5_000, 'prompt after fg + Ctrl+C');
    expect(driver.since(mark2).includes('AFTER_FG'), 'fg should resume the job and Ctrl+C end it');
    return {
      note: 'sleep 20 + \\x1a -> Stopped; jobs lists it; fg resumes; \\x03 ends it',
      evidence: snippet(stoppedSegment),
    };
  } finally {
    driver.close();
  }
}

async function caseLess(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const lessFile = join(state.tempDir, 'less-matrix.txt');
    writeFileSync(
      lessFile,
      Array.from({ length: 80 }, (_, index) => `less-matrix line ${index + 1}`).join('\n') + '\n',
    );
    const mark = driver.mark();
    driver.send(`less ${lessFile}\r`);
    await driver.waitForText('\x1b[?1049h', mark, 5_000, 'less alternate screen');
    const segment = driver.since(mark);
    expect(
      segment.includes('\x1b[?1049h') || segment.includes('\x1b[7m'),
      `less should enter alt-screen or reverse video, got: ${snippet(segment)}`,
    );
    driver.send('q');
    await sleep(300);
    const mark2 = driver.mark();
    driver.send('echo LESS_DONE\r');
    await driver.waitForText('LESS_DONE', mark2, 5_000, 'prompt after less quit');
    return {
      note: 'less enters alt-screen (\\x1b[?1049h), q returns to prompt',
      evidence: snippet(segment, 240),
    };
  } finally {
    driver.close();
  }
}

async function caseTop(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('top\r');
    await sleep(1_500);
    const segment = driver.since(mark);
    expect(
      segment.includes('\x1b[H') || segment.includes('\x1b[2J') || segment.includes('\x1b[?25l'),
      `top should emit ANSI repaint sequences, got: ${snippet(segment)}`,
    );
    driver.send('q');
    await sleep(400);
    const mark2 = driver.mark();
    driver.send('echo TOP_DONE\r');
    await driver.waitForText('TOP_DONE', mark2, 5_000, 'prompt after top quit');
    return {
      note: 'top repaints with ANSI (\\x1b[H / \\x1b[2J), q returns to prompt',
      evidence: snippet(segment, 240),
    };
  } finally {
    driver.close();
  }
}

async function casePythonRepl(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('python3 -i\r');
    await driver.waitForText('>>>', mark, 8_000, 'python prompt');
    driver.send('print(1+1)\r');
    await sleep(600);
    driver.send('exit()\r');
    const segment = driver.since(mark);
    expect(segment.includes('>>>'), 'python REPL should show the >>> prompt');
    expect(/\n2\r?\n/.test(segment) || segment.includes('\r\n2\r\n'), 'python should print 2');
    return { note: 'python3 -i REPL prints 2 and keeps >>>', evidence: snippet(segment, 320) };
  } finally {
    driver.close();
  }
}

async function caseUnicode(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('echo 中文测试\r');
    await driver.waitForText('中文测试', mark, 5_000, 'utf-8 echo');
    const echoSegment = driver.since(mark);
    expect(echoSegment.includes('中文测试'), 'echo should round-trip CJK text');
    expect(!echoSegment.includes('\uFFFD'), 'CJK echo must not contain U+FFFD');

    const mark2 = driver.mark();
    driver.send(`python3 -c "print('中'*20000)"\r`);
    await driver.waitFor(
      () => driver.since(mark2).includes('中'.repeat(20_000)),
      15_000,
      'large CJK output across chunk boundaries',
    );
    const bigSegment = driver.since(mark2);
    expect(
      bigSegment.includes('中'.repeat(20_000)),
      '20000 CJK chars must survive chunk boundaries',
    );
    expect(!bigSegment.includes('\uFFFD'), 'large CJK output must not contain U+FFFD');
    return {
      note: 'echo CJK + 20000×中 via python: no U+FFFD (StringDecoder carry verified)',
      evidence: `echo=${snippet(echoSegment, 120)} | bigRunPresent=${bigSegment.includes(
        '中'.repeat(20_000),
      )} bigBytes=${Buffer.byteLength(bigSegment, 'utf-8')}`,
    };
  } finally {
    driver.close();
  }
}

async function caseThrottleSeq(state: RunnerState): Promise<{ note: string; evidence: string }> {
  const driver = createDriver(state.deps, state.tempDir);
  try {
    const eventsMark = driver.events.length;
    const outputMark = driver.mark();
    driver.send(`for i in $(seq 1 25); do printf 'CHUNK-%s\\n' "$i"; done\r`);
    await driver.waitForText('CHUNK-25', outputMark, 8_000, 'chunk loop output');
    await sleep(300);

    const events = driver.events.slice(eventsMark);
    expect(events.length > 0, 'expected terminal_output events');
    let previousSeq = -1;
    for (const event of events) {
      expect(typeof event.seq === 'number', 'terminal_output must carry numeric seq');
      expect(typeof event.data === 'string', 'terminal_output must carry string data');
      expect(typeof event.outputTail === 'string', 'terminal_output must carry outputTail');
      expect(
        typeof event.outputBytesTotal === 'number',
        'terminal_output must carry outputBytesTotal',
      );
      expect(event.seq > previousSeq, `seq must be strictly increasing, got ${event.seq}`);
      previousSeq = event.seq;
    }

    const mergedEvents = events.filter(
      (event) => countOccurrences(event.data ?? '', 'CHUNK-') >= 2,
    );
    expect(
      mergedEvents.length > 0,
      '100ms throttle should merge several small deltas into one event (no drops)',
    );

    const allData = driver.events.map((event) => event.data ?? '').join('');
    const snapshot = state.deps.registry.getTerminalOutputSnapshot(driver.terminalId);
    expect(snapshot !== null, 'snapshot should exist for a live terminal');
    expect(allData === snapshot.data, 'concatenated incremental data must equal the ring snapshot');
    const last = events[events.length - 1]!;
    expect(last.seq === snapshot.seq, 'last event seq must equal snapshot seq');
    expect(last.outputBytesTotal === last.seq, 'last outputBytesTotal must equal seq');
    expect(
      snapshot.data.endsWith(last.outputTail),
      'outputTail must be a suffix of the ring snapshot',
    );
    return {
      note: `events=${events.length} merged=${mergedEvents.length} seq ${events[0]?.seq}→${last.seq}, concat===snapshot`,
      evidence: `mergedData=${snippet(mergedEvents[0]?.data ?? '', 160)} | tail=${snippet(
        last.outputTail,
        80,
      )}`,
    };
  } finally {
    driver.close();
  }
}

// ---------------------------------------------------------------------------
// Node pipe-degradation probe (T-10)
// ---------------------------------------------------------------------------

async function casePipeDegradation(
  state: RunnerState,
): Promise<{ note: string; evidence: string }> {
  const capabilities = state.capabilities;
  expect(
    capabilities.kind === 'pipe',
    `pipe probe expected kind=pipe but got ${capabilities.kind}`,
  );
  expect(
    typeof capabilities.reason === 'string' && capabilities.reason.length > 0,
    'pipe fallback must carry a non-empty reason',
  );
  expect(capabilities.supportsResize === false, 'pipe fallback must not claim resize support');

  const driver = createDriver(state.deps, state.tempDir);
  try {
    const mark = driver.mark();
    driver.send('echo PIPE_PATH_OK\r');
    await driver.waitForText('PIPE_PATH_OK', mark, 8_000, 'pipe output');

    const resizeResult = state.deps.persistent.resizeTerminal({
      terminalId: driver.terminalId,
      cols: 120,
      rows: 40,
    });
    expect(resizeResult.ok === true, 'resizeTerminal must return { ok: true } on the pipe path');

    const eventsMark = driver.events.length;
    driver.send('echo PIPE_SEQ_ONE\r');
    await driver.waitForText('PIPE_SEQ_ONE', driver.mark(), 8_000, 'pipe seq output');
    await sleep(300);
    const events = driver.events.slice(eventsMark);
    expect(events.length > 0, 'pipe path must still emit terminal_output events');
    let previousSeq = -1;
    for (const event of events) {
      expect(typeof event.seq === 'number', 'pipe terminal_output must carry seq');
      expect(typeof event.data === 'string', 'pipe terminal_output must carry data');
      expect(event.seq > previousSeq, 'pipe seq must be strictly increasing');
      previousSeq = event.seq;
    }
    const allData = driver.events.map((event) => event.data ?? '').join('');
    const snapshot = state.deps.registry.getTerminalOutputSnapshot(driver.terminalId);
    expect(snapshot !== null, 'pipe snapshot should exist');
    expect(allData === snapshot.data, 'pipe incremental data must equal ring snapshot');
    return {
      note: `kind=pipe reason="${capabilities.reason}" resize=ok output+seq ok`,
      evidence: `output=${snippet(driver.since(mark), 200)} | seq ${events[0]?.seq}→${
        events[events.length - 1]?.seq
      }`,
    };
  } finally {
    driver.close();
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function seed(db: DbApi): Promise<void> {
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'pty-matrix@openawork.local',
  ]);
  db.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'pty-matrix')", [
    SESSION_ID,
    USER_ID,
  ]);
}

function formatEntry(entry: MatrixEntry, index: number): string {
  const tag = `[${entry.status}]`;
  const line = `${tag} ${entry.id} ${entry.item}`;
  const note = entry.note.length > 0 ? `\n    note: ${entry.note}` : '';
  const evidence = entry.evidence.length > 0 ? `\n    evidence: ${entry.evidence}` : '';
  return `${index + 1}. ${line}${note}${evidence}`;
}

async function main(): Promise<void> {
  const db = await import('../infra/db.js');
  const registry = await import('../session/session-terminal-registry.js');
  const runEvents = await import('../session/session-run-events.js');
  const persistent = await import('../session/persistent-terminals.js');
  const ptyBackend = await import('../session/pty-backend.js');

  const capabilities = ptyBackend.detectTerminalBackend();
  const deps: DriverDeps = { db, registry, runEvents, persistent };
  const state: RunnerState = { deps, capabilities, tempDir: tempDataDir };

  console.log('=== T-08/T-10 终端 PTY 能力矩阵 ===');
  console.log(
    `runtime=${capabilities.runtime} platform=${capabilities.platform} kind=${capabilities.kind} ` +
      `supportsResize=${capabilities.supportsResize} reason=${capabilities.reason ?? '(none)'}`,
  );
  for (const tool of ['vim', 'less', 'top', 'htop', 'python3', 'bash', 'tput', 'stty']) {
    const path = which(tool);
    console.log(`which ${tool} -> ${path.length > 0 ? path : 'NOT FOUND'}`);
  }

  await db.connectDb();
  await db.migrate();
  await seed(db);

  const cases: MatrixCase[] = [
    {
      id: 'P1',
      item: 'isatty(0) 为真 (test -t 0)',
      run: () => caseIsatty(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'P2',
      item: 'SIGWINCH / resize 生效 (tput/stty/trap)',
      run: () => caseResizeSigwinch(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'P3',
      item: 'Ctrl+C 产生 SIGINT 且 shell 存活',
      run: () => caseCtrlC(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'P4',
      item: '作业控制: sleep 20 & / jobs / kill %1',
      run: () => caseBackgroundJobs(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'P5',
      item: '作业控制: Ctrl+Z / jobs / fg',
      run: () => caseCtrlZForeground(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'P6',
      item: '交互式程序: less 全屏 + q 退出',
      run: () => caseLess(state),
      skipReason: () => ptySkipReason(state) ?? missingToolReason('less'),
    },
    {
      id: 'P7',
      item: '交互式程序: top 重绘 + q 退出 (≤3s)',
      run: () => caseTop(state),
      skipReason: () => ptySkipReason(state) ?? missingToolReason('top'),
    },
    {
      id: 'P8',
      item: '交互式程序: vim 备用屏',
      run: async (): Promise<{ note: string; evidence: string } | null> => {
        throw new Error('vim 未安装，无法执行');
      },
      skipReason: () => ptySkipReason(state) ?? missingToolReason('vim'),
    },
    {
      id: 'P9',
      item: '交互式程序: htop',
      run: async (): Promise<{ note: string; evidence: string } | null> => {
        throw new Error('htop 未安装，无法执行');
      },
      skipReason: () => ptySkipReason(state) ?? missingToolReason('htop'),
    },
    {
      id: 'P10',
      item: 'Python REPL: print(1+1) -> 2 / >>>',
      run: () => casePythonRepl(state),
      skipReason: () => ptySkipReason(state) ?? missingToolReason('python3'),
    },
    {
      id: 'P11',
      item: '中文宽字符 + 跨 chunk carry (无 U+FFFD)',
      run: () => caseUnicode(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'P12',
      item: '节流与 seq (订阅 terminal_output)',
      run: () => caseThrottleSeq(state),
      skipReason: () => ptySkipReason(state),
    },
    {
      id: 'N1',
      item: 'Node/pipe 降级回归 (T-10)',
      run: () => casePipeDegradation(state),
      skipReason: () =>
        state.capabilities.kind === 'pipe'
          ? null
          : `T-10 pipe 回归仅在 Node/pipe 运行时执行；当前 runtime=${state.capabilities.runtime} kind=pty`,
    },
  ];

  const entries: MatrixEntry[] = [];
  for (const testCase of cases) {
    const reason = testCase.skipReason?.() ?? null;
    if (reason) {
      entries.push({
        id: testCase.id,
        item: testCase.item,
        status: 'SKIP',
        note: reason,
        evidence: '',
      });
      continue;
    }
    try {
      const result = await testCase.run();
      if (result === null) {
        entries.push({
          id: testCase.id,
          item: testCase.item,
          status: 'SKIP',
          note: 'no result',
          evidence: '',
        });
      } else {
        entries.push({
          id: testCase.id,
          item: testCase.item,
          status: 'PASS',
          note: result.note,
          evidence: result.evidence,
        });
      }
    } catch (error) {
      entries.push({
        id: testCase.id,
        item: testCase.item,
        status: 'FAIL',
        note: error instanceof Error ? error.message : String(error),
        evidence: '',
      });
    }
  }

  console.log('');
  entries.forEach((entry, index) => console.log(formatEntry(entry, index)));
  const passed = entries.filter((entry) => entry.status === 'PASS').length;
  const failed = entries.filter((entry) => entry.status === 'FAIL').length;
  const skipped = entries.filter((entry) => entry.status === 'SKIP').length;
  console.log('');
  console.log(
    `=== 汇总: PASS=${passed} FAIL=${failed} SKIP=${skipped} TOTAL=${entries.length} ===`,
  );
  if (failed > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  try {
    const persistent = await import('../session/persistent-terminals.js');
    persistent.__resetPersistentTerminalsForTest();
  } catch {
    /* module load failure during teardown is non-fatal */
  }
  try {
    const db = await import('../infra/db.js');
    await db.closeDb();
  } catch {
    /* db never opened */
  }
  rmSync(tempDataDir, { force: true, recursive: true });
}

try {
  await main();
} catch (error) {
  console.error('verify-terminal-pty-interactive: failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
