using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using MediatR;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Sessions;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Application.Features.Sessions;

public sealed record SearchSessionsQuery(string Query, int Limit) : IQuery<SessionSearchResponse>;

public sealed class SearchSessionsQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<SearchSessionsQuery, SessionSearchResponse>
{
    public async Task<SessionSearchResponse> Handle(SearchSessionsQuery request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var tokens = BuildQueryTokens(request.Query);
        if (tokens.Count == 0)
        {
            return new SessionSearchResponse([]);
        }

        var rows = await (
            from message in dbContext.MessageV2.AsNoTracking()
            join session in dbContext.Sessions.AsNoTracking()
                on new { message.SessionId, message.UserId } equals new { SessionId = session.Id, session.UserId }
            join part in dbContext.PartV2.AsNoTracking()
                on new { MessageId = message.Id, message.UserId } equals new { MessageId = part.MessageId, part.UserId }
            where message.UserId == userId
            select new SessionSearchCandidateRow(
                message.Id,
                message.SessionId,
                message.TimeCreated,
                message.DataJson,
                session.Title,
                session.UpdatedAtUtc,
                part.DataJson)
        ).ToListAsync(cancellationToken);

        var results = rows
            .GroupBy((row) => new SessionSearchKey(row.MessageId, row.SessionId, row.CreatedAtMs, row.MessageDataJson, row.Title, row.UpdatedAtUtc))
            .Select((group) => BuildSearchResult(group, tokens))
            .Where((result) => result is not null)
            .Select((result) => result!)
            .OrderByDescending((result) => result.CreatedAtMs)
            .Take(request.Limit)
            .ToArray();

        return new SessionSearchResponse(results);
    }

    private static SessionSearchResultResponse? BuildSearchResult(
        IGrouping<SessionSearchKey, SessionSearchCandidateRow> group,
        IReadOnlyList<string> tokens)
    {
        var searchableText = string.Join("\n", group
            .Select((item) => ExtractSearchableText(item.PartDataJson))
            .Where((text) => !string.IsNullOrWhiteSpace(text)))
            .Trim();
        if (string.IsNullOrWhiteSpace(searchableText))
        {
            return null;
        }

        if (!tokens.All((token) => searchableText.Contains(token, StringComparison.OrdinalIgnoreCase)))
        {
            return null;
        }

        return new SessionSearchResultResponse(
            group.Key.CreatedAtMs,
            group.Key.MessageId,
            ReadRole(group.Key.MessageDataJson),
            group.Key.SessionId,
            BuildSnippet(searchableText, tokens),
            group.Key.Title,
            FormatTimestamp(group.Key.UpdatedAtUtc));
    }

    private static IReadOnlyList<string> BuildQueryTokens(string query)
        => query
            .Trim()
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where((token) => token.Length > 0)
            .Take(8)
            .ToArray();

    private static string ExtractSearchableText(string partDataJson)
    {
        try
        {
            using var document = JsonDocument.Parse(partDataJson);
            var root = document.RootElement;
            var type = ReadString(root, "type");
            return type switch
            {
                "text" => ReadString(root, "text")?.Trim() ?? string.Empty,
                "modified_files_summary" => JoinNonEmpty(ReadString(root, "title"), ReadString(root, "summary")),
                _ => string.Empty,
            };
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    private static string BuildSnippet(string text, IReadOnlyList<string> tokens)
    {
        var firstIndex = tokens
            .Select((token) => text.IndexOf(token, StringComparison.OrdinalIgnoreCase))
            .Where((index) => index >= 0)
            .DefaultIfEmpty(0)
            .Min();
        var start = Math.Max(0, firstIndex - 24);
        var length = Math.Min(text.Length - start, 120);
        var snippet = text.Substring(start, length);
        if (start > 0)
        {
            snippet = $"…{snippet}";
        }

        if (start + length < text.Length)
        {
            snippet = $"{snippet}…";
        }

        foreach (var token in tokens.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            snippet = Regex.Replace(
                snippet,
                Regex.Escape(token),
                static (match) => $"<mark>{match.Value}</mark>",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        return snippet;
    }

    private static string JoinNonEmpty(string? left, string? right)
        => string.Join("：", new[] { left, right }.Where((value) => !string.IsNullOrWhiteSpace(value)));

    private static string ReadRole(string messageDataJson)
    {
        try
        {
            using var document = JsonDocument.Parse(messageDataJson);
            return ReadString(document.RootElement, "role") ?? "assistant";
        }
        catch (JsonException)
        {
            return "assistant";
        }
    }

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static string FormatTimestamp(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private sealed record SessionSearchCandidateRow(
        string MessageId,
        string SessionId,
        long CreatedAtMs,
        string MessageDataJson,
        string? Title,
        DateTimeOffset UpdatedAtUtc,
        string PartDataJson);

    private sealed record SessionSearchKey(
        string MessageId,
        string SessionId,
        long CreatedAtMs,
        string MessageDataJson,
        string? Title,
        DateTimeOffset UpdatedAtUtc);
}
