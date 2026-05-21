export default function SplashScreen() {
  return (
    <div
      style={{
        height: '100dvh',
        background:
          'radial-gradient(circle at 50% 18%, var(--accent-muted), transparent 36%), radial-gradient(circle at 50% 82%, color-mix(in oklch, var(--success) 18%, transparent), transparent 42%), var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '28px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px',
          animation: 'route-loader-panel-in 360ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 56,
            height: 56,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: -8,
              borderRadius: '50%',
              background: 'radial-gradient(circle at center, var(--accent-muted), transparent 70%)',
              filter: 'blur(4px)',
              animation: 'route-loader-aura 2.4s ease-in-out infinite',
            }}
          />
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              position: 'relative',
              filter: 'drop-shadow(0 6px 20px var(--accent-muted)',
            }}
          >
            <title>OpenAWork</title>
            <rect width="48" height="48" rx="12" fill="var(--accent)" />
            <path
              d="M14 24L24 14L34 24L24 34L14 24Z"
              stroke="var(--fg-on-accent)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              fill="none"
            />
            <circle cx="24" cy="24" r="3" fill="var(--fg-on-accent)" />
          </svg>
        </div>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            backgroundImage:
              'linear-gradient(90deg, var(--fg-muted) 0%, var(--fg-muted) 35%, var(--accent) 50%, var(--fg-muted) 65%, var(--fg-muted) 100%)',
            backgroundSize: '220% 100%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            animation: 'route-loader-caption-shimmer 2.6s linear infinite',
          }}
        >
          OpenAWork
        </span>
      </div>
      <div className="spinner" />
    </div>
  );
}
