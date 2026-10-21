/**
 * 实时预览帧的解码。
 *
 * 三条路径，按「主线程成本」从低到高依次尝试：
 *
 * 1. **data URL + `fetch`**（首选）：base64 解析与 JPEG 解码都在浏览器实现层完成，
 *    主线程只做一次字符串拼接与一次 `Blob` 创建；`atob` + 逐字节搬运（百 KB 级
 *    帧要 2–5ms）完全消失——这是「画面掉帧 / 点击延迟」里最容易被低估的一块。
 * 2. **`createImageBitmap` + 手动 Blob**：JPEG 解码仍在主线程之外，但 `atob` 与
 *    字节搬运要占主线程；部分环境 CSP（`connect-src`）拦住 data: fetch 时走这里。
 * 3. **离屏 `<img>` + data URL**：老 WebKit 没有 `createImageBitmap` 时的兜底，
 *    保证画面不会凭空消失——回退路径只是慢，不是不可用。
 */

export interface FrameDecodeInput {
  /** `frame` 信封的 `data`：JPEG 的 base64（不含 `data:` 前缀）。 */
  base64: string;
  mimeType: string;
}

export interface DecodedFrame {
  source: CanvasImageSource;
  /** 位图像素尺寸（canvas 的 backing store 直接按它定尺寸）。 */
  width: number;
  height: number;
  /** 释放底层资源：`ImageBitmap` 需要 `close()`，`<img>` 需要断开回调。 */
  release: () => void;
}

/** 当前环境能否离主线程解码（能力探测，UI 与诊断都只看这一个口子）。 */
export function canDecodeFrameOffThread(): boolean {
  return typeof createImageBitmap === 'function';
}

/**
 * base64 → Blob。
 *
 * 不走 `data:` URL：那要先拼一个与 base64 等长的字符串再交给浏览器解析，
 * 每帧都复制一遍；这里只做一次 `atob` 与一次字节搬运。
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * data: URL 的 fetch 是否可用。
 *
 * 部分环境（CSP `connect-src` 不含 data:、非浏览器 fetch 实现）第一次就会失败；
 * 置位后不再重试，避免每帧都白付一次异常开销。能力是静态的，记住是安全的。
 */
let dataUrlFetchDisabled = false;

interface FetchDecodeResult {
  /** `decoded` = 走完了解码（frame 为 null 表示数据本身无效）；`unavailable` = 环境不支持。 */
  readonly status: 'decoded' | 'unavailable';
  readonly frame: DecodedFrame | null;
}

/**
 * 首选路径：把「base64 → 字节」交给浏览器实现层。
 *
 * 返回 `unavailable` 而不是 null，是为了把「环境不支持」与「这帧数据坏了」区分开：
 * 前者必须继续向下回退，后者再走一遍手动解码也不会成功。
 */
async function decodeFrameWithFetch(input: FrameDecodeInput): Promise<FetchDecodeResult> {
  if (
    dataUrlFetchDisabled ||
    typeof fetch !== 'function' ||
    typeof createImageBitmap !== 'function'
  ) {
    return { status: 'unavailable', frame: null };
  }

  try {
    const response = await fetch(`data:${input.mimeType};base64,${input.base64}`);
    if (!response.ok) {
      return { status: 'unavailable', frame: null };
    }
    const blob = await response.blob();
    if (blob.size === 0) {
      return { status: 'decoded', frame: null };
    }
    const bitmap = await createImageBitmap(blob);
    if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
      bitmap.close();
      return { status: 'decoded', frame: null };
    }
    return {
      status: 'decoded',
      frame: {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      },
    };
  } catch {
    // CSP 拦截 / data: 不被支持 / 位图损坏：交给手动解码路径再判一次。
    dataUrlFetchDisabled = true;
    return { status: 'unavailable', frame: null };
  }
}

/**
 * 直接解码原始 JPEG 字节（二进制帧路径）。
 *
 * 这条路径没有 base64、没有 data URL、也没有任何主线程字符串处理：拿到 ArrayBuffer
 * 后只剩一次 Blob 包装与离主线程解码。`createImageBitmap` 不可用的环境返回 null，
 * 调用方据此不协商二进制帧（见 `canDecodeFrameOffThread`）。
 */
export async function decodeFrameFromBytes(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<DecodedFrame | null> {
  if (typeof createImageBitmap !== 'function') {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
      bitmap.close();
      return null;
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

/** 解码一帧；数据无效 / 解码失败时返回 null（调用方仍必须回 ack）。 */
export async function decodeFrame(input: FrameDecodeInput): Promise<DecodedFrame | null> {
  const fetched = await decodeFrameWithFetch(input);
  if (fetched.status === 'decoded') {
    return fetched.frame;
  }

  if (canDecodeFrameOffThread()) {
    const bitmap = await createImageBitmap(base64ToBlob(input.base64, input.mimeType));
    if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
      bitmap.close();
      return null;
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  return await decodeFrameWithImageElement(input);
}

/** 回退路径：离屏 `<img>` + data URL，等 `load` 后交给 canvas 绘制。 */
async function decodeFrameWithImageElement(input: FrameDecodeInput): Promise<DecodedFrame | null> {
  return await new Promise<DecodedFrame | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!(width > 0) || !(height > 0)) {
        resolve(null);
        return;
      }
      resolve({
        source: image,
        width,
        height,
        release: () => {
          image.onload = null;
          image.onerror = null;
        },
      });
    };
    image.onerror = () => resolve(null);
    image.src = `data:${input.mimeType};base64,${input.base64}`;
  });
}
