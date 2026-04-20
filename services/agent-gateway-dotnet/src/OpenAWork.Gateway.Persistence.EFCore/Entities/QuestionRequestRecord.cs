namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class QuestionRequestRecord
{
    public required string Id { get; set; }

    public required string SessionId { get; set; }

    public required string UserId { get; set; }

    public required string ToolName { get; set; }

    public required string Title { get; set; }

    public required string QuestionsJson { get; set; }

    public string? AnswerJson { get; set; }

    public string? RequestPayloadJson { get; set; }

    public long? ExpiresAtMs { get; set; }

    public required string Status { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public SessionRecord? Session { get; set; }

    public UserRecord? User { get; set; }
}
