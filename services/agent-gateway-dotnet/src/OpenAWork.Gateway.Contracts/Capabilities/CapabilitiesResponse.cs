namespace OpenAWork.Gateway.Contracts.Capabilities;

public sealed record CapabilitiesResponse(IReadOnlyList<CapabilityDescriptorResponse> Capabilities);
