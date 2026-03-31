/**
 * Vite plugin: inject build version info as compile-time constants
 * Usage in vite.config.ts:
 *   import versionPlugin from '../../scripts/vite-plugin-version.mjs'
 *   plugins: [versionPlugin(), ...]
 *
 * Exposes:
 *   __APP_VERSION__   → "0.0.1"
 *   __APP_BUILD_VERSION__ → "0.0.1+f659896"
 *   __APP_BUILD_TIME__ → "2026-03-20T03:25:40.000Z"
 *   __APP_GIT_HASH__  → "f659896"
 *   __APP_GIT_BRANCH__ → "main"
 */
import { getVersionInfo } from './version.mjs';

export default function versionPlugin() {
  const info = getVersionInfo();

  return {
    name: 'vite-plugin-version',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(info.version),
          __APP_BUILD_VERSION__: JSON.stringify(info.buildVersion),
          __APP_BUILD_TIME__: JSON.stringify(info.buildTime),
          __APP_GIT_HASH__: JSON.stringify(info.gitHash),
          __APP_GIT_BRANCH__: JSON.stringify(info.branch),
          __APP_GIT_TAG__: JSON.stringify(info.gitTag),
        },
      };
    },
  };
}
