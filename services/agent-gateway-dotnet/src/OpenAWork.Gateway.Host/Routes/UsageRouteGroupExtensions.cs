using MediatR;
using OpenAWork.Gateway.Application.Features.Usage;

namespace OpenAWork.Gateway.Host.Routes;

public static class UsageRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapUsageRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/usage").RequireAuthorization();

        group.MapGet("/records", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetUsageRecordsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/breakdown", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetUsageBreakdownQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        return endpoints;
    }
}
