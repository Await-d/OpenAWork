using MediatR;
using OpenAWork.Gateway.Application.Features.Settings;

namespace OpenAWork.Gateway.Host.Routes;

public static class SettingsRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapSettingsRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/settings").RequireAuthorization();

        group.MapGet("/model-prices", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetModelPricesQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/workers", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetWorkersQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/mcp-status", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetMcpStatusQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/upstream-retry", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetUpstreamRetrySettingsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/compaction", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetCompactionSettingsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/file-patterns", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetFilePatternsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        return endpoints;
    }
}
