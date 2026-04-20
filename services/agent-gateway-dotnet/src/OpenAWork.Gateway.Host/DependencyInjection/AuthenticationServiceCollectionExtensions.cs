using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using System.Text.Json;
using OpenAWork.Gateway.Infrastructure.Auth;

namespace OpenAWork.Gateway.Host.DependencyInjection;

public static class AuthenticationServiceCollectionExtensions
{
    public static IServiceCollection AddGatewayAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var secret = JwtConfiguration.ResolveJwtSecret(configuration);
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var issuer = JwtConfiguration.ResolveJwtIssuer(configuration);
        var audience = JwtConfiguration.ResolveJwtAudience(configuration);

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer((options) =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = key,
                    ValidIssuer = issuer,
                    ValidAudience = audience,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.Zero,
                };

                options.Events = new JwtBearerEvents
                {
                    OnChallenge = async (context) =>
                    {
                        context.HandleResponse();
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        context.Response.ContentType = "application/json; charset=utf-8";
                        context.Response.Headers.CacheControl = "no-store";
                        context.Response.Headers.Pragma = "no-cache";
                        await context.Response.WriteAsync(JsonSerializer.Serialize(new { error = "Unauthorized" }));
                    },
                };
            });

        services.AddAuthorization();
        return services;
    }
}
