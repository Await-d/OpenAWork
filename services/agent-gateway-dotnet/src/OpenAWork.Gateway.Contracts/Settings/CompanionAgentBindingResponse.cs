using System.Text.Json.Serialization;

namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompanionAgentBindingResponse(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    string Species,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ThemeVariant,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? BehaviorTone,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? InjectionMode,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Verbosity,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? VoiceOutputMode,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? VoiceRate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? VoiceVariant);
