namespace OpenAWork.Gateway.Contracts.Capabilities;

public sealed record CanonicalRoleResponse(
    string CoreRole,
    string? Preset,
    IReadOnlyList<string>? Overlays,
    string? Confidence);
