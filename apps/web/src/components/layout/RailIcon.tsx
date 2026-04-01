import React from 'react';

export const railItems = [
  { to: '/chat', label: 'Chat' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/skills', label: 'Skills' },
  { to: '/agents', label: 'Agents' },
  { to: '/settings/channels', label: 'Channels' },
  { to: '/usage', label: 'Usage' },
  { to: '/schedules', label: 'Schedules' },
];

export const railLabelCn: Record<string, string> = {
  Chat: '对话',
  Sessions: '会话',
  Settings: '设置',
  Skills: '技能',
  Agents: '智能体',
  Channels: '频道',
  Usage: '用量',
  Schedules: '定时',
};

const I = ({ d, children }: { d?: string; children?: React.ReactNode }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d && <path d={d} />}
    {children}
  </svg>
);

export function railIcon(label: string) {
  switch (label) {
    case 'Chat':
      return <I d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
    case 'Sessions':
      return (
        <I>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </I>
      );
    case 'Channels':
      return (
        <I>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <line x1="9" y1="10" x2="9" y2="10" />
          <line x1="12" y1="10" x2="12" y2="10" />
          <line x1="15" y1="10" x2="15" y2="10" />
        </I>
      );
    case 'Usage':
      return (
        <I>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </I>
      );
    case 'Schedules':
      return (
        <I>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </I>
      );
    case 'Skills':
      return (
        <I>
          <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.47 1.229 0 1.698l-1.568 1.568a1.1 1.1 0 0 0-.289.878l.31 2.208a1.1 1.1 0 0 1-1.271 1.271l-2.208-.31a1.1 1.1 0 0 0-.878.289l-1.568 1.568a1.2 1.2 0 0 1-1.698 0l-1.568-1.568a1.1 1.1 0 0 0-.878-.289l-2.208.31a1.1 1.1 0 0 1-1.271-1.271l.31-2.208a1.1 1.1 0 0 0-.289-.878L4.753 13.1a1.2 1.2 0 0 1 0-1.698l1.568-1.568a1.1 1.1 0 0 0 .289-.878l-.31-2.208a1.1 1.1 0 0 1 1.271-1.271l2.208.31a1.1 1.1 0 0 0 .878-.289l1.568-1.568a1.2 1.2 0 0 1 1.698 0l1.568 1.568a1.1 1.1 0 0 0 .878.289l2.208-.31a1.1 1.1 0 0 1 1.271 1.271z" />
          <circle cx="12" cy="12" r="3" />
        </I>
      );
    case 'Agents':
      return (
        <I>
          <rect x="3" y="4" width="7" height="7" rx="2" />
          <rect x="14" y="4" width="7" height="7" rx="2" />
          <rect x="3" y="13" width="7" height="7" rx="2" />
          <rect x="14" y="13" width="7" height="7" rx="2" />
        </I>
      );
    case 'Settings':
      return (
        <I>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </I>
      );
    default:
      return (
        <I>
          <circle cx="12" cy="12" r="3" />
        </I>
      );
  }
}
