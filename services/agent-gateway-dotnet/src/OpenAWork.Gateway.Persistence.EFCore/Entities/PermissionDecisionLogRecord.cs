namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class PermissionDecisionLogRecord
{
    public long Id { get; set; }

    public required string RequestId { get; set; }

    public required string SessionId { get; set; }

    public required string ToolName { get; set; }

    public required string Scope { get; set; }

    public required string Decision { get; set; }

    public string? WorkspaceRoot { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }
}
