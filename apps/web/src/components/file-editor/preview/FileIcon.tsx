import React from 'react';

const EXT_COLOR: Record<string, string> = {
  ts: 'var(--aux)',
  tsx: 'var(--aux)',
  js: 'var(--warning)',
  jsx: 'var(--chart-7)',
  json: 'var(--warning)',
  md: 'var(--aux)',
  mdx: 'var(--aux)',
  css: 'var(--aux)',
  html: 'var(--complement)',
  yaml: 'var(--danger)',
  yml: 'var(--danger)',
  py: 'var(--aux)',
  rs: 'var(--warning)',
  go: 'var(--chart-7)',
  java: 'var(--warning)',
  c: 'var(--fg-subtle)',
  cpp: 'var(--complement)',
  cs: 'var(--success)',
  sh: 'var(--success)',
  bash: 'var(--success)',
  sql: 'var(--accent)',
  png: 'var(--chart-5)',
  jpg: 'var(--chart-5)',
  jpeg: 'var(--chart-5)',
  svg: 'var(--accent-hover)',
  gif: 'var(--chart-5)',
  pdf: 'var(--danger)',
  txt: 'var(--fg-muted)',
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
  const color = EXT_COLOR[ext] ?? 'var(--fg-muted)';
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
          color: 'var(--fg-on-accent)',
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
  src: 'var(--aux)',
  lib: 'var(--aux)',
  app: 'var(--aux)',
  apps: 'var(--aux)',
  components: 'var(--chart-7)',
  hooks: 'var(--chart-7)',
  pages: 'var(--chart-7)',
  utils: 'var(--success)',
  helpers: 'var(--success)',
  config: 'var(--warning)',
  configs: 'var(--warning)',
  public: 'var(--aux)',
  static: 'var(--aux)',
  assets: 'var(--chart-5)',
  images: 'var(--chart-5)',
  styles: 'var(--aux)',
  css: 'var(--aux)',
  test: 'var(--warning)',
  tests: 'var(--warning)',
  __tests__: 'var(--warning)',
  spec: 'var(--warning)',
  docs: 'var(--aux)',
  doc: 'var(--aux)',
  scripts: 'var(--success)',
  build: 'var(--warning)',
  dist: 'var(--warning)',
  packages: 'var(--danger)',
  services: 'var(--danger)',
  types: 'var(--aux)',
  interfaces: 'var(--aux)',
  models: 'var(--warning)',
  store: 'var(--success)',
  stores: 'var(--success)',
  api: 'var(--chart-7)',
  routes: 'var(--chart-7)',
  middleware: 'var(--warning)',
};
