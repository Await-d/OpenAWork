import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const options = {
    inputFile: null,
    outputFile: null,
    notesFile: null,
    version: null,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
    requiredPlatforms: [],
    proxyPrefix: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input-file') {
      options.inputFile = next;
      index += 1;
    } else if (arg === '--output-file') {
      options.outputFile = next;
      index += 1;
    } else if (arg === '--notes-file') {
      options.notesFile = next;
      index += 1;
    } else if (arg === '--version') {
      options.version = next;
      index += 1;
    } else if (arg === '--token') {
      options.token = next;
      index += 1;
    } else if (arg === '--required-platform') {
      options.requiredPlatforms.push(next);
      index += 1;
    } else if (arg === '--proxy-prefix') {
      options.proxyPrefix = next;
      index += 1;
    }
  }

  if (!options.inputFile) {
    throw new Error('--input-file is required');
  }
  if (!options.outputFile) {
    throw new Error('--output-file is required');
  }
  if (!options.version) {
    throw new Error('--version is required');
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assetMatches(asset, pattern) {
  return pattern.test(asset.name);
}

function chooseOnlyOrNamed(assets, pattern, archPattern = null, allowSingleFallback = true) {
  const candidates = assets.filter((asset) => assetMatches(asset, pattern));
  if (archPattern) {
    const named = candidates.find((asset) => assetMatches(asset, archPattern));
    if (named) {
      return named;
    }
    return allowSingleFallback && candidates.length === 1 ? candidates[0] : null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function selectPlatformAssets(assets) {
  return {
    'linux-x86_64': chooseOnlyOrNamed(assets, /\.AppImage$/i, /(amd64|x86_64)/i),
    'linux-aarch64': chooseOnlyOrNamed(assets, /\.AppImage$/i, /(aarch64|arm64)/i, false),
    'windows-x86_64': chooseOnlyOrNamed(assets, /(?:setup.*\.exe|\.exe)$/i, /(?:^|[._-])x64(?:[._-]|$)|(?:^|[._-])x86_64(?:[._-]|$)|(?:^|[._-])amd64(?:[._-]|$)/i),
    'windows-aarch64': chooseOnlyOrNamed(assets, /(?:setup.*\.exe|\.exe)$/i, /(?:^|[._-])(?:aarch64|arm64)(?:[._-]|$)/i, false),
    'darwin-aarch64': chooseOnlyOrNamed(assets, /\.app\.tar\.gz$/i, /(aarch64|arm64)/i),
    'darwin-x86_64': chooseOnlyOrNamed(assets, /\.app\.tar\.gz$/i, /(x64|x86_64|amd64)/i, false),
  };
}

function findSignatureAsset(assets, asset) {
  return assets.find((candidate) => candidate.name === `${asset.name}.sig`) ?? null;
}

async function downloadText(url, token) {
  const headers = { Accept: 'application/octet-stream' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.text()).trim();
}

async function buildUpdaterJson(options) {
  const release = readJson(options.inputFile);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const selected = selectPlatformAssets(assets);
  const platforms = {};

  for (const [platform, asset] of Object.entries(selected)) {
    if (!asset) {
      continue;
    }

    const signatureAsset = findSignatureAsset(assets, asset);
    if (!signatureAsset) {
      throw new Error(`Missing signature asset for ${platform}: ${asset.name}.sig`);
    }

    // Apply proxy prefix to download URL if specified
    const downloadUrl = options.proxyPrefix
      ? `${options.proxyPrefix}${asset.browser_download_url}`
      : asset.browser_download_url;

    platforms[platform] = {
      signature: await downloadText(signatureAsset.browser_download_url, options.token),
      url: downloadUrl,
    };
  }

  const missing = options.requiredPlatforms.filter((platform) => !platforms[platform]);
  if (missing.length > 0) {
    throw new Error(`Missing required updater platforms: ${missing.join(', ')}`);
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error('No updater platforms were discovered from release assets');
  }

  return {
    version: options.version,
    notes: options.notesFile ? readFileSync(options.notesFile, 'utf8') : (release.body ?? ''),
    pub_date: release.published_at ?? new Date().toISOString(),
    platforms,
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildUpdaterJson(options);
  writeFileSync(options.outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Wrote ${options.outputFile} with ${Object.keys(result.platforms).length} platforms\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
