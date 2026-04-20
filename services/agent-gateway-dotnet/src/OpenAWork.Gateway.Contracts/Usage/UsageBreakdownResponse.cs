namespace OpenAWork.Gateway.Contracts.Usage;

public sealed record UsageBreakdownResponse(
    decimal MonthlyCostUsd,
    IReadOnlyList<CostBreakdownItemResponse> Breakdown);
