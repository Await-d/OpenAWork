import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function execGit(args: string[], cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('git', args, { cwd });
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
    backupStore,
    routes,
  ] = await Promise.all([
    import('fastify'),
    import('../auth.js'),
    import('../request-workflow.js'),
    import('../db.js'),
    import('../session-file-diff-store.js'),
    import('../session-snapshot-store.js'),
    import('../session-file-backup-store.js'),
    import('../routes/sessions.js'),
  ]);

  const { closeDb, connectDb, migrate, sqliteGet, sqliteRun } = dbModule;
  const { persistSessionFileDiffs } = fileDiffStore;
  const { createRequestSnapshotRef, persistSessionSnapshot } = snapshotStore;
  const { persistSessionFileBackup } = backupStore;
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

      const restoreTargetPath = path.join(workspaceRoot, 'restorable.txt');
      mkdirSync(path.dirname(restoreTargetPath), { recursive: true });
      writeFileSync(restoreTargetPath, 'current\n', 'utf8');

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
      const backup = await persistSessionFileBackup({
        sessionId,
        userId: currentAdmin.id,
        filePath: restoreTargetPath,
        content: 'backup\n',
        kind: 'before_write',
        toolName: 'edit',
        requestId: 'req-route-restore',
        toolCallId: 'call-restore-1',
      });
      const secondSessionRes = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const secondSessionId = (JSON.parse(secondSessionRes.body) as { sessionId: string })
        .sessionId;
      const secondRestoreTargetPath = path.join(workspaceRoot, 'restorable-2.txt');
      writeFileSync(secondRestoreTargetPath, 'current-two\n', 'utf8');
      const sharedBackup = await persistSessionFileBackup({
        sessionId: secondSessionId,
        userId: currentAdmin.id,
        filePath: secondRestoreTargetPath,
        content: 'backup\n',
        kind: 'before_write',
        toolName: 'write',
        requestId: 'req-route-restore-2',
        toolCallId: 'call-restore-2',
      });
      assert(
        sharedBackup.storagePath === backup.storagePath,
        'equal content should share the same backup storage path',
      );
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

      const readModelRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/file-changes/read-model`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const readModelPayload = JSON.parse(readModelRes.body) as {
        readModel: {
          debugSurface: Record<string, string>;
          sessionSummary: { turnCount: number; totalFileDiffs: number };
          turns: Array<{ clientRequestId: string; files: Array<Record<string, unknown>> }>;
        };
      };
      assert(
        readModelPayload.readModel.sessionSummary.turnCount === 1,
        'ui read model should expose request-scoped turn count',
      );
      assert(
        readModelPayload.readModel.turns[0]?.clientRequestId === 'req-route-1',
        'ui read model should group file changes by clientRequestId turn',
      );
      assert(
        readModelPayload.readModel.turns[0]?.files[0]?.['before'] === undefined &&
          readModelPayload.readModel.turns[0]?.files[0]?.['after'] === undefined &&
          readModelPayload.readModel.turns[0]?.files[0]?.['requestId'] === undefined &&
          readModelPayload.readModel.turns[0]?.files[0]?.['toolCallId'] === undefined,
        'ui read model should omit debug-only text and correlation fields',
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

      const restorePreviewRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/preview`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: backup.backupId, includeText: true },
      });
      const restorePreviewPayload = JSON.parse(restorePreviewRes.body) as {
        hashValidation: { available: boolean; lineCount?: number; matchesExpectedAfter?: boolean };
        mode: string;
        preview: { changed: boolean; diff: { before: string; after: string } };
        validateOnly: boolean;
        validation: {
          backupContentAvailable: boolean;
          canRestore: boolean;
          currentExists: boolean;
        };
        workspaceReview: { available: boolean; reason?: string };
      };
      assert(
        restorePreviewPayload.validateOnly === true,
        'restore preview should always be validate-only',
      );
      assert(
        restorePreviewPayload.mode === 'backup',
        'restore preview should identify backup mode',
      );
      assert(
        restorePreviewPayload.validation.canRestore === true,
        'restore preview should be restorable',
      );
      assert(
        restorePreviewPayload.validation.backupContentAvailable === true,
        'restore preview should read backup content',
      );
      assert(
        restorePreviewPayload.preview.diff.before === 'current\n' &&
          restorePreviewPayload.preview.diff.after === 'backup\n',
        'restore preview should compare current workspace content with backup content',
      );
      assert(
        restorePreviewPayload.hashValidation.available === true &&
          restorePreviewPayload.hashValidation.lineCount === 1,
        'backup restore preview should expose hash validation for existing files',
      );
      assert(
        restorePreviewPayload.workspaceReview.available === false &&
          restorePreviewPayload.workspaceReview.reason === 'not_git_repo',
        'backup restore preview should distinguish non-git fallback from a clean workspace',
      );

      writeFileSync(path.join(workspaceRoot, 'copied.txt'), 'current snapshot\n', 'utf8');

      const snapshotRestorePreviewRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/preview`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { snapshotRef: 'backup:backup-1', includeText: 'false' },
      });
      const snapshotRestorePreviewPayload = JSON.parse(snapshotRestorePreviewRes.body) as {
        preview: Array<{ diff: Record<string, unknown>; hashValidation: { available: boolean } }>;
        mode: string;
        validateOnly: boolean;
        validation: { canRestore: boolean };
        workspaceReview: { available: boolean; reason?: string };
      };
      assert(
        snapshotRestorePreviewPayload.validateOnly === true,
        'snapshot restore preview should stay validate-only',
      );
      assert(
        snapshotRestorePreviewPayload.mode === 'snapshot',
        'snapshot restore preview should identify snapshot mode',
      );
      assert(
        snapshotRestorePreviewPayload.validation.canRestore === true,
        'snapshot restore preview should support workspace-relative diff paths',
      );
      assert(
        snapshotRestorePreviewPayload.preview[0]?.diff['before'] === undefined &&
          snapshotRestorePreviewPayload.preview[0]?.diff['after'] === undefined,
        'snapshot restore preview should honor includeText=false even when passed as string',
      );
      assert(
        snapshotRestorePreviewPayload.preview[0]?.hashValidation.available === true,
        'snapshot restore preview should expose hash validation for workspace-relative files',
      );
      assert(
        snapshotRestorePreviewPayload.workspaceReview.available === false &&
          snapshotRestorePreviewPayload.workspaceReview.reason === 'not_git_repo',
        'snapshot restore preview should surface workspace-review fallback reason',
      );

      const invalidApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: backup.backupId, snapshotRef: 'req:req-route-1' },
      });
      assert(invalidApplyRes.statusCode === 400, 'restore apply should reject invalid mixed input');

      const missingApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: 'missing-backup' },
      });
      assert(
        missingApplyRes.statusCode === 404,
        'restore apply should return 404 for missing backup',
      );

      const backupApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: backup.backupId },
      });
      const backupApplyPayload = JSON.parse(backupApplyRes.body) as {
        applied: boolean;
        clientRequestId: string;
        fileCount: number;
        mode: string;
      };
      assert(backupApplyRes.statusCode === 200, 'backup restore apply should succeed');
      assert(backupApplyPayload.applied === true, 'backup restore apply should mark applied=true');
      assert(
        backupApplyPayload.mode === 'backup',
        'backup restore apply should report backup mode',
      );
      assert(backupApplyPayload.fileCount === 1, 'backup restore apply should touch one file');
      assert(
        readFileSync(restoreTargetPath, 'utf8') === 'backup\n',
        'backup restore apply should rewrite file content',
      );

      const appliedDiffRows = sqliteGet<{ count: number }>(
        `SELECT COUNT(*) as count FROM session_file_diffs
         WHERE session_id = ? AND client_request_id = ? AND source_kind = 'restore_replay' AND guarantee_level = 'strong'`,
        [sessionId, backupApplyPayload.clientRequestId],
      );
      assert(
        (appliedDiffRows?.count ?? 0) >= 1,
        'backup restore apply should persist restore_replay strong diff rows',
      );

      writeFileSync(path.join(workspaceRoot, 'copied.txt'), 'current snapshot\n', 'utf8');
      const snapshotApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { snapshotRef: 'backup:backup-1', includeText: false },
      });
      const snapshotApplyPayload = JSON.parse(snapshotApplyRes.body) as {
        applied: boolean;
        clientRequestId: string;
        fileCount: number;
        mode: string;
      };
      assert(snapshotApplyRes.statusCode === 200, 'snapshot restore apply should succeed');
      assert(
        snapshotApplyPayload.applied === true,
        'snapshot restore apply should mark applied=true',
      );
      assert(
        snapshotApplyPayload.mode === 'snapshot',
        'snapshot restore apply should report snapshot mode',
      );
      assert(snapshotApplyPayload.fileCount >= 1, 'snapshot restore apply should touch files');
      assert(
        readFileSync(path.join(workspaceRoot, 'copied.txt'), 'utf8') === 'hello\nworld\n',
        'snapshot restore apply should rewrite tracked snapshot file content',
      );
      const snapshotApplyRows = sqliteGet<{ count: number }>(
        `SELECT COUNT(*) as count FROM session_file_diffs
         WHERE session_id = ? AND client_request_id = ? AND source_kind = 'restore_replay' AND guarantee_level = 'strong'`,
        [sessionId, snapshotApplyPayload.clientRequestId],
      );
      assert(
        (snapshotApplyRows?.count ?? 0) >= 1,
        'snapshot restore apply should persist restore_replay strong diff rows',
      );

      const emptyRestoreTargetPath = path.join(workspaceRoot, 'empty-restore.txt');
      writeFileSync(emptyRestoreTargetPath, 'non-empty backup payload\n', 'utf8');
      const emptyBackup = await persistSessionFileBackup({
        sessionId,
        userId: currentAdmin.id,
        filePath: emptyRestoreTargetPath,
        content: '',
        kind: 'before_write',
        toolName: 'write',
        requestId: 'req-route-empty-restore',
        toolCallId: 'call-empty-restore-1',
      });
      const emptyBackupApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: emptyBackup.backupId },
      });
      assert(
        emptyBackupApplyRes.statusCode === 200,
        'backup restore apply should accept empty-file backup content',
      );
      assert(
        existsSync(emptyRestoreTargetPath) && readFileSync(emptyRestoreTargetPath, 'utf8') === '',
        'backup restore apply should preserve empty file content instead of deleting the file',
      );

      const sessionWorkspaceRoot = path.join(workspaceRoot, 'apps', 'web');
      const customSessionRes = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { workingDirectory: sessionWorkspaceRoot },
      });
      assert(
        customSessionRes.statusCode === 201,
        `custom workspace session create should succeed, got ${customSessionRes.statusCode}: ${customSessionRes.body}`,
      );
      const { sessionId: customSessionId } = JSON.parse(customSessionRes.body) as {
        sessionId: string;
      };

      const relativeRestorePath = 'src/App.tsx';
      const globalShadowPath = path.join(workspaceRoot, relativeRestorePath);
      const sessionScopedPath = path.join(sessionWorkspaceRoot, relativeRestorePath);
      mkdirSync(path.dirname(globalShadowPath), { recursive: true });
      mkdirSync(path.dirname(sessionScopedPath), { recursive: true });
      writeFileSync(globalShadowPath, 'global current\n', 'utf8');
      writeFileSync(sessionScopedPath, 'session current\n', 'utf8');

      persistSessionSnapshot({
        sessionId: customSessionId,
        userId: currentAdmin.id,
        snapshotRef: createRequestSnapshotRef('req-custom-workspace-1'),
        fileDiffs: [
          {
            file: relativeRestorePath,
            before: 'session current\n',
            after: 'snapshot target\n',
            additions: 1,
            deletions: 1,
            status: 'modified',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      });
      const customBackup = await persistSessionFileBackup({
        sessionId: customSessionId,
        userId: currentAdmin.id,
        filePath: relativeRestorePath,
        content: 'backup target\n',
        kind: 'before_write',
        toolName: 'edit',
        requestId: 'req-custom-restore',
        toolCallId: 'call-custom-restore-1',
      });

      const customBackupPreviewRes = await app.inject({
        method: 'POST',
        url: `/sessions/${customSessionId}/restore/preview`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: customBackup.backupId, includeText: true },
      });
      const customBackupPreviewPayload = JSON.parse(customBackupPreviewRes.body) as {
        preview: { diff: { after: string; before: string } };
      };
      assert(
        customBackupPreviewRes.statusCode === 200,
        'custom workspace backup preview should succeed',
      );
      assert(
        customBackupPreviewPayload.preview.diff.before === 'session current\n',
        'custom workspace backup preview should read current content from session workingDirectory',
      );

      const customSnapshotPreviewRes = await app.inject({
        method: 'POST',
        url: `/sessions/${customSessionId}/restore/preview`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          snapshotRef: 'req:req-custom-workspace-1',
          includeText: true,
        },
      });
      const customSnapshotPreviewPayload = JSON.parse(customSnapshotPreviewRes.body) as {
        preview: Array<{ diff: { after: string; before: string } }>;
      };
      assert(
        customSnapshotPreviewRes.statusCode === 200,
        'custom workspace snapshot preview should succeed',
      );
      assert(
        customSnapshotPreviewPayload.preview[0]?.diff.before === 'session current\n',
        'custom workspace snapshot preview should read current content from session workingDirectory',
      );

      const customBackupApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${customSessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: customBackup.backupId },
      });
      assert(
        customBackupApplyRes.statusCode === 200,
        'custom workspace backup apply should succeed',
      );
      assert(
        readFileSync(sessionScopedPath, 'utf8') === 'backup target\n',
        'custom workspace backup apply should rewrite the session workspace file',
      );
      assert(
        readFileSync(globalShadowPath, 'utf8') === 'global current\n',
        'custom workspace backup apply should not touch same relative path under global workspace root',
      );

      writeFileSync(sessionScopedPath, 'session current\n', 'utf8');
      const customSnapshotApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${customSessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { snapshotRef: 'req:req-custom-workspace-1' },
      });
      assert(
        customSnapshotApplyRes.statusCode === 200,
        'custom workspace snapshot apply should succeed',
      );
      assert(
        readFileSync(sessionScopedPath, 'utf8') === 'snapshot target\n',
        'custom workspace snapshot apply should rewrite the session workspace file',
      );
      assert(
        readFileSync(globalShadowPath, 'utf8') === 'global current\n',
        'custom workspace snapshot apply should not touch same relative path under global workspace root',
      );

      await execGit(['init'], workspaceRoot);
      await execGit(['config', 'user.email', 'restore@example.com'], workspaceRoot);
      await execGit(['config', 'user.name', 'Restore Test'], workspaceRoot);
      await execGit(['add', '.'], workspaceRoot);
      await execGit(['commit', '-m', 'baseline'], workspaceRoot);
      writeFileSync(restoreTargetPath, 'dirty\n', 'utf8');

      const conflictApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: backup.backupId },
      });
      const conflictApplyPayload = JSON.parse(conflictApplyRes.body) as {
        error: string;
        validateOnly: boolean;
        workspaceReview: { available: boolean; conflicts: Array<{ filePath: string }> };
      };
      assert(
        conflictApplyRes.statusCode === 409,
        'restore apply should block dirty git conflicts by default',
      );
      assert(
        conflictApplyPayload.validateOnly === true,
        'blocked restore apply should return preview payload',
      );
      assert(
        conflictApplyPayload.workspaceReview.available === true &&
          conflictApplyPayload.workspaceReview.conflicts.some(
            (conflict) => conflict.filePath === restoreTargetPath,
          ),
        'blocked restore apply should surface conflicting file paths',
      );

      const forcedApplyRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/restore/apply`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { backupId: backup.backupId, forceConflicts: true },
      });
      assert(
        forcedApplyRes.statusCode === 200,
        'forceConflicts should allow restore apply to proceed',
      );
      assert(
        readFileSync(restoreTargetPath, 'utf8') === 'backup\n',
        'forced restore apply should overwrite conflicting content',
      );

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const deletedSessionIds = (JSON.parse(deleteRes.body) as { deletedSessionIds: string[] })
        .deletedSessionIds;
      assert(
        deleteRes.statusCode === 200,
        `session delete should succeed, got ${deleteRes.statusCode}`,
      );
      assert(
        deletedSessionIds.includes(sessionId),
        'session delete should include deleted root session id',
      );
      assert(typeof backup.storagePath === 'string', 'backup should expose storagePath');
      assert(
        !sqliteGet('SELECT 1 FROM session_file_backups WHERE backup_id = ? LIMIT 1', [
          backup.backupId,
        ]),
        'session delete should remove backup metadata rows',
      );
      assert(
        existsSync(backup.storagePath),
        'shared backup file should remain after first session delete',
      );

      const secondDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/sessions/${secondSessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert(secondDeleteRes.statusCode === 200, 'second session delete should succeed');
      assert(
        !existsSync(backup.storagePath),
        'backup file should be gc’d after final reference is gone',
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
