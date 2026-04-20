namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface ITaskParentAutoResumeContextStore
{
    Task UpsertAsync(TaskParentAutoResumeContextInfoRecord record, CancellationToken cancellationToken);

    Task<TaskParentAutoResumeContextInfoRecord?> ConsumeAsync(
        string childSessionId,
        string parentSessionId,
        string userId,
        CancellationToken cancellationToken);

    Task ClearAsync(string childSessionId, string userId, CancellationToken cancellationToken);
}

public sealed record TaskParentAutoResumeContextInfoRecord(
    string ChildSessionId,
    string ParentSessionId,
    string UserId,
    string TaskId,
    string RequestDataJson,
    string CreatedAt,
    string UpdatedAt);
