using System.Text.Json;

namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface ISessionRunEventStore
{
    Task PersistAsync(SessionRunEventInfoRecord record, CancellationToken cancellationToken);

    Task<IReadOnlyList<SessionRunEventInfoRecord>> ListForSessionAsync(string sessionId, CancellationToken cancellationToken);

    Task<IReadOnlyList<SessionRunEventInfoRecord>> ListByRequestAsync(string sessionId, string clientRequestId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PersistedSessionRunEventInfoRecord>> ListByRequestAfterSeqAsync(string sessionId, string clientRequestId, long afterSeq, CancellationToken cancellationToken);

    Task<long> GetLatestSeqByRequestAsync(string sessionId, string clientRequestId, CancellationToken cancellationToken);

    Task DeleteByRequestAsync(string sessionId, string clientRequestId, CancellationToken cancellationToken);
}

public sealed record SessionRunEventInfoRecord(
    long Id,
    string SessionId,
    string? UserId,
    string? ClientRequestId,
    long? Seq,
    string EventType,
    string? EventId,
    string? RunId,
    long? OccurredAtMs,
    string PayloadJson,
    string CreatedAt);

public sealed record PersistedSessionRunEventInfoRecord(
    long Seq,
    JsonElement Event);
