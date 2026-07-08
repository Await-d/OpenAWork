import type { ReactNode } from 'react';

export type TeamTabIconName =
  | 'overview'
  | 'graph'
  | 'health'
  | 'conversation'
  | 'flow'
  | 'layered'
  | 'messages'
  | 'tasks'
  | 'artifacts'
  | 'review'
  | 'metrics'
  | 'usage'
  | 'timing'
  | 'governance'
  | 'init'
  | 'templates'
  | 'shares'
  | 'audit'
  | 'settings'
  | 'office'
  | 'files';

interface TeamTabIconProps {
  readonly name: TeamTabIconName;
  readonly size?: number;
}

function assertNever(value: never): never {
  throw new Error(`未处理的 Team tab 图标: ${value}`);
}

function renderIconPath(name: TeamTabIconName): ReactNode {
  switch (name) {
    case 'overview':
      return (
        <>
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M3 19h14" />
        </>
      );
    case 'graph':
      return (
        <>
          <circle cx="5" cy="5" r="2" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="16" r="2" />
          <path d="m7 6 6 0" />
          <path d="m6 7 2 7" />
          <path d="m14 8-4 6" />
        </>
      );
    case 'health':
      return (
        <>
          <path d="M10 18s-6-3.5-6-8.5A3.5 3.5 0 0 1 10 7a3.5 3.5 0 0 1 6 2.5C16 14.5 10 18 10 18Z" />
          <path d="M5 11h3l1-2 2 5 1-3h3" />
        </>
      );
    case 'conversation':
      return (
        <>
          <path d="M4 5h12v8H8l-4 4V5Z" />
          <path d="M7 8h6" />
          <path d="M7 11h4" />
        </>
      );
    case 'flow':
      return (
        <>
          <path d="M5 4v12" />
          <path d="M5 16h10" />
          <path d="M9 4h6v4H9z" />
          <path d="M9 12h6v4H9z" />
        </>
      );
    case 'layered':
      return (
        <>
          <path d="m10 3 7 4-7 4-7-4 7-4Z" />
          <path d="m3 11 7 4 7-4" />
          <path d="m3 15 7 4 7-4" />
        </>
      );
    case 'messages':
      return (
        <>
          <path d="M4 5h12v9H6l-2 2V5Z" />
          <path d="M7 8h6" />
          <path d="M7 11h5" />
        </>
      );
    case 'tasks':
      return (
        <>
          <path d="M5 5h10v12H5z" />
          <path d="M8 8h4" />
          <path d="M8 11h5" />
          <path d="M8 14h3" />
        </>
      );
    case 'artifacts':
      return (
        <>
          <path d="M4 7 10 4l6 3v6l-6 3-6-3V7Z" />
          <path d="m4 7 6 3 6-3" />
          <path d="M10 10v6" />
        </>
      );
    case 'review':
      return (
        <>
          <path d="M4 10 8 14 16 6" />
          <path d="M15 11v5H5V5h8" />
        </>
      );
    case 'metrics':
      return (
        <>
          <path d="M4 16h12" />
          <path d="M6 16V9" />
          <path d="M10 16V5" />
          <path d="M14 16v-4" />
        </>
      );
    case 'usage':
      return (
        <>
          <path d="M5 6h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5V6Z" />
          <path d="M3 8v4" />
          <path d="M7 9h5" />
        </>
      );
    case 'timing':
      return (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l3 2" />
        </>
      );
    case 'governance':
      return (
        <>
          <path d="M10 3 4 6v5c0 4 3 6 6 7 3-1 6-3 6-7V6l-6-3Z" />
          <path d="M8 10h4" />
          <path d="M10 8v4" />
        </>
      );
    case 'init':
      return (
        <>
          <path d="M10 3v4" />
          <path d="M10 13v4" />
          <path d="M3 10h4" />
          <path d="M13 10h4" />
          <circle cx="10" cy="10" r="2" />
        </>
      );
    case 'templates':
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M8 4v12" />
          <path d="M5 8h10" />
        </>
      );
    case 'shares':
      return (
        <>
          <circle cx="5" cy="10" r="2" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="15" cy="14" r="2" />
          <path d="m7 9 6-2" />
          <path d="m7 11 6 2" />
        </>
      );
    case 'audit':
      return (
        <>
          <path d="M5 4h10v12H5z" />
          <path d="M8 8h4" />
          <path d="M8 11h4" />
          <path d="M8 14h2" />
        </>
      );
    case 'settings':
      return (
        <>
          <circle cx="10" cy="10" r="2" />
          <path d="M10 3v2" />
          <path d="M10 15v2" />
          <path d="m5 5 1.4 1.4" />
          <path d="m13.6 13.6 1.4 1.4" />
          <path d="M3 10h2" />
          <path d="M15 10h2" />
          <path d="m5 15 1.4-1.4" />
          <path d="m13.6 6.4 1.4-1.4" />
        </>
      );
    case 'office':
      return (
        <>
          <path d="M4 17V5h8v12" />
          <path d="M12 9h4v8" />
          <path d="M7 8h2" />
          <path d="M7 11h2" />
          <path d="M7 14h2" />
          <path d="M3 17h14" />
        </>
      );
    case 'files':
      return (
        <>
          <path d="M3 5a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5Z" />
          <path d="M3 17a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2H3v2Z" />
        </>
      );
    default:
      return assertNever(name);
  }
}

export function TeamTabIcon({ name, size = 14 }: TeamTabIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {renderIconPath(name)}
    </svg>
  );
}
