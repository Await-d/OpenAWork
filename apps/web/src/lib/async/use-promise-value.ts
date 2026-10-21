/**
 * `usePromiseValue` —— 把 {@link PromiseCache} 接到 React 的 `use()` 上。
 *
 * 这是「数据获取迁 `use()` + `<Suspense>`」的落点：组件不再需要
 * `useEffect` + `setLoading` / `setError` 三件套，挂起态与错误态分别交给
 * `<Suspense fallback>` 与错误边界。
 *
 * ## 用法
 *
 * ```tsx
 * const agentCatalog = createPromiseCache<AgentInfo[]>({ ttlMs: 5 * 60_000 });
 *
 * function AgentList() {
 *   const agents = usePromiseValue(agentCatalog, 'all', () => listAgents());
 *   return <ul>{agents.map((a) => <li key={a.id}>{a.name}</li>)}</ul>;
 * }
 *
 * // 上层必须有边界
 * <Suspense fallback={<Spinner />}>
 *   <AgentList />
 * </Suspense>
 * ```
 *
 * ## 约束
 *
 * - **缓存必须是模块级或长期存活的实例**（`useRef` 也不行——它每个组件一份，
 *   起不到跨组件复用与去重的作用）。在渲染期新建缓存等同于没有缓存。
 * - 上层必须有 `<Suspense>`，否则挂起会冒泡到根；`load` reject 时由错误边界接管。
 * - 缓存实例决定 TTL 语义，`usePromiseValue` 本身不做失效判断。
 */

import { use } from 'react';
import type { PromiseCache } from './promise-cache.js';

/**
 * 读取缓存中的值；未命中时用 `load` 取数并缓存。
 *
 * 命中时**不会**调用 `load`，因此 `load` 的引用不稳定（每次渲染新建箭头函数）
 * 不会造成额外请求——只有真正未命中时它才会被执行。
 */
export function usePromiseValue<V>(cache: PromiseCache<V>, key: string, load: () => Promise<V>): V {
  return use(cache.get(key, load));
}
