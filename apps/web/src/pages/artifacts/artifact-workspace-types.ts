import type { ArtifactRecord, ArtifactVersionRecord } from '@openAwork/artifacts';

export interface ArtifactSessionSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface SessionsListResponse {
  sessions?: Array<{
    id: string;
    title: string | null;
    updated_at: string;
  }>;
}

export interface SessionArtifactsResponse {
  contentArtifacts?: ArtifactRecord[];
}

export interface ArtifactVersionsResponse {
  artifact: ArtifactRecord;
  versions: ArtifactVersionRecord[];
}
