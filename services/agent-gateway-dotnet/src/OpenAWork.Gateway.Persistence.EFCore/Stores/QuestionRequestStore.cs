using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class QuestionRequestStore(GatewayDbContext dbContext) : IQuestionRequestStore
{
    public async Task InsertAsync(QuestionRequestInfoRecord record, CancellationToken cancellationToken)
    {
        dbContext.Add(new QuestionRequestRecord
        {
            Id = record.Id,
            SessionId = record.SessionId,
            UserId = record.UserId,
            ToolName = record.ToolName,
            Title = record.Title,
            QuestionsJson = record.QuestionsJson,
            AnswerJson = record.AnswerJson,
            RequestPayloadJson = record.RequestPayloadJson,
            ExpiresAtMs = record.ExpiresAtMs,
            Status = record.Status,
            CreatedAtUtc = ParseTimestamp(record.CreatedAt),
            UpdatedAtUtc = ParseTimestamp(record.UpdatedAt),
        });
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<QuestionRequestInfoRecord?> GetAsync(string sessionId, string requestId, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<QuestionRequestRecord>()
            .AsNoTracking()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId, cancellationToken);
        return record is null ? null : Map(record);
    }

    public async Task<IReadOnlyList<QuestionRequestInfoRecord>> ListPendingAsync(string sessionId, CancellationToken cancellationToken)
    {
        var records = await dbContext.Set<QuestionRequestRecord>()
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.Status == "pending")
            .OrderBy((item) => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        return records.Select(Map).ToArray();
    }

    public async Task<string?> FindLatestPendingIdAsync(string sessionId, string title, CancellationToken cancellationToken)
    {
        return await dbContext.Set<QuestionRequestRecord>()
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.Title == title && item.Status == "pending")
            .OrderByDescending((item) => item.CreatedAtUtc)
            .Select((item) => item.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<bool> UpdatePendingPayloadAsync(string requestId, string payloadJson, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<QuestionRequestRecord>()
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

    public async Task<bool> UpdateResolutionAsync(string sessionId, string requestId, string status, string? answerJson, string updatedAt, CancellationToken cancellationToken)
    {
        var record = await dbContext.Set<QuestionRequestRecord>()
            .SingleOrDefaultAsync((item) => item.SessionId == sessionId && item.Id == requestId && item.Status == "pending", cancellationToken);
        if (record is null)
        {
            return false;
        }

        record.Status = status;
        record.AnswerJson = answerJson;
        record.UpdatedAtUtc = ParseTimestamp(updatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<IReadOnlyList<QuestionRequestInfoRecord>> ExpirePendingAsync(string sessionId, long nowMs, string updatedAt, CancellationToken cancellationToken)
    {
        var records = await dbContext.Set<QuestionRequestRecord>()
            .Where((item) => item.SessionId == sessionId && item.Status == "pending" && item.ExpiresAtMs != null && item.ExpiresAtMs <= nowMs)
            .OrderBy((item) => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        if (records.Count == 0)
        {
            return Array.Empty<QuestionRequestInfoRecord>();
        }

        var nextUpdatedAt = ParseTimestamp(updatedAt);
        foreach (var record in records)
        {
            record.Status = "dismissed";
            record.AnswerJson = null;
            record.UpdatedAtUtc = nextUpdatedAt;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return records.Select(Map).ToArray();
    }

    private static QuestionRequestInfoRecord Map(QuestionRequestRecord record)
        => new(
            record.Id,
            record.SessionId,
            record.UserId,
            record.ToolName,
            record.Title,
            record.QuestionsJson,
            record.AnswerJson,
            record.RequestPayloadJson,
            record.ExpiresAtMs,
            record.Status,
            FormatTimestamp(record.CreatedAtUtc),
            FormatTimestamp(record.UpdatedAtUtc));
    private static DateTimeOffset ParseTimestamp(string value)
        => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static string FormatTimestamp(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
