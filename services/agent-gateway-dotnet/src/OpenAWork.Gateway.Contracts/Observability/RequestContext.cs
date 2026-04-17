namespace OpenAWork.Gateway.Contracts.Observability;

public sealed record RequestContext(
    string RequestId,
    string Method,
    string Path,
    string? Ip,
    string? UserAgent,
    DateTimeOffset StartTimeUtc);
