using FluentValidation;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Behaviors;

namespace OpenAWork.Gateway.Application.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddGatewayApplication(this IServiceCollection services)
    {
        services.AddMediatR((configuration) =>
        {
            configuration.RegisterServicesFromAssembly(typeof(ServiceCollectionExtensions).Assembly);
            configuration.AddOpenBehavior(typeof(ValidationBehavior<,>));
            configuration.AddOpenBehavior(typeof(LoggingBehavior<,>));
            configuration.AddOpenBehavior(typeof(TransactionBehavior<,>));
        });

        services.AddValidatorsFromAssembly(typeof(ServiceCollectionExtensions).Assembly);
        return services;
    }
}
