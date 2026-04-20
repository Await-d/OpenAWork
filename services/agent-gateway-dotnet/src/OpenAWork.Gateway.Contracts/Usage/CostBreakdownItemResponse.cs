namespace OpenAWork.Gateway.Contracts.Usage;

public sealed record CostBreakdownItemResponse(
    string ModelName,
    decimal InputCost,
    decimal OutputCost,
    decimal TotalCost);
