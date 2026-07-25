export function resolveMediaBinaryPath(
  configuredPath: string | undefined,
  bundledPath: unknown,
): string | null {
  if (configuredPath?.trim()) {
    return configuredPath;
  }
  return typeof bundledPath === 'string' ? bundledPath : null;
}
