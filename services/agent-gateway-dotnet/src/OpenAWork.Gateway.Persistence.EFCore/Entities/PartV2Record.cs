namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class PartV2Record
{
    public required string Id { get; set; }

    public required string MessageId { get; set; }

    public required string SessionId { get; set; }

    public required string UserId { get; set; }

    public long TimeCreated { get; set; }

    public required string DataJson { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public MessageV2Record? Message { get; set; }

    public SessionRecord? Session { get; set; }

    public UserRecord? User { get; set; }
}
