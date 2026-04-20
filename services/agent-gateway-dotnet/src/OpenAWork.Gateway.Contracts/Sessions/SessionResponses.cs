using System.Text.Json.Serialization;

namespace OpenAWork.Gateway.Contracts.Sessions;

public sealed record SessionFileChangesSummaryResponse(
    int SnapshotCount,
    IReadOnlyList<string> SourceKinds,
    int TotalAdditions,
    int TotalDeletions,
    int TotalFileDiffs,
    string? LatestSnapshotAt,
    string? LatestSnapshotRef,
    string? LatestSnapshotScopeKind,
    string? WeakestGuaranteeLevel);

public sealed record SessionSummaryResponse(
    string Id,
    [property: JsonPropertyName("state_status")] string StateStatus,
    [property: JsonPropertyName("metadata_json")] string MetadataJson,
    string? Title,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("updated_at")] string UpdatedAt,
    SessionFileChangesSummaryResponse FileChangesSummary);

public sealed record SessionDetailResponse(
    string Id,
    [property: JsonPropertyName("state_status")] string StateStatus,
    [property: JsonPropertyName("metadata_json")] string MetadataJson,
    string? Title,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("updated_at")] string UpdatedAt,
    IReadOnlyList<object> Messages,
    IReadOnlyList<object> RunEvents,
    IReadOnlyList<object> Todos,
    SessionFileChangesSummaryResponse FileChangesSummary);

public sealed record SessionsListResponse(IReadOnlyList<SessionSummaryResponse> Sessions);

public sealed record SessionEnvelopeResponse(SessionDetailResponse Session);

public sealed record CreateSessionResponse(string SessionId);

public sealed record DeleteSessionResponse(bool Ok, IReadOnlyList<string> DeletedSessionIds);
