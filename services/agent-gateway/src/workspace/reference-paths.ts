import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_CANDIDATES = [
  process.env['OPENAWORK_REPO_ROOT'],
  path.resolve(CURRENT_DIR, '../../..'),
  process.cwd(),
].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

export function resolveReferencePath(...segments: string[]): string {
  const base = REPO_ROOT_CANDIDATES[0] ?? process.cwd();
  return path.resolve(base, ...segments);
}
