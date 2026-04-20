namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class SessionRecord
{
    public required string Id { get; set; }

    public required string UserId { get; set; }

    public required string MessagesJson { get; set; }

    public required string StateStatus { get; set; }

    public required string MetadataJson { get; set; }

    public string? Title { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public UserRecord? User { get; set; }
}
