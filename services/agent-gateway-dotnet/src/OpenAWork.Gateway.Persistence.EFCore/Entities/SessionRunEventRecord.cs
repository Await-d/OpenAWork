namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class SessionRunEventRecord
{
    public long Id { get; set; }

    public required string SessionId { get; set; }

    public string? UserId { get; set; }

    public string? ClientRequestId { get; set; }

    public long? Seq { get; set; }

    public required string EventType { get; set; }

    public string? EventId { get; set; }

    public string? RunId { get; set; }

    public long? OccurredAtMs { get; set; }

    public required string PayloadJson { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public SessionRecord? Session { get; set; }

    public UserRecord? User { get; set; }
}
