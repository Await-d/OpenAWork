/**
 * Shared GitHub install flow for plugins — used by the management route
 * (`POST /plugins/install/github`) and the `plugin_manage` tool so
 * validation, staging and cleanup never drift.
 *
 * Pipeline: bounded zipball download → bounded unzip (zip-bomb guard) →
 * staging directory under `<dataDir>/plugin-downloads/` → the local
 * installer's atomic placement (`installPluginFromPath`) → hot-reload
 * activation (`refreshPluginsFromDisk`). The staging directory is always
 * removed.
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';
import { refreshPluginsFromDisk } from '../runtime/plugin-host.js';
import {
  downloadGitHubZipball,
  extractZipSubtreeToDirectory,
  PluginFetchError,
  unzipPluginArchive,
} from './github-fetch.js';
import { installPluginFromPath, sanitizeInstallId, type InstallResult } from './installer.js';
import { installIdForSource } from './lifecycle-ops.js';
import { normalizePluginRepoInput, PluginSourceError } from './sources-store.js';

export interface GithubInstallInput {
  readonly repo: string;
  readonly path?: string;
  readonly ref?: string;
  readonly name?: string;
  readonly force?: boolean;
}

export interface GithubInstallResult {
  readonly install: InstallResult;
  readonly source: {
    readonly repo: string;
    readonly ref?: string;
    readonly path: string;
  };
  readonly plugin: {
    readonly id: string;
    readonly state:
      { readonly status: 'active' } | { readonly status: 'failed'; readonly error?: string };
  } | null;
}

export async function installPluginFromGitHub(
  input: GithubInstallInput,
): Promise<GithubInstallResult> {
  let normalized: { repo: string; ref?: string };
  try {
    normalized = normalizePluginRepoInput(input.repo);
  } catch (err) {
    if (err instanceof PluginSourceError) throw err;
    throw new PluginSourceError(err instanceof Error ? err.message : String(err));
  }
  const [owner, repoName] = normalized.repo.split('/');
  if (!owner || !repoName) {
    throw new PluginSourceError(`无效的仓库：${input.repo}`);
  }

  const subPath = (input.path ?? '').replace(/^\/+|\/+$/g, '');
  const idSeed =
    input.name?.trim() || (subPath.length > 0 ? (subPath.split('/').pop() ?? repoName) : repoName);
  // Throws PluginInstallError on invalid ids — callers map it to 400/text.
  const installId = sanitizeInstallId(idSeed);

  const ref = input.ref?.trim() || normalized.ref;
  // The installer derives the install id from the directory name, so the
  // staging directory must be named after the id.
  const stagingDir = join(resolveGatewayDataDir(), 'plugin-downloads', installId);

  try {
    const archive = await downloadGitHubZipball(owner, repoName, ref);
    const entries = unzipPluginArchive(archive);
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });
    const written = await extractZipSubtreeToDirectory(entries, subPath, stagingDir);
    if (written === 0) {
      throw new PluginFetchError(`路径 "${subPath || '/'}" 在仓库 ${normalized.repo} 中不存在。`);
    }

    const installed = await installPluginFromPath(stagingDir, { force: input.force === true });
    const outcome = await refreshPluginsFromDisk();
    const tracked = outcome.tracked.find(
      (plugin) => installIdForSource(plugin.spec) === installed.installId,
    );
    return {
      install: installed,
      source: {
        repo: normalized.repo,
        ...(ref === undefined ? {} : { ref }),
        path: subPath,
      },
      plugin:
        tracked === undefined
          ? null
          : {
              id: tracked.pluginId,
              state: tracked.active
                ? { status: 'active' }
                : {
                    status: 'failed',
                    ...(tracked.error === undefined ? {} : { error: tracked.error }),
                  },
            },
    };
  } finally {
    // The installer copies out of the staging dir, so it is always safe
    // to clean up here (success or failure).
    await rm(stagingDir, { recursive: true, force: true });
  }
}
