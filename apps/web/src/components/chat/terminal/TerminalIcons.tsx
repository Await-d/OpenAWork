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
