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

public sealed record SessionChildResponse(
    string Id,
    [property: JsonPropertyName("state_status")] string StateStatus,
    [property: JsonPropertyName("metadata_json")] string MetadataJson,
    string? Title,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("updated_at")] string UpdatedAt,
    IReadOnlyList<object> Messages,
    IReadOnlyList<object> RunEvents,
    IReadOnlyList<object> Todos);

public sealed record SessionChildrenResponse(IReadOnlyList<SessionChildResponse> Sessions);

public sealed record SessionTaskResponse(
    string Id,
    string Kind,
    string Title,
    string Subject,
    string Status,
    IReadOnlyList<string> BlockedBy,
    IReadOnlyList<string> Blocks,
    string? ParentTaskId,
    string? SessionId,
    string? AssignedAgent,
    string Priority,
    IReadOnlyList<string> Tags,
    string? Result,
    string? ErrorMessage,
    long CreatedAt,
    long UpdatedAt,
    int CompletedSubtaskCount,
    int Depth,
    long? EffectiveDeadline,
    int ReadySubtaskCount,
    int SubtaskCount,
    string? TerminalReason,
    int UnmetDependencyCount);

public sealed record SessionTasksResponse(
    IReadOnlyList<SessionTaskResponse> Tasks,
    [property: JsonPropertyName("updatedAt")] long UpdatedAt);

public sealed record SessionsListResponse(IReadOnlyList<SessionSummaryResponse> Sessions);

public sealed record SessionSearchResultResponse(
    long CreatedAtMs,
    string MessageId,
    string Role,
    string SessionId,
    string Snippet,
    string? Title,
    string UpdatedAt);

public sealed record SessionSearchResponse(IReadOnlyList<SessionSearchResultResponse> Results);

public sealed record SessionMessagesResponse(IReadOnlyList<object> Messages);

public sealed record SessionEnvelopeResponse(SessionDetailResponse Session);

public sealed record CreateSessionResponse(string SessionId);

public sealed record DeleteSessionResponse(bool Ok, IReadOnlyList<string> DeletedSessionIds);
