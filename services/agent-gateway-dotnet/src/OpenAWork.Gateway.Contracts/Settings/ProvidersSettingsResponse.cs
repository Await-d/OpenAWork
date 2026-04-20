using System.Text.Json;

namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record ProvidersSettingsResponse(
    IReadOnlyList<JsonElement> Providers,
    ActiveSelectionResponse ActiveSelection,
    JsonElement DefaultThinking);
