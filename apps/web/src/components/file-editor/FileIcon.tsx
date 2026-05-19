import React from 'react';

const EXT_COLOR: Record<string, string> = {
  ts: 'var(--aux, var(--aux, #8b9cf5))',
  tsx: 'var(--aux, var(--aux, #8b9cf5))',
  js: 'var(--warning, #f0b429)',
  jsx: 'var(--chart-7, #67e8f9)',
  json: 'var(--warning, #f0b429)',
  md: 'var(--aux, var(--aux, #8b9cf5))',
  mdx: 'var(--aux, var(--aux, #8b9cf5))',
  css: 'var(--aux, var(--aux, #8b9cf5))',
  html: 'var(--complement, #f06b7e)',
  yaml: 'var(--danger, #f06b7e)',
  yml: 'var(--danger, #f06b7e)',
  py: 'var(--aux, var(--aux, #8b9cf5))',
  rs: 'var(--warning, #f0b429)',
  go: 'var(--chart-7, #67e8f9)',
  java: 'var(--warning, #f0b429)',
  c: 'var(--fg-subtle, #4d5b6e)555',
  cpp: 'var(--complement, #f06b7e)',
  cs: 'var(--success, #3dd49a)',
  sh: 'var(--success, #3dd49a)',
  bash: 'var(--success, #3dd49a)',
  sql: 'var(--accent)',
  png: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  jpg: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  jpeg: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  svg: 'var(--accent-hover)',
  gif: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  pdf: 'var(--danger, #f06b7e)',
  txt: 'var(--fg-muted, #7b8a9e)',
};

const EXT_LABEL: Record<string, string> = {
  ts: 'TS',
  tsx: 'TSX',
  js: 'JS',
  jsx: 'JSX',
  json: '{}',
  md: 'MD',
  mdx: 'MDX',
  css: 'CSS',
  html: 'HTML',
  yaml: 'YML',
  yml: 'YML',
  py: 'PY',
  rs: 'RS',
  go: 'GO',
  java: 'JV',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  sh: 'SH',
  bash: 'SH',
  sql: 'SQL',
  png: '🖼',
  jpg: '🖼',
  jpeg: '🖼',
  svg: 'SVG',
  gif: '🖼',
  pdf: 'PDF',
  txt: 'TXT',
};

export function FileIcon({ path, size = 14 }: { path: string; size?: number }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const color = EXT_COLOR[ext] ?? 'var(--fg-muted, #7b8a9e)';
  const label = EXT_LABEL[ext];

  if (label?.includes('🖼') || label?.includes('📄')) {
    return <span style={{ fontSize: size, lineHeight: 1 }}>{label}</span>;
  }

  if (label) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size + 4,
          height: size + 2,
          borderRadius: 2,
          background: color,
          color: 'var(--fg-on-accent, #ffffff)',
          fontSize: size - 4,
          fontWeight: 700,
          fontFamily: 'monospace',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {label.slice(0, 3)}
      </span>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );
}

export function FolderIcon({
  open = false,
  size = 14,
  name,
}: {
  open?: boolean;
  size?: number;
  name?: string;
}) {
  // Special folder colors for well-known directories
  const specialColor = name ? SPECIAL_FOLDER_COLORS[name.toLowerCase()] : undefined;
  const strokeColor = specialColor ?? 'var(--accent)';
  const fillColor = open
    ? specialColor
      ? `color-mix(in oklch, ${specialColor} 20%, transparent)`
      : 'var(--accent-muted)'
    : 'transparent';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const SPECIAL_FOLDER_COLORS: Record<string, string> = {
  src: 'var(--aux, var(--aux, #8b9cf5))',
  lib: 'var(--aux, var(--aux, #8b9cf5))',
  app: 'var(--aux, var(--aux, #8b9cf5))',
  apps: 'var(--aux, var(--aux, #8b9cf5))',
  components: 'var(--chart-7, #67e8f9)',
  hooks: 'var(--chart-7, #67e8f9)',
  pages: 'var(--chart-7, #67e8f9)',
  utils: 'var(--success, #3dd49a)',
  helpers: 'var(--success, #3dd49a)',
  config: 'var(--warning, #f0b429)',
  configs: 'var(--warning, #f0b429)',
  public: 'var(--aux, var(--aux, #8b9cf5))',
  static: 'var(--aux, var(--aux, #8b9cf5))',
  assets: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  images: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  styles: 'var(--aux, var(--aux, #8b9cf5))',
  css: 'var(--aux, var(--aux, #8b9cf5))',
  test: 'var(--warning, #f0b429)',
  tests: 'var(--warning, #f0b429)',
  __tests__: 'var(--warning, #f0b429)',
  spec: 'var(--warning, #f0b429)',
  docs: 'var(--aux, var(--aux, #8b9cf5))',
  doc: 'var(--aux, var(--aux, #8b9cf5))',
  scripts: 'var(--success, #3dd49a)',
  build: 'var(--warning, var(--warning, #f0b429))',
  dist: 'var(--warning, var(--warning, #f0b429))',
  packages: 'var(--danger, #f06b7e)',
  services: 'var(--danger, #f06b7e)',
  types: 'var(--aux, var(--aux, #8b9cf5))',
  interfaces: 'var(--aux, var(--aux, #8b9cf5))',
  models: 'var(--warning, #f0b429)',
  store: 'var(--success, #3dd49a)',
  stores: 'var(--success, #3dd49a)',
  api: 'var(--chart-7, #67e8f9)',
  routes: 'var(--chart-7, #67e8f9)',
  middleware: 'var(--warning, #f0b429)',
};
