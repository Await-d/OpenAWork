/* eslint-disable no-undef */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for workspace package changes
config.watchFolders = [monorepoRoot];

// Resolve modules from both the app's node_modules and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Ensure .ts/.tsx are tried when resolving .js/.jsx imports (ESM-style TypeScript)
const defaultSourceExts = config.resolver.sourceExts;
const tsExts = defaultSourceExts
  .filter((ext) => !['js', 'jsx', 'ts', 'tsx', 'json'].includes(ext))
  .concat(['ts', 'tsx', 'js', 'jsx', 'json']);
config.resolver.sourceExts = tsExts;

// Custom resolver to strip .js/.jsx extensions from imports and resolve to .ts/.tsx
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only process relative imports with .js/.jsx extension
  if (
    (moduleName.endsWith('.js') || moduleName.endsWith('.jsx')) &&
    (moduleName.startsWith('./') || moduleName.startsWith('../'))
  ) {
    const stripped = moduleName.replace(/\.jsx$/, '').replace(/\.js$/, '');
    try {
      return context.resolveRequest(
        { ...context, sourceExts: ['ts', 'tsx', 'js', 'jsx', 'json'] },
        stripped,
        platform,
      );
    } catch {
      // Fall through to default resolution
    }
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
