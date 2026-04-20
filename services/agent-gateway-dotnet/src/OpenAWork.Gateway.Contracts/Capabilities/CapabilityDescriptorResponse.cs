namespace OpenAWork.Gateway.Contracts.Capabilities;

public sealed record CapabilityDescriptorResponse(
    string Id,
    string Kind,
    string Label,
    string Description,
    string Source,
    IReadOnlyList<string>? Tags,
    bool? Enabled,
    bool? Callable,
    CanonicalRoleResponse? CanonicalRole,
    IReadOnlyList<string>? Aliases);
