namespace OpenAWork.Gateway.Contracts.Usage;

public sealed record UsageRecordResponse(
    string Month,
    decimal TotalCostUsd,
    long TotalInputTokens,
    long TotalOutputTokens,
    IReadOnlyDictionary<string, decimal> ByProvider);
