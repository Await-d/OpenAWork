using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Tools;

namespace OpenAWork.Gateway.Application.Features.Tools;

public sealed record GetToolDefinitionsQuery(string? SessionId) : IQuery<ToolDefinitionsResponse>;
