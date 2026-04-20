namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface ISyncEventStore
{
    Task<long> PeekNextSequenceAsync(string aggregateId, CancellationToken cancellationToken);

    Task<bool> IsEventProcessedAsync(string eventId, CancellationToken cancellationToken);

    Task<AppendSyncEventResult> AppendEventAsync(AppendSyncEventRecord record, CancellationToken cancellationToken);

    Task<IReadOnlyList<SyncEventInfoRecord>> ReplayEventsForAggregateAsync(string aggregateId, CancellationToken cancellationToken);
}

public sealed record AppendSyncEventRecord(
    string Id,
    string AggregateId,
    string Type,
    int Version,
    string DataJson,
    long Timestamp);

public sealed record AppendSyncEventResult(
    string Id,
    string AggregateId,
    long Seq,
    bool Persisted);

public sealed record SyncEventInfoRecord(
    string Id,
    string AggregateId,
    long Seq,
    string Type,
    int Version,
    string DataJson,
    long Timestamp,
    string CreatedAt);
