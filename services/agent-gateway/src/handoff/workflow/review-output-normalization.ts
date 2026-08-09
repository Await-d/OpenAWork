type ReviewVerdict = 'pass' | 'fail' | null;
type ReviewVerdictInference = (text: string) => ReviewVerdict;

export function normalizeReviewOutput(
  result: string,
  inferVerdict: ReviewVerdictInference,
): { passed: boolean; issues: string[] } {
  const lines = result
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const issues = lines
    .filter((line) => line.startsWith('ISSUE:'))
    .map((line) => line.replace(/^ISSUE:\s*/, ''));
  if (issues.length > 0) {
    return { passed: false, issues };
  }
  if (lines.length === 0) {
    return { passed: false, issues: ['评审未返回有效总结'] };
  }

  const verdict = inferVerdict(result);
  if (verdict === 'fail') {
    return { passed: false, issues: [result.trim()] };
  }
  if (verdict === 'pass') {
    return { passed: true, issues: [] };
  }
  return { passed: false, issues: ['评审未给出明确结论：' + result.trim()] };
}
