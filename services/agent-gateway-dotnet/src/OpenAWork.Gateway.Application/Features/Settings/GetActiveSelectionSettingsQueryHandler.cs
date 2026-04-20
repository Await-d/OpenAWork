using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetActiveSelectionSettingsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetActiveSelectionSettingsQuery, ActiveSelectionSettingsResponse>
{
    public async Task<ActiveSelectionSettingsResponse> Handle(GetActiveSelectionSettingsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var providers = await userSettingsReader.GetValueAsync(userId, "providers", cancellationToken);
        var value = await userSettingsReader.GetValueAsync(userId, "active_selection", cancellationToken);

        var materializedProviders = ProviderSettingsMaterializer.MaterializeProviders(ProviderSettingsMaterializer.ParseStoredProviders(providers));
        return new ActiveSelectionSettingsResponse(ProviderSettingsMaterializer.MaterializeActiveSelection(materializedProviders, value));
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }

    internal static ActiveSelectionResponse ParseActiveSelection(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return EmptySelection();
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            var root = document.RootElement;
            return new ActiveSelectionResponse(
                ParseSlot(root, "chat"),
                ParseSlot(root, "fast"),
                ParseOptionalSlot(root, "compaction"));
        }
        catch (JsonException)
        {
            return EmptySelection();
        }
    }

    private static ActiveSelectionItemResponse ParseSlot(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var slot) || slot.ValueKind != JsonValueKind.Object)
        {
            return EmptySelectionItem();
        }

        return new ActiveSelectionItemResponse(
            ProviderId: ReadString(slot, "providerId"),
            ModelId: ReadString(slot, "modelId"));
    }

    private static ActiveSelectionItemResponse? ParseOptionalSlot(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var slot) || slot.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ActiveSelectionItemResponse(
            ProviderId: ReadString(slot, "providerId"),
            ModelId: ReadString(slot, "modelId"));
    }

    private static string ReadString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? string.Empty
            : string.Empty;
    }

    private static ActiveSelectionResponse EmptySelection() => new(EmptySelectionItem(), EmptySelectionItem(), null);

    private static ActiveSelectionItemResponse EmptySelectionItem() => new(string.Empty, string.Empty);
}
