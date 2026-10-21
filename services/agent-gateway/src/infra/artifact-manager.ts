/**
 * 磁盘型产物（`ARTIFACTS_DIR` + `artifacts-index.json`）的**进程内唯一实例**。
 *
 * 背景：`ArtifactManagerImpl` 的内存 `Map` 是索引的全量视图，`persistArtifacts` 每次
 * 写入都会把内存 Map 整体重写回索引文件。此前 `routes/artifacts.ts` 与
 * `routes/session-images.ts` 各自 `new` 了一份实例指向同一个索引文件——两份内存视图
 * 互不可见，A 实例的写入会把 B 实例刚加的条目覆盖掉。
 *
 * 共享单例后，谁持有引用都能看到同一份索引，`session/composer-queue-artifact-purge.ts`
 * 的删除也就不会被下一次上传的「全量重写」复活。
 *
 * 懒加载而非模块顶层实例化：路由模块在测试里会被反复 import，索引路径解析依赖
 * 环境变量（`OPENAWORK_DATA_DIR`），延迟到首次使用可以保证读到的是最终环境。
 */
import { ArtifactManagerImpl } from '@openAwork/artifacts';
import { resolveGatewayArtifactsIndexPath } from './storage-paths.js';

let artifactManager: ArtifactManagerImpl | null = null;

export function getGatewayArtifactManager(): ArtifactManagerImpl {
  if (!artifactManager) {
    artifactManager = new ArtifactManagerImpl({
      indexFilePath: resolveGatewayArtifactsIndexPath(),
    });
  }
  return artifactManager;
}
