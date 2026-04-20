namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompanionPreferencesResponse(
    bool Enabled,
    bool Muted,
    bool ReducedMotion,
    string Verbosity,
    string InjectionMode,
    string ThemeVariant,
    bool VoiceOutputEnabled,
    string VoiceOutputMode,
    double VoiceRate,
    string VoiceVariant);
