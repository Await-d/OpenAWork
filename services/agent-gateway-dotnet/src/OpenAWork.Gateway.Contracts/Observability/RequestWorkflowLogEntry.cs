namespace OpenAWork.Gateway.Contracts.Observability;

public sealed record RequestWorkflowLogEntry(
    long Id,
    string RequestId,
    string? UserId,
    string? SessionId,
    string Method,
    string Path,
    int StatusCode,
    string WorkflowJson,
    DateTimeOffset CreatedAtUtc);
