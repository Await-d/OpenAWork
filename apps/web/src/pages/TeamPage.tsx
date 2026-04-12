import { useParams } from 'react-router';
import { TeamRuntimeReferencePage } from './team/runtime/team-runtime-reference-page.js';
import {
  TeamRuntimeReferenceDataProvider,
  useResolvedTeamRuntimeReferenceData,
} from './team/runtime/team-runtime-reference-data.js';
import { useTeamWorkspaceSnapshotState } from './team/use-team-workspace-snapshot-state.js';
import { useTeamWorkspaceState } from './team/use-team-workspace-state.js';

export default function TeamPage() {
  const { teamWorkspaceId } = useParams<{ teamWorkspaceId?: string }>();
  const workspaceState = useTeamWorkspaceState(teamWorkspaceId);
  const workspaceSnapshotState = useTeamWorkspaceSnapshotState(teamWorkspaceId);
  const data = useResolvedTeamRuntimeReferenceData({
    activeWorkspace: workspaceState.activeWorkspace,
    activeWorkspaceSnapshot: workspaceSnapshotState.snapshot,
    workspaceSnapshotError: workspaceSnapshotState.error,
    workspaceSnapshotLoading: workspaceSnapshotState.loading,
    workspaceError: workspaceState.error,
    workspaceLoading: workspaceState.loading,
  });

  return (
    <TeamRuntimeReferenceDataProvider value={data}>
      <TeamRuntimeReferencePage />
    </TeamRuntimeReferenceDataProvider>
  );
}
