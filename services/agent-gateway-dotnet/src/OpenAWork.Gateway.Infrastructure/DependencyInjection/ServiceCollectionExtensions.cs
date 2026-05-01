using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Infrastructure.Auth;
using OpenAWork.Gateway.Infrastructure.HostedServices;
using OpenAWork.Gateway.Infrastructure.Observability;
using OpenAWork.Gateway.Infrastructure.Settings;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Application.Features.Stream;
using OpenAWork.Gateway.Infrastructure.Streaming;

namespace OpenAWork.Gateway.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddGatewayInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpContextCurrentUser>();
        services.AddScoped<IDefaultAdminSeeder, DefaultAdminSeeder>();
        services.AddSingleton<IJwtTokenIssuer>(_ => new JwtTokenIssuer(configuration));
        services.AddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();
        services.AddSingleton<IRefreshTokenFactory, RefreshTokenFactory>();
        services.AddSingleton<IWorkflowLlmClient, WorkflowLlmClient>();
        services.AddSingleton<ISessionStreamRequestRegistry, InMemorySessionStreamRequestRegistry>();
        services.AddSingleton<ISessionRunEventBroadcaster, InMemorySessionRunEventBroadcaster>();
        services.AddScoped<ISessionStreamRuntimeService, SessionStreamRuntimeService>();
        services.AddScoped<ISessionRuntimeReconciler, SessionRuntimeReconciler>();
        services.AddScoped<IRequestWorkflowTracker, RequestWorkflowTracker>();
        services.AddHostedService<GatewayHeartbeatService>();
        return services;
    }
}
