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
 * 「解析失败」类拒绝的可自查后缀。
 *
 * 上游 `assertPublicHttpUrlResolved` 只抛 `Error.message`、不带错误码，这里按已知
 * 文案归类；归类失败时退回不带后缀的通用文案，**不**自行做第二份网段判定。
 * 「解析到非公网地址」最常见的成因是本机 fake-IP DNS（Clash TUN 等），所以直接把
 * 放行开关写进文案，避免用户对着一堆公网 URL 无从排查。
 */
const FAKE_IP_HINT =
  '若本机使用 Clash 等 fake-IP DNS（常见为 198.18.0.0/15），请为网关进程设置 FAKE_IP_CIDRS=198.18.0.0/15 后重启。';

/**
 * 返回 `null` 表示通过；否则返回调用方给定的本地化 `message`（可附带失败原因后缀）。
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
  } catch (error) {
    return `${message}${describeResolvedFailure(error)}`;
  }
}

/**
 * 仅补充「为什么被拒」的诊断后缀；字面量私有地址 / 非 HTTP 协议在
 * `isPublicHttpUrl` 阶段就被拦下，不会走到这里。
 */
function describeResolvedFailure(error: unknown): string {
  const reason = error instanceof Error ? error.message : '';
  if (reason.includes('could not be resolved')) {
    return '（域名解析失败，请检查网络与 DNS 配置。）';
  }
  if (reason.includes('resolves to a private or local network target')) {
    return `（域名解析到非公网地址。${FAKE_IP_HINT}）`;
  }
  return '';
}
