import { useActionState, useState } from 'react';
import { createSshClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import './ssh-host-key-recovery.css';

export function parseHostKeyMismatch(message: string) {
  const match =
    /host key mismatch:.*?expected (SHA256:[A-Za-z0-9+/]{43}); received (SHA256:[A-Za-z0-9+/]{43})/.exec(
      message,
    );
  return match?.[1] && match[2] ? { expectedFingerprint: match[1], fingerprint: match[2] } : null;
}

export default function SshHostKeyRecovery({
  connectionId,
  message,
  onRecovered,
}: {
  connectionId: string;
  message: string;
  onRecovered: () => Promise<void>;
}) {
  const token = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [confirmed, setConfirmed] = useState(false);
  const mismatch = parseHostKeyMismatch(message);
  const [error, submit, pending] = useActionState(
    async () => {
      if (!token || !mismatch || !confirmed) return '请登录并先核验服务器指纹。';
      try {
        const client = createSshClient(gatewayUrl);
        await client.trustHostKey(token, connectionId, mismatch);
        await client.connect(token, connectionId);
        await onRecovered();
        return null;
      } catch (cause) {
        return cause instanceof Error
          ? cause.message
          : '更新指纹失败，请重新测试连接获取最新指纹。';
      }
    },
    null as string | null,
  );
  if (!mismatch) return null;
  return (
    <form className="ssh-host-key-recovery" action={submit} aria-label="核验 SSH 主机指纹">
      <strong>服务器身份发生变化</strong>
      <p>
        服务器重装或密钥更换可能导致此提示。请通过服务器控制台或管理员核验新指纹，确认前不要继续连接。
      </p>
      <dl>
        <dt>已保存指纹</dt>
        <dd>{mismatch.expectedFingerprint}</dd>
        <dt>本次收到指纹</dt>
        <dd>{mismatch.fingerprint}</dd>
      </dl>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        我已通过可信渠道核验新指纹
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!confirmed || !token || pending}>
        {pending ? '正在更新并重连…' : '确认更新并重新连接'}
      </button>
    </form>
  );
}
