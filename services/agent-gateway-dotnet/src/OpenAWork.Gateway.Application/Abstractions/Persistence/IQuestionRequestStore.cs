namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface IQuestionRequestStore
{
    Task InsertAsync(QuestionRequestInfoRecord record, CancellationToken cancellationToken);

    Task<QuestionRequestInfoRecord?> GetAsync(string sessionId, string requestId, CancellationToken cancellationToken);

    Task<IReadOnlyList<QuestionRequestInfoRecord>> ListPendingAsync(string sessionId, CancellationToken cancellationToken);

    Task<string?> FindLatestPendingIdAsync(string sessionId, string title, CancellationToken cancellationToken);

    Task<bool> UpdatePendingPayloadAsync(string requestId, string payloadJson, string updatedAt, CancellationToken cancellationToken);

    Task<bool> UpdateResolutionAsync(string sessionId, string requestId, string status, string? answerJson, string updatedAt, CancellationToken cancellationToken);

    Task<IReadOnlyList<QuestionRequestInfoRecord>> ExpirePendingAsync(string sessionId, long nowMs, string updatedAt, CancellationToken cancellationToken);
}

public sealed record QuestionRequestInfoRecord(
    string Id,
    string SessionId,
    string UserId,
    string ToolName,
    string Title,
    string QuestionsJson,
    string? AnswerJson,
    string? RequestPayloadJson,
    long? ExpiresAtMs,
    string Status,
    string CreatedAt,
    string UpdatedAt);
