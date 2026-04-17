using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Infrastructure.Auth;
using OpenAWork.Gateway.Infrastructure.HostedServices;
using OpenAWork.Gateway.Infrastructure.Observability;

namespace OpenAWork.Gateway.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddGatewayInfrastructure(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpContextCurrentUser>();
        services.AddScoped<IRequestWorkflowTracker, RequestWorkflowTracker>();
        services.AddHostedService<GatewayHeartbeatService>();
        return services;
    }
}
