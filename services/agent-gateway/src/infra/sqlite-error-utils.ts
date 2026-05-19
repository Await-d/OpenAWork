export function isSqliteMalformedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /database disk image is malformed/iu.test(error.message);
}
