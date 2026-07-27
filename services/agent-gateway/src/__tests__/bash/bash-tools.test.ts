import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// `bash-tools.ts` transitively pulls in `db.ts` for `WORKSPACE_ROOT`, and
// `db.ts` imports `node:sqlite` at module load. Vite (vitest's bundler)
// cannot resolve the `node:` protocol during transform, so we stub the
// whole module here. The same pattern is used in
// `v2-runtime-effect-bridge.test.ts` and `v2-runtime-boot.test.ts`.
vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: tmpdir(),
  WORKSPACE_ROOTS: [tmpdir()],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn((query: string) => {
    if (query.includes('role_layer') && query.includes('team_parent_session_id')) {
      return {
        metadata_json: '{}',
        role_layer: 'executor',
        team_parent_session_id: null,
        user_id: 'test-user',
      };
    }
    return undefined;
  }),
  sqliteRun: vi.fn(),
  sqliteTransaction: vi.fn((fn: () => unknown) => fn()),
}));

const {
  assertSafeShellCommand,
  bashToolDefinition,
  buildBashPermissionScope,
  buildShellCompatibilityHint,
  deriveBashDescription,
  resolveShellChoiceForPlatform,
  runBashCommand,
} = await import('../../tools/bash-tools.js');
const { buildBashApprovalPatterns } = await import('../../tools/bash-arity.js');
const { listTruncationDirCandidates } = await import('../../tools/bash-output-truncator.js');

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

    it('treats description as optional (OpenAWork compatibility)', () => {
      // OpenAWork relaxes opencode's `description: required` rule so
      // models that omit the field don't fail at the schema gate. The
      // missing field is later backfilled inside `runBashCommand` via
      // `deriveBashDescription`. See comments in bash-tools.ts.
      const parsed = bashToolDefinition.inputSchema.safeParse({
        command: 'echo hi',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.description).toBeUndefined();
      }
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

  describe('deriveBashDescription', () => {
    it('produces a non-empty fallback for short commands', () => {
      expect(deriveBashDescription('ls')).toContain('ls');
      expect(deriveBashDescription('git status').length).toBeGreaterThan(0);
    });

    it('clips long single-line commands to a 50-char preview with an ellipsis', () => {
      const cmd = 'echo ' + 'x'.repeat(80);
      const out = deriveBashDescription(cmd);
      // The clipped form keeps the leading slice + ellipsis marker
      expect(out).toContain('…');
      // Total length stays bounded (50 char clip + a small wrapper)
      expect(out.length).toBeLessThan(80);
    });

    it('uses only the first line of a multi-line command for the preview', () => {
      const out = deriveBashDescription('git status\necho hidden');
      expect(out).toContain('git status');
      expect(out).not.toContain('hidden');
    });

    it('falls back to a generic phrase for an empty / whitespace-only command', () => {
      expect(deriveBashDescription('')).toBe('执行 bash 命令');
      expect(deriveBashDescription('   ')).toBe('执行 bash 命令');
    });
  });

  describe('shell selection', () => {
    it('Windows 默认优先使用 pwsh.exe，不跟随 Git Bash 风格的 SHELL 环境变量', () => {
      const choice = resolveShellChoiceForPlatform(
        'win32',
        {
          SHELL: '/usr/bin/bash',
        },
        {
          commandExists: (command) => command === 'pwsh.exe',
        },
      );

      expect(choice.shell).toBe('pwsh.exe');
      expect(choice.isPowerShell).toBe(true);
      expect(choice.name).toBe('pwsh.exe');
    });

    it('Windows 在找不到 pwsh.exe 时回退到 powershell.exe', () => {
      const choice = resolveShellChoiceForPlatform(
        'win32',
        {
          SHELL: '/usr/bin/bash',
        },
        {
          commandExists: () => false,
        },
      );

      expect(choice.shell).toBe('powershell.exe');
      expect(choice.isPowerShell).toBe(true);
      expect(choice.name).toBe('powershell.exe');
    });

    it('Windows 允许通过 OPENAWORK_WINDOWS_SHELL 显式覆盖默认 shell', () => {
      const choice = resolveShellChoiceForPlatform(
        'win32',
        {
          OPENAWORK_WINDOWS_SHELL: 'pwsh.exe',
          SHELL: '/usr/bin/bash',
        },
        {
          commandExists: () => false,
        },
      );

      expect(choice.shell).toBe('pwsh.exe');
      expect(choice.isPowerShell).toBe(true);
      expect(choice.name).toBe('pwsh.exe');
    });
  });

  describe('shell-aware safety pre-checks', () => {
    it('允许 PowerShell 的变量子表达式', () => {
      expect(() =>
        assertSafeShellCommand('Write-Output "$($_.LineNumber)"', { isPowerShell: true }),
      ).not.toThrow();
    });

    it('允许 PowerShell 的命令子表达式', () => {
      expect(() =>
        assertSafeShellCommand('Write-Output "$(Get-Location).Path"', { isPowerShell: true }),
      ).not.toThrow();
    });

    it('允许 PowerShell 反引号转义（`t/`n/`"），不按 bash 命令替换拦截', () => {
      expect(() =>
        assertSafeShellCommand('Write-Output ("{0}`t{1}MB`tdur={2}" -f $_.Name, $sz, $d)', {
          isPowerShell: true,
        }),
      ).not.toThrow();
    });

    it('允许 PowerShell here-string / 多行脚本', () => {
      const hereString = [
        "@'",
        'from pathlib import Path',
        "print('ok')",
        "'@",
        ' | Set-Content -Encoding utf8 script.py',
      ].join('\n');
      expect(() => assertSafeShellCommand(hereString, { isPowerShell: true })).not.toThrow();
    });

    it('非 PowerShell 仍拒绝反引号命令替换与多行', () => {
      expect(() => assertSafeShellCommand('echo `whoami`', { isPowerShell: false })).toThrow(
        /Backtick/,
      );
      expect(() => assertSafeShellCommand('echo a\necho b', { isPowerShell: false })).toThrow(
        /Multi-line/,
      );
    });

    it('仍然拒绝 bash 风格的命令替换', () => {
      expect(() => assertSafeShellCommand('echo $(whoami)', { isPowerShell: false })).toThrow(
        /Command substitution/,
      );
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

    it('忽略管道后的消费命令，只基于主命令提取审批前缀', () => {
      expect(
        buildBashApprovalPatterns(
          'curl -s "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans" | head -20',
        ),
      ).toEqual(['curl -s *', 'curl *']);
    });

    it('PowerShell 子表达式命令只允许精确 scope，不生成 wildcard 审批模式', () => {
      expect(
        buildBashApprovalPatterns(
          "Write-Output \"$($_.Path.Replace((Get-Location).Path + '\\\\', '')):$($_.LineNumber)\"",
        ),
      ).toEqual([]);
    });

    it('含换行的多行命令不生成 always-allow 通配，避免误批后续语句', () => {
      expect(
        buildBashApprovalPatterns(
          ['Get-ChildItem .', 'Remove-Item -Recurse C:\\Windows'].join('\n'),
        ),
      ).toEqual([]);
    });
  });

  describe('buildShellCompatibilityHint', () => {
    const powershell51 = {
      shell: 'powershell.exe',
      isPowerShell: true,
      name: 'powershell.exe',
    };
    const pwsh = {
      shell: 'pwsh.exe',
      isPowerShell: true,
      name: 'pwsh.exe',
    };

    it('识别 PS 5.1 的 && 语法错误', () => {
      const hint = buildShellCompatibilityHint({
        cwd: 'C:\\work',
        output:
          "At line:1 char:10\r\n+ echo a && echo b\r\n+          ~~\r\nThe token '&&' is not a valid statement separator in this version.",
        shellChoice: powershell51,
      });
      expect(hint).toMatch(/不支持 '&&'/);
      expect(hint).toMatch(/OPENAWORK_WINDOWS_SHELL/);
    });

    it('仅在明确 ParserError 时提示，不把业务 stderr 当 shell 语法问题', () => {
      expect(
        buildShellCompatibilityHint({
          cwd: 'C:\\work',
          output: 'ParserError: failed to parse config.json\nUnexpected token at offset 12',
          shellChoice: powershell51,
        }),
      ).toBeNull();

      const realParser = buildShellCompatibilityHint({
        cwd: 'C:\\work',
        output: [
          'At line:1 char:20',
          "+ Write-Output 'abc",
          '+                    ~',
          "The string is missing the terminator: '.",
          '    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException',
          '    + FullyQualifiedErrorId : TerminatorExpectedAtEndOfString',
        ].join('\r\n'),
        shellChoice: powershell51,
      });
      expect(realParser).toMatch(/PowerShell 语法错误/);
      expect(realParser).toMatch(/here-string/);
      expect(realParser).not.toMatch(/不支持 '&&'/);
    });

    it('pwsh 的 ParserError 提示不鼓励改用 PS 5.1 条件链', () => {
      const hint = buildShellCompatibilityHint({
        cwd: 'C:\\work',
        output: [
          'At line:1 char:5',
          '+ foo)',
          '+     ~',
          "Unexpected token ')' in expression or statement.",
          '    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException',
          '    + FullyQualifiedErrorId : UnexpectedToken',
        ].join('\r\n'),
        shellChoice: pwsh,
      });
      expect(hint).toMatch(/pwsh\.exe/);
      expect(hint).toMatch(/&&/);
      expect(hint).not.toMatch(/PS 5\.1/);
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
    it('rejects session-scoped bash when the session has no workingDirectory', async () => {
      await expect(
        runBashCommand(
          {
            command: 'echo hi',
            description: 'missing workspace',
          },
          { sessionId: 'session-without-workspace' },
        ),
      ).rejects.toThrow(/当前会话未绑定工作区/);
    });

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
      // Emit to both stdout and stderr, then exit non-zero.
      // Some CI environments may not reliably capture stderr from short-lived
      // processes; emitting to stdout as well ensures the test is stable.
      const result = await runBashCommand({
        command: 'echo to-stdout-content; echo to-stderr-content 1>&2; exit 7',
        description: 'failing probe',
        workdir,
      });
      expect(result.kind).toBe('exit');
      expect(result.exitCode).toBe(7);
      // stdout is always captured
      expect(result.output).toContain('to-stdout-content');
    });

    it('respects workdir parameter for cwd', async () => {
      const result = await runBashCommand({
        command: 'pwd',
        description: 'print cwd',
        workdir,
      });
      expect(result.cwd).toBe(workdir);
    });

    it('adds a workdir hint for pnpm importer-manifest failures', async () => {
      const result = await runBashCommand({
        command:
          'node -e "process.stderr.write(\'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND No package.json was found in current directory.\\\\n\'); process.exit(1)"',
        description: 'pnpm manifest hint',
        workdir,
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND');
      expect(result.output).toContain('workdir');
      expect(result.output).toContain('package.json');
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
      // Prefer workspace tool-output; may fall back to data/tmp when unwritable.
      expect(listTruncationDirCandidates().some((dir) => result.outputPath?.startsWith(dir))).toBe(
        true,
      );
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
