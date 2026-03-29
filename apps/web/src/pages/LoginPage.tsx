import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Navigate } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { login } from '@openAwork/web-client';

interface LoginPageProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export default function LoginPage({ theme, onToggleTheme }: LoginPageProps = {}) {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const setGatewayUrl = useAuthStore((s) => s.setGatewayUrl);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gatewayInput, setGatewayInput] = useState(gatewayUrl || 'http://localhost:3000');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  if (token) {
    return <Navigate to="/chat" replace />;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resolvedUrl = gatewayInput.trim().replace(/\/$/, '') || gatewayUrl;
      setGatewayUrl(resolvedUrl);
      const data = await login(resolvedUrl, email, password);
      setAuth(data.accessToken, email, data.refreshToken, data.expiresIn);
      void navigate('/chat', { replace: true });
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      setError(
        isTimeout
          ? '登录超时 — Gateway 响应过慢，请检查服务是否正常运行'
          : err instanceof Error
            ? err.message
            : '网络错误 — Gateway 是否正在运行？',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleGatewayBlur() {
    setGatewayUrl(gatewayInput.trim().replace(/\/$/, ''));
  }

  function getInputStyle(field: string): React.CSSProperties {
    const focused = focusedField === field;
    return {
      background: 'var(--surface)',
      border: focused ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
      borderRadius: 10,
      padding: '11px 14px',
      color: 'var(--text)',
      fontSize: 12,
      outline: 'none',
      width: '100%',
      boxSizing: 'border-box' as const,
      transition: 'border-color 0.2s, box-shadow 0.2s',
      fontFamily: 'inherit',
      boxShadow: focused ? '0 0 0 3px var(--accent-muted)' : 'none',
    };
  }

  return (
    <LoginPageContent
      theme={theme}
      onToggleTheme={onToggleTheme}
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      error={error}
      loading={loading}
      gatewayInput={gatewayInput}
      setGatewayInput={setGatewayInput}
      showAdvanced={showAdvanced}
      setShowAdvanced={setShowAdvanced}
      focusedField={focusedField}
      setFocusedField={setFocusedField}
      handleSubmit={handleSubmit}
      handleGatewayBlur={handleGatewayBlur}
      getInputStyle={getInputStyle}
    />
  );
}

interface LoginPageContentProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  error: string | null;
  loading: boolean;
  gatewayInput: string;
  setGatewayInput: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (fn: (v: boolean) => boolean) => void;
  focusedField: string | null;
  setFocusedField: (v: string | null) => void;
  handleSubmit: (e: React.SyntheticEvent) => Promise<void>;
  handleGatewayBlur: () => void;
  getInputStyle: (field: string) => React.CSSProperties;
}

function LoginPageContent({
  theme,
  onToggleTheme,
  email,
  setEmail,
  password,
  setPassword,
  error,
  loading,
  gatewayInput,
  setGatewayInput,
  showAdvanced,
  setShowAdvanced,
  focusedField,
  setFocusedField,
  handleSubmit,
  handleGatewayBlur,
  getInputStyle,
}: LoginPageContentProps) {
  return (
    <>
      <Styles />
      {onToggleTheme && <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />}
      <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
        <LeftPanel />
        <RightPanel
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          error={error}
          loading={loading}
          gatewayInput={gatewayInput}
          setGatewayInput={setGatewayInput}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          focusedField={focusedField}
          setFocusedField={setFocusedField}
          handleSubmit={handleSubmit}
          handleGatewayBlur={handleGatewayBlur}
          getInputStyle={getInputStyle}
        />
      </div>
    </>
  );
}

function Styles() {
  return (
    <style>{`
      @keyframes bg-drift {
        0%, 100% { transform: translate(0%, 0%) scale(1); }
        33% { transform: translate(2%, -3%) scale(1.04); }
        66% { transform: translate(-2%, 2%) scale(0.97); }
      }
      @keyframes spin-slow {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes login-fade-in {
        from { opacity: 0; transform: translateY(18px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes dot-pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
      @keyframes float-orb {
        0%, 100% { transform: translate(0px, 0px) scale(1); }
        25% { transform: translate(30px, -40px) scale(1.06); }
        50% { transform: translate(-20px, 30px) scale(0.94); }
        75% { transform: translate(40px, 20px) scale(1.02); }
      }
      @keyframes float-orb-2 {
        0%, 100% { transform: translate(0px, 0px) scale(1); }
        30% { transform: translate(-50px, 30px) scale(1.08); }
        60% { transform: translate(30px, -50px) scale(0.93); }
      }
      @keyframes pulse-ring {
        0%, 100% { box-shadow: 0 0 0 0px var(--accent-muted), 0 0 30px var(--accent-muted); }
        50% { box-shadow: 0 0 0 8px var(--accent-muted), 0 0 50px var(--accent-muted); }
      }
      @keyframes constellation-pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.9; }
}
      @keyframes scan-line {
        0% { top: -80px; }
        100% { top: 100%; }
}
      @keyframes rotate-ring {
        from { transform: translate(-50%, -50%) rotate(0deg); }
        to { transform: translate(-50%, -50%) rotate(360deg); }
}
      @keyframes slide-in-right {
        from { opacity: 0; transform: translateX(28px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes shine {
        from { left: -120%; }
        to { left: 150%; }
      }
      .login-right-panel {
        animation: slide-in-right 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .login-submit:hover:not(:disabled) { transform: scale(1.015); filter: brightness(1.08); }
      .login-submit:hover:not(:disabled) .shine-sweep { animation: shine 0.55s ease forwards; }
      .login-submit:active:not(:disabled) { transform: scale(0.985); }
      .login-submit { transition: transform 0.12s, filter 0.12s, opacity 0.15s; }
      .advanced-toggle:hover { color: var(--accent) !important; }
      .advanced-toggle { transition: color 0.15s; }
      .theme-btn:hover { background: var(--surface-2) !important; }
      .theme-btn { transition: background 0.15s; }
      @media (max-width: 700px) {
        .login-left-panel { display: none !important; }
        .login-right-panel { width: 100% !important; }
      }
    `}</style>
  );
}

function ThemeToggle({
  theme,
  onToggleTheme,
}: {
  theme?: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  return (
    <button
      type="button"
      className="theme-btn"
      onClick={onToggleTheme}
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 8,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--shadow-sm)',
        cursor: 'pointer',
        zIndex: 10,
      }}
    >
      {theme === 'dark' ? (
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="7.5" cy="7.5" r="2.5" />
          <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.1 1.1M11 11l1.1 1.1M2.9 12.1l1.1-1.1M11 4l1.1-1.1" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.5 9A5.5 5.5 0 0 1 6 2.5a5.5 5.5 0 1 0 6.5 6.5z" />
        </svg>
      )}
    </button>
  );
}

function AppIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="white"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(0, 14, 14)"
      />
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="white"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(120, 14, 14)"
      />
      <path
        d="M 14,2.6 C 22.75,2.6 25.4,10.5 14,14"
        stroke="white"
        strokeWidth="2.45"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
        transform="rotate(240, 14, 14)"
      />
      <circle cx="14" cy="14" r="2.2" fill="white" />
    </svg>
  );
}

function ConstellationSVG() {
  const nodes = [
    { x: 80, y: 60, r: 4, d: '6s', delay: '0s' },
    { x: 200, y: 40, r: 3, d: '8s', delay: '1s' },
    { x: 350, y: 80, r: 5, d: '7s', delay: '0.5s' },
    { x: 450, y: 50, r: 3, d: '9s', delay: '2s' },
    { x: 120, y: 160, r: 4, d: '6.5s', delay: '1.5s' },
    { x: 280, y: 180, r: 3, d: '10s', delay: '0.8s' },
    { x: 420, y: 200, r: 5, d: '7.5s', delay: '3s' },
    { x: 60, y: 280, r: 3, d: '8.5s', delay: '0.3s' },
    { x: 180, y: 300, r: 4, d: '6s', delay: '2.5s' },
    { x: 320, y: 320, r: 3, d: '9s', delay: '1.2s' },
    { x: 470, y: 290, r: 5, d: '7s', delay: '0.7s' },
    { x: 100, y: 420, r: 3, d: '8s', delay: '3.5s' },
    { x: 240, y: 450, r: 4, d: '6.5s', delay: '1.8s' },
    { x: 390, y: 400, r: 3, d: '10s', delay: '0.4s' },
    { x: 50, y: 520, r: 5, d: '7.5s', delay: '2.2s' },
    { x: 200, y: 560, r: 3, d: '9s', delay: '0.9s' },
    { x: 360, y: 540, r: 4, d: '6s', delay: '4s' },
    { x: 460, y: 480, r: 3, d: '8.5s', delay: '1.6s' },
  ];
  const lines = [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 4],
    [1, 5],
    [2, 6],
    [4, 7],
    [4, 8],
    [5, 8],
    [5, 9],
    [6, 10],
    [7, 11],
    [8, 12],
    [9, 13],
    [10, 13],
    [11, 15],
    [12, 15],
    [13, 16],
    [14, 15],
    [16, 17],
  ];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 500 600"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.6 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {lines.map(([a, b], i) => {
        const na = nodes[a as number];
        const nb = nodes[b as number];
        if (!na || !nb) return null;
        return (
          <line
            key={`line-${na.x}-${na.y}-${nb.x}-${nb.y}`}
            x1={na.x}
            y1={na.y}
            x2={nb.x}
            y2={nb.y}
            stroke="white"
            strokeWidth="0.7"
            opacity="0.2"
          />
        );
      })}
      {nodes.map((n) => (
        <circle
          key={`node-${n.x}-${n.y}`}
          cx={n.x}
          cy={n.y}
          r={n.r}
          fill="white"
          style={{
            animation: `constellation-pulse ${n.d} ease-in-out infinite`,
            animationDelay: n.delay,
          }}
        />
      ))}
    </svg>
  );
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function HexGridSVG() {
  const hexes: Array<{ cx: number; cy: number; lit: boolean }> = [];
  const colSpacing = 52;
  const rowSpacing = 60;
  let idx = 0;
  for (let col = 0; col <= 9; col++) {
    const cx = 28 + col * colSpacing;
    const offset = col % 2 === 0 ? 0 : 30;
    for (let row = 0; row <= 11; row++) {
      const cy = 30 + offset + row * rowSpacing;
      const lit = idx % 5 === 0;
      hexes.push({ cx, cy, lit });
      idx++;
    }
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 500 700"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.7 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {hexes.map((h) => (
        <polygon
          key={`hex-${h.cx}-${h.cy}`}
          points={hexPoints(h.cx, h.cy, 28)}
          fill={h.lit ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'none'}
          stroke={
            h.lit
              ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
              : 'color-mix(in srgb, var(--accent) 20%, transparent)'
          }
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

function LeftPanel() {
  const features = [
    {
      icon: '✦',
      zh: '多智能体协作',
      en: 'Orchestrate multiple AI agents in parallel',
      delay: '0.4s',
    },
    {
      icon: '⚡',
      zh: '实时流式响应',
      en: 'Stream responses with live tool execution',
      delay: '0.55s',
    },
    {
      icon: '🔒',
      zh: '端到端安全',
      en: 'Enterprise-grade auth & workspace isolation',
      delay: '0.7s',
    },
  ];

  return (
    <div
      className="login-left-panel"
      style={{
        width: '55%',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0d1a 50%, #080810 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <HexGridSVG />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 80,
            background:
              'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 15%, transparent) 50%, transparent)',
            animation: 'scan-line 8s linear infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '-15%',
            left: '-10%',
            width: '60%',
            height: '60%',
            borderRadius: '50%',
            background:
              'radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 35%, transparent) 0%, transparent 70%)',
            animation: 'float-orb 18s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-20%',
            right: '-5%',
            width: '55%',
            height: '55%',
            borderRadius: '50%',
            background:
              'radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 25%, transparent) 0%, transparent 70%)',
            animation: 'float-orb-2 22s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '50%',
            width: '40%',
            height: '40%',
            borderRadius: '50%',
            background:
              'radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 70%)',
            animation: 'float-orb 26s ease-in-out infinite reverse',
          }}
        />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ position: 'relative', width: 120, height: 120, marginBottom: 32 }}>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: 120,
              height: 120,
              borderRadius: '50%',
              border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              borderTopColor: 'color-mix(in srgb, var(--accent) 80%, transparent)',
              animation: 'rotate-ring 20s linear infinite',
              boxSizing: 'border-box' as const,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 100,
              height: 100,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(20px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow:
                '0 0 40px color-mix(in srgb, var(--accent) 20%, transparent), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <AppIcon size={52} />
          </div>
        </div>

        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: '-0.05em',
            color: 'white',
            margin: '0 0 10px',
            textShadow: '0 2px 20px rgba(0,0,0,0.5)',
          }}
        >
          OpenAWork
        </h1>
        <p
          style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            margin: '0 0 40px',
            fontWeight: 500,
          }}
        >
          AI Agent Workbench
        </p>

        <div
          style={{
            width: 280,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '8px 0',
            backdropFilter: 'blur(10px)',
          }}
        >
          {features.map((f) => (
            <div
              key={f.zh}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 20px',
                animation: 'login-fade-in 0.5s cubic-bezier(0.16,1,0.3,1) both',
                animationDelay: f.delay,
              }}
            >
              <span style={{ fontSize: 15, width: 24, textAlign: 'center', flexShrink: 0 }}>
                {f.icon}
              </span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'white', lineHeight: 1.3 }}>
                  {f.zh}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.4)',
                    marginTop: 2,
                    lineHeight: 1.4,
                  }}
                >
                  {f.en}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface RightPanelProps {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  error: string | null;
  loading: boolean;
  gatewayInput: string;
  setGatewayInput: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (fn: (v: boolean) => boolean) => void;
  focusedField: string | null;
  setFocusedField: (v: string | null) => void;
  handleSubmit: (e: React.SyntheticEvent) => Promise<void>;
  handleGatewayBlur: () => void;
  getInputStyle: (field: string) => React.CSSProperties;
}

function RightPanel({
  email,
  setEmail,
  password,
  setPassword,
  error,
  loading,
  gatewayInput,
  setGatewayInput,
  showAdvanced,
  setShowAdvanced,
  focusedField,
  setFocusedField,
  handleSubmit,
  handleGatewayBlur,
  getInputStyle,
}: RightPanelProps) {
  return (
    <div
      className="login-right-panel"
      style={{
        width: '45%',
        background: 'var(--bg)',
        borderLeft: '1px solid var(--bg-glass-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        overflowY: 'auto',
      }}
    >
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        style={{
          width: '100%',
          maxWidth: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.1rem',
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
                boxShadow: '0 0 0 5px var(--accent-muted)',
                flexShrink: 0,
              }}
            >
              <AppIcon size={20} />
            </div>
            <span
              style={{
                fontSize: 15,
                fontWeight: 750,
                letterSpacing: '-0.04em',
                color: 'var(--text)',
              }}
            >
              OpenAWork
            </span>
          </div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--text)',
              margin: '0 0 4px',
            }}
          >
            欢迎回来
          </h2>
          <p
            style={{ color: 'var(--text-3)', fontSize: 12.5, margin: 0, letterSpacing: '-0.01em' }}
          >
            登录以继续使用
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              borderRadius: 8,
              padding: '0.55rem 0.85rem',
              color: 'var(--danger)',
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--text-2)',
            letterSpacing: '0.02em',
          }}
        >
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="your@email.com"
            style={getInputStyle('email')}
            onFocus={() => setFocusedField('email')}
            onBlur={() => setFocusedField(null)}
          />
        </label>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--text-2)',
            letterSpacing: '0.02em',
          }}
        >
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            style={getInputStyle('password')}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
          />
        </label>

        <div>
          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: '2px 0',
              fontSize: 12.5,
              color: 'var(--text-3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              letterSpacing: '0.01em',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transition: 'transform 0.2s',
                transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)',
                fontSize: 10,
              }}
            >
              ▶
            </span>
            ⚙ 服务器设置
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 8 }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: 'var(--text-2)',
                  letterSpacing: '0.02em',
                }}
              >
                Gateway 地址
                <input
                  type="url"
                  value={gatewayInput}
                  onChange={(e) => setGatewayInput(e.target.value)}
                  onBlur={handleGatewayBlur}
                  placeholder="http://localhost:3000"
                  autoComplete="url"
                  style={getInputStyle('gateway')}
                  onFocus={() => setFocusedField('gateway')}
                />
              </label>
              <p
                style={{
                  margin: '5px 0 0',
                  fontSize: 11.5,
                  color: 'var(--text-3)',
                  letterSpacing: '0.01em',
                }}
              >
                API 网关地址，默认 http://localhost:3000
              </p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="login-submit"
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
            color: 'var(--accent-text)',
            border: 'none',
            borderRadius: 10,
            padding: '0.8rem',
            fontSize: 12.5,
            fontWeight: 650,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            letterSpacing: '-0.01em',
            marginTop: 4,
            boxShadow: '0 4px 20px color-mix(in srgb, var(--accent) 35%, transparent)',
          }}
        >
          <span
            className="shine-sweep"
            style={{
              position: 'absolute',
              top: 0,
              left: '-120%',
              width: '60%',
              height: '100%',
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
              transform: 'skewX(-20deg)',
              pointerEvents: 'none',
            }}
          />
          {loading ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  animation: 'spin-slow 0.8s linear infinite',
                  fontSize: 12,
                }}
              >
                ✦
              </span>
              登录中…
            </>
          ) : (
            '登录'
          )}
        </button>

        <p
          style={{
            textAlign: 'center',
            fontSize: 11.5,
            color: 'var(--text-3)',
            margin: '4px 0 0',
            letterSpacing: '0.01em',
          }}
        >
          由 OpenAWork 驱动
        </p>
      </form>
    </div>
  );
}
