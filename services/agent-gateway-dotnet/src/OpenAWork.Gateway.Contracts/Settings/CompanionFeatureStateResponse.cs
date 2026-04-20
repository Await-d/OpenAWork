namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompanionFeatureStateResponse(
    bool Enabled,
    string Mode);
