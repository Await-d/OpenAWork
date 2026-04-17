namespace OpenAWork.Gateway.Contracts.Health;

public sealed record HealthResponse(
    string Status,
    string Service,
    string Provider,
    DateTimeOffset TimestampUtc);
