/**
 * Regression (§0.118, artifact store corrupt-row tolerance):
 * rowToArtifactRecord / rowToArtifactVersionRecord parse `metadata_json` /
 * `diff_json` and are used via `rows.map(...)` in listArtifactsBySession,
 * listImageWorkbenchArtifacts, and listArtifactVersions. The parses were
 * unguarded, so one corrupt row (crash mid-write, disk error, hand-edited DB)
 * threw and made the WHOLE listing unreadable. The parses now degrade a corrupt
 * metadata to {} and a corrupt diff to [] + warn so the bad row stays listable.
 *
 * We seed two artifacts (+ a version each), corrupt one row's JSON column
 * directly, and assert the listings still return BOTH rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ArtifactStoreModule from '../../session/artifact-content-store.js';
import type { ArtifactRecord, ArtifactVersionRecord } from '@openAwork/artifacts';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof ArtifactStoreModule;

const USER_ID = 'u-artifact-store';
const SESSION_ID = 's-artifact-store';

function seedUserAndSession(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'artifact-store@example.com',
  ]);
  dbModule.sqliteRun(
    "INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status) VALUES (?, ?, 'demo', '{}', 'idle')",
    [SESSION_ID, USER_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../session/artifact-content-store.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM artifact_versions', []);
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUserAndSession();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('artifact store corrupt-row resilience', () => {
  it('listArtifactsBySession: 单行 metadata_json 损坏时不抛出，仍返回全部产物', () => {
    const good = store.createArtifact(USER_ID, {
      sessionId: SESSION_ID,
      title: 'good',
      content: 'good body',
      type: 'markdown',
      metadata: { source: 'agent' },
    });
    const poison = store.createArtifact(USER_ID, {
      sessionId: SESSION_ID,
      title: 'poison',
      content: 'poison body',
      type: 'markdown',
      metadata: { source: 'agent' },
    });
    // Corrupt the poison artifact's metadata_json directly.
    dbModule.sqliteRun('UPDATE artifacts SET metadata_json = ? WHERE id = ?', [
      '{not valid json',
      poison.id,
    ]);

    let list: ArtifactRecord[] | undefined;
    expect(() => {
      list = store.listArtifactsBySession(USER_ID, SESSION_ID);
    }).not.toThrow();

    // Both artifacts returned; poison's metadata degraded to {}.
    const ids = (list ?? []).map((a) => a.id).sort();
    expect(ids).toEqual([good.id, poison.id].sort());
    const poisonRecord = list?.find((a) => a.id === poison.id);
    expect(poisonRecord?.metadata).toEqual({});
    expect(console.warn).toHaveBeenCalled();
  });

  it('listArtifactVersions: 单行 diff_json 损坏时不抛出，仍返回全部版本', () => {
    const artifact = store.createArtifact(USER_ID, {
      sessionId: SESSION_ID,
      title: 'versioned',
      content: 'v1',
      type: 'markdown',
    });
    // Second version → produces an artifact_versions row with a diff_json.
    store.updateArtifact(USER_ID, artifact.id, { content: 'v2 changed' });

    // Corrupt one version row's diff_json.
    const versionRow = dbModule.sqliteGet<{ id: string }>(
      'SELECT id FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number ASC LIMIT 1',
      [artifact.id],
    );
    expect(versionRow?.id).toBeDefined();
    dbModule.sqliteRun('UPDATE artifact_versions SET diff_json = ? WHERE id = ?', [
      '{not valid json',
      versionRow!.id,
    ]);

    let versions: ArtifactVersionRecord[] | undefined;
    expect(() => {
      versions = store.listArtifactVersions(USER_ID, artifact.id);
    }).not.toThrow();

    // All versions returned; the corrupt one's diff degraded to [].
    expect((versions ?? []).length).toBeGreaterThanOrEqual(2);
    const corrupt = versions?.find((v) => v.id === versionRow!.id);
    expect(corrupt?.diffFromPrevious).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});
