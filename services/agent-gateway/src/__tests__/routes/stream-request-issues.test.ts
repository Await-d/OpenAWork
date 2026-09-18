import { describe, expect, it } from 'vitest';
import { formatStreamRequestIssues } from '../../routes/stream-request-issues.js';

describe('formatStreamRequestIssues', () => {
  it('把每个 issue 压成 path: message 一行', () => {
    const result = formatStreamRequestIssues([
      { path: ['clientRequestId'], message: 'Required' },
      { path: ['message'], message: 'String must contain at least 1 character(s)' },
    ]);

    expect(result).toBe(
      'clientRequestId: Required\nmessage: String must contain at least 1 character(s)',
    );
  });

  it('嵌套路径用点号连接', () => {
    const result = formatStreamRequestIssues([
      { path: ['inputParts', 0, 'type'], message: 'Invalid' },
    ]);

    expect(result).toBe('inputParts.0.type: Invalid');
  });

  it('空 path 回退为 (root)', () => {
    const result = formatStreamRequestIssues([{ path: [], message: 'Invalid input' }]);

    expect(result).toBe('(root): Invalid input');
  });

  it('无 issue 时返回空字符串（调用方不会附上 technicalDetail）', () => {
    expect(formatStreamRequestIssues([])).toBe('');
  });
});
