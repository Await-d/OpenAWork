import type { CSSProperties } from 'react';
import { BrandLogo } from '@openAwork/shared-ui';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import { DIALOGUE_MODE_OPTIONS } from '../../../pages/chat-page/mode/dialogue-mode.js';

export interface WelcomeScreenProps {
  readonly hasWorkspace: boolean;
  readonly dialogueMode: DialogueMode;
  readonly onNewSession: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onSelectMode: (mode: DialogueMode) => void;
}

const MODE_ACCENTS = {
  clarify: {
    bg: 'var(--contrast-subtle)',
    color: 'var(--contrast)',
  },
  coding: {
    bg: 'var(--accent-subtle)',
    color: 'var(--accent)',
  },
  programmer: {
    bg: 'var(--aux-subtle)',
    color: 'var(--aux)',
  },
} satisfies Record<DialogueMode, { readonly bg: string; readonly color: string }>;

const WELCOME_KEYFRAMES = `
@keyframes ws-fade-up{0%{opacity:0;transform:translateY(18px)}100%{opacity:1;transform:translateY(0)}}
@keyframes ws-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes ws-glow-pulse{0%,100%{box-shadow:0 0 0 1px var(--glow),0 2px 16px color-mix(in srgb,var(--glow) 18%,transparent)}50%{box-shadow:0 0 0 1.5px var(--glow),0 4px 24px color-mix(in srgb,var(--glow) 30%,transparent)}}
@keyframes ws-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ws-card{transition:border-color .22s,background .22s,box-shadow .22s,transform .22s}
.ws-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)!important}
.ws-pill{transition:transform .18s,box-shadow .18s}
.ws-pill:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.ws-pill:active{transform:scale(.97)}
.ws-mode-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%}
@media (max-width: 900px){
  .ws-mode-grid{grid-template-columns:1fr;max-width:520px}
  .ws-card{display:grid!important;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:8px!important}
  .ws-card ul{grid-column:2;margin-top:0!important}
  .ws-card:hover{transform:none}
}
`;

function renderDialogueModeIcon(mode: DialogueMode) {
  switch (mode) {
    case 'clarify':
      return (
        <svg
          aria-hidden="true"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'coding':
      return (
        <svg
          aria-hidden="true"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z" />
        </svg>
      );
    case 'programmer':
      return (
        <svg
          aria-hidden="true"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
          <path d="m14.5 4-5 16" />
        </svg>
      );
  }
}

export function WelcomeScreen({
  hasWorkspace,
  dialogueMode,
  onNewSession,
  onOpenWorkspace,
  onSelectMode,
}: WelcomeScreenProps) {
  const tips = [
    { key: '/', text: '输入 / 查看命令' },
    { key: '@', text: '输入 @ 引用文件' },
  ] as const;

  return (
    <div
      style={{
        margin: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 24px 12px',
        gap: 18,
        maxWidth: 1024,
        width: '100%',
      }}
    >
      <style>{WELCOME_KEYFRAMES}</style>

      <div
        style={{
          textAlign: 'center',
          animation: 'ws-fade-up .5s ease both',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 42,
            height: 42,
            marginBottom: 10,
            boxShadow: '0 4px 24px color-mix(in srgb, var(--accent) 28%, transparent)',
            animation: 'ws-float 3s ease-in-out infinite',
          }}
        >
          <BrandLogo size={42} />
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--fg-strong)',
            letterSpacing: '-0.03em',
          }}
        >
          OpenAWork
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-muted)',
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          选择模式，然后开始对话
        </div>
      </div>

      <div className="ws-mode-grid">
        {DIALOGUE_MODE_OPTIONS.map((mode, idx) => {
          const accent = MODE_ACCENTS[mode.value];
          const isActive = dialogueMode === mode.value;
          const cardStyle: CSSProperties & { '--glow': string } = {
            '--glow': accent.color,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
            padding: '14px 13px 12px',
            borderRadius: 12,
            border: isActive ? `1.5px solid ${accent.color}` : '1px solid var(--border-default)',
            background: isActive ? accent.bg : 'var(--bg-overlay)',
            color: 'var(--fg-strong)',
            cursor: 'pointer',
            textAlign: 'left',
            animation: `ws-fade-up .5s ease both ${0.1 + idx * 0.08}s${isActive ? ', ws-glow-pulse 2.5s ease-in-out infinite .6s' : ''}`,
            overflow: 'hidden',
            minWidth: 0,
          };

          return (
            <button
              key={mode.value}
              className="ws-card"
              type="button"
              onClick={() => onSelectMode(mode.value)}
              style={cardStyle}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 'inherit',
                    background: `linear-gradient(110deg, transparent 30%, color-mix(in srgb, ${accent.color} 8%, transparent) 50%, transparent 70%)`,
                    backgroundSize: '200% 100%',
                    animation: 'ws-shimmer 3s linear infinite',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: isActive
                    ? `linear-gradient(135deg, ${accent.bg}, color-mix(in srgb, ${accent.color} 18%, transparent))`
                    : accent.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  color: accent.color,
                  flexShrink: 0,
                  transition: 'transform .2s',
                  transform: isActive ? 'scale(1.08)' : 'scale(1)',
                }}
              >
                {renderDialogueModeIcon(mode.value)}
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  position: 'relative',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    textWrap: 'pretty',
                    wordBreak: 'keep-all',
                  }}
                >
                  {mode.label}
                  {isActive ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: accent.color,
                        color: 'var(--fg-on-accent)',
                        fontSize: 9,
                        fontWeight: 700,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    lineHeight: 1.4,
                    textWrap: 'pretty',
                    wordBreak: 'keep-all',
                  }}
                >
                  {mode.description}
                </span>
              </span>
              <ul
                style={{
                  margin: '1px 0 0',
                  padding: '0 0 0 12px',
                  fontSize: 10,
                  color: isActive ? 'var(--fg-default)' : 'var(--fg-muted)',
                  lineHeight: 1.5,
                  listStyle: 'none',
                  transition: 'color .2s',
                  textWrap: 'pretty',
                  wordBreak: 'keep-all',
                }}
              >
                {mode.details.slice(0, 2).map((detail) => (
                  <li
                    key={detail}
                    style={{
                      position: 'relative',
                      paddingLeft: 2,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: -10,
                        color: isActive ? accent.color : 'var(--fg-muted)',
                        transition: 'color .2s',
                      }}
                    >
                      ·
                    </span>
                    {detail}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          justifyContent: 'center',
          animation: 'ws-fade-up .5s ease both .38s',
        }}
      >
        <button
          className="ws-pill"
          type="button"
          onClick={onNewSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建会话
        </button>
        <button
          className="ws-pill"
          type="button"
          onClick={onOpenWorkspace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 999,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-default)',
            fontSize: 11.5,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {hasWorkspace ? '切换工作区' : '打开工作区'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          justifyContent: 'center',
          flexWrap: 'wrap',
          animation: 'ws-fade-up .5s ease both .46s',
        }}
      >
        {tips.map((tip) => (
          <span
            key={tip.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: 'var(--fg-muted)',
            }}
          >
            <kbd
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 20,
                height: 20,
                padding: '0 5px',
                borderRadius: 5,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--fg-default)',
                lineHeight: 1,
              }}
            >
              {tip.key}
            </kbd>
            {tip.text}
          </span>
        ))}
      </div>
    </div>
  );
}
