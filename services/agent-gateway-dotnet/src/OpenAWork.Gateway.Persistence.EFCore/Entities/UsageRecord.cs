namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class UsageRecord
{
    public long Id { get; set; }

    public required string UserId { get; set; }

    public required string Month { get; set; }

    public long InputTokens { get; set; }

    public long OutputTokens { get; set; }

    public decimal CostUsd { get; set; }

    public UserRecord? User { get; set; }
}
