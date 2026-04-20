using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Contracts.Observability;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class RequestWorkflowLogStore(GatewayDbContext dbContext) : IRequestWorkflowLogStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task PersistAsync(
        RequestContext context,
        IReadOnlyCollection<WorkflowStep> steps,
        int statusCode,
        string? userId,
        CancellationToken cancellationToken)
    {
        var record = new RequestWorkflowLogRecord
        {
            RequestId = context.RequestId,
            UserId = userId,
            SessionId = DetectSessionId(context.Path),
            Method = context.Method,
            Path = context.Path,
            StatusCode = statusCode,
            Ip = context.Ip,
            UserAgent = context.UserAgent,
            WorkflowJson = JsonSerializer.Serialize(steps.Select(CloneStep), JsonOptions),
            CreatedAtUtc = DateTimeOffset.UtcNow,
        };

        dbContext.RequestWorkflowLogs.Add(record);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<RequestWorkflowLogEntry>> ListByUserAsync(string userId, int limit, CancellationToken cancellationToken)
    {
        return await dbContext.RequestWorkflowLogs
            .AsNoTracking()
            .Where((record) => record.UserId == userId)
            .OrderByDescending((record) => record.Id)
            .Take(limit)
            .Select((record) => new RequestWorkflowLogEntry(
                record.Id,
                record.RequestId,
                record.UserId,
                record.SessionId,
                record.Method,
                record.Path,
                record.StatusCode,
                record.WorkflowJson,
                record.CreatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public Task<int> DeleteErrorLogsByUserAsync(string userId, CancellationToken cancellationToken)
    {
        return dbContext.RequestWorkflowLogs
            .Where((record) => record.UserId == userId && record.StatusCode >= 400)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static string? DetectSessionId(string path)
    {
        var marker = "/sessions/";
        var startIndex = path.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (startIndex < 0)
        {
            return null;
        }

        var remainder = path[(startIndex + marker.Length)..];
        var endIndex = remainder.IndexOf('/');
        return endIndex >= 0 ? remainder[..endIndex] : remainder;
    }

    private static WorkflowStep CloneStep(WorkflowStep step)
    {
        return new WorkflowStep
        {
            Name = step.Name,
            Status = step.Status,
            Message = step.Message,
            DurationMs = step.DurationMs,
            Fields = step.Fields is null ? null : new Dictionary<string, string>(step.Fields),
            StartedAtUtc = null,
            Children = step.Children.Select(CloneStep).ToList(),
        };
    }
}
