import {
  assertPublicHttpUrlResolved,
  isPublicHttpUrl as isUpstreamPublicHttpUrl,
} from 'open-websearch/build/utils/urlSafety.js';

/**
 * 公开 HTTP(S) URL 的 SSRF 守卫（中性模块，供 mcp / tools 等各层复用）。
 *
 * 分类与解析语义**完全委托上游 open-websearch 的 urlSafety**（`ipaddr.js` 的
 * `range() !== 'unicast'`），避免仓库内再出现第二份手写网段判定而与库漂移；
 * `FAKE_IP_CIDRS` 等 fake-IP 放行也由上游统一处理。
 */
export const PUBLIC_HTTP_URL_MESSAGE = '只支持公开 HTTP(S) 网页 URL。';

export function isPublicHttpUrl(value: string): boolean {
  return isUpstreamPublicHttpUrl(value);
}

/**
 * 返回 `null` 表示通过；否则返回调用方给定的本地化 `message`。
 *
 * 注意：此处的 `catch` 是**有意的哨兵转换**（把校验失败/解析失败统一收敛为
 * 调用方文案），并非吞掉异常——与仓库内 `assertLookAtFileWithinLimit` 等同类
 * 校验的写法一致。
 */
export async function readPublicUrlError(value: string, message: string): Promise<string | null> {
  if (!isPublicHttpUrl(value)) {
    return message;
  }

  try {
    await assertPublicHttpUrlResolved(value, 'Request URL');
    return null;
  } catch {
    return message;
  }
}
