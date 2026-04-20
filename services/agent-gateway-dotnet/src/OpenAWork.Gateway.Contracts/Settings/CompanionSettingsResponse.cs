using System.Text.Json.Serialization;

namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompanionSettingsResponse(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] CompanionAgentBindingResponse? ActiveBinding,
    IReadOnlyDictionary<string, CompanionAgentBindingResponse> Bindings,
    CompanionFeatureStateResponse Feature,
    CompanionPreferencesResponse Preferences,
    CompanionProfileResponse Profile);
