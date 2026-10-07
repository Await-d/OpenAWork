import { HttpError } from '@openAwork/web-client';

/**
 * 预览体积上限（10MB），与网关 `MAX_FILE_BYTES` 保持一致。
 *
 * 网关对超限文件一律返回 413（不再返回截断内容），前端据此给出明确提示。
 * 两处常量必须同步修改，否则用户会看到与实际行为不符的文案。
 */
export const FILE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** 上限的人读标签，供 UI 文案拼装（避免各处硬编码 "10MB" 字符串）。 */
export const FILE_PREVIEW_MAX_LABEL = '10MB';

/** 统一的过大提示。用于编辑器、Office 预览、hover 预览三处入口。 */
export const FILE_TOO_LARGE_MESSAGE = `文件超过 ${FILE_PREVIEW_MAX_LABEL} 预览上限，暂不支持预览与编辑。请下载后用本地应用打开。`;

/**
 * 并发门控拒绝（429）时的提示。措辞刻意表达「稍后重试」而非「不支持」——
 * 这是临时状态，重试即可成功。
 */
export const FILE_PREVIEW_BUSY_MESSAGE =
  '正在预览其它大文件，请稍后重试。也可以先用编辑器打开或下载该文件。';

/**
 * 判断错误是否为「文件超过预览上限」。
 *
 * 三个消费点都要用到（openFile / useOfficeFile / useFilePreview），集中判定
 * 避免各自 try/catch 猜状态码。
 */
export function isFileTooLargeError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 413;
}

/**
 * 判断错误是否为「大文件预览请求过多 / 排队超时」（网关并发门控返回 429）。
 *
 * 这是**临时**状态（槽位释放后重试即可），与 413 的「永久不支持」必须区分：
 * 文案不能写成「文件过大不支持预览」，否则用户会以为文件本身有问题。
 */
export function isPreviewBusyError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 429;
}

/**
 * 把读取文件的异常转成用户可读文案：超限 / 繁忙走统一提示，其余保留原始信息。
 */
export function describeFileReadError(error: unknown, fallback: string): string {
  if (isFileTooLargeError(error)) {
    return FILE_TOO_LARGE_MESSAGE;
  }
  if (isPreviewBusyError(error)) {
    return FILE_PREVIEW_BUSY_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
