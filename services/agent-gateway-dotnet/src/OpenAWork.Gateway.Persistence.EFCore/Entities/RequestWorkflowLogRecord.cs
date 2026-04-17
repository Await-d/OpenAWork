namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class RequestWorkflowLogRecord
{
    public long Id { get; set; }

    public required string RequestId { get; set; }

    public string? UserId { get; set; }

    public string? SessionId { get; set; }

    public required string Method { get; set; }

    public required string Path { get; set; }

    public int StatusCode { get; set; }

    public string? Ip { get; set; }

    public string? UserAgent { get; set; }

    public required string WorkflowJson { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }
}
