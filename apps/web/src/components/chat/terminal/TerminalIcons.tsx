/**
 * 终端浮层用的内联 SVG 图标（Lucide 风格：24×24 viewBox / stroke / round cap）。
 * 不引第三方图标包，也不使用 emoji 或文字符号充当图标。
 */

interface IconProps {
  size?: number;
}

function Svg({ size = 14, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function ChevronUpIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="18 15 12 9 6 15" />
    </Svg>
  );
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}

export function CloseIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function SearchIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </Svg>
  );
}

export function CopyIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Svg>
  );
}

export function LinkIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

export function ClipboardIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M9 4h6v3H9z" />
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    </Svg>
  );
}

export function SelectAllIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />
    </Svg>
  );
}

export function EraserIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 16 12.5 7.5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L14 20H7z" />
      <line x1="9" y1="20" x2="20" y2="20" />
    </Svg>
  );
}

export function ArrowDownIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </Svg>
  );
}

export function AlertTriangleIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M10.3 4.3 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </Svg>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="5 13 9.5 17.5 19 7" />
    </Svg>
  );
}

export function TerminalIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </Svg>
  );
}

export function PlusIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function SplitIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="12" y1="4" x2="12" y2="20" />
      <path d="M8 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3" />
      <path d="M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" />
    </Svg>
  );
}

export function MoreIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Svg>
  );
}

export function PlugIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </Svg>
  );
}

export function MaximizeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Svg>
  );
}

export function RestoreIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Svg>
  );
}

export function RefreshIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  );
}

export function PauseIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="6.5" y="4" width="3.5" height="16" rx="1" />
      <rect x="14" y="4" width="3.5" height="16" rx="1" />
    </Svg>
  );
}

export function PlayIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polygon points="6 3.5 20 12 6 20.5 6 3.5" />
    </Svg>
  );
}

export function ExternalLinkIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  );
}

export function SquareStopIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function TrashIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 7h16" />
      <path d="M10 4h4" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  );
}
