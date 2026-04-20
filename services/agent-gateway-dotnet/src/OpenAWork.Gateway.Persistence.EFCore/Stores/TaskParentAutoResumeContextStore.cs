using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class TaskParentAutoResumeContextStore(GatewayDbContext dbContext) : ITaskParentAutoResumeContextStore
{
    public async Task UpsertAsync(TaskParentAutoResumeContextInfoRecord record, CancellationToken cancellationToken)
    {
        var existing = await dbContext.Set<TaskParentAutoResumeContextRecord>()
            .SingleOrDefaultAsync((item) => item.ChildSessionId == record.ChildSessionId, cancellationToken);

        if (existing is null)
        {
            dbContext.Add(new TaskParentAutoResumeContextRecord
            {
                ChildSessionId = record.ChildSessionId,
                ParentSessionId = record.ParentSessionId,
                UserId = record.UserId,
                TaskId = record.TaskId,
                RequestDataJson = record.RequestDataJson,
                CreatedAtUtc = ParseTimestamp(record.CreatedAt),
                UpdatedAtUtc = ParseTimestamp(record.UpdatedAt),
            });
        }
        else
        {
            existing.ParentSessionId = record.ParentSessionId;
            existing.UserId = record.UserId;
            existing.TaskId = record.TaskId;
            existing.RequestDataJson = record.RequestDataJson;
            existing.UpdatedAtUtc = ParseTimestamp(record.UpdatedAt);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<TaskParentAutoResumeContextInfoRecord?> ConsumeAsync(
        string childSessionId,
        string parentSessionId,
        string userId,
        CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<TaskParentAutoResumeContextRecord>()
            .SingleOrDefaultAsync(
                (item) => item.ChildSessionId == childSessionId && item.ParentSessionId == parentSessionId && item.UserId == userId,
                cancellationToken);
        if (record is null)
        {
            return null;
        }

        var result = Map(record);
        dbContext.Remove(record);
        await dbContext.SaveChangesAsync(cancellationToken);
        return result;
    }

    public Task ClearAsync(string childSessionId, string userId, CancellationToken cancellationToken)
        => dbContext.Set<TaskParentAutoResumeContextRecord>()
            .Where((item) => item.ChildSessionId == childSessionId && item.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

    private static TaskParentAutoResumeContextInfoRecord Map(TaskParentAutoResumeContextRecord record)
        => new(
            record.ChildSessionId,
            record.ParentSessionId,
            record.UserId,
            record.TaskId,
            record.RequestDataJson,
            FormatTimestamp(record.CreatedAtUtc),
            FormatTimestamp(record.UpdatedAtUtc));

    private static DateTimeOffset ParseTimestamp(string value)
        => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static string FormatTimestamp(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
