namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface IPermissionRequestStore
{
    Task InsertAsync(PermissionRequestInfoRecord record, CancellationToken cancellationToken);

    Task<PermissionRequestInfoRecord?> GetAsync(string sessionId, string requestId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PermissionRequestInfoRecord>> ListPendingAsync(string sessionId, CancellationToken cancellationToken);

    Task<string?> FindLatestPendingIdAsync(string sessionId, string toolName, string scope, CancellationToken cancellationToken);

    Task<bool> UpdatePendingPayloadAsync(string requestId, string payloadJson, string updatedAt, CancellationToken cancellationToken);

    Task<bool> UpdateResolutionAsync(string sessionId, string requestId, string status, string? decision, string updatedAt, CancellationToken cancellationToken);

    Task<IReadOnlyList<PermissionRequestInfoRecord>> ExpirePendingAsync(string sessionId, long nowMs, string updatedAt, CancellationToken cancellationToken);

    Task<bool> MarkConsumedAsync(string requestId, string updatedAt, CancellationToken cancellationToken);
}

public sealed record PermissionRequestInfoRecord(
    string Id,
    string SessionId,
    string ToolName,
    string Scope,
    string Reason,
    string RiskLevel,
    string? PreviewAction,
    string Status,
    string? Decision,
    string? RequestPayloadJson,
    long? ExpiresAtMs,
    string? AlwaysJson,
    string CreatedAt,
    string UpdatedAt);
