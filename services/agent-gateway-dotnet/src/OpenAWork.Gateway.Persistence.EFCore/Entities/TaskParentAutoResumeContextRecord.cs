namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class TaskParentAutoResumeContextRecord
{
    public required string ChildSessionId { get; set; }

    public required string ParentSessionId { get; set; }

    public required string UserId { get; set; }

    public required string TaskId { get; set; }

    public required string RequestDataJson { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public SessionRecord? ChildSession { get; set; }

    public SessionRecord? ParentSession { get; set; }

    public UserRecord? User { get; set; }
}
