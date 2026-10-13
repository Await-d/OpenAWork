import { describe, expect, it } from 'vitest';
import { redactAuditValue, redactSecretsInString } from '../../infra/audit-redaction.js';

describe('audit-redaction', () => {
  it('echo 管道 sudo -S 的 stdin 密码被脱敏', () => {
    expect(redactSecretsInString("echo 'hunter2' | sudo -S docker ps")).toBe(
      "echo '******' | sudo -S docker ps",
    );
  });

  it('双引号与键值形式同样脱敏', () => {
    expect(redactSecretsInString('echo "hunter2" | sudo -S ls')).toBe("echo '******' | sudo -S ls");
    expect(redactSecretsInString('--password=hunter2 --retry=3')).toBe(
      '--password=[REDACTED] --retry=3',
    );
  });

  it('token/api_key 键值被脱敏且不影响普通词', () => {
    expect(redactSecretsInString('api_key: sk-123')).toBe('api_key=[REDACTED]');
    expect(redactSecretsInString('tokenizer=cl100k')).toBe('tokenizer=cl100k');
  });

  it('redactAuditValue 递归处理对象与数组并保留非文本值', () => {
    const redacted = redactAuditValue({
      command: "echo 'hunter2' | sudo -S docker ps",
      nested: { api_key: 'sk-123', list: ['password=abc', 7] },
      count: 3,
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk-123');
    expect(serialized).toContain('[REDACTED]');
    expect((redacted as { count: number }).count).toBe(3);
  });
});
