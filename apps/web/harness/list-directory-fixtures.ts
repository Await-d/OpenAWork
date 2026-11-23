export const rootPath = '/workspace/OpenAWork/apps/web';
export const longName = `${'very-long-directory-name-'.repeat(8)}目录`;
export const longFile = `${'long-file-name-'.repeat(12)}report.tsx`;
export const listingOutput = JSON.stringify({
  path: rootPath,
  depth: 3,
  visitedEntries: 190,
  nodes: [
    {
      name: 'src',
      path: `${rootPath}/src`,
      type: 'directory',
      children: [
        { name: 'main.tsx', path: `${rootPath}/src/main.tsx`, type: 'file' },
        { name: 'README.md', path: `${rootPath}/src/README.md`, type: 'file' },
        { name: 'empty-cache', type: 'directory', children: [] },
        { name: longName, type: 'directory', children: [{ name: longFile, type: 'file' }] },
      ],
    },
    { name: 'package.json', path: `${rootPath}/package.json`, type: 'file' },
  ],
});
export const emptyOutput = JSON.stringify({
  path: rootPath,
  depth: 3,
  visitedEntries: 0,
  nodes: [],
});
export const malformedOutput = '{"path":"/workspace/OpenAWork","nodes":[{"name":"broken"}';
export const errorOutput = JSON.stringify({
  path: rootPath,
  error: 'EACCES: permission denied listing private directory',
  nodes: [{ name: 'should-not-render.ts', type: 'file' }],
});
