const LONG_PATH = `apps/web/src/components/${'deeply-nested-workspace/'.repeat(5)}patch-example.ts`;

export const patchText = [
  '*** Begin Patch',
  '*** Add File: src/new-file.ts',
  '+export const created = true;',
  '*** Update File: src/existing.ts',
  '@@',
  '-export const value = 1;',
  '+export const value = 2;',
  '*** Delete File: src/obsolete.ts',
  `*** Update File: ${LONG_PATH}`,
  '@@',
  '-const longValue = "old";',
  `+const longValue = "${'long-content-'.repeat(35)}";`,
  '*** End Patch',
].join('\n');

const files = [
  { path: 'src/new-file.ts', action: 'add' },
  { path: 'src/existing.ts', action: 'update' },
  { path: 'src/obsolete.ts', action: 'delete' },
  { path: LONG_PATH, action: 'update' },
];

export const successOutput = JSON.stringify({ success: true, files });
export const richOutput = JSON.stringify({
  success: true,
  files,
  fileDiffs: [
    { file: 'src/new-file.ts', before: '', after: 'export const created = true;\n' },
    {
      file: 'src/existing.ts',
      before: 'export const value = 1;\n',
      after: 'export const value = 2;\n',
    },
    {
      file: 'src/existing.ts',
      before: 'export const value = 1;\n',
      after: 'export const value = 2;\n',
    },
    { file: 'src/obsolete.ts', before: 'export const obsolete = true;\n', after: '' },
    {
      file: LONG_PATH,
      before: 'const longValue = "old";\n',
      after: `const longValue = "${'long-content-'.repeat(35)}";\n`,
      truncated: true,
    },
  ],
});
