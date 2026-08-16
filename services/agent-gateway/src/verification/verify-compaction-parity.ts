import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runRealAnthropic,
  type AnthropicGateResult,
} from './verify-compaction-parity-gate.js';

export const EVIDENCE_PATH = join(
  process.cwd(),
  '../../.omo/evidence/task-8-260816-claude-compaction-parity.log',
);
const MATRIX = 'src/__tests__/compaction/compaction-provider-parity-matrix.test.ts';
const SELECTED = [
  'src/__tests__/compaction/task-5-recovery-http.test.ts',
  'src/__tests__/compaction/task-5-stream-compaction-http.test.ts',
  'src/__tests__/compaction/task-5-stream-compaction-preflight.test.ts',
] as const;

type CommandResult = { readonly exitCode: number; readonly output: string; readonly timedOut: boolean };

function appendEvidence(content: string): void {
  try {
    appendFileSync(EVIDENCE_PATH, content);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      console.error('compaction-parity: evidence write blocked by environment (EPERM)');
      return;
    }
    throw error;
  }
}

function runVitest(files: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: ':memory:' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, output, timedOut });
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `${output}\n${error.message}`, timedOut });
    });
  });
}

function appendGateEvidence(result: AnthropicGateResult): void {
  const lines = [
    `provider_gate=${result.outcome}`,
    `request_official_base_url=${result.request.officialBaseUrl}`,
    `request_context_management=${result.request.contextManagement}`,
    `request_anthropic_beta=${result.request.betaHeader}`,
  ];
  if (result.response) {
    lines.push(
      `response_status=${result.response.status}`,
      `response_message_start=${result.response.sawMessageStart}`,
      `response_usage_input_tokens=${result.response.inputTokens ?? 'missing'}`,
      `response_usage_output_tokens=${result.response.outputTokens ?? 'missing'}`,
      `response_message_delta=${result.response.sawMessageDelta}`,
      `response_stop_reason=${result.response.stopReason ?? 'missing'}`,
      `response_message_stop=${result.response.sawMessageStop}`,
    );
  }
  appendEvidence(`${lines.join('\n')}\n\n`);
}

async function main(): Promise<void> {
  mkdirSync(join(process.cwd(), '../../.omo/evidence'), { recursive: true });
  const baseline = `Baseline failing-first: pnpm --filter @openAwork/agent-gateway verify:compaction-parity\n${process.env['TASK8_BASELINE_RESULT'] ?? 'recorded in the task-8 evidence before this verifier existed'}\n`;
  appendEvidence(`Task 8 — compaction parity verifier\nDate: ${new Date().toISOString()}\n\n${baseline}`);
  const matrix = await runVitest([MATRIX, ...SELECTED]);
  appendEvidence(`offline_matrix_exit=${matrix.exitCode} timed_out=${matrix.timedOut}\n${matrix.output}\n`);
  if (matrix.exitCode !== 0) {
    console.error('compaction-parity: offline verification failed');
    process.exitCode = 1;
    return;
  }
  const gate = await runRealAnthropic();
  appendGateEvidence(gate);
  console.log('compaction-parity: offline matrix and stream/recovery suites passed');
  console.log(gate.outcome);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    appendEvidence(`verifier_error=${error instanceof Error ? error.message : 'unknown'}\n`);
    console.error('compaction-parity: verifier failed');
    process.exitCode = 1;
  });
}
