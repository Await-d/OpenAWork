/**
 * 浏览器/移动端可用的 UUID v4 生成器。
 *
 * 为什么不能到处直接写 `crypto.randomUUID()`：
 * 该方法只在**安全上下文**（HTTPS / localhost / file）下才由宿主暴露。通过
 * `http://<内网 IP 或内网域名>` 反代访问时 `crypto.randomUUID` 是 `undefined`，
 * 直接调用抛 `TypeError: crypto.randomUUID is not a function`。这类调用又几乎都
 * 落在 toast、消息规范化、请求 id 这些**非关键路径**上，一旦抛错会顺着 React 树
 * 把整页打崩（线上表现为「团队页白屏 + unhandled rejection」）。
 *
 * 降级顺序（后者仅在前者不可用时启用）：
 * 1. `crypto.randomUUID` —— 安全上下文可用，密码学随机；
 * 2. `crypto.getRandomValues` —— 非安全上下文仍可用，同为密码学随机，手工拼 v4；
 * 3. `Math.random` —— 最后兜底，伪随机，**只可用于瞬态 UI id，禁止用于安全用途**
 *    （token / 幂等键 / 签名等）。
 */
export function createRandomUuid(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 §4.4：第 7 字节高 4 位固定为版本 4，第 9 字节高 2 位固定为变体 1。
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
