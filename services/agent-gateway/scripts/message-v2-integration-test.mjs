#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(
  pnpmCommand,
  ['exec', 'tsx', 'src/verification/verify-message-v2-event-projection.ts'],
  {
    cwd: gatewayRoot,
    env: process.env,
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error('message-v2-integration-test wrapper failed');
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
