import { useNavigate } from 'react-router';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        height: '100dvh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '32px',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>OpenAWork</title>
          <rect width="48" height="48" rx="12" fill="var(--accent)" />
          <path
            d="M14 24L24 14L34 24L24 34L14 24Z"
            stroke="var(--accent-text)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="24" cy="24" r="3" fill="var(--accent-text)" />
        </svg>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
          }}
        >
          OpenAWork
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            fontSize: '72px',
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            color: 'var(--text)',
            opacity: 0.15,
          }}
        >
          404
        </div>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
          页面不存在
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', textAlign: 'center' }}>
          你访问的路径不存在，可能已被移除或地址有误。
        </p>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            height: '34px',
            padding: '0 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            transition: 'background 150ms ease',
          }}
        >
          返回上页
        </button>
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="btn-accent"
          style={{ height: '34px', padding: '0 16px', fontSize: '13px' }}
        >
          回到首页
        </button>
      </div>
    </div>
  );
}
