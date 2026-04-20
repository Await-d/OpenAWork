using MediatR;
using OpenAWork.Gateway.Application.Features.Tools;

namespace OpenAWork.Gateway.Host.Routes;

public static class ToolsRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapToolsRoutes(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/tools/definitions", async (string? sessionId, ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetToolDefinitionsQuery(sessionId), cancellationToken);
            return TypedResults.Ok(response);
        }).RequireAuthorization();

        return endpoints;
    }
}
