import { randomUUID } from 'node:crypto';
import type {
  ArtifactContentType,
  ArtifactDraftInput,
  ArtifactLineChange,
  ArtifactMetadata,
  ArtifactRecord,
  ArtifactVersionActor,
  ArtifactVersionRecord,
} from '@openAwork/artifacts';
import { computeArtifactLineDiff, detectArtifactContentType } from '@openAwork/artifacts';
import { db, sqliteAll, sqliteGet, sqliteRun } from './db.js';

interface ArtifactRow {
  id: string;
  session_id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  version: number;
  parent_version_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version_number: number;
  content: string;
  diff_json: string;
  created_by: string;
  created_by_note: string | null;
  created_at: string;
}

export interface CreateArtifactInput extends ArtifactDraftInput {
  sessionId: string;
  metadata?: ArtifactMetadata;
  createdBy?: ArtifactVersionActor;
  createdByNote?: string | null;
}

export interface UpdateArtifactInput {
  title?: string;
  content?: string;
  type?: ArtifactContentType | null;
  fileName?: string | null;
  mimeType?: string | null;
  metadata?: ArtifactMetadata;
  createdBy?: ArtifactVersionActor;
  createdByNote?: string | null;
}

export interface RevertArtifactInput {
  versionId: string;
  createdBy?: ArtifactVersionActor;
  createdByNote?: string | null;
}

function parseMetadata(metadataJson: string): ArtifactMetadata {
  return JSON.parse(metadataJson) as ArtifactMetadata;
}

function parseDiff(diffJson: string): ArtifactLineChange[] {
  return JSON.parse(diffJson) as ArtifactLineChange[];
}

function rowToArtifactRecord(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    type: row.type as ArtifactContentType,
    title: row.title,
    content: row.content,
    version: row.version,
    parentVersionId: row.parent_version_id,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToArtifactVersionRecord(row: ArtifactVersionRow): ArtifactVersionRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    versionNumber: row.version_number,
    content: row.content,
    diffFromPrevious: parseDiff(row.diff_json),
    createdBy: row.created_by as ArtifactVersionActor,
    createdByNote: row.created_by_note,
    createdAt: row.created_at,
  };
}

function withTransaction<T>(action: () => T): T {
  db.exec('BEGIN');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function normalizeMetadata(
  metadata: ArtifactMetadata | undefined,
  fileName?: string | null,
  mimeType?: string | null,
): ArtifactMetadata {
  return {
    ...(metadata ?? {}),
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

function resolveArtifactType(input: {
  content: string;
  title: string;
  type?: ArtifactContentType | null;
  fileName?: string | null;
  mimeType?: string | null;
  fallbackType?: ArtifactContentType;
}): ArtifactContentType {
  if (input.type) {
    return input.type;
  }

  if (input.fallbackType && !input.fileName && !input.mimeType) {
    return input.fallbackType;
  }

  return detectArtifactContentType({
    content: input.content,
    fileName: input.fileName ?? input.title,
    mimeType: input.mimeType,
    hint: input.fallbackType ?? null,
  });
}

function getArtifactRowById(userId: string, artifactId: string): ArtifactRow | undefined {
  return sqliteGet<ArtifactRow>('SELECT * FROM artifacts WHERE id = ? AND user_id = ? LIMIT 1', [
    artifactId,
    userId,
  ]);
}

function getLatestArtifactVersionRow(artifactId: string): ArtifactVersionRow | undefined {
  return sqliteGet<ArtifactVersionRow>(
    `SELECT * FROM artifact_versions
     WHERE artifact_id = ?
     ORDER BY version_number DESC
     LIMIT 1`,
    [artifactId],
  );
}

function getArtifactVersionRowById(
  userId: string,
  artifactId: string,
  versionId: string,
): ArtifactVersionRow | undefined {
  return sqliteGet<ArtifactVersionRow>(
    `SELECT versions.*
     FROM artifact_versions AS versions
     INNER JOIN artifacts AS artifacts ON artifacts.id = versions.artifact_id
     WHERE versions.id = ? AND versions.artifact_id = ? AND artifacts.user_id = ?
     LIMIT 1`,
    [versionId, artifactId, userId],
  );
}

export function createArtifact(userId: string, input: CreateArtifactInput): ArtifactRecord {
  const id = randomUUID();
  const versionId = randomUUID();
  const now = new Date().toISOString();
  const metadata = normalizeMetadata(input.metadata, input.fileName, input.mimeType);
  const type = resolveArtifactType({
    content: input.content,
    title: input.title,
    type: input.type ?? null,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  const diff = computeArtifactLineDiff('', input.content);

  return withTransaction(() => {
    sqliteRun(
      `INSERT INTO artifacts
       (id, session_id, user_id, type, title, content, version, parent_version_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.sessionId,
        userId,
        type,
        input.title,
        input.content,
        1,
        null,
        JSON.stringify(metadata),
        now,
        now,
      ],
    );
    sqliteRun(
      `INSERT INTO artifact_versions
       (id, artifact_id, version_number, content, diff_json, created_by, created_by_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        id,
        1,
        input.content,
        JSON.stringify(diff),
        input.createdBy ?? 'user',
        input.createdByNote ?? null,
        now,
      ],
    );
    return {
      id,
      sessionId: input.sessionId,
      userId,
      type,
      title: input.title,
      content: input.content,
      version: 1,
      parentVersionId: null,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function getArtifactById(userId: string, artifactId: string): ArtifactRecord | undefined {
  const row = getArtifactRowById(userId, artifactId);
  return row ? rowToArtifactRecord(row) : undefined;
}

export function listArtifactsBySession(userId: string, sessionId: string): ArtifactRecord[] {
  const rows = sqliteAll<ArtifactRow>(
    `SELECT * FROM artifacts
     WHERE user_id = ? AND session_id = ?
     ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`,
    [userId, sessionId],
  );
  return rows.map(rowToArtifactRecord);
}

export function listArtifactVersions(userId: string, artifactId: string): ArtifactVersionRecord[] {
  const artifact = getArtifactRowById(userId, artifactId);
  if (!artifact) {
    return [];
  }

  const rows = sqliteAll<ArtifactVersionRow>(
    `SELECT * FROM artifact_versions
     WHERE artifact_id = ?
     ORDER BY version_number DESC`,
    [artifactId],
  );
  return rows.map(rowToArtifactVersionRecord);
}

export function updateArtifact(
  userId: string,
  artifactId: string,
  input: UpdateArtifactInput,
): ArtifactRecord | undefined {
  const existing = getArtifactById(userId, artifactId);
  if (!existing) {
    return undefined;
  }

  const title = input.title ?? existing.title;
  const content = input.content ?? existing.content;
  const metadata = {
    ...existing.metadata,
    ...normalizeMetadata(input.metadata, input.fileName, input.mimeType),
  };
  const type = resolveArtifactType({
    content,
    title,
    type: input.type ?? null,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fallbackType: existing.type,
  });
  const metadataJson = JSON.stringify(metadata);
  const existingMetadataJson = JSON.stringify(existing.metadata);
  const changed =
    title !== existing.title ||
    content !== existing.content ||
    type !== existing.type ||
    metadataJson !== existingMetadataJson;

  if (!changed) {
    return existing;
  }

  const latestVersion = getLatestArtifactVersionRow(artifactId);
  const nextVersion = existing.version + 1;
  const nextVersionId = randomUUID();
  const now = new Date().toISOString();
  const diff = computeArtifactLineDiff(existing.content, content);

  return withTransaction(() => {
    sqliteRun(
      `UPDATE artifacts
       SET type = ?, title = ?, content = ?, version = ?, parent_version_id = ?, metadata_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        type,
        title,
        content,
        nextVersion,
        latestVersion?.id ?? null,
        metadataJson,
        now,
        artifactId,
        userId,
      ],
    );
    sqliteRun(
      `INSERT INTO artifact_versions
       (id, artifact_id, version_number, content, diff_json, created_by, created_by_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextVersionId,
        artifactId,
        nextVersion,
        content,
        JSON.stringify(diff),
        input.createdBy ?? 'user',
        input.createdByNote ?? null,
        now,
      ],
    );
    return {
      ...existing,
      title,
      content,
      type,
      version: nextVersion,
      parentVersionId: latestVersion?.id ?? null,
      metadata,
      updatedAt: now,
    };
  });
}

export function revertArtifactToVersion(
  userId: string,
  artifactId: string,
  input: RevertArtifactInput,
): ArtifactRecord | undefined {
  const existing = getArtifactById(userId, artifactId);
  if (!existing) {
    return undefined;
  }

  const targetVersion = getArtifactVersionRowById(userId, artifactId, input.versionId);
  if (!targetVersion) {
    return undefined;
  }

  if (targetVersion.content === existing.content) {
    return existing;
  }

  const latestVersion = getLatestArtifactVersionRow(artifactId);
  const nextVersion = existing.version + 1;
  const nextVersionId = randomUUID();
  const now = new Date().toISOString();
  const diff = computeArtifactLineDiff(existing.content, targetVersion.content);

  return withTransaction(() => {
    sqliteRun(
      `UPDATE artifacts
       SET content = ?, version = ?, parent_version_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [targetVersion.content, nextVersion, latestVersion?.id ?? null, now, artifactId, userId],
    );
    sqliteRun(
      `INSERT INTO artifact_versions
       (id, artifact_id, version_number, content, diff_json, created_by, created_by_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextVersionId,
        artifactId,
        nextVersion,
        targetVersion.content,
        JSON.stringify(diff),
        input.createdBy ?? 'user',
        input.createdByNote ?? `revert:${input.versionId}`,
        now,
      ],
    );
    return {
      ...existing,
      content: targetVersion.content,
      version: nextVersion,
      parentVersionId: latestVersion?.id ?? null,
      updatedAt: now,
    };
  });
}
