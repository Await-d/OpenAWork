import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const workspaceRoot = path.join('/tmp', `openawork-session-summary-${randomUUID()}`);
  process.env['DATABASE_URL'] = ':memory:';
  process.env['WORKSPACE_ROOT'] = workspaceRoot;

  const [
    { default: Fastify },
    { default: authPlugin },
    { default: requestWorkflowPlugin },
    dbModule,
    fileDiffStore,
    snapshotStore,
    routes,
  ] = await Promise.all([
    import('fastify'),
    import('../auth.js'),
    import('../request-workflow.js'),
    import('../db.js'),
    import('../session-file-diff-store.js'),
    import('../session-snapshot-store.js'),
    import('../routes/sessions.js'),
  ]);

  const { closeDb, connectDb, migrate, sqliteGet, sqliteRun } = dbModule;
  const { persistSessionFileDiffs } = fileDiffStore;
  const { createRequestSnapshotRef, persistSessionSnapshot } = snapshotStore;
  const { sessionsRoutes } = routes;

  await connectDb();
  await migrate();

  try {
    const admin = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
      'admin@openAwork.local',
    ]);
    if (!admin) {
      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        randomUUID(),
        'admin@openAwork.local',
        createHash('sha256').update('admin123456').digest('hex'),
      ]);
    }

    const app = Fastify();
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(sessionsRoutes);
    await app.ready();

    try {
      const currentAdmin = sqliteGet<{ id: string }>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        ['admin@openAwork.local'],
      );
      assert(currentAdmin?.id, 'admin user should exist');
      const accessToken = app.jwt.sign({
        sub: currentAdmin.id,
        email: 'admin@openAwork.local',
      });

      const sessionRes = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      assert(
        sessionRes.statusCode === 201,
        `session create should succeed, got ${sessionRes.statusCode}: ${sessionRes.body}`,
      );
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };
      assert(
        typeof sessionId === 'string' && sessionId.length > 0,
        'session create should return sessionId',
      );

      persistSessionFileDiffs({
        sessionId,
        userId: currentAdmin.id,
        clientRequestId: 'req-route-1',
        requestId: 'req-route-1:tool:bash-1',
        toolName: 'bash',
        toolCallId: 'bash-1',
        diffs: [
          {
            file: 'copied.txt',
            before: '',
            after: 'hello\n',
            additions: 1,
            deletions: 0,
            status: 'added',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      });
      persistSessionSnapshot({
        sessionId,
        userId: currentAdmin.id,
        snapshotRef: createRequestSnapshotRef('req-route-1'),
        fileDiffs: [
          {
            file: 'copied.txt',
            before: '',
            after: 'hello\n',
            additions: 1,
            deletions: 0,
            status: 'added',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      });
      const getRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const getPayload = JSON.parse(getRes.body) as {
        session: {
          fileChangesSummary: {
            latestSnapshotRef: string;
            snapshotCount: number;
            sourceKinds: string[];
            totalFileDiffs: number;
            weakestGuaranteeLevel: string;
          };
        };
      };
      assert(
        getPayload.session.fileChangesSummary.totalFileDiffs === 1,
        'session get should expose file diff count in fileChangesSummary',
      );
      assert(
        getPayload.session.fileChangesSummary.snapshotCount === 1,
        'session get should expose snapshot count in fileChangesSummary',
      );
      assert(
        getPayload.session.fileChangesSummary.weakestGuaranteeLevel === 'weak',
        'session get should expose weakest guarantee level',
      );
      assert(
        getPayload.session.fileChangesSummary.latestSnapshotRef === 'req:req-route-1',
        'session get should expose latest snapshot ref',
      );
      assert(
        getPayload.session.fileChangesSummary.sourceKinds.includes('workspace_reconcile'),
        'session get should expose reconcile source kind',
      );

      const listRes = await app.inject({
        method: 'GET',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const listPayload = JSON.parse(listRes.body) as {
        sessions: Array<{
          fileChangesSummary?: {
            totalFileDiffs: number;
            weakestGuaranteeLevel: string;
          };
          id: string;
        }>;
      };
      const listedSession = listPayload.sessions.find((session) => session.id === sessionId);
      assert(listedSession, 'session list should include the created session');
      assert(
        listedSession.fileChangesSummary?.totalFileDiffs === 1,
        'session list should expose file diff count in fileChangesSummary',
      );
      assert(
        listedSession.fileChangesSummary?.weakestGuaranteeLevel === 'weak',
        'session list should expose weakest guarantee level in fileChangesSummary',
      );

      const sessionChangesRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/file-changes`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const sessionChangesPayload = JSON.parse(sessionChangesRes.body) as {
        fileChanges: {
          fileDiffs: Array<Record<string, unknown>>;
          snapshots: Array<Record<string, unknown>>;
          summary: { totalFileDiffs: number; snapshotCount: number };
        };
      };
      assert(
        sessionChangesPayload.fileChanges.summary.totalFileDiffs === 1,
        'session file-changes should expose summary diff count',
      );
      assert(
        sessionChangesPayload.fileChanges.fileDiffs[0]?.['after'] === undefined,
        'session file-changes should omit text payloads by default',
      );
      assert(
        sessionChangesPayload.fileChanges.snapshots[0]?.['files'] === undefined,
        'session file-changes should omit snapshot files by default',
      );
      assert(
        sessionChangesPayload.fileChanges.snapshots[0]?.['summary'] &&
          !(
            'backupBeforeRefs' in
            (sessionChangesPayload.fileChanges.snapshots[0]['summary'] as Record<string, unknown>)
          ),
        'session file-changes should omit backup refs from default snapshot summaries',
      );

      const requestChangesRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/requests/req-route-1/file-changes?includeText=true`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const requestChangesPayload = JSON.parse(requestChangesRes.body) as {
        clientRequestId: string;
        fileChanges: {
          fileDiffs: Array<Record<string, unknown>>;
          snapshots: Array<Record<string, unknown>>;
          summary: { snapshotCount: number; totalFileDiffs: number };
        };
      };
      assert(
        requestChangesPayload.clientRequestId === 'req-route-1',
        'request file-changes should echo clientRequestId',
      );
      assert(
        requestChangesPayload.fileChanges.summary.snapshotCount === 1,
        'request file-changes should only include request-scoped snapshots',
      );
      assert(
        requestChangesPayload.fileChanges.fileDiffs[0]?.['after'] === 'hello\n',
        'request file-changes should include text payloads when requested',
      );
      assert(
        Array.isArray(requestChangesPayload.fileChanges.snapshots[0]?.['files']),
        'request file-changes should include snapshot files when includeText=true',
      );

      persistSessionSnapshot({
        sessionId,
        userId: currentAdmin.id,
        snapshotRef: 'backup:backup-1',
        fileDiffs: [
          {
            file: 'copied.txt',
            before: 'hello\n',
            after: 'hello\nworld\n',
            additions: 1,
            deletions: 0,
            status: 'modified',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      });

      const snapshotsRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/snapshots`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const snapshotsPayload = JSON.parse(snapshotsRes.body) as {
        snapshots: Array<Record<string, unknown>>;
      };
      assert(
        snapshotsPayload.snapshots.length === 2,
        'snapshot list should include both snapshots',
      );
      assert(
        snapshotsPayload.snapshots.every((snapshot) => snapshot['files'] === undefined),
        'snapshot list should omit file payloads',
      );
      assert(
        snapshotsPayload.snapshots.every(
          (snapshot) =>
            !('backupBeforeRefs' in ((snapshot['summary'] as Record<string, unknown>) ?? {})) &&
            !('backupAfterRefs' in ((snapshot['summary'] as Record<string, unknown>) ?? {})),
        ),
        'snapshot list should omit backup refs from default summaries',
      );

      const snapshotDetailRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/snapshots/${encodeURIComponent('req:req-route-1')}?includeText=true`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const snapshotDetailPayload = JSON.parse(snapshotDetailRes.body) as {
        snapshot: { files?: unknown[]; snapshotRef: string };
      };
      assert(
        snapshotDetailPayload.snapshot.snapshotRef === 'req:req-route-1',
        'snapshot detail should return the requested ref',
      );
      assert(
        Array.isArray(snapshotDetailPayload.snapshot.files),
        'snapshot detail should include files when includeText=true',
      );

      const snapshotCompareRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/snapshots/compare?from=${encodeURIComponent('req:req-route-1')}&to=${encodeURIComponent('backup:backup-1')}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const snapshotComparePayload = JSON.parse(snapshotCompareRes.body) as {
        comparison: Array<Record<string, unknown>>;
        from: Record<string, unknown>;
        to: Record<string, unknown>;
      };
      assert(
        snapshotComparePayload.comparison[0]?.['changed'] === true,
        'snapshot compare should mark changed files',
      );
      assert(
        snapshotComparePayload.from['files'] === undefined &&
          snapshotComparePayload.to['files'] === undefined,
        'snapshot compare should omit full files by default',
      );

      console.log('verify-session-file-summary-routes: ok');
    } finally {
      await app.close();
    }
  } finally {
    await closeDb();
    rmSync(workspaceRoot, { recursive: true, force: true });
    delete process.env['DATABASE_URL'];
    delete process.env['WORKSPACE_ROOT'];
  }
}

void main().catch((error) => {
  console.error('verify-session-file-summary-routes: failed');
  console.error(error);
  process.exitCode = 1;
});
