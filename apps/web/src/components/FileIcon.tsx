import React from 'react';

const EXT_COLOR: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#61dafb',
  json: '#cbcb41',
  md: '#519aba',
  mdx: '#519aba',
  css: '#42a5f5',
  html: '#e44d26',
  yaml: '#cc3534',
  yml: '#cc3534',
  py: '#3572a5',
  rs: '#dea584',
  go: '#00add8',
  java: '#b07219',
  c: '#555555',
  cpp: '#f34b7d',
  cs: '#178600',
  sh: '#89e051',
  bash: '#89e051',
  sql: 'var(--accent)',
  png: '#a074c4',
  jpg: '#a074c4',
  jpeg: '#a074c4',
  svg: 'var(--accent-hover)',
  gif: '#a074c4',
  pdf: '#f40f02',
  txt: '#9e9e9e',
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
  const color = EXT_COLOR[ext] ?? '#9e9e9e';
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
          color: '#fff',
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
  src: '#3178c6',
  lib: '#3178c6',
  app: '#3178c6',
  apps: '#3178c6',
  components: '#61dafb',
  hooks: '#61dafb',
  pages: '#61dafb',
  utils: '#89e051',
  helpers: '#89e051',
  config: '#cbcb41',
  configs: '#cbcb41',
  public: '#42a5f5',
  static: '#42a5f5',
  assets: '#a074c4',
  images: '#a074c4',
  styles: '#42a5f5',
  css: '#42a5f5',
  test: '#f7df1e',
  tests: '#f7df1e',
  __tests__: '#f7df1e',
  spec: '#f7df1e',
  docs: '#519aba',
  doc: '#519aba',
  scripts: '#89e051',
  build: '#f59e0b',
  dist: '#f59e0b',
  packages: '#cc3534',
  services: '#cc3534',
  types: '#3178c6',
  interfaces: '#3178c6',
  models: '#dea584',
  store: '#178600',
  stores: '#178600',
  api: '#00add8',
  routes: '#00add8',
  middleware: '#b07219',
};
