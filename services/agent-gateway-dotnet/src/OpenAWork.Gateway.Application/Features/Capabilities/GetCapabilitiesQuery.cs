using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Capabilities;

namespace OpenAWork.Gateway.Application.Features.Capabilities;

public sealed record GetCapabilitiesQuery(string? SessionId) : IQuery<CapabilitiesResponse>;
