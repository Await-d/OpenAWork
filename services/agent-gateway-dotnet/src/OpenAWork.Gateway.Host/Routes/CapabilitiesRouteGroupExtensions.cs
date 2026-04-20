using MediatR;
using OpenAWork.Gateway.Application.Features.Capabilities;

namespace OpenAWork.Gateway.Host.Routes;

public static class CapabilitiesRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapCapabilitiesRoutes(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/capabilities", async (string? sessionId, ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetCapabilitiesQuery(sessionId), cancellationToken);
            return TypedResults.Ok(response);
        }).RequireAuthorization();

        return endpoints;
    }
}
