using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class SessionRuntimeThreadStore(GatewayDbContext dbContext) : ISessionRuntimeThreadStore
{
    public const long HeartbeatMs = 5_000;
    public const long StaleAfterMs = 20_000;

    public async Task UpsertAsync(SessionRuntimeThreadInfoRecord record, CancellationToken cancellationToken)
    {
        var existing = await dbContext.SessionRuntimeThreads
            .SingleOrDefaultAsync((thread) => thread.SessionId == record.SessionId, cancellationToken);

        if (existing is null)
        {
            dbContext.SessionRuntimeThreads.Add(new OpenAWork.Gateway.Persistence.EFCore.Entities.SessionRuntimeThreadRecord
            {
                SessionId = record.SessionId,
                UserId = record.UserId,
                ClientRequestId = record.ClientRequestId,
                StartedAtMs = record.StartedAtMs,
                HeartbeatAtMs = record.HeartbeatAtMs,
                CreatedAtUtc = ParseTimestamp(record.CreatedAt),
                UpdatedAtUtc = ParseTimestamp(record.UpdatedAt),
            });
        }
        else
        {
            existing.UserId = record.UserId;
            existing.ClientRequestId = record.ClientRequestId;
            existing.StartedAtMs = record.StartedAtMs;
            existing.HeartbeatAtMs = record.HeartbeatAtMs;
            existing.UpdatedAtUtc = ParseTimestamp(record.UpdatedAt);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task TouchAsync(string sessionId, string userId, string clientRequestId, long heartbeatAtMs, CancellationToken cancellationToken)
    {
        var thread = await dbContext.SessionRuntimeThreads
            .SingleOrDefaultAsync(
                (item) => item.SessionId == sessionId && item.UserId == userId && item.ClientRequestId == clientRequestId,
                cancellationToken);
        if (thread is null)
        {
            return;
        }

        thread.HeartbeatAtMs = heartbeatAtMs;
        thread.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public Task ClearAsync(string sessionId, string userId, string? clientRequestId, CancellationToken cancellationToken)
    {
        var query = dbContext.SessionRuntimeThreads.Where((thread) => thread.SessionId == sessionId && thread.UserId == userId);
        if (!string.IsNullOrWhiteSpace(clientRequestId))
        {
            query = query.Where((thread) => thread.ClientRequestId == clientRequestId);
        }

        return query.ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<SessionRuntimeThreadInfoRecord?> GetFreshAsync(string sessionId, string userId, long nowMs, CancellationToken cancellationToken)
    {
        var thread = await dbContext.SessionRuntimeThreads
            .AsNoTracking()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.UserId == userId, cancellationToken);
        if (thread is null)
        {
            return null;
        }

        if (thread.HeartbeatAtMs < nowMs - StaleAfterMs)
        {
            return null;
        }

        return new SessionRuntimeThreadInfoRecord(
            thread.SessionId,
            thread.UserId,
            thread.ClientRequestId,
            thread.StartedAtMs,
            thread.HeartbeatAtMs,
            thread.CreatedAtUtc.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            thread.UpdatedAtUtc.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));
    }

    public async Task<bool> HasFreshAsync(string sessionId, string userId, long nowMs, CancellationToken cancellationToken)
        => await GetFreshAsync(sessionId, userId, nowMs, cancellationToken) is not null;

    private static DateTimeOffset ParseTimestamp(string value)
        => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
}
