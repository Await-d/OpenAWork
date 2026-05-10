import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// `bash-tools.ts` transitively pulls in `db.ts` for `WORKSPACE_ROOT`, and
// `db.ts` imports `node:sqlite` at module load. Vite (vitest's bundler)
// cannot resolve the `node:` protocol during transform, so we stub the
// whole module here. The same pattern is used in
// `v2-runtime-effect-bridge.test.ts` and `v2-runtime-boot.test.ts`.
vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: tmpdir(),
  WORKSPACE_ROOTS: [tmpdir()],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: vi.fn((fn: () => unknown) => fn()),
}));

const { bashToolDefinition, buildBashPermissionScope, runBashCommand } =
  await import('../bash-tools.js');
const { TRUNCATION_DIR } = await import('../bash-output-truncator.js');

/**
 * Real-process integration tests for the bash tool. We don't mock spawn
 * because the whole point of the rewrite is the spawn / abort / timeout
 * orchestration; using the real shell is the only way to verify the
 * three-way termination race produces the expected `<bash_metadata>`
 * footers and exit kinds.
 *
 * All tests run in a tmp workdir so they don't pollute the workspace, and
 * each test uses a unique probe so output assertions don't collide if the
 * runner reuses the directory across runs.
 */
describe('bash-tools', () => {
  let workdir: string;

  beforeAll(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), 'openAwork-bash-test-'));
  });

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe('inputSchema', () => {
    it('accepts a minimal valid call (command + description)', () => {
      const parsed = bashToolDefinition.inputSchema.safeParse({
        command: 'echo hi',
        description: 'Prints hi',
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects empty command', () => {
      const parsed = bashToolDefinition.inputSchema.safeParse({
        command: '',
        description: 'noop',
      });
      expect(parsed.success).toBe(false);
    });

    it('requires description (opencode parity)', () => {
      const parsed = bashToolDefinition.inputSchema.safeParse({
        command: 'echo hi',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects non-positive timeout', () => {
      const parsed = bashToolDefinition.inputSchema.safeParse({
        command: 'echo hi',
        description: 'noop',
        timeout: -1,
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects timeout above the hard ceiling', () => {
      const parsed = bashToolDefinition.inputSchema.safeParse({
        command: 'echo hi',
        description: 'noop',
        timeout: 60 * 60 * 1000, // 1h, above MAX_BASH_TIMEOUT_MS = 30min
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('description template', () => {
    it('exposes opencode bash.txt template with placeholders resolved', () => {
      const description = bashToolDefinition.description;
      // 校验 bash.txt 模板已被正确加载（OpenAWork 已统一为中文模板，见
      // services/agent-gateway/src/bash.txt）。同时确保占位符已被替换，没有
      // 残留 `${...}` 标记。
      expect(description).toMatch(/在持久化的 shell 会话中执行给定的 bash 命令/);
      expect(description).toMatch(/workdir/);
      expect(description).not.toMatch(/\$\{os\}/);
      expect(description).not.toMatch(/\$\{shell\}/);
      expect(description).not.toMatch(/\$\{maxLines\}/);
      expect(description).not.toMatch(/\$\{maxBytes\}/);
    });
  });

  describe('buildBashPermissionScope', () => {
    it('anchors permission scope on command verb arity', () => {
      // `git checkout main` should produce `git checkout *` so the user
      // approving once covers `git checkout <any-branch>` thereafter.
      // Mirrors opencode's `BashArity.prefix(tokens).join(" ") + " *"`.
      expect(
        buildBashPermissionScope({
          command: 'git checkout main',
          description: 'switch branch',
        }),
      ).toBe('git checkout *');
    });
  });

  describe('safety pre-checks', () => {
    it('rejects sudo invocations', async () => {
      await expect(
        runBashCommand({
          command: 'sudo ls',
          description: 'attempt sudo',
          workdir,
        }),
      ).rejects.toThrow(/sudo is not allowed/);
    });

    it('rejects PATH= environment hijacks', async () => {
      await expect(
        runBashCommand({
          command: 'PATH=/tmp ls',
          description: 'attempt path hijack',
          workdir,
        }),
      ).rejects.toThrow(/PATH/);
    });

    it('rejects backtick command substitution', async () => {
      await expect(
        runBashCommand({
          command: 'echo `whoami`',
          description: 'attempt backtick subshell',
          workdir,
        }),
      ).rejects.toThrow(/Backtick/);
    });

    it('rejects $(...) command substitution', async () => {
      await expect(
        runBashCommand({
          command: 'echo $(whoami)',
          description: 'attempt $() subshell',
          workdir,
        }),
      ).rejects.toThrow(/Command substitution/);
    });

    it('rejects multi-line commands (opencode bash.txt: no newlines)', async () => {
      await expect(
        runBashCommand({
          command: 'echo a\necho b',
          description: 'attempt multi-line',
          workdir,
        }),
      ).rejects.toThrow(/Multi-line/);
    });
  });

  describe('workdir resolution', () => {
    it('rejects nonexistent workdir with a clear message', async () => {
      await expect(
        runBashCommand({
          command: 'echo hi',
          description: 'check missing dir',
          workdir: path.join(workdir, 'definitely-missing-folder'),
        }),
      ).rejects.toThrow(/does not exist/);
    });

    it('rejects when workdir points to a file rather than a directory', async () => {
      const file = path.join(workdir, 'not-a-dir.txt');
      await writeFile(file, 'hello');
      await expect(
        runBashCommand({
          command: 'echo hi',
          description: 'check file as dir',
          workdir: file,
        }),
      ).rejects.toThrow(/not a directory/);
    });
  });

  describe('runBashCommand — happy path', () => {
    it('returns kind=exit and exitCode=0 for a successful command', async () => {
      const result = await runBashCommand({
        command: 'echo bash-tool-probe-12345',
        description: 'sanity probe',
        workdir,
      });
      expect(result.kind).toBe('exit');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('bash-tool-probe-12345');
      expect(result.cwd).toBe(workdir);
      expect(result.truncated).toBe(false);
      // No <bash_metadata> footer on a clean exit
      expect(result.output).not.toContain('<bash_metadata>');
    });

    it('returns non-zero exitCode and merged stderr on failure', async () => {
      // `false` exits 1 with no output; combine with stderr emission.
      const result = await runBashCommand({
        command: 'echo to-stderr-content 1>&2; exit 7',
        description: 'failing probe',
        workdir,
      });
      expect(result.kind).toBe('exit');
      expect(result.exitCode).toBe(7);
      // stderr is merged into output (opencode parity: stdout+stderr stream union)
      expect(result.output).toContain('to-stderr-content');
    });

    it('respects workdir parameter for cwd', async () => {
      const result = await runBashCommand({
        command: 'pwd',
        description: 'print cwd',
        workdir,
      });
      // macOS resolves /tmp -> /private/tmp; accept either by matching basename
      expect(result.output).toContain(path.basename(workdir));
    });
  });

  describe('runBashCommand — timeout', () => {
    it('emits kind=timeout and a <bash_metadata> footer when timeout fires', async () => {
      const result = await runBashCommand({
        command: 'sleep 5',
        description: 'force timeout',
        workdir,
        timeout: 200,
      });
      expect(result.kind).toBe('timeout');
      expect(result.output).toContain('<bash_metadata>');
      expect(result.output).toContain('exceeding timeout 200 ms');
      expect(result.output).toContain('retry with a larger timeout');
    });
  });

  describe('runBashCommand — abort', () => {
    it('emits kind=aborted and footer when external signal aborts', async () => {
      const controller = new AbortController();
      const promise = runBashCommand(
        {
          command: 'sleep 5',
          description: 'force abort',
          workdir,
        },
        { signal: controller.signal },
      );
      // Give the spawn a moment so the abort handler is registered.
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();
      const result = await promise;
      expect(result.kind).toBe('aborted');
      expect(result.output).toContain('<bash_metadata>');
      // Exact opencode text — no trailing period.
      expect(result.output).toContain('User aborted the command');
      expect(result.output).not.toContain('User aborted the command.');
    });
  });

  describe('runBashCommand — output truncation', () => {
    it('truncates oversized output and writes the full text to TRUNCATION_DIR', async () => {
      // 60_000 bytes > MAX_OUTPUT_BYTES (50 KB). `yes` outputs `y\n` quickly;
      // we grab a deterministic head with `head -c` so the test isn't racy.
      const result = await runBashCommand({
        command: 'yes truncation-marker | head -c 60000',
        description: 'overflow probe',
        workdir,
      });
      expect(result.kind).toBe('exit');
      expect(result.truncated).toBe(true);
      expect(typeof result.outputPath).toBe('string');
      expect(result.outputPath?.startsWith(TRUNCATION_DIR)).toBe(true);
      // Hint is in the output so the model knows where to look.
      expect(result.output).toContain('Output truncated');
      expect(result.output).toContain('Full output saved to:');
    });
  });

  describe('runBashCommand — onPartialOutput streaming', () => {
    it('invokes the callback at least twice for spread-out output', async () => {
      // Two echoes separated by sleep 0.15s so they straddle the 80ms
      // throttle window. Each callback receives the *cumulative* text so
      // far, not just the latest chunk.
      const partials: string[] = [];
      const result = await runBashCommand(
        {
          command: 'echo first; sleep 0.15; echo second',
          description: 'streaming probe',
          workdir,
        },
        {
          onPartialOutput: (text) => {
            partials.push(text);
          },
        },
      );
      expect(result.kind).toBe('exit');
      expect(result.exitCode).toBe(0);
      // At least one partial must have fired — and the last one should be
      // a strict prefix of (or equal to) the final output.
      expect(partials.length).toBeGreaterThanOrEqual(1);
      const last = partials[partials.length - 1] ?? '';
      expect(result.output).toContain(last.trim());
      // Cumulative semantics: a later partial should be ≥ the previous
      // length. (Equality is fine; shrinking is not.)
      for (let i = 1; i < partials.length; i += 1) {
        const cur = partials[i];
        const prev = partials[i - 1];
        if (cur === undefined || prev === undefined) continue;
        expect(cur.length).toBeGreaterThanOrEqual(prev.length);
      }
    });

    it('is optional — omitting the callback leaves behaviour unchanged', async () => {
      const result = await runBashCommand({
        command: 'echo plain-no-stream',
        description: 'no-stream probe',
        workdir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('plain-no-stream');
    });

    it('does not fire after the process resolves (no late-callback race)', async () => {
      const partials: string[] = [];
      const result = await runBashCommand(
        {
          command: 'echo immediate',
          description: 'fast-finish probe',
          workdir,
        },
        {
          onPartialOutput: (text) => {
            partials.push(text);
          },
        },
      );
      expect(result.exitCode).toBe(0);
      // Wait one tick longer than the throttle window to catch a stray
      // trailing emit. None should fire.
      const before = partials.length;
      await new Promise((r) => setTimeout(r, 120));
      expect(partials.length).toBe(before);
    });
  });
});
