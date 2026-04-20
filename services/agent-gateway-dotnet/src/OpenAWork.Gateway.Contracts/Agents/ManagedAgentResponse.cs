using OpenAWork.Gateway.Contracts.Capabilities;

namespace OpenAWork.Gateway.Contracts.Agents;

public sealed record ManagedAgentResponse(
    string Id,
    string Origin,
    string Source,
    bool Enabled,
    bool Removable,
    bool Resettable,
    bool HasOverrides,
    string CreatedAt,
    string UpdatedAt,
    string Label,
    string Description,
    IReadOnlyList<string> Aliases,
    CanonicalRoleResponse? CanonicalRole,
    string? Model,
    string? Variant,
    IReadOnlyList<string>? FallbackModels,
    string? SystemPrompt,
    string? Color,
    string? Note);

public sealed record ManagedAgentsResponse(IReadOnlyList<ManagedAgentResponse> Agents);

public sealed record ManagedAgentEnvelopeResponse(ManagedAgentResponse Agent);
