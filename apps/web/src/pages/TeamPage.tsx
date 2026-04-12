import { TeamRuntimeReferencePage } from './team/runtime/team-runtime-reference-page.js';
import {
  TeamRuntimeReferenceDataProvider,
  useResolvedTeamRuntimeReferenceData,
} from './team/runtime/team-runtime-reference-data.js';

export default function TeamPage() {
  const data = useResolvedTeamRuntimeReferenceData();

  return (
    <TeamRuntimeReferenceDataProvider value={data}>
      <TeamRuntimeReferencePage />
    </TeamRuntimeReferenceDataProvider>
  );
}
