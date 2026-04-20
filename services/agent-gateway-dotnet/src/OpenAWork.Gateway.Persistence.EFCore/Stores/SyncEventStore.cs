using System.Globalization;
using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class SyncEventStore(
    GatewayDbContext dbContext) : ISyncEventStore
{
    public async Task<long> PeekNextSequenceAsync(string aggregateId, CancellationToken cancellationToken)
    {
        var currentSeq = await dbContext.EventSequences
            .AsNoTracking()
            .Where((record) => record.AggregateId == aggregateId)
            .Select((record) => (long?)record.Seq)
            .SingleOrDefaultAsync(cancellationToken);

        return (currentSeq ?? 0) + 1;
    }

    public Task<bool> IsEventProcessedAsync(string eventId, CancellationToken cancellationToken)
    {
        return dbContext.EventLog
            .AsNoTracking()
            .AnyAsync((record) => record.Id == eventId, cancellationToken);
    }

    public Task<AppendSyncEventResult> AppendEventAsync(AppendSyncEventRecord record, CancellationToken cancellationToken)
    {
        return AppendEventWithRetriesAsync(record, cancellationToken);
    }

    private async Task<AppendSyncEventResult> AppendEventWithRetriesAsync(AppendSyncEventRecord record, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 3; attempt += 1)
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

            try
            {
                var existing = await GetExistingEventAsync(record.Id, cancellationToken);
                if (existing is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return existing;
                }

                var nextSeq = await AllocateNextSequenceAsync(record.AggregateId, cancellationToken);

                dbContext.EventLog.Add(new EventLogRecord
                {
                    Id = record.Id,
                    AggregateId = record.AggregateId,
                    Seq = nextSeq,
                    Type = record.Type,
                    Version = record.Version,
                    DataJson = record.DataJson,
                    Timestamp = record.Timestamp,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                });

                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                return new AppendSyncEventResult(record.Id, record.AggregateId, nextSeq, true);
            }
            catch (DbUpdateException) when (attempt < 2)
            {
                await transaction.RollbackAsync(cancellationToken);
                dbContext.ChangeTracker.Clear();

                var existing = await GetExistingEventAsync(record.Id, cancellationToken);
                if (existing is not null)
                {
                    return existing;
                }
            }
        }

        throw new InvalidOperationException($"Failed to append sync event {record.Id} after retries.");
    }

    public async Task<IReadOnlyList<SyncEventInfoRecord>> ReplayEventsForAggregateAsync(string aggregateId, CancellationToken cancellationToken)
    {
        return await dbContext.EventLog
            .AsNoTracking()
            .Where((record) => record.AggregateId == aggregateId)
            .OrderBy((record) => record.Seq)
            .Select((record) => new SyncEventInfoRecord(
                record.Id,
                record.AggregateId,
                record.Seq,
                record.Type,
                record.Version,
                record.DataJson,
                record.Timestamp,
                record.CreatedAtUtc.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)))
            .ToListAsync(cancellationToken);
    }

    private Task<AppendSyncEventResult?> GetExistingEventAsync(string eventId, CancellationToken cancellationToken)
    {
        return dbContext.EventLog
            .AsNoTracking()
            .Where((item) => item.Id == eventId)
            .Select((item) => new AppendSyncEventResult(item.Id, item.AggregateId, item.Seq, false))
            .SingleOrDefaultAsync(cancellationToken);
    }

    private async Task<long> AllocateNextSequenceAsync(string aggregateId, CancellationToken cancellationToken)
    {
        DbConnection connection = dbContext.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO event_sequences (aggregate_id, seq)
            VALUES (@aggregateId, 1)
            ON CONFLICT(aggregate_id) DO UPDATE SET seq = event_sequences.seq + 1
            RETURNING seq;
            """;
        command.Transaction = dbContext.Database.CurrentTransaction?.GetDbTransaction();

        var parameter = command.CreateParameter();
        parameter.ParameterName = "@aggregateId";
        parameter.Value = aggregateId;
        command.Parameters.Add(parameter);

        var scalar = await command.ExecuteScalarAsync(cancellationToken);
        if (scalar is null || scalar is DBNull)
        {
            throw new InvalidOperationException($"Failed to allocate sequence for aggregate {aggregateId}.");
        }

        return Convert.ToInt64(scalar, CultureInfo.InvariantCulture);
    }
}
