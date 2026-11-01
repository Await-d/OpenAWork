import type { ProfilerOnRenderCallback } from 'react';

const CAPACITY = 80;
const STACK_LIMIT = 2_000;
const STORAGE_KEY = 'openawork:react-commit-cascade';
const UPDATE_DEPTH_ERROR = /Minified React error #185\b|Maximum update depth exceeded/i;
const UPDATE_WARNING =
  /^(?:Warning: )?(?:Maximum update depth exceeded|The result of getSnapshot should be cached|Cannot update a component)/;

type CommitPhase = 'mount' | 'update' | 'nested-update';

interface CommitSample {
  sequence: number;
  commitTime: number;
  subtrees: { id: string; phase: CommitPhase; durationMs: number }[];
  stack: string | null;
}

interface UpdateSource {
  source: string;
  detail: string;
  atMs: number;
  stack: string | null;
}

let commits: CommitSample[] = [];
let sources: UpdateSource[] = [];
let warnings: string[] = [];
let sequence = 0;
let frozenReport: string | null = null;
let originalConsoleError: typeof console.error | null = null;
let warningCapture: typeof console.error | null = null;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function captureEnabled(): boolean {
  try {
    return (
      new URLSearchParams(globalThis.location?.search ?? '').get('diag') === 'commit-cascade' ||
      globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function captureStack(): string | null {
  return new Error('React update diagnostic').stack?.slice(0, STACK_LIMIT) ?? null;
}

/**
 * React 为同一提交下的所有 Profiler 提供相同 commitTime；按它合并，避免父子回调重复计数。
 * 回调栈仅表示提交执行现场，不保证包含发起该更新的 setter。
 * 标准生产 React 不执行 onRender；需要开发服务器或 OPENAWORK_DEV_REACT=1 诊断构建。
 */
export const recordReactCommit: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  _baseDuration,
  _startTime,
  commitTime,
) => {
  if (frozenReport) return;
  try {
    let sample = commits[commits.length - 1];
    if (!sample || sample.commitTime !== commitTime) {
      sequence += 1;
      sample = { sequence, commitTime, subtrees: [], stack: null };
      commits.push(sample);
      if (commits.length > CAPACITY) commits.shift();
    }
    sample.subtrees.push({ id, phase, durationMs: actualDuration });
    if (!sample.stack && (phase === 'nested-update' || captureEnabled())) {
      sample.stack = captureStack();
    }
  } catch {
    // 诊断失败不得影响 React 提交。
  }
};

/** 只接收固定来源标签与非敏感状态，不记录消息正文、会话 id 或 token。 */
export function recordReactUpdateSource(source: string, detail: string): void {
  if (frozenReport) return;
  try {
    sources.push({
      source,
      detail,
      atMs: now(),
      stack: captureEnabled() ? captureStack() : null,
    });
    if (sources.length > CAPACITY) sources.shift();
  } catch {
    // 来源记录不影响业务派遣。
  }
}

export function dumpReactCommitCascadeReport(): string {
  if (frozenReport) return frozenReport;
  const lines = [
    'React 更新诊断（时间密集不等于闭环，提交栈不等于 setter 来源）',
    `独立提交总数：${sequence}；保留最近 ${commits.length}/${CAPACITY} 次`,
    '标准生产 React 的 Profiler 不回调；无样本时请使用开发服务器或诊断构建。',
    '── 提交概览（旧 → 新，相同 commitTime 的子树属于同一次提交）──',
  ];
  let previousTime: number | null = null;
  for (const sample of commits) {
    const delta = previousTime === null ? '-' : (sample.commitTime - previousTime).toFixed(2);
    previousTime = sample.commitTime;
    lines.push(
      `#${sample.sequence} t=${sample.commitTime.toFixed(2)}ms Δ=${delta}ms ` +
        sample.subtrees
          .map((tree) => `${tree.id}:${tree.phase}(${tree.durationMs.toFixed(2)}ms)`)
          .join(', '),
    );
  }
  lines.push('── 更新入口（旧 → 新，不代表已确认根因）──');
  for (const entry of sources) {
    lines.push(`t=${entry.atMs.toFixed(2)}ms ${entry.source} ${entry.detail}`);
  }
  lines.push('── React 完整警告（保留组件提示与现场栈）──', ...warnings);
  lines.push('── 最近入口调用栈 ──');
  for (const entry of sources.filter((entry) => entry.stack).slice(-8)) {
    lines.push(`${entry.source}: ${entry.detail}`, entry.stack ?? '');
  }
  lines.push('── 最近提交执行栈（未必包含触发 setter）──');
  for (const sample of commits.filter((entry) => entry.stack).slice(-4)) {
    lines.push(`#${sample.sequence}`, sample.stack ?? '');
  }
  return lines.join('\n');
}

/** 首次 #185 时冻结现场，避免错误边界回退或后续提交覆盖故障前历史。 */
export function buildReactUpdateDepthDiagnostics(message: string): string | null {
  if (!UPDATE_DEPTH_ERROR.test(message)) return null;
  frozenReport ??= dumpReactCommitCascadeReport();
  return frozenReport;
}

export function resetReactCommitCascadeDiagnostics(): void {
  commits = [];
  sources = [];
  warnings = [];
  sequence = 0;
  frozenReport = null;
}

/** 只拦截指定 React 更新警告，保留原始 console.error 行为，不拦截其他业务日志。 */
export function installReactCommitCascadeDiagnostics(): void {
  const target = globalThis as typeof globalThis & {
    __openaworkReactCommitCascade?: { dump: () => string; reset: () => void };
  };
  target.__openaworkReactCommitCascade = {
    dump: dumpReactCommitCascadeReport,
    reset: resetReactCommitCascadeDiagnostics,
  };
  if (warningCapture) return;
  originalConsoleError = console.error;
  const forward = originalConsoleError;
  warningCapture = (...args: unknown[]) => {
    try {
      const message = args[0];
      if (!frozenReport && typeof message === 'string' && UPDATE_WARNING.test(message)) {
        warnings.push(
          args
            .filter((arg): arg is string => typeof arg === 'string')
            .join('\n')
            .slice(0, 2_000) +
            '\n' +
            (captureStack() ?? ''),
        );
        if (warnings.length > 8) warnings.shift();
      }
    } catch {
      // 控制台包装器失败时仍必须转发原始日志。
    }
    forward.apply(console, args);
  };
  console.error = warningCapture;
}

export function uninstallReactCommitCascadeDiagnostics(): void {
  if (warningCapture && console.error === warningCapture && originalConsoleError) {
    console.error = originalConsoleError;
  }
  originalConsoleError = null;
  warningCapture = null;
}
