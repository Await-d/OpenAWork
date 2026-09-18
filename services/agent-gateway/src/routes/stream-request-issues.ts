/**
 * 把 zod 校验失败细节压成可直接展示的多行文本。
 *
 * 挂在错误块的 `technicalDetail` 上（前端「技术详情」可展开），
 * 否则 INVALID_REQUEST 只能给出一句「请求参数无效。」，无从定位到底是哪个字段不合法。
 */
export function formatStreamRequestIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
