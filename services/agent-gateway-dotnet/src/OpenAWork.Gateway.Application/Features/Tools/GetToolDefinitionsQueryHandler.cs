using MediatR;
using OpenAWork.Gateway.Contracts.Tools;
using OpenAWork.Gateway.Application.Features.Capabilities;

namespace OpenAWork.Gateway.Application.Features.Tools;

public sealed class GetToolDefinitionsQueryHandler : IRequestHandler<GetToolDefinitionsQuery, ToolDefinitionsResponse>
{
    public Task<ToolDefinitionsResponse> Handle(GetToolDefinitionsQuery request, CancellationToken cancellationToken)
    {
        var tools = CapabilityCatalogStaticData.BuildToolDefinitions(presentedNames: !string.IsNullOrWhiteSpace(request.SessionId));
        return Task.FromResult(new ToolDefinitionsResponse(tools));
    }
}
