namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class EventLogRecord
{
    public required string Id { get; set; }

    public required string AggregateId { get; set; }

    public long Seq { get; set; }

    public required string Type { get; set; }

    public int Version { get; set; }

    public required string DataJson { get; set; }

    public long Timestamp { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }
}
