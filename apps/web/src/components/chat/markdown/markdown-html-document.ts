export function isFullHtmlDocument(code: string): boolean {
  const trimmed = code.trimStart().slice(0, 200).toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}
