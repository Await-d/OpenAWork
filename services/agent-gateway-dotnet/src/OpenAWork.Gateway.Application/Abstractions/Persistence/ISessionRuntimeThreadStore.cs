namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface ISessionRuntimeThreadStore
{
    Task UpsertAsync(SessionRuntimeThreadInfoRecord record, CancellationToken cancellationToken);

    Task TouchAsync(string sessionId, string userId, string clientRequestId, long heartbeatAtMs, CancellationToken cancellationToken);

    Task ClearAsync(string sessionId, string userId, string? clientRequestId, CancellationToken cancellationToken);

    Task<SessionRuntimeThreadInfoRecord?> GetFreshAsync(string sessionId, string userId, long nowMs, CancellationToken cancellationToken);

    Task<bool> HasFreshAsync(string sessionId, string userId, long nowMs, CancellationToken cancellationToken);
}

public sealed record SessionRuntimeThreadInfoRecord(
    string SessionId,
    string UserId,
    string ClientRequestId,
    long StartedAtMs,
    long HeartbeatAtMs,
    string CreatedAt,
    string UpdatedAt);
