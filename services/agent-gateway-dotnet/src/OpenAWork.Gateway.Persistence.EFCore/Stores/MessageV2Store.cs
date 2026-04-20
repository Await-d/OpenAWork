using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class MessageV2Store(GatewayDbContext dbContext) : IMessageV2Store
{
    public async Task InsertMessageAsync(MessageV2InfoRecord message, CancellationToken cancellationToken)
    {
        var existing = await dbContext.MessageV2.SingleOrDefaultAsync(
            (item) => item.Id == message.Id && item.SessionId == message.SessionId,
            cancellationToken);

        if (existing is not null)
        {
            existing.DataJson = message.DataJson;
            existing.UpdatedAtUtc = ParseTimestamp(message.UpdatedAt);
            await dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        dbContext.MessageV2.Add(new MessageV2Record
        {
            Id = message.Id,
            SessionId = message.SessionId,
            UserId = message.UserId,
            TimeCreated = message.TimeCreated,
            DataJson = message.DataJson,
            CreatedAtUtc = ParseTimestamp(message.CreatedAt),
            UpdatedAtUtc = ParseTimestamp(message.UpdatedAt),
        });

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateMessageAsync(MessageV2InfoRecord message, CancellationToken cancellationToken)
    {
        var record = await dbContext.MessageV2.SingleAsync((item) => item.Id == message.Id && item.SessionId == message.SessionId, cancellationToken);
        record.DataJson = message.DataJson;
        record.UpdatedAtUtc = ParseTimestamp(message.UpdatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteMessageAsync(string sessionId, string userId, string messageId, CancellationToken cancellationToken)
    {
        await dbContext.MessageV2
            .Where((item) => item.Id == messageId && item.SessionId == sessionId && item.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    public Task<MessageV2InfoRecord?> GetMessageAsync(string sessionId, string messageId, CancellationToken cancellationToken)
    {
        return dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.Id == messageId && item.SessionId == sessionId)
            .Select(MapMessage)
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<MessageV2InfoRecord>> ListMessagesAsync(string sessionId, string userId, long? afterTime, int limit, CancellationToken cancellationToken)
    {
        var query = dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.UserId == userId);

        if (afterTime is not null)
        {
            query = query.Where((item) => item.TimeCreated > afterTime.Value);
        }

        return await query
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .Take(limit)
            .Select(MapMessage)
            .ToListAsync(cancellationToken);
    }

    public async Task InsertPartAsync(PartV2InfoRecord part, CancellationToken cancellationToken)
    {
        var existing = await dbContext.PartV2.SingleOrDefaultAsync(
            (item) => item.Id == part.Id && item.MessageId == part.MessageId && item.SessionId == part.SessionId,
            cancellationToken);

        if (existing is not null)
        {
            existing.DataJson = part.DataJson;
            existing.UpdatedAtUtc = ParseTimestamp(part.UpdatedAt);
            await dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        dbContext.PartV2.Add(new PartV2Record
        {
            Id = part.Id,
            MessageId = part.MessageId,
            SessionId = part.SessionId,
            UserId = part.UserId,
            TimeCreated = part.TimeCreated,
            DataJson = part.DataJson,
            CreatedAtUtc = ParseTimestamp(part.CreatedAt),
            UpdatedAtUtc = ParseTimestamp(part.UpdatedAt),
        });

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdatePartAsync(PartV2InfoRecord part, CancellationToken cancellationToken)
    {
        var record = await dbContext.PartV2.SingleAsync((item) => item.Id == part.Id && item.MessageId == part.MessageId && item.SessionId == part.SessionId, cancellationToken);
        record.DataJson = part.DataJson;
        record.UpdatedAtUtc = ParseTimestamp(part.UpdatedAt);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public Task DeletePartAsync(string sessionId, string partId, CancellationToken cancellationToken)
    {
        return dbContext.PartV2
            .Where((item) => item.Id == partId && item.SessionId == sessionId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    public Task<PartV2InfoRecord?> GetPartAsync(string sessionId, string messageId, string partId, CancellationToken cancellationToken)
    {
        return dbContext.PartV2
            .AsNoTracking()
            .Where((item) => item.Id == partId && item.MessageId == messageId && item.SessionId == sessionId)
            .Select(MapPart)
            .SingleOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PartV2InfoRecord>> ListPartsForMessageAsync(string sessionId, string messageId, CancellationToken cancellationToken)
    {
        return await dbContext.PartV2
            .AsNoTracking()
            .Where((item) => item.MessageId == messageId && item.SessionId == sessionId)
            .OrderBy((item) => item.Id)
            .Select(MapPart)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PartV2InfoRecord>> ListPartsForSessionAsync(string sessionId, long? afterTime, CancellationToken cancellationToken)
    {
        var query = dbContext.PartV2
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId);

        if (afterTime is not null)
        {
            query = query.Where((item) => item.TimeCreated > afterTime.Value);
        }

        return await query
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .Select(MapPart)
            .ToListAsync(cancellationToken);
    }

    public async Task UpdatePartDeltaAsync(string sessionId, string messageId, string partId, string field, string delta, CancellationToken cancellationToken)
    {
        var record = await dbContext.PartV2.SingleOrDefaultAsync((item) => item.Id == partId && item.MessageId == messageId && item.SessionId == sessionId, cancellationToken);
        if (record is null)
        {
            return;
        }

        var data = JsonNode.Parse(record.DataJson)?.AsObject() ?? new JsonObject();
        var existing = data[field] is JsonValue value && value.TryGetValue<string>(out var existingText)
            ? existingText
            : string.Empty;
        data[field] = existing + delta;
        record.DataJson = data.ToJsonString();
        record.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<MessageWithPartsRecord>> ListMessagesWithPartsAsync(string sessionId, string userId, int limit, CancellationToken cancellationToken)
    {
        var messages = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .Take(limit)
            .Select(MapMessage)
            .ToListAsync(cancellationToken);

        if (messages.Count == 0)
        {
            return Array.Empty<MessageWithPartsRecord>();
        }

        var messageIds = messages.Select((message) => message.Id).ToArray();
        var parts = await dbContext.PartV2
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && messageIds.Contains(item.MessageId))
            .OrderBy((item) => item.MessageId)
            .ThenBy((item) => item.Id)
            .Select(MapPart)
            .ToListAsync(cancellationToken);

        var partsByMessageId = parts.GroupBy((part) => part.MessageId, StringComparer.Ordinal)
            .ToDictionary((group) => group.Key, (group) => (IReadOnlyList<PartV2InfoRecord>)group.ToArray(), StringComparer.Ordinal);

        return messages
            .Select((message) => new MessageWithPartsRecord(message, partsByMessageId.GetValueOrDefault(message.Id) ?? Array.Empty<PartV2InfoRecord>()))
            .ToArray();
    }

    public async Task<MessageV2ScopedResult?> GetMessageByRequestIdAsync(string sessionId, string userId, string clientRequestId, string role, CancellationToken cancellationToken)
    {
        var messages = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .Select(MapMessage)
            .ToListAsync(cancellationToken);
        var message = messages.FirstOrDefault((candidate) =>
        {
            using var document = JsonDocument.Parse(candidate.DataJson);
            var root = document.RootElement;
            var candidateRole = ReadString(root, "role");
            var requestId = ReadString(root, "clientRequestId");
            return candidateRole == role && requestId == clientRequestId;
        });

        if (message is null)
        {
            return null;
        }

        using var parsed = JsonDocument.Parse(message.DataJson);
        var status = ReadString(parsed.RootElement, "status") == "error" ? "error" : "final";
        return new MessageV2ScopedResult(message, status);
    }

    public async Task<IReadOnlyList<MessageV2InfoRecord>> ListMessagesByRequestScopeAsync(string sessionId, string userId, string clientRequestId, CancellationToken cancellationToken)
    {
        var messages = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == sessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .Select(MapMessage)
            .ToListAsync(cancellationToken);
        return messages.Where((message) =>
        {
            using var document = JsonDocument.Parse(message.DataJson);
            var requestId = ReadString(document.RootElement, "clientRequestId");
            return requestId == clientRequestId || requestId?.StartsWith($"{clientRequestId}:", StringComparison.Ordinal) == true;
        }).ToArray();
    }

    public async Task UpdateMessagesStatusByRequestScopeAsync(string sessionId, string userId, string clientRequestId, string status, IReadOnlyList<string>? roles, CancellationToken cancellationToken)
    {
        var roleFilter = roles is null ? null : new HashSet<string>(roles, StringComparer.Ordinal);
        var records = await dbContext.MessageV2
            .Where((item) => item.SessionId == sessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .ToListAsync(cancellationToken);

        var changed = false;
        foreach (var record in records)
        {
            using var document = JsonDocument.Parse(record.DataJson);
            var root = document.RootElement;
            var requestId = ReadString(root, "clientRequestId");
            var role = ReadString(root, "role");
            var matchesRequest = requestId == clientRequestId || requestId?.StartsWith($"{clientRequestId}:", StringComparison.Ordinal) == true;
            var matchesRole = roleFilter is null ? true : (role is not null && roleFilter.Contains(role));
            if (!matchesRequest || !matchesRole)
            {
                continue;
            }

            var data = JsonNode.Parse(record.DataJson)?.AsObject() ?? new JsonObject();
            data["status"] = status;
            record.DataJson = data.ToJsonString();
            record.UpdatedAtUtc = DateTimeOffset.UtcNow;
            changed = true;
        }

        if (changed)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task DeleteMessagesByRequestScopeAsync(string sessionId, string userId, string clientRequestId, IReadOnlyList<string>? roles, CancellationToken cancellationToken)
    {
        var roleFilter = roles is null ? null : new HashSet<string>(roles, StringComparer.Ordinal);
        var records = await dbContext.MessageV2
            .Where((item) => item.SessionId == sessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .ToListAsync(cancellationToken);

        var targetIds = new List<string>();
        foreach (var record in records)
        {
            using var document = JsonDocument.Parse(record.DataJson);
            var root = document.RootElement;
            var requestId = ReadString(root, "clientRequestId");
            var role = ReadString(root, "role");
            var matchesRequest = requestId == clientRequestId || requestId?.StartsWith($"{clientRequestId}:", StringComparison.Ordinal) == true;
            var matchesRole = roleFilter is null ? true : (role is not null && roleFilter.Contains(role));
            if (matchesRequest && matchesRole)
            {
                targetIds.Add(record.Id);
            }
        }

        if (targetIds.Count == 0)
        {
            return;
        }

        await dbContext.PartV2
            .Where((item) => item.SessionId == sessionId && targetIds.Contains(item.MessageId))
            .ExecuteDeleteAsync(cancellationToken);
        await dbContext.MessageV2
            .Where((item) => item.SessionId == sessionId && item.UserId == userId && targetIds.Contains(item.Id))
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static MessageV2InfoRecord MapMessage(MessageV2Record record)
        => new(
            record.Id,
            record.SessionId,
            record.UserId,
            record.TimeCreated,
            record.DataJson,
            FormatTimestamp(record.CreatedAtUtc),
            FormatTimestamp(record.UpdatedAtUtc));

    private static PartV2InfoRecord MapPart(PartV2Record record)
        => new(
            record.Id,
            record.MessageId,
            record.SessionId,
            record.UserId,
            record.TimeCreated,
            record.DataJson,
            FormatTimestamp(record.CreatedAtUtc),
            FormatTimestamp(record.UpdatedAtUtc));

    private static DateTimeOffset ParseTimestamp(string value)
        => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static string FormatTimestamp(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}
