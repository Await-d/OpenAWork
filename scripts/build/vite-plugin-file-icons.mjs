/**
 * Vite 插件：为「文件图标主题」投递静态资产。
 *
 * 数据源为 material-icon-theme（MIT）：`dist/material-icons.json` 是 VS Code
 * iconTheme 清单，`icons/` 下为自带上色（fill 品牌色）的 SVG。
 *
 * 冻结契约（消费端按此实现，勿改键名）：
 *   GET /file-icons/<图标文件名>.svg → image/svg+xml
 *   GET /file-icons/manifest.json    → 裁剪后的清单；**所有值都是「图标文件名（不含
 *                                      .svg）」**，消费端拼 `${basePath}/<值>.svg` 即可
 *   GET /file-icons/LICENSE          → text/plain；上游 material-icon-theme 的 MIT 许可原文
 *
 * 清单值由 `iconDefinitions[].iconPath` 反推，而不是直接用 iconId：上游存在
 * `angular-component.clone.svg` 这类 id 与文件名不一致的图标，用 id 拼 URL 会 404。
 *
 * dev 通过中间件按需投递；build 通过 emitFile 发射，两处共用同一份缓存。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 挂载到 `/file-icons`，故中间件内的 req.url 已是去掉该前缀的剩余路径。 */
const URL_BASE = '/file-icons';

/** 仅接受单层文件名，禁止 `/`、`..` 等路径成分（防目录穿越）。 */
const SVG_NAME_PATTERN = /^[A-Za-z0-9._-]+\.svg$/;

/** 键排序输出，保证多次构建产物字节稳定（dev 缓存与构建 diff 都依赖这点）。 */
function sortKeys(record) {
  const sorted = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

/**
 * iconId → SVG 文件名（不含 `.svg`）。
 *
 * 不能假设文件名等于 iconId：上游存在 `angular-component.clone.svg` 这类
 * 「id 与文件名不一致」的图标（36 个），用 id 直接拼 URL 会 404 并静默降级
 * 成通用图标。`iconDefinitions[].iconPath` 才是权威来源。
 */
function buildIconFileIndex(iconDefinitions) {
  const index = {};
  for (const [iconId, definition] of Object.entries(iconDefinitions ?? {})) {
    const iconPath = typeof definition?.iconPath === 'string' ? definition.iconPath : '';
    const fileName = iconPath.split('/').pop() ?? '';
    if (fileName.endsWith('.svg')) {
      index[iconId] = fileName.slice(0, -'.svg'.length);
    }
  }
  return index;
}

/** 清单里的值统一是「SVG 文件名（不含 .svg）」，消费端拼 `${basePath}/<值>.svg`。 */
function resolveIconFile(iconId, iconFiles) {
  const iconFile = iconFiles[iconId];
  if (!iconFile) {
    throw new Error(`[file-icons] 清单引用了 iconDefinitions 中不存在的 iconId：${iconId}`);
  }
  return iconFile;
}

/** 扩展名统一小写，值改写为 SVG 文件名。 */
function lowercaseKeys(record, iconFiles) {
  const out = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    out[key.toLowerCase()] = resolveIconFile(value, iconFiles);
  }
  return out;
}

/** 具名文件表的 key 必须保持原样（存在 `.pug-lintrc.js` 这类文件，不能 lower）。 */
function mapFileNames(record, iconFiles) {
  const out = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    out[key] = resolveIconFile(value, iconFiles);
  }
  return out;
}

/**
 * 目录名规范化：lowerCase + 去除非字母数字。
 * 上游同一目录名存在 `rust` / `_rust` / `-rust` / `__rust__` 等变体，规范化后必须
 * 收敛；若两个变体指向不同图标则语义冲突，直接抛错而非静默取其一。
 */
function normalizeFolderKeys(record, iconFiles) {
  const out = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    const canonical = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!canonical) {
      continue;
    }
    const iconFile = resolveIconFile(value, iconFiles);
    if (out[canonical] !== undefined && out[canonical] !== iconFile) {
      throw new Error(
        `[file-icons] 目录名规范化冲突：「${key}」→「${canonical}」映射到多个图标（${out[canonical]} vs ${iconFile}）`,
      );
    }
    out[canonical] = iconFile;
  }
  return out;
}

/** light 子集：4 个 map，各自规范化并排序；上游缺失时输出空对象。 */
function buildLightManifest(rawLight, iconFiles) {
  if (!rawLight || typeof rawLight !== 'object') {
    return {};
  }
  return {
    fileExtensions: sortKeys(lowercaseKeys(rawLight.fileExtensions, iconFiles)),
    fileNames: sortKeys(mapFileNames(rawLight.fileNames, iconFiles)),
    folderNames: sortKeys(normalizeFolderKeys(rawLight.folderNames, iconFiles)),
    folderNamesExpanded: sortKeys(normalizeFolderKeys(rawLight.folderNamesExpanded, iconFiles)),
  };
}

/**
 * 纯函数：把已解析的 `dist/material-icons.json` 裁剪为消费端清单。
 * 不读写文件，便于独立测试。
 */
export function buildMaterialIconManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== 'object') {
    throw new Error('[file-icons] material-icons.json 内容无效：期望对象');
  }
  const iconFiles = buildIconFileIndex(rawManifest.iconDefinitions);
  return {
    file: resolveIconFile(rawManifest.file ?? 'file', iconFiles),
    folder: resolveIconFile(rawManifest.folder ?? 'folder', iconFiles),
    folderExpanded: resolveIconFile(rawManifest.folderExpanded ?? 'folder-open', iconFiles),
    rootFolder: resolveIconFile(rawManifest.rootFolder ?? 'folder-root', iconFiles),
    rootFolderExpanded: resolveIconFile(
      rawManifest.rootFolderExpanded ?? 'folder-root-open',
      iconFiles,
    ),
    fileExtensions: sortKeys(lowercaseKeys(rawManifest.fileExtensions, iconFiles)),
    fileNames: sortKeys(mapFileNames(rawManifest.fileNames, iconFiles)),
    folderNames: sortKeys(normalizeFolderKeys(rawManifest.folderNames, iconFiles)),
    folderNamesExpanded: sortKeys(normalizeFolderKeys(rawManifest.folderNamesExpanded, iconFiles)),
    light: buildLightManifest(rawManifest.light, iconFiles),
  };
}

/** 收集清单实际引用到的全部图标文件名，用于校验资产完整性。 */
function collectReferencedIconFiles(manifest) {
  return new Set([
    manifest.file,
    manifest.folder,
    manifest.folderExpanded,
    manifest.rootFolder,
    manifest.rootFolderExpanded,
    ...Object.values(manifest.fileExtensions),
    ...Object.values(manifest.fileNames),
    ...Object.values(manifest.folderNames),
    ...Object.values(manifest.folderNamesExpanded),
    ...Object.values(manifest.light.fileExtensions ?? {}),
    ...Object.values(manifest.light.fileNames ?? {}),
    ...Object.values(manifest.light.folderNames ?? {}),
    ...Object.values(manifest.light.folderNamesExpanded ?? {}),
  ]);
}

/**
 * 读取包内清单与图标名，缓存一次供 dev/build 复用。
 * packageDir 由调用方从 apps/web 锚定解析（pnpm 下该包只位于 apps/web/node_modules）。
 */
function loadIconAssets(packageDir) {
  const manifestPath = join(packageDir, 'dist', 'material-icons.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`[file-icons] 未找到清单：${manifestPath}`);
  }
  const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifest = buildMaterialIconManifest(rawManifest);

  const iconsDir = join(packageDir, 'icons');
  const iconNames = listIconNames(iconsDir);
  const available = new Set(iconNames);
  const missing = [...collectReferencedIconFiles(manifest)].filter(
    (iconFile) => !available.has(`${iconFile}.svg`),
  );
  if (missing.length > 0) {
    throw new Error(`[file-icons] 清单引用了不存在的图标文件：${missing.join(', ')}`);
  }

  // MIT 要求随副本附版权与许可声明：图标会随产物对外分发，许可证必须同行。
  const licensePath = join(packageDir, 'LICENSE');
  if (!existsSync(licensePath)) {
    throw new Error(`[file-icons] 未找到 material-icon-theme 许可证：${licensePath}`);
  }
  const licenseText = readFileSync(licensePath, 'utf8');

  return { iconsDir, iconNames, manifestJson: JSON.stringify(manifest), licenseText };
}

/** 列出 icons 目录下全部 SVG（过滤隐藏文件），排序后返回文件名。 */
function listIconNames(iconsDir) {
  return readdirSync(iconsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.svg'))
    .sort();
}

/**
 * Vite 插件：dev 中间件 + build emit，同一份清单/图标缓存。
 */
export default function fileIconAssetsPlugin({ packageDir }) {
  const { iconsDir, iconNames, manifestJson, licenseText } = loadIconAssets(packageDir);
  const iconNameSet = new Set(iconNames);
  let cachedSources = null;

  // 延迟读取图标内容：build 才需要全量读，dev 命中哪个读哪个。
  function getSources() {
    if (cachedSources) {
      return cachedSources;
    }
    cachedSources = new Map();
    for (const name of iconNames) {
      cachedSources.set(name, readFileSync(join(iconsDir, name)));
    }
    return cachedSources;
  }

  function sendNotFound(res, message) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(message);
  }

  return {
    name: 'openawork:file-icon-assets',

    configureServer(server) {
      server.middlewares.use(URL_BASE, (req, res) => {
        const rawPath = (req.url ?? '').split('?')[0];
        let decodedPath;
        try {
          decodedPath = decodeURIComponent(rawPath);
        } catch {
          sendNotFound(res, 'Not Found');
          return;
        }

        if (decodedPath === '/manifest.json') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(manifestJson);
          return;
        }

        if (decodedPath === '/LICENSE') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(licenseText);
          return;
        }

        const name = decodedPath.startsWith('/') ? decodedPath.slice(1) : decodedPath;
        if (!SVG_NAME_PATTERN.test(name) || !iconNameSet.has(name)) {
          sendNotFound(res, 'Not Found');
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(readFileSync(join(iconsDir, name)));
      });
    },

    generateBundle() {
      const sources = getSources();
      for (const name of iconNames) {
        this.emitFile({
          type: 'asset',
          fileName: `${URL_BASE.slice(1)}/${name}`,
          source: sources.get(name),
        });
      }
      this.emitFile({
        type: 'asset',
        fileName: `${URL_BASE.slice(1)}/manifest.json`,
        source: manifestJson,
      });
      this.emitFile({
        type: 'asset',
        fileName: `${URL_BASE.slice(1)}/LICENSE`,
        source: licenseText,
      });
    },
  };
}
