export default function SplashScreen() {
  return (
    <div
      style={{
        height: '100dvh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '28px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
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
      <div className="spinner" />
    </div>
  );
}
