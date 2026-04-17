using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetCompactionSettingsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetCompactionSettingsQuery, CompactionSettingsResponse>
{
    private const string CompactionSettingsKey = "compaction_policy_v1";

    public async Task<CompactionSettingsResponse> Handle(GetCompactionSettingsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var value = await userSettingsReader.GetValueAsync(userId, CompactionSettingsKey, cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return new CompactionSettingsResponse(true, true, 6, null);
        }

        try
        {
            var parsed = System.Text.Json.JsonDocument.Parse(value).RootElement;
            var auto = TryReadBoolean(parsed, "auto") ?? true;
            var prune = TryReadBoolean(parsed, "prune") ?? true;
            var recentMessagesKept = parsed.TryGetProperty("recentMessagesKept", out var recentElement) && recentElement.TryGetInt32(out var recent)
                ? Math.Max(recent, 0)
                : 6;
            int? reserved = parsed.TryGetProperty("reserved", out var reservedElement) && reservedElement.TryGetInt32(out var reservedValue)
                ? Math.Max(reservedValue, 0)
                : null;

            return new CompactionSettingsResponse(auto, prune, recentMessagesKept, reserved);
        }
        catch (System.Text.Json.JsonException)
        {
            return new CompactionSettingsResponse(true, true, 6, null);
        }
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }

    private static bool? TryReadBoolean(System.Text.Json.JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            System.Text.Json.JsonValueKind.True => true,
            System.Text.Json.JsonValueKind.False => false,
            _ => null,
        };
    }
}
