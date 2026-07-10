import type { ReactNode } from 'react';

export type CommandIconName =
  'new' | 'help' | 'template' | 'retry' | 'pause' | 'resume' | 'status' | 'agent';

export type GuideIconTone = 'failure' | 'default';

function assertNever(value: never): never {
  throw new Error(`未处理的输入引导图标: ${value}`);
}

function IconSvg({
  children,
  size = 14,
}: {
  readonly children: ReactNode;
  readonly size?: number;
}) {
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
      {children}
    </svg>
  );
}

export function GuideIcon({ tone }: { readonly tone: GuideIconTone }) {
  if (tone === 'failure') {
    return (
      <IconSvg>
        <path d="M10 4 3 16h14L10 4Z" />
        <path d="M10 8v4" />
        <path d="M10 15h.01" />
      </IconSvg>
    );
  }
  return (
    <IconSvg>
      <path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9Z" />
      <path d="M8 17h4" />
      <path d="M9 14h2" />
    </IconSvg>
  );
}

export function CommandIcon({ name }: { readonly name: CommandIconName }) {
  switch (name) {
    case 'new':
      return (
        <IconSvg>
          <path d="M10 4v12" />
          <path d="M4 10h12" />
        </IconSvg>
      );
    case 'help':
      return (
        <IconSvg>
          <circle cx="10" cy="10" r="7" />
          <path d="M8.5 8a1.8 1.8 0 1 1 2.7 1.6c-.8.5-1.2.9-1.2 1.9" />
          <path d="M10 14.5h.01" />
        </IconSvg>
      );
    case 'template':
      return (
        <IconSvg>
          <path d="M5 4h10v12H5z" />
          <path d="M8 4v12" />
          <path d="M5 8h10" />
        </IconSvg>
      );
    case 'retry':
      return (
        <IconSvg>
          <path d="M15 7a6 6 0 1 0 1 5" />
          <path d="M15 4v3h-3" />
        </IconSvg>
      );
    case 'pause':
      return (
        <IconSvg>
          <path d="M7 5v10" />
          <path d="M13 5v10" />
        </IconSvg>
      );
    case 'resume':
      return (
        <IconSvg>
          <path d="m7 5 8 5-8 5V5Z" />
        </IconSvg>
      );
    case 'status':
      return (
        <IconSvg>
          <path d="M4 16V9" />
          <path d="M10 16V5" />
          <path d="M16 16v-4" />
        </IconSvg>
      );
    case 'agent':
      return (
        <IconSvg>
          <rect x="5" y="6" width="10" height="8" rx="2" />
          <path d="M10 3v3" />
          <path d="M8 10h.01" />
          <path d="M12 10h.01" />
        </IconSvg>
      );
    default:
      return assertNever(name);
  }
}

export function FileMentionIcon() {
  return (
    <IconSvg>
      <path d="M6 4h6l3 3v9H6z" />
      <path d="M12 4v4h3" />
    </IconSvg>
  );
}
