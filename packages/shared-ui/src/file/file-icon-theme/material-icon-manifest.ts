/**
 * Material 图标清单加载器。
 *
 * 清单来自静态资产端点，进程内只需加载一次：模块级缓存把同一 basePath 的
 * promise 复用，避免每个图标组件各发一次请求。加载失败会清空对应缓存，
 * 使后续挂载可以重试，而不是被一个 rejected promise 永久毒化。
 */

import { useEffect, useState } from 'react';

import type { MaterialIconManifest, MaterialIconManifestLight } from './types.js';

export const FILE_ICON_BASE_PATH = '/file-icons';

const manifestCache = new Map<string, Promise<MaterialIconManifest>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 表值必须是图标文件名；非字符串会拼出 `[object Object].svg` 这类无效 URL。 */
function isStringTable(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

/** `light` 可选；存在时必须是对象，其子表同样只能是字符串表（缺省子表回退主表）。 */
function isLightOverride(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    (value.fileExtensions === undefined || isStringTable(value.fileExtensions)) &&
    (value.fileNames === undefined || isStringTable(value.fileNames)) &&
    (value.folderNames === undefined || isStringTable(value.folderNames)) &&
    (value.folderNamesExpanded === undefined || isStringTable(value.folderNamesExpanded))
  );
}

function isMaterialIconManifest(value: unknown): value is MaterialIconManifest {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === 'string' &&
    typeof value.folder === 'string' &&
    typeof value.folderExpanded === 'string' &&
    typeof value.rootFolder === 'string' &&
    typeof value.rootFolderExpanded === 'string' &&
    isStringTable(value.fileExtensions) &&
    isStringTable(value.fileNames) &&
    isStringTable(value.folderNames) &&
    isStringTable(value.folderNamesExpanded) &&
    isLightOverride(value.light)
  );
}

/**
 * 查表方（`resolve-file-icon.ts`）直接做 `table[key]`，普通对象会命中原型链上的
 * `constructor` / `toString` 等继承键。复制为 null 原型对象后，未命中严格等于 undefined。
 */
function isolateTable(table: Record<string, string>): Record<string, string> {
  return Object.assign(Object.create(null) as Record<string, string>, table);
}

function isolateLight(light: MaterialIconManifestLight): MaterialIconManifestLight {
  return {
    ...light,
    ...(light.fileExtensions ? { fileExtensions: isolateTable(light.fileExtensions) } : {}),
    ...(light.fileNames ? { fileNames: isolateTable(light.fileNames) } : {}),
    ...(light.folderNames ? { folderNames: isolateTable(light.folderNames) } : {}),
    ...(light.folderNamesExpanded
      ? { folderNamesExpanded: isolateTable(light.folderNamesExpanded) }
      : {}),
  };
}

function isolateManifest(manifest: MaterialIconManifest): MaterialIconManifest {
  return {
    ...manifest,
    fileExtensions: isolateTable(manifest.fileExtensions),
    fileNames: isolateTable(manifest.fileNames),
    folderNames: isolateTable(manifest.folderNames),
    folderNamesExpanded: isolateTable(manifest.folderNamesExpanded),
    ...(manifest.light ? { light: isolateLight(manifest.light) } : {}),
  };
}

export function loadMaterialIconManifest(
  basePath: string = FILE_ICON_BASE_PATH,
): Promise<MaterialIconManifest> {
  const cached = manifestCache.get(basePath);
  if (cached) return cached;

  const promise = (async (): Promise<MaterialIconManifest> => {
    const response = await fetch(`${basePath}/manifest.json`);
    if (!response.ok) {
      throw new Error(`文件图标清单加载失败：HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!isMaterialIconManifest(data)) {
      throw new Error('文件图标清单格式不合法');
    }
    return isolateManifest(data);
  })().catch((error: unknown) => {
    manifestCache.delete(basePath);
    throw error;
  });

  manifestCache.set(basePath, promise);
  return promise;
}

/**
 * 订阅清单加载结果；未就绪或失败时返回 `null`，由组件降级为通用图标。
 * 失败信息存入 state 以驱动重渲染，但不向调用方暴露——图标是纯装饰信息，
 * 不值得把网络错误抛进渲染树。
 */
export function useMaterialIconManifest(
  basePath: string = FILE_ICON_BASE_PATH,
): MaterialIconManifest | null {
  const [manifest, setManifest] = useState<MaterialIconManifest | null>(null);
  const [, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    setManifest(null);
    void loadMaterialIconManifest(basePath)
      .then((loaded) => {
        if (active) setManifest(loaded);
      })
      .catch((error: unknown) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
    };
  }, [basePath]);

  return manifest;
}
