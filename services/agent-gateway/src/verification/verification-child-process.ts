import { spawn } from 'node:child_process';

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export function runVerificationChild(input: {
  runtime: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  killOnStdout?: string;
  /**
   * 由外部条件触发的杀死（例如「假上游已收到连接」= 模型请求确实在途）。
   * 与 `killOnStdout` 同属**预期杀死**：必须真的观察到 SIGKILL 才判成功。
   */
  killWhen?: Promise<unknown>;
}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.runtime, input.args, {
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let intentionalKill = false;
    let interrupted = false;
    /** 有声明「预期杀死」时，必须观察到真实 SIGKILL 才算成功。 */
    const expectsKill = input.killOnStdout !== undefined || input.killWhen !== undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, input.timeoutMs);
    const onParentExit = (): void => {
      child.kill('SIGKILL');
    };
    const onParentSignal = (): void => {
      interrupted = true;
      intentionalKill = false;
      child.kill('SIGKILL');
      process.exitCode = 1;
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      process.removeListener('exit', onParentExit);
      process.removeListener('SIGINT', onParentSignal);
      process.removeListener('SIGTERM', onParentSignal);
    };
    process.once('exit', onParentExit);
    process.once('SIGINT', onParentSignal);
    process.once('SIGTERM', onParentSignal);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (
        !interrupted &&
        !timedOut &&
        !intentionalKill &&
        input.killOnStdout &&
        stdout.includes(input.killOnStdout)
      ) {
        intentionalKill = child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (input.killWhen) {
      void input.killWhen.then(() => {
        if (!interrupted && !timedOut && !intentionalKill) {
          intentionalKill = child.kill('SIGKILL');
        }
      });
    }

    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (interrupted) {
        reject(new Error('verification child interrupted by parent signal'));
      } else if (timedOut) {
        reject(
          new Error(`verification child timeout (${input.timeoutMs}ms): ${stderr.slice(-2000)}`),
        );
      } else if (
        expectsKill ? intentionalKill && signal === 'SIGKILL' : code === 0 && signal === null
      ) {
        resolve({ code, signal, stdout, stderr });
      } else {
        reject(
          new Error(
            `verification child failed: code=${code} signal=${signal}: ${stderr.slice(-2000)}`,
          ),
        );
      }
    });
  });
}
