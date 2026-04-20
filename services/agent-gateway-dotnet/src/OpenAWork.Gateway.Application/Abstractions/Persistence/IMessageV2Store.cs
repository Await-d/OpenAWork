namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface IMessageV2Store
{
    Task InsertMessageAsync(MessageV2InfoRecord message, CancellationToken cancellationToken);

    Task UpdateMessageAsync(MessageV2InfoRecord message, CancellationToken cancellationToken);

    Task DeleteMessageAsync(string sessionId, string userId, string messageId, CancellationToken cancellationToken);

    Task<MessageV2InfoRecord?> GetMessageAsync(string sessionId, string messageId, CancellationToken cancellationToken);

    Task<IReadOnlyList<MessageV2InfoRecord>> ListMessagesAsync(string sessionId, string userId, long? afterTime, int limit, CancellationToken cancellationToken);

    Task InsertPartAsync(PartV2InfoRecord part, CancellationToken cancellationToken);

    Task UpdatePartAsync(PartV2InfoRecord part, CancellationToken cancellationToken);

    Task DeletePartAsync(string sessionId, string partId, CancellationToken cancellationToken);

    Task<PartV2InfoRecord?> GetPartAsync(string sessionId, string messageId, string partId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PartV2InfoRecord>> ListPartsForMessageAsync(string sessionId, string messageId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PartV2InfoRecord>> ListPartsForSessionAsync(string sessionId, long? afterTime, CancellationToken cancellationToken);

    Task UpdatePartDeltaAsync(string sessionId, string messageId, string partId, string field, string delta, CancellationToken cancellationToken);

    Task<IReadOnlyList<MessageWithPartsRecord>> ListMessagesWithPartsAsync(string sessionId, string userId, int limit, CancellationToken cancellationToken);

    Task<MessageV2ScopedResult?> GetMessageByRequestIdAsync(string sessionId, string userId, string clientRequestId, string role, CancellationToken cancellationToken);

    Task<IReadOnlyList<MessageV2InfoRecord>> ListMessagesByRequestScopeAsync(string sessionId, string userId, string clientRequestId, CancellationToken cancellationToken);

    Task UpdateMessagesStatusByRequestScopeAsync(string sessionId, string userId, string clientRequestId, string status, IReadOnlyList<string>? roles, CancellationToken cancellationToken);

    Task DeleteMessagesByRequestScopeAsync(string sessionId, string userId, string clientRequestId, IReadOnlyList<string>? roles, CancellationToken cancellationToken);
}

public sealed record MessageV2InfoRecord(
    string Id,
    string SessionId,
    string UserId,
    long TimeCreated,
    string DataJson,
    string CreatedAt,
    string UpdatedAt);

public sealed record PartV2InfoRecord(
    string Id,
    string MessageId,
    string SessionId,
    string UserId,
    long TimeCreated,
    string DataJson,
    string CreatedAt,
    string UpdatedAt);

public sealed record MessageWithPartsRecord(
    MessageV2InfoRecord Message,
    IReadOnlyList<PartV2InfoRecord> Parts);

public sealed record MessageV2ScopedResult(
    MessageV2InfoRecord Message,
    string Status);
