import { useActionState, useState } from 'react';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useMessageLimits, validateMessageMaxChars } from '../../../hooks/use-message-limits.js';
import type { MessageLimitsSnapshot } from '@openAwork/web-client';
import './message-limits-section.css';

export function MessageLimitsSection() {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const email = useAuthStore((state) => state.email);
  const limits = useMessageLimits(gatewayUrl, token, email ?? '');
  return (
    <section className="message-limits" aria-labelledby="message-limits-title">
      <h3 id="message-limits-title">消息字符上限</h3>
      <p>设置当前网关每条消息可发送的字符数，对所有会话生效。</p>
      {!token ? <p role="status">登录后可查看当前配置。</p> : null}
      {token && limits.loading ? <p role="status">正在读取消息字符上限…</p> : null}
      {limits.error ? (
        <div role="alert">
          {limits.error}{' '}
          <button type="button" onClick={limits.reload}>
            重试
          </button>
        </div>
      ) : null}
      {token && limits.snapshot ? (
        <MessageLimitsForm key={limits.scope} snapshot={limits.snapshot} save={limits.save} />
      ) : null}
    </section>
  );
}

function MessageLimitsForm({
  snapshot,
  save,
}: {
  snapshot: MessageLimitsSnapshot;
  save: (maxChars: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(snapshot.maxChars);
  const validation = validateMessageMaxChars(value, snapshot.minChars, snapshot.hardMaxChars);
  const [feedback, action, pending] = useActionState(async () => {
    if (validation || !snapshot.canEdit) return '';
    try {
      const saved = await save(Number(value));
      if (!saved) return '当前账号无权修改此配置，请刷新后重试。';
      setDraft(null);
      return '消息字符上限已保存。';
    } catch (error) {
      return error instanceof Error ? `保存失败：${error.message}` : '保存失败，请重试。';
    }
  }, '');
  return (
    <form action={action} noValidate>
      <label htmlFor="message-max-chars">每条消息最多字符数</label>
      <div className="message-limits__controls">
        <input
          id="message-max-chars"
          type="number"
          inputMode="numeric"
          min={snapshot.minChars}
          max={snapshot.hardMaxChars}
          step={1}
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!snapshot.canEdit || pending}
          aria-invalid={Boolean(validation)}
          aria-describedby="message-limits-help message-limits-validation"
        />
        {snapshot.canEdit ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => setDraft(String(snapshot.defaultMaxChars))}
            >
              恢复默认值
            </button>
            <button
              className="message-limits__save"
              type="submit"
              disabled={pending || Boolean(validation) || Number(value) === snapshot.maxChars}
            >
              {pending ? '保存中…' : '保存字符上限'}
            </button>
          </>
        ) : null}
      </div>
      <p id="message-limits-help">
        范围 {snapshot.minChars.toLocaleString()}–{snapshot.hardMaxChars.toLocaleString()}，默认{' '}
        {snapshot.defaultMaxChars.toLocaleString()}。恢复默认值后需点击保存。
      </p>
      {!snapshot.canEdit ? <p>当前账号仅可查看，请联系管理员修改。</p> : null}
      <p id="message-limits-validation" role={validation ? 'alert' : undefined}>
        {validation}
      </p>
      <p role="status">{feedback}</p>
    </form>
  );
}
