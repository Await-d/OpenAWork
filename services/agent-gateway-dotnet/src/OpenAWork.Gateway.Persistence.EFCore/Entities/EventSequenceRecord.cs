namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class EventSequenceRecord
{
    public required string AggregateId { get; set; }

    public long Seq { get; set; }
}
