namespace OpenAWork.Gateway.Contracts.Usage;

public sealed record UsageRecordsResponse(
    IReadOnlyList<UsageRecordResponse> Records,
    decimal BudgetUsd);
