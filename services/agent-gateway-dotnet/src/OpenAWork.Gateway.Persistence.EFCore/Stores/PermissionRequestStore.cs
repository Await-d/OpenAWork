using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class PermissionRequestStore(GatewayDbContext dbContext) : IPermissionRequestStore
{
    public async Task InsertAsync(PermissionRequestInfoRecord record, CancellationToken cancellationToken)
    {
        dbContext.Add(new PermissionRequestRecord
        {
            Id = record.Id,
            SessionId = record.SessionId,
            ToolName = record.ToolName,
            Scope = record.Scope,
            Reason = record.Reason,
            RiskLevel = record.RiskLevel,
            PreviewAction = record.PreviewAction,
            Status = record.Status,
            Decision = record.Decision,
            RequestPayloadJson = record.RequestPayloadJson,
            ExpiresAtMs = record.ExpiresAtMs,
            AlwaysJson = record.AlwaysJson,
            CreatedAtUtc = ParseTimestamp(record.CreatedAt),
            UpdatedAtUtc = ParseTimestamp(record.UpdatedAt),
        });
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<PermissionRequestInfoRecord?> GetAsync(string sessionId, string requestId, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .AsNoTracking()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId, cancellationToken);
        return record is null ? null : Map(record);
    }

    public async Task<IReadOnlyList<PermissionRequestInfoRecord>> ListPendingAsync(string sessionId, CancellationToken cancellationToken)
    {
        var records = await dbContext.Set<PermissionRequestRecord>()
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.Status == "pending")
            .OrderBy((item) => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        return records.Select(Map).ToArray();
    }

    public async Task<string?> FindLatestPendingIdAsync(string sessionId, string toolName, string scope, CancellationToken cancellationToken)
    {
        return await dbContext.Set<PermissionRequestRecord>()
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.ToolName == toolName && item.Scope == scope && item.Status == "pending")
            .OrderByDescending((item) => item.CreatedAtUtc)
            .Select((item) => item.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<bool> UpdatePendingPayloadAsync(string requestId, string payloadJson, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.Id == requestId && item.Status == "pending", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.RequestPayloadJson = payloadJson;
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> BeginPermanentMaterializationAsync(string sessionId, string requestId, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId && item.Status == "pending", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.Status = "materializing";
        record.Decision = "permanent";
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> CompletePermanentMaterializationAsync(string sessionId, string requestId, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId && item.Status == "materializing" && item.Decision == "permanent", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.Status = "approved";
        record.Decision = "permanent";
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> RevertPermanentMaterializationAsync(string sessionId, string requestId, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId && item.Status == "materializing" && item.Decision == "permanent", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.Status = "pending";
        record.Decision = null;
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> UpdateResolutionAsync(string sessionId, string requestId, string status, string? decision, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId && item.Status == "pending", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.Status = status;
        record.Decision = decision;
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<IReadOnlyList<PermissionRequestInfoRecord>> ExpirePendingAsync(string sessionId, long nowMs, string updatedAt, CancellationToken cancellationToken)
    {
        var records = await dbContext.Set<PermissionRequestRecord>()
            .Where((item) => item.SessionId == sessionId && item.Status == "pending" && item.ExpiresAtMs != null && item.ExpiresAtMs <= nowMs)
            .OrderBy((item) => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        if (records.Count == 0)
        {
            return Array.Empty<PermissionRequestInfoRecord>();
        }

        var nextUpdatedAt = ParseTimestamp(updatedAt);
        foreach (var record in records)
        {
            record.Status = "rejected";
            record.Decision = "reject";
            record.UpdatedAtUtc = nextUpdatedAt;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return records.Select(Map).ToArray();
    }

    public async Task<bool> MarkConsumedAsync(string requestId, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<PermissionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.Id == requestId && item.Status == "approved" && item.Decision == "once", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.Status = "consumed";
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static PermissionRequestInfoRecord Map(PermissionRequestRecord record)
        => new(
            record.Id,
            record.SessionId,
            record.ToolName,
            record.Scope,
            record.Reason,
            record.RiskLevel,
            record.PreviewAction,
            record.Status,
            record.Decision,
            record.RequestPayloadJson,
            record.ExpiresAtMs,
            record.AlwaysJson,
            FormatTimestamp(record.CreatedAtUtc),
            FormatTimestamp(record.UpdatedAtUtc));
    private static DateTimeOffset ParseTimestamp(string value)
        => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static string FormatTimestamp(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
