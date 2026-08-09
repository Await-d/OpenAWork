export type ExecutionSummaryVerdict = 'pass' | 'fail' | 'blocked' | 'unknown';

const EXECUTION_BLOCKED_PHRASES = [
  /\bblocked\b/i,
  /阻塞/,
  /无法继续/,
  /等待依赖/,
  /待验证/,
  /需要验证/,
  /尚未验证/,
] as const;

const EXECUTION_FAILED_PHRASES = [
  /\bfail(?:ed|ure)?\b/i,
  /失败/,
  /未完成/,
  /未修复/,
  /不通过/,
  /报错/,
  /错误/,
  /未通过/,
  /有问题/,
  /问题[：:]/,
  /需要修正/,
  /需要修改/,
  /待修改/,
  /待修复/,
] as const;

const EXECUTION_PASS_PHRASES = [
  /\bpass\b/i,
  /\bdone\b/i,
  /已完成/,
  /完成/,
  /已实现/,
  /实现完成/,
  /已修复/,
  /修复完成/,
  /已处理/,
  /已补齐/,
  /已更新/,
  /已落地/,
  /提交完成/,
  /已提交/,
  /通过/,
  /成功/,
  /可交付/,
] as const;

export function inferExecutionSummaryVerdict(text: string): ExecutionSummaryVerdict {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 'unknown';
  }
  if (EXECUTION_BLOCKED_PHRASES.some((pattern) => pattern.test(normalized))) {
    return 'blocked';
  }
  if (EXECUTION_FAILED_PHRASES.some((pattern) => pattern.test(normalized))) {
    return 'fail';
  }
  if (EXECUTION_PASS_PHRASES.some((pattern) => pattern.test(normalized))) {
    return 'pass';
  }
  return 'unknown';
}
