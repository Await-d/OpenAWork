const HIDDEN_FILE_TREE_ENTRY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.DS_Store',
]);

export function joinFileTreePath(directoryPath: string, entryName: string): string {
  if (directoryPath === '/') {
    return `/${entryName}`;
  }

  return `${directoryPath}/${entryName}`;
}

export function isValidFileTreeEntryName(entryName: string): boolean {
  return (
    entryName.length > 0 &&
    !/[\\/]/.test(entryName) &&
    entryName !== '.' &&
    entryName !== '..' &&
    !HIDDEN_FILE_TREE_ENTRY_NAMES.has(entryName)
  );
}

export async function getResponseErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  } catch (error) {
    console.warn('读取接口错误信息失败', error);
    return fallbackMessage;
  }

  return fallbackMessage;
}

export function getFileTreeRelativePath(
  rootPath: string | null,
  targetPath: string,
): string | null {
  if (!rootPath) {
    return null;
  }

  const normalizedRoot = rootPath === '/' ? rootPath : rootPath.replace(/\/+$/, '');
  const normalizedTarget = targetPath === '/' ? targetPath : targetPath.replace(/\/+$/, '');

  if (normalizedRoot === normalizedTarget) {
    return '.';
  }

  const rootPrefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  if (!normalizedTarget.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedTarget.slice(rootPrefix.length);
}

function copyWithHiddenTextArea(text: string): void {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('当前环境不支持复制');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('浏览器未允许复制');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  copyWithHiddenTextArea(text);
}
