using System.Text.Json;
using System.Text;
using System.Net.WebSockets;
using System.Threading.RateLimiting;
using MediatR;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.Json;
using OpenAWork.Gateway.Application.DependencyInjection;
using OpenAWork.Gateway.Application.Features.Health;
using OpenAWork.Gateway.Host.Routes;
using OpenAWork.Gateway.Host.DependencyInjection;
using OpenAWork.Gateway.Host.ExceptionHandling;
using OpenAWork.Gateway.Infrastructure.DependencyInjection;
using OpenAWork.Gateway.Infrastructure.Middleware;
using OpenAWork.Gateway.Persistence.EFCore.Services;

namespace OpenAWork.Gateway.Host;

public partial class Program
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        ConfigureGatewayUrls(builder);

        builder.Services.Configure<JsonOptions>((options) =>
        {
            options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        });

        builder.Services.AddCors((options) =>
        {
            options.AddDefaultPolicy((policy) => policy
                .AllowAnyOrigin()
                .AllowAnyHeader()
                .AllowAnyMethod());
        });

        builder.Services.AddProblemDetails();
        builder.Services.AddExceptionHandler<GatewayExceptionHandler>();
        builder.Services.AddRateLimiter((options) =>
        {
            options.AddPolicy("auth", (httpContext) =>
            {
                var remoteIp = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: remoteIp,
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 20,
                        QueueLimit = 0,
                        Window = TimeSpan.FromMinutes(1),
                        AutoReplenishment = true,
                    });
            });
        });
        builder.Services.AddGatewayAuthentication(builder.Configuration);
        builder.Services.AddGatewayApplication();
        builder.Services.AddGatewayInfrastructure(builder.Configuration);
        builder.Services.AddGatewayPersistence(builder.Configuration);

        var app = builder.Build();

        app.UseExceptionHandler(new ExceptionHandlerOptions
        {
            SuppressDiagnosticsCallback = static _ => false,
        });
        app.UseCors();
        app.UseRateLimiter();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseWebSockets();
        app.UseMiddleware<RequestWorkflowMiddleware>();

        app.MapGet("/health", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetHealthQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });
        app.MapAuthRoutes();
        app.MapCommandsRoutes();
        app.MapSessionStreamRoutes();
        app.MapPermissionsRoutes();
        app.MapQuestionsRoutes();
        app.MapSessionsRoutes();
        app.MapAgentsRoutes();
        app.MapWorkflowsRoutes();
        app.MapSettingsRoutes();
        app.MapToolsRoutes();
        app.MapCapabilitiesRoutes();
        app.MapUsageRoutes();

        app.MapGet("/stream/sse", async (HttpContext context) =>
        {
            context.Response.Headers.ContentType = "text/event-stream";
            await context.Response.WriteAsync("event: ready\n", context.RequestAborted);
            await context.Response.WriteAsync("data: {\"status\":\"ready\",\"transport\":\"sse\"}\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
        });

        app.MapGet("/stream/ws", async (HttpContext context) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("WebSocket upgrade required.", context.RequestAborted);
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var payload = Encoding.UTF8.GetBytes("{\"status\":\"ready\",\"transport\":\"websocket\"}");
            await socket.SendAsync(payload, WebSocketMessageType.Text, true, context.RequestAborted);
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "skeleton-ready", context.RequestAborted);
        });

        using (var scope = app.Services.CreateScope())
        {
            var databaseInitializer = scope.ServiceProvider.GetRequiredService<GatewayDatabaseInitializer>();
            await databaseInitializer.InitializeAsync(CancellationToken.None);

            var defaultAdminSeeder = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Auth.IDefaultAdminSeeder>();
            await defaultAdminSeeder.SeedAsync(CancellationToken.None);

            var registrationBootstrapper = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Auth.IUserRegistrationBootstrapper>();
            await registrationBootstrapper.EnsureDefaultsForAllUsersAsync(CancellationToken.None);
        }

        await app.RunAsync();
    }

    private static void ConfigureGatewayUrls(WebApplicationBuilder builder)
    {
        if (!string.IsNullOrWhiteSpace(builder.Configuration["ASPNETCORE_URLS"]))
        {
            return;
        }

        var host = builder.Configuration["GATEWAY_HOST"];
        var port = builder.Configuration["GATEWAY_PORT"];

        var resolvedHost = string.IsNullOrWhiteSpace(host) ? "0.0.0.0" : host;
        var resolvedPort = int.TryParse(port, out var parsedPort) ? parsedPort : 3000;
        builder.WebHost.UseUrls($"http://{resolvedHost}:{resolvedPort}");
    }
}

public partial class Program;
