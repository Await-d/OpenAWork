using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetProvidersSettingsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetProvidersSettingsQuery, ProvidersSettingsResponse>
{
    internal static readonly JsonElement DefaultThinking = JsonSerializer.SerializeToElement(new
    {
        chat = new { enabled = false, effort = "medium" },
        fast = new { enabled = false, effort = "medium" },
    });

    public async Task<ProvidersSettingsResponse> Handle(GetProvidersSettingsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var providersRaw = await userSettingsReader.GetValueAsync(userId, "providers", cancellationToken);
        var activeSelectionRaw = await userSettingsReader.GetValueAsync(userId, "active_selection", cancellationToken);
        var defaultThinkingRaw = await userSettingsReader.GetValueAsync(userId, "default_thinking", cancellationToken);

        var materializedProviders = ProviderSettingsMaterializer.MaterializeProviders(ProviderSettingsMaterializer.ParseStoredProviders(providersRaw));
        var providers = request.EnabledOnly ? FilterEnabledProviders(materializedProviders) : materializedProviders;
        var activeSelection = ProviderSettingsMaterializer.MaterializeActiveSelection(materializedProviders, activeSelectionRaw);
        var defaultThinking = ParseDefaultThinking(defaultThinkingRaw);

        return new ProvidersSettingsResponse(providers, activeSelection, defaultThinking);
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }

    private static IReadOnlyList<JsonElement> FilterEnabledProviders(IReadOnlyList<JsonElement> providers)
    {
        var filtered = new List<JsonElement>();

        foreach (var provider in providers)
        {
            if (provider.ValueKind != JsonValueKind.Object || !IsEnabled(provider))
            {
                continue;
            }

            var models = GetModelsElement(provider);
            if (models is null)
            {
                continue;
            }

            var enabledModels = models.Value.EnumerateArray().Where(IsEnabled).ToArray();
            if (enabledModels.Length == 0)
            {
                continue;
            }

            var normalized = JsonSerializer.SerializeToElement(provider.EnumerateObject().ToDictionary(
                (property) => property.Name,
                (property) => property.NameEquals("defaultModels") || property.NameEquals("models")
                    ? JsonSerializer.SerializeToElement(enabledModels)
                    : property.Value.Clone()));

            filtered.Add(normalized);
        }

        return filtered;
    }

    private static bool IsEnabled(JsonElement element)
    {
        return !element.TryGetProperty("enabled", out var enabledProperty)
            || enabledProperty.ValueKind != JsonValueKind.False;
    }

    internal static JsonElement ParseDefaultThinking(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return DefaultThinking;
        }

        try
        {
            return JsonDocument.Parse(value).RootElement.Clone();
        }
        catch (JsonException)
        {
            return DefaultThinking;
        }
    }

    private static JsonElement? GetModelsElement(JsonElement provider)
    {
        if (provider.TryGetProperty("defaultModels", out var defaultModels) && defaultModels.ValueKind == JsonValueKind.Array)
        {
            return defaultModels;
        }

        if (provider.TryGetProperty("models", out var models) && models.ValueKind == JsonValueKind.Array)
        {
            return models;
        }

        return null;
    }
}
