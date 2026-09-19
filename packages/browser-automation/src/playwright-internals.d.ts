/**
 * `playwright-core` 内部子路径的运行时类型声明。
 *
 * 这些子路径在 `playwright-core/package.json` 的 `exports` 映射中可见，但发布包**不带**
 * 对应的 `.d.ts`（源码用 TS 编写、仅发布编译产物），因此在严格模式下直接 import 会报
 * TS7016。这里按运行时真实形状补充环境声明，避免使用 `@ts-ignore` / `as any`。
 *
 * 说明：`registry` 的元数据来自 `playwright-core/lib/server/registry/index.js` 在内联
 * `browsers.json` 后构造的注册表；`zipBundle` / `utilsBundle` 分别提供 zip 解压与
 * 代理解析能力。以上导入均已在本仓库的 Node ESM 下验证可解析（含命名导出）。
 */

declare module 'playwright-core/lib/server/registry/index' {
  /** Playwright 注册表中的单个浏览器可执行项（仅声明本包用到的字段）。 */
  export interface PlaywrightRegistryExecutable {
    name: string;
    revision: string;
    browserVersion?: string;
    directory?: string;
    executablePath(): string | undefined;
    downloadURLs: string[];
  }

  export const registry: {
    findExecutable(name: string): PlaywrightRegistryExecutable | undefined;
  };
}

declare module 'playwright-core/lib/zipBundle' {
  export function extract(zipPath: string, options: { dir: string }): Promise<void>;
}

declare module 'playwright-core/lib/utilsBundle' {
  import type { Agent } from 'node:http';

  export function getProxyForUrl(url: string): string;
  export const HttpsProxyAgent: new (proxy: string) => Agent;
  export const SocksProxyAgent: new (proxy: string) => Agent;
}
