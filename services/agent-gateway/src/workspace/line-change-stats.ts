/**
 * 行级改动统计的统一口径。
 *
 * 背景（2026-10-12 排障）：`workspace-reconcile` 与 `modified-files-summary`
 * 各自维护过一份「双指针错位即双计」的朴素计数——首个分歧点之后的所有行会被
 * **同时**计为新增与删除。实测 128 行文件在第 11 行插入 1 行会报出
 * `additions: 118 / deletions: 117`；排障包里那条
 * `additions: 116 / deletions: 116` 的真实改动只是文件顶部多了一行 `using`
 * （外加整文件 CRLF 化），却看起来像整体重写。
 *
 * 现在改为按行内容的**多重集差异**（O(n)，对文件规模有界）：
 *   - 插入 N 行 → N / 0，删除 N 行 → 0 / N
 *   - 改写单行 → 1 / 1
 *   - 纯行移动 → 0 / 0（行集合未变，不虚增）
 *
 * 换行符（CRLF / LF）在此口径下等价：纯行尾改写不算内容改动，
 * 调用方的「内容是否变化」判定也应使用 {@link normalizeLineEndings}。
 */

/** CRLF → LF。仅用于比较；展示用的原始文本不得被改写。 */
export function normalizeLineEndings(value: string): string {
  return value.includes('\r') ? value.replaceAll('\r\n', '\n') : value;
}

/**
 * 行视图（去掉尾部空行）。换行符通过 `\r?\n` 切分，因此 CRLF / LF 得到
 * 相同的行序列；单独出现的 `\r`（旧 Mac 行尾）视为行内字符，不做特殊处理。
 */
export function toComparableLines(value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

export function countLineChanges(
  before: string,
  after: string,
): { additions: number; deletions: number } {
  const remainingBefore = new Map<string, number>();
  for (const line of toComparableLines(before)) {
    remainingBefore.set(line, (remainingBefore.get(line) ?? 0) + 1);
  }

  let additions = 0;
  for (const line of toComparableLines(after)) {
    const remaining = remainingBefore.get(line);
    if (remaining === undefined || remaining === 0) {
      additions += 1;
      continue;
    }
    remainingBefore.set(line, remaining - 1);
  }

  let deletions = 0;
  for (const remaining of remainingBefore.values()) {
    deletions += remaining;
  }

  return { additions, deletions };
}
