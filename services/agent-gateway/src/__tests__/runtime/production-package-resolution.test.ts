import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('production package resolution', () => {
  it('loads the built native LLM package from a Node ESM process', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', "import('@openAwork/opencode-llm'); console.log('loaded')"],
      { cwd: process.cwd() },
    );

    expect(stdout.trim()).toBe('loaded');
  });
});
